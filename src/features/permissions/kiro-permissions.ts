import { join } from "node:path";

import { z } from "zod/mini";

import { KIRO_AGENTS_DIR_PATH, KIRO_HOOKS_FILE_NAME } from "../../constants/kiro-paths.js";
import type { ValidationResult } from "../../types/ai-file.js";
import type { PermissionAction, PermissionsConfig } from "../../types/permissions.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import { isPrototypePollutionKey } from "../../utils/prototype-pollution.js";
import { isPlainObject } from "../../utils/type-guards.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
import {
  ToolPermissions,
  type ToolPermissionsForDeletionParams,
  type ToolPermissionsFromFileParams,
  type ToolPermissionsFromRulesyncPermissionsParams,
  type ToolPermissionsSettablePaths,
} from "./tool-permissions.js";

const KiroAgentSchema = z.looseObject({
  allowedTools: z.optional(z.array(z.string())),
  toolsSettings: z.optional(z.record(z.string(), z.unknown())),
});

type KiroAgent = z.infer<typeof KiroAgentSchema>;
const UnknownRecordSchema = z.record(z.string(), z.unknown());

// Shell settings driven by the canonical `bash` category (allow/deny command
// lists). Every OTHER `toolsSettings.shell` key (e.g. the auto-trust flags
// `autoAllowReadonly` / `denyByDefault`) has no canonical home and is authored /
// round-tripped through the `kiro` override instead.
const CANONICAL_SHELL_KEYS = new Set(["allowedCommands", "deniedCommands"]);

export class KiroPermissions extends ToolPermissions {
  static getSettablePaths(_options: { global?: boolean } = {}): ToolPermissionsSettablePaths {
    return {
      relativeDirPath: KIRO_AGENTS_DIR_PATH,
      relativeFilePath: KIRO_HOOKS_FILE_NAME,
    };
  }

  override isDeletable(): boolean {
    return false;
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
  }: ToolPermissionsFromFileParams): Promise<KiroPermissions> {
    const paths = this.getSettablePaths();
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? JSON.stringify({}, null, 2);
    return new KiroPermissions({
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
    validate = true,
    logger,
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<KiroPermissions> {
    const paths = this.getSettablePaths();
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = (await readFileContentOrNull(filePath)) ?? JSON.stringify({}, null, 2);

    const parsedResult = KiroAgentSchema.safeParse(JSON.parse(existingContent));
    if (!parsedResult.success) {
      throw new Error(
        `Failed to parse existing Kiro agent config at ${filePath}: ${formatError(parsedResult.error)}`,
      );
    }

    const config = rulesyncPermissions.getJson();
    const next = buildKiroPermissionsFromRulesync({ config, logger, existing: parsedResult.data });

    return new KiroPermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify(next, null, 2),
      validate,
    });
  }

  toRulesyncPermissions(): RulesyncPermissions {
    let parsed: KiroAgent;
    try {
      parsed = KiroAgentSchema.parse(JSON.parse(this.getFileContent()));
    } catch (error) {
      throw new Error(
        `Failed to parse Kiro permissions content in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        { cause: error },
      );
    }

    const permission: PermissionsConfig["permission"] = {};
    const toolsSettings = parsed.toolsSettings ?? {};

    const shellRules = rulesFromArrays(
      asRecord(toolsSettings.shell),
      "allowedCommands",
      "deniedCommands",
    );
    if (Object.keys(shellRules).length > 0) permission.bash = shellRules;

    // read/write/grep/glob all use `{ allowedPaths, deniedPaths }` under their
    // own toolsSettings key, mapping 1:1 to the canonical category name.
    for (const category of ["read", "write", "grep", "glob"] as const) {
      const rules = rulesFromArrays(
        asRecord(toolsSettings[category]),
        "allowedPaths",
        "deniedPaths",
      );
      if (Object.keys(rules).length > 0) permission[category] = rules;
    }

    const allowedTools = new Set(parsed.allowedTools ?? []);
    if (allowedTools.has("web_fetch")) {
      permission.webfetch = { "*": "allow" };
    }
    if (allowedTools.has("web_search")) {
      permission.websearch = { "*": "allow" };
    }

    // Extract the Kiro-specific `toolsSettings` knobs with no canonical category
    // (shell auto-trust flags, the `aws` service lists, the `web_fetch` domain
    // trust arrays) into the `kiro` override so they round-trip and are authorable.
    const kiroOverride = extractKiroOverride(toolsSettings);

    const result: Record<string, unknown> = { permission };
    if (kiroOverride !== undefined) {
      result.kiro = kiroOverride;
    }

    return this.toRulesyncPermissionsDefault({
      fileContent: JSON.stringify(result, null, 2),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolPermissionsForDeletionParams): KiroPermissions {
    return new KiroPermissions({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({}, null, 2),
      validate: false,
    });
  }
}

function buildKiroPermissionsFromRulesync({
  config,
  logger,
  existing,
}: {
  config: PermissionsConfig;
  logger?: ToolPermissionsFromRulesyncPermissionsParams["logger"];
  existing: KiroAgent;
}): KiroAgent {
  const nextAllowedTools = new Set(existing.allowedTools ?? []);
  const nextToolsSettings = { ...asRecord(existing.toolsSettings) };

  // Path/command categories map to a `{ <allowKey>: [], <denyKey>: [] }` table
  // under a `toolsSettings` key. `edit` and `write` both fold into `write`.
  const pathBuckets: Record<string, { allow: string[]; deny: string[] }> = {};
  const pushPath = (key: string, action: PermissionAction, pattern: string): void => {
    const bucket = (pathBuckets[key] ??= { allow: [], deny: [] });
    (action === "allow" ? bucket.allow : bucket.deny).push(pattern);
  };
  const shell = { allowedCommands: [] as string[], deniedCommands: [] as string[] };

  for (const [category, rules] of Object.entries(config.permission)) {
    for (const [pattern, action] of Object.entries(rules)) {
      if (action === "ask") {
        logger?.warn(`Kiro permissions do not support "ask". Skipping ${category}:${pattern}`);
        continue;
      }
      if (category === "bash") {
        (action === "allow" ? shell.allowedCommands : shell.deniedCommands).push(pattern);
      } else if (category === "read" || category === "grep" || category === "glob") {
        pushPath(category, action, pattern);
      } else if (category === "edit" || category === "write") {
        pushPath("write", action, pattern);
      } else if (category === "webfetch" || category === "websearch") {
        applyKiroWebPermission({ category, pattern, action, nextAllowedTools, logger });
      } else {
        logger?.warn(`Kiro permissions do not support category: ${category}. Skipping.`);
      }
    }
  }

  // `shell`/`read`/`write` are always emitted (even empty) to match the prior
  // behavior; `grep`/`glob` are only emitted when they carry a rule so existing
  // configs do not gain empty tables. For `shell`, preserve any non-canonical
  // flags already in the file (e.g. `autoAllowReadonly` / `denyByDefault`) rather
  // than clobbering the whole object with just the command lists — the `kiro`
  // override below then wins over them when it authors those flags.
  nextToolsSettings.shell = { ...preservedShellFlags(existing), ...shell };
  nextToolsSettings.read = pathTable(pathBuckets.read);
  nextToolsSettings.write = pathTable(pathBuckets.write);
  for (const key of ["grep", "glob"] as const) {
    const bucket = pathBuckets[key];
    if (bucket && (bucket.allow.length > 0 || bucket.deny.length > 0)) {
      nextToolsSettings[key] = pathTable(bucket);
    }
  }

  // Apply the `kiro` override: Kiro-specific `toolsSettings` knobs with no
  // canonical category (shell auto-trust flags, the `aws` service lists, the
  // `web_fetch` domain trust arrays). Deep-merge per `toolsSettings` key so the
  // override's leaf values win without discarding the canonical-generated
  // siblings (e.g. authoring `shell.autoAllowReadonly` keeps the generated
  // `shell.allowedCommands`).
  applyKiroOverride({ override: config.kiro, nextToolsSettings });

  return {
    ...existing,
    allowedTools: [...nextAllowedTools].toSorted(),
    toolsSettings: nextToolsSettings,
  };
}

/**
 * Non-canonical `toolsSettings.shell` keys already present in the existing agent
 * config (everything except the canonical `allowed`/`deniedCommands`), so a
 * regenerate does not silently drop a hand-set `autoAllowReadonly` /
 * `denyByDefault` when no `kiro` override re-authors it.
 */
function preservedShellFlags(existing: KiroAgent): Record<string, unknown> {
  const existingShell = asRecord(asRecord(existing.toolsSettings).shell);
  const flags: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(existingShell)) {
    if (!CANONICAL_SHELL_KEYS.has(key)) flags[key] = value;
  }
  return flags;
}

/**
 * Deep-merge the `kiro` override's `toolsSettings` block into the generated
 * settings, one `toolsSettings` key at a time so the override's leaf fields win
 * without clobbering canonical-generated siblings. Prototype-pollution keys are
 * skipped defensively before being used as object keys.
 */
function applyKiroOverride({
  override,
  nextToolsSettings,
}: {
  override: PermissionsConfig["kiro"];
  nextToolsSettings: Record<string, unknown>;
}): void {
  const overrideToolsSettings = override?.toolsSettings;
  if (!isPlainObject(overrideToolsSettings)) return;
  for (const [key, value] of Object.entries(overrideToolsSettings)) {
    if (isPrototypePollutionKey(key)) continue;
    if (!isPlainObject(value)) continue;
    nextToolsSettings[key] = { ...asRecord(nextToolsSettings[key]), ...value };
  }
}

function pathTable(bucket: { allow: string[]; deny: string[] } | undefined): {
  allowedPaths: string[];
  deniedPaths: string[];
} {
  return { allowedPaths: bucket?.allow ?? [], deniedPaths: bucket?.deny ?? [] };
}

function applyKiroWebPermission({
  category,
  pattern,
  action,
  nextAllowedTools,
  logger,
}: {
  category: "webfetch" | "websearch";
  pattern: string;
  action: PermissionAction;
  nextAllowedTools: Set<string>;
  logger?: ToolPermissionsFromRulesyncPermissionsParams["logger"];
}): void {
  if (pattern !== "*") {
    logger?.warn(
      `Kiro ${category} supports only wildcard (*) via allowedTools. Skipping rule: ${pattern}`,
    );
    return;
  }
  const toolName = category === "webfetch" ? "web_fetch" : "web_search";
  if (action === "allow") {
    nextAllowedTools.add(toolName);
  } else {
    nextAllowedTools.delete(toolName);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  const result = UnknownRecordSchema.safeParse(value);
  return result.success ? result.data : {};
}

/**
 * Build the `kiro` permissions override from a parsed agent config's
 * `toolsSettings`, lifting the Kiro-specific knobs with no canonical category:
 * - `shell.*` flags other than the canonical `allowed`/`deniedCommands`
 *   (e.g. `autoAllowReadonly`, `denyByDefault`), verbatim.
 * - the whole `aws` object (`allowedServices` / `deniedServices` / …), verbatim.
 * - the whole `web_fetch` object (`trusted` / `blocked`), verbatim.
 *
 * Returns `undefined` when none are present so the override key is omitted.
 */
function extractKiroOverride(
  toolsSettings: Record<string, unknown>,
): { toolsSettings: Record<string, unknown> } | undefined {
  const overrideToolsSettings: Record<string, unknown> = {};

  const shellFlags: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(asRecord(toolsSettings.shell))) {
    if (!CANONICAL_SHELL_KEYS.has(key)) shellFlags[key] = value;
  }
  if (Object.keys(shellFlags).length > 0) overrideToolsSettings.shell = shellFlags;

  const aws = asRecord(toolsSettings.aws);
  if (Object.keys(aws).length > 0) overrideToolsSettings.aws = aws;

  const webFetch = asRecord(toolsSettings.web_fetch);
  if (Object.keys(webFetch).length > 0) overrideToolsSettings.web_fetch = webFetch;

  if (Object.keys(overrideToolsSettings).length === 0) return undefined;
  return { toolsSettings: overrideToolsSettings };
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/**
 * Build a canonical `{ pattern: action }` map from a Kiro tool settings record's
 * allow/deny string arrays (e.g. `allowedPaths`/`deniedPaths` or
 * `allowedCommands`/`deniedCommands`).
 */
function rulesFromArrays(
  settings: Record<string, unknown>,
  allowKey: string,
  denyKey: string,
): Record<string, PermissionAction> {
  const rules: Record<string, PermissionAction> = {};
  for (const pattern of asStringArray(settings[allowKey])) rules[pattern] = "allow";
  for (const pattern of asStringArray(settings[denyKey])) rules[pattern] = "deny";
  return rules;
}
