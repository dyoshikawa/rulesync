import { join } from "node:path";

import { uniq } from "es-toolkit";
import { z } from "zod/mini";

import { QWENCODE_DIR, QWENCODE_SETTINGS_FILE_NAME } from "../../constants/qwencode-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import type {
  PermissionAction,
  PermissionsConfig,
  QwencodePermissionsOverride,
} from "../../types/permissions.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import { fallbackLogger, type Logger } from "../../utils/logger.js";
import { applySharedConfigPatch, sharedConfigFileKey } from "../shared/shared-config-gateway.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
import {
  ToolPermissions,
  type ToolPermissionsForDeletionParams,
  type ToolPermissionsFromFileParams,
  type ToolPermissionsFromRulesyncPermissionsParams,
  type ToolPermissionsSettablePaths,
} from "./tool-permissions.js";

/**
 * Qwen Code uses a settings.json file in `.qwen/` (project) or `~/.qwen/` (global).
 * The shape mirrors Claude Code's `permissions.allow/ask/deny` arrays with
 * entries like `Bash(<pattern>)`, `Read(<pattern>)`, etc.
 */

const QwenSettingsPermissionsSchema = z.looseObject({
  allow: z.optional(z.array(z.string())),
  ask: z.optional(z.array(z.string())),
  deny: z.optional(z.array(z.string())),
});

const QwenSettingsSchema = z.looseObject({
  permissions: z.optional(QwenSettingsPermissionsSchema),
});

type QwenSettings = z.infer<typeof QwenSettingsSchema>;

// Shared fallback logger used by the importing direction (toRulesyncPermissions), where the
// instance method has no `logger` parameter. The exporting direction (fromRulesyncPermissions)
// forwards the caller-supplied logger explicitly. Unlike a private ConsoleLogger instance,
// `fallbackLogger` is configured from CLI flags and the resolved config, so `silent` is honored.
const moduleLogger: Logger = fallbackLogger;

/**
 * Mapping from rulesync canonical tool category names (lowercase) to Qwen Code tool names (PascalCase).
 * Unknown names pass through as-is (e.g., mcp__server__tool).
 */
const CANONICAL_TO_QWEN_TOOL_NAMES: Record<string, string> = {
  bash: "Bash",
  read: "Read",
  edit: "Edit",
  write: "Write",
  webfetch: "WebFetch",
  websearch: "WebSearch",
  grep: "Grep",
  glob: "Glob",
  agent: "Agent",
};

const QWEN_TO_CANONICAL_TOOL_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(CANONICAL_TO_QWEN_TOOL_NAMES).map(([k, v]) => [v, k]),
);

function toQwenToolName(canonical: string): string {
  return CANONICAL_TO_QWEN_TOOL_NAMES[canonical] ?? canonical;
}

function toCanonicalToolName(qwenName: string): string {
  return QWEN_TO_CANONICAL_TOOL_NAMES[qwenName] ?? qwenName;
}

type ParsedQwenEntry =
  | { ok: true; toolName: string; pattern: string }
  | { ok: false; toolName: string; raw: string };

function parseQwenPermissionEntry(
  entry: string,
  options: { logger?: Logger } = {},
): ParsedQwenEntry {
  const parenIndex = entry.indexOf("(");
  if (parenIndex === -1) {
    return { ok: true, toolName: entry, pattern: "*" };
  }
  const toolName = entry.slice(0, parenIndex);
  // Use `lastIndexOf(')')` so patterns containing nested parentheses (e.g. `Bash(echo (a))`) round-trip
  // without truncating the inner content. If no closing paren is found, the entry is malformed.
  const lastParenIndex = entry.lastIndexOf(")");
  if (lastParenIndex < parenIndex) {
    options.logger?.warn(
      `Qwen permissions: malformed entry '${entry}' is missing a closing parenthesis.`,
    );
    return { ok: false, toolName, raw: entry };
  }
  // The entry MUST end with the last `)` — anything trailing it (e.g. `Bash(...)x`) is malformed.
  if (lastParenIndex !== entry.length - 1) {
    options.logger?.warn(
      `Qwen permissions: malformed entry '${entry}' has trailing characters after the closing parenthesis.`,
    );
    return { ok: false, toolName, raw: entry };
  }
  const pattern = entry.slice(parenIndex + 1, lastParenIndex);
  return { ok: true, toolName, pattern: pattern || "*" };
}

function buildQwenPermissionEntry(toolName: string, pattern: string): string {
  if (pattern === "*") {
    return toolName;
  }
  return `${toolName}(${pattern})`;
}

// The `tools`/`security` sub-keys that the `qwencode` override authors and that
// round-trip back into it on import. Kept explicit so unrelated `tools`/
// `security` keys are not pulled into the canonical model on import. The
// deprecated `tools.exclude` is intentionally excluded — Qwen recommends
// expressing those denials via `permissions.deny`, which the shared block owns.
const QWEN_OVERRIDE_TOOLS_KEYS = [
  "approvalMode",
  "autoAccept",
  "sandbox",
  "sandboxImage",
  "disabled",
  // Deferred tool names made visible at startup without tool_search (union
  // merge across scopes) — the counterpart of the `disabled` registry control.
  // Added in Qwen Code v0.19.7. https://github.com/QwenLM/qwen-code/pull/6372
  "visible",
  // `{ enabled: boolean }` toggle for the built-in `list_directory` tool, off by
  // default because `glob` covers the same ground. Added in Qwen Code v0.23.0.
  "listDirectory",
  // Enables the Workflow tool and the `/workflows` command. Added in Qwen Code
  // v0.23.0 and honored in user/system settings only — see
  // `QWEN_GLOBAL_ONLY_TOOLS_KEYS`. https://github.com/QwenLM/qwen-code/pull/9098
  "workflowsEnabled",
] as const;
// Upstream documents `tools.workflowsEnabled` as honored from User/System/
// SystemDefaults scopes only, with workspace values ignored, so emitting it into
// project settings would be dead configuration. Generate drops it there with a
// warning, exactly as it does for the global-only `security` keys.
const QWEN_GLOBAL_ONLY_TOOLS_KEYS: readonly (typeof QWEN_OVERRIDE_TOOLS_KEYS)[number][] = [
  "workflowsEnabled",
];
// `allowedHttpHookUrls` (URL patterns allowed as `type: "http"` hook targets; an
// empty list means allow-all) and `allowPrivateNetworkHooks` (relaxes the SSRF
// private-IP check) gate the HTTP hooks rulesync emits. Both are authored through
// the override's `security` group.
const QWEN_OVERRIDE_SECURITY_KEYS = [
  "folderTrust",
  "allowedHttpHookUrls",
  "allowPrivateNetworkHooks",
] as const;
// Upstream's settings schema documents `allowPrivateNetworkHooks` as honored only
// from User/System/SystemDefaults scopes: a Workspace (project) value is ignored
// by design so that a cloned repository cannot self-grant private-network access.
// Emitting it into project settings would therefore be dead configuration, so
// generate drops it there with a warning.
const QWEN_GLOBAL_ONLY_SECURITY_KEYS: readonly (typeof QWEN_OVERRIDE_SECURITY_KEYS)[number][] = [
  "allowPrivateNetworkHooks",
];
// The single source of truth pairing each override group with its global-only
// keys. Both directions read it — the generate-side scope gate and the
// import-side promotion warning — so a new group or key cannot be wired into
// one of them and forgotten in the other.
const QWEN_GLOBAL_ONLY_GROUPS = [
  { groupName: "tools", globalOnlyKeys: QWEN_GLOBAL_ONLY_TOOLS_KEYS },
  { groupName: "security", globalOnlyKeys: QWEN_GLOBAL_ONLY_SECURITY_KEYS },
] as const;
// The `permissions` sub-keys the `qwencode` override authors. `autoMode` (the
// Auto Mode classifier config) is a sibling of `allow`/`ask`/`deny` under
// `permissions` with no canonical category, so it round-trips through the
// override rather than the shared allow/ask/deny arrays.
const QWEN_OVERRIDE_PERMISSIONS_KEYS = ["autoMode"] as const;

function asPlainRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Pick the override-managed keys out of a settings group into a fresh record. */
function pickQwenOverrideKeys(group: unknown, keys: readonly string[]): Record<string, unknown> {
  const source = asPlainRecord(group);
  const picked: Record<string, unknown> = {};
  for (const key of keys) {
    if (source[key] !== undefined) picked[key] = source[key];
  }
  return picked;
}

/**
 * Apply the scope rule for a settings group's global-only keys.
 *
 * Generating project settings drops them — Qwen Code ignores a workspace value
 * by design, so writing one would be dead configuration — and warns once per
 * dropped key. Only the override copy is filtered, so a value the user already
 * wrote into the project file stays untouched.
 *
 * Generating global settings keeps them, but a key whose whole point is that a
 * workspace cannot self-grant it is worth announcing when it is granted: the
 * `.rulesync/permissions.jsonc` carrying it may have arrived with a cloned or
 * fetched repository, and the global file applies to every project on this
 * machine. So a value that widens what Qwen Code does without asking is named,
 * alongside the value it replaces, exactly as the deepagents startup override
 * announces its own relaxations.
 */
function scopeOverrideGroup(
  overrideGroup: unknown,
  {
    groupName,
    globalOnlyKeys,
    existingGroup,
    global,
    relativeFilePath,
    logger,
  }: {
    groupName: string;
    globalOnlyKeys: readonly string[];
    existingGroup: unknown;
    global: boolean;
    relativeFilePath: string;
    logger?: Logger;
  },
): Record<string, unknown> {
  const scoped = { ...asPlainRecord(overrideGroup) };
  const previous = asPlainRecord(existingGroup);
  for (const key of globalOnlyKeys) {
    const value = scoped[key];
    if (value === undefined) continue;
    if (!global) {
      delete scoped[key];
      logger?.warn(
        `Qwen permissions: '${groupName}.${key}' is only honored in user/system settings, so it is skipped for the project-scoped ${relativeFilePath}. Author it in the global scope instead.`,
      );
      continue;
    }
    // Every global-only key is a boolean that grants something when `true`, so
    // `false` (and a value the file already had) relaxes nothing and would only
    // bury the case that does.
    if (value !== true || previous[key] === true) continue;
    const replaced = previous[key] === undefined ? "" : ` (was ${JSON.stringify(previous[key])})`;
    logger?.warn(
      `Qwen permissions: the qwencode override wrote '${groupName}.${key}' = true${replaced} into ${relativeFilePath}, your global Qwen Code settings. Qwen Code ignores this key in workspace settings so a repository cannot grant it per project; in the global scope it applies to every project on this machine.`,
    );
  }
  return scoped;
}

/**
 * Build the `tools`/`security` patch groups contributed by the `qwencode`
 * override. Each group is shallow-merged over what `settings.json` already has,
 * after the scope gate has handled the keys Qwen Code honors in one scope only.
 */
function buildOverrideGroupsPatch({
  settings,
  override,
  global,
  relativeFilePath,
  logger,
}: {
  settings: QwenSettings;
  override: QwencodePermissionsOverride | undefined;
  global: boolean;
  relativeFilePath: string;
  logger?: Logger;
}): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const { groupName, globalOnlyKeys } of QWEN_GLOBAL_ONLY_GROUPS) {
    const overrideGroup = override?.[groupName];
    if (overrideGroup === undefined) continue;
    const existingGroup = settings[groupName];
    const scoped = scopeOverrideGroup(overrideGroup, {
      groupName,
      globalOnlyKeys,
      existingGroup,
      global,
      relativeFilePath,
      logger,
    });
    const merged = { ...asPlainRecord(existingGroup), ...scoped };
    // An override whose only key was scoped away leaves nothing to write, so do
    // not add an empty group object to a file that had none.
    if (Object.keys(merged).length > 0) {
      patch[groupName] = merged;
    }
  }
  return patch;
}

/**
 * Warn about a global-only key lifted out of a settings file being imported.
 * The file carries no scope marker, so import keeps the key either way — but
 * regenerating in the global scope would turn a value Qwen Code ignored in a
 * workspace into one it enforces everywhere, and a settings file read out of a
 * cloned repository is exactly where such a value comes from.
 */
function warnAboutImportedGlobalOnlyKeys(groups: Record<string, Record<string, unknown>>): void {
  for (const { groupName, globalOnlyKeys } of QWEN_GLOBAL_ONLY_GROUPS) {
    const group = groups[groupName] ?? {};
    for (const key of globalOnlyKeys) {
      // Only a granting value is worth flagging; see `scopeOverrideGroup`.
      if (group[key] !== true) continue;
      moduleLogger.warn(
        `Qwen permissions: imported '${groupName}.${key}' = true. Qwen Code ignores it in workspace settings but enforces it in user/system settings, so review it before generating with the global scope.`,
      );
    }
  }
}

export class QwencodePermissions extends ToolPermissions {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "{}",
    });
    // Mirror `RulesyncPermissions` so that `fromFile({ validate: true })` actually
    // verifies schema conformance and throws on malformed input. Without this
    // wiring, the `validate()` method exists but is never invoked at construction
    // time, so callers reading `validate: true` would falsely assume validation
    // already ran.
    if (params.validate) {
      const result = this.validate();
      if (!result.success) {
        throw result.error;
      }
    }
  }

  override isDeletable(): boolean {
    return false;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolPermissionsSettablePaths {
    return {
      relativeDirPath: QWENCODE_DIR,
      relativeFilePath: QWENCODE_SETTINGS_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolPermissionsFromFileParams): Promise<QwencodePermissions> {
    const paths = QwencodePermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? '{"permissions":{}}';
    return new QwencodePermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
    });
  }

  static async fromRulesyncPermissions({
    outputRoot = process.cwd(),
    rulesyncPermissions,
    global = false,
    logger,
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<QwencodePermissions> {
    const paths = QwencodePermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    // Read without initializing so generation has no filesystem side effects
    // when the destination directory does not yet exist (important for dry-run);
    // the actual write happens later in `writeAiFiles`.
    const existingContent = (await readFileContentOrNull(filePath)) ?? "{}";

    let settings: QwenSettings;
    try {
      const parsed = JSON.parse(existingContent);
      const result = QwenSettingsSchema.safeParse(parsed);
      if (!result.success) {
        throw new Error(formatError(result.error));
      }
      settings = result.data;
    } catch (error) {
      throw new Error(
        `Failed to parse existing Qwen settings at ${filePath}: ${formatError(error)}`,
        { cause: error },
      );
    }

    const config = rulesyncPermissions.getJson();
    const { allow, ask, deny } = convertRulesyncToQwenPermissions(config);

    const managedToolNames = new Set(
      Object.keys(config.permission).map((category) => toQwenToolName(category)),
    );

    const existingPermissions = settings.permissions ?? {};
    // For preservation filtering we only need the tool name; whether the entry is malformed is
    // irrelevant here since we are forwarding it verbatim back into the merged output.
    const preservedAllow = (existingPermissions.allow ?? []).filter(
      (entry) => !managedToolNames.has(parseQwenPermissionEntry(entry, { logger }).toolName),
    );
    const preservedAsk = (existingPermissions.ask ?? []).filter(
      (entry) => !managedToolNames.has(parseQwenPermissionEntry(entry, { logger }).toolName),
    );
    const preservedDeny = (existingPermissions.deny ?? []).filter(
      (entry) => !managedToolNames.has(parseQwenPermissionEntry(entry, { logger }).toolName),
    );

    const mergedPermissions: {
      allow?: string[];
      ask?: string[];
      deny?: string[];
      [k: string]: unknown;
    } = {
      ...existingPermissions,
    };

    const mergedAllow = uniq([...preservedAllow, ...allow].toSorted());
    const mergedAsk = uniq([...preservedAsk, ...ask].toSorted());
    const mergedDeny = uniq([...preservedDeny, ...deny].toSorted());

    if (mergedAllow.length > 0) {
      mergedPermissions.allow = mergedAllow;
    } else {
      delete mergedPermissions.allow;
    }
    if (mergedAsk.length > 0) {
      mergedPermissions.ask = mergedAsk;
    } else {
      delete mergedPermissions.ask;
    }
    if (mergedDeny.length > 0) {
      mergedPermissions.deny = mergedDeny;
    } else {
      delete mergedPermissions.deny;
    }

    const override = config.qwencode;

    // Overlay the Qwen-scoped override's `permissions.autoMode` (the Auto Mode
    // classifier config). It has no canonical category and would otherwise be
    // dropped on round-trip. Replaces the existing `autoMode` wholesale, matching
    // how the override's nested objects (e.g. `security.folderTrust`) behave.
    if (override?.autoMode !== undefined) {
      mergedPermissions.autoMode = override.autoMode;
    }

    const patch: Record<string, unknown> = { permissions: mergedPermissions };

    // Overlay the Qwen-scoped override's `tools`/`security` groups (autonomy and
    // sandbox settings). Shallow-merged at the top level of each group, so an
    // unrelated sibling key (e.g. `tools.core`) is preserved while an override
    // key wins; a nested object the override supplies (e.g. `security.folderTrust`)
    // replaces the existing one wholesale rather than being deep-merged.
    Object.assign(
      patch,
      buildOverrideGroupsPatch({
        settings,
        override,
        global,
        relativeFilePath: paths.relativeFilePath,
        logger,
      }),
    );

    const fileContent = applySharedConfigPatch({
      fileKey: sharedConfigFileKey(paths),
      feature: "permissions",
      existingContent,
      patch,
      filePath,
    });

    return new QwencodePermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate: true,
    });
  }

  toRulesyncPermissions(): RulesyncPermissions {
    let settings: QwenSettings;
    try {
      const parsed = JSON.parse(this.getFileContent());
      const result = QwenSettingsSchema.safeParse(parsed);
      if (!result.success) {
        throw new Error(formatError(result.error));
      }
      settings = result.data;
    } catch (error) {
      throw new Error(
        `Failed to parse Qwen permissions content in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        { cause: error },
      );
    }

    const permissions = settings.permissions ?? {};
    const config = convertQwenToRulesyncPermissions({
      allow: permissions.allow ?? [],
      ask: permissions.ask ?? [],
      deny: permissions.deny ?? [],
    });

    // Route Qwen's autonomy/sandbox settings into the `qwencode` override — they
    // have no canonical category and would otherwise be dropped on round-trip.
    // Import lifts every override-managed key regardless of scope: the file being
    // read carries no scope marker, and dropping a global-only key here would lose
    // a user's real setting. The scope gate lives on the generate side.
    const overrideTools = pickQwenOverrideKeys(settings.tools, QWEN_OVERRIDE_TOOLS_KEYS);
    const overrideSecurity = pickQwenOverrideKeys(settings.security, QWEN_OVERRIDE_SECURITY_KEYS);
    warnAboutImportedGlobalOnlyKeys({ tools: overrideTools, security: overrideSecurity });
    const overridePermissions = pickQwenOverrideKeys(
      settings.permissions,
      QWEN_OVERRIDE_PERMISSIONS_KEYS,
    );
    const qwencodeOverride: Record<string, unknown> = {};
    if (Object.keys(overrideTools).length > 0) qwencodeOverride.tools = overrideTools;
    if (Object.keys(overrideSecurity).length > 0) qwencodeOverride.security = overrideSecurity;
    if (overridePermissions.autoMode !== undefined) {
      qwencodeOverride.autoMode = overridePermissions.autoMode;
    }

    const result: Record<string, unknown> = { ...config };
    if (Object.keys(qwencodeOverride).length > 0) {
      result.qwencode = qwencodeOverride;
    }

    return this.toRulesyncPermissionsDefault({
      fileContent: JSON.stringify(result, null, 2),
    });
  }

  validate(): ValidationResult {
    // Mirror Kilo's `safeParse`-based pattern: actually verify that the file
    // content is JSON-parseable and conforms to the Qwen settings schema.
    // A no-op validate would let malformed files slip past the
    // generate/import boundary and surface as confusing errors deeper in the
    // pipeline.
    try {
      const parsed = JSON.parse(this.fileContent || "{}");
      const result = QwenSettingsSchema.safeParse(parsed);
      if (!result.success) {
        return { success: false, error: result.error };
      }
      return { success: true, error: null };
    } catch (error) {
      return {
        success: false,
        error: new Error(`Failed to parse Qwen permissions JSON: ${formatError(error)}`),
      };
    }
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolPermissionsForDeletionParams): QwencodePermissions {
    return new QwencodePermissions({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({ permissions: {} }, null, 2),
      validate: false,
    });
  }
}

function convertRulesyncToQwenPermissions(config: PermissionsConfig): {
  allow: string[];
  ask: string[];
  deny: string[];
} {
  const allow: string[] = [];
  const ask: string[] = [];
  const deny: string[] = [];

  for (const [category, rules] of Object.entries(config.permission)) {
    const qwenToolName = toQwenToolName(category);
    for (const [pattern, action] of Object.entries(rules)) {
      const entry = buildQwenPermissionEntry(qwenToolName, pattern);
      switch (action) {
        case "allow":
          allow.push(entry);
          break;
        case "ask":
          ask.push(entry);
          break;
        case "deny":
          deny.push(entry);
          break;
      }
    }
  }

  return { allow, ask, deny };
}

function convertQwenToRulesyncPermissions(params: {
  allow: string[];
  ask: string[];
  deny: string[];
  logger?: Logger;
}): PermissionsConfig {
  const permission: Record<string, Record<string, PermissionAction>> = {};
  // Forward a logger to `parseQwenPermissionEntry` so its malformed-entry warnings are not
  // dead code in production. Default to the module-level ConsoleLogger when the caller did not
  // supply one (the instance-side `toRulesyncPermissions()` has no logger parameter to thread).
  const logger = params.logger ?? moduleLogger;

  const processEntries = (entries: string[], action: PermissionAction) => {
    for (const entry of entries) {
      const parsed = parseQwenPermissionEntry(entry, { logger });
      if (!parsed.ok) {
        // Fail-closed asymmetry by category:
        // - `deny`: keep the existing fallback to `*` so a malformed deny still blocks (broader is safer).
        // - `allow` / `ask`: dropping is safer than broadening a narrow user rule into `*`. The
        //   already-emitted warn from `parseQwenPermissionEntry` makes the drop visible.
        if (action === "deny") {
          const canonical = toCanonicalToolName(parsed.toolName);
          if (!permission[canonical]) {
            permission[canonical] = {};
          }
          permission[canonical]["*"] = action;
        }
        continue;
      }
      const { toolName, pattern } = parsed;
      const canonical = toCanonicalToolName(toolName);
      if (!permission[canonical]) {
        permission[canonical] = {};
      }
      permission[canonical][pattern] = action;
    }
  };

  processEntries(params.allow, "allow");
  processEntries(params.ask, "ask");
  processEntries(params.deny, "deny");

  return { permission };
}
