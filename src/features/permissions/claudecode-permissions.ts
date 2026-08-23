import { join } from "node:path";

import { CLAUDECODE_DIR, CLAUDECODE_SETTINGS_FILE_NAME } from "../../constants/claudecode-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import type { ClaudeSettingsJson } from "../../types/claude-settings.js";
import type { PermissionAction, PermissionsConfig } from "../../types/permissions.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { PROTOTYPE_POLLUTION_KEYS } from "../../utils/prototype-pollution.js";
import { applyPermissions } from "../shared/shared-config-gateway.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
import {
  ToolPermissions,
  type ToolPermissionsForDeletionParams,
  type ToolPermissionsFromFileParams,
  type ToolPermissionsFromRulesyncPermissionsParams,
  type ToolPermissionsSettablePaths,
} from "./tool-permissions.js";

/**
 * Mapping from rulesync canonical tool category names (lowercase) to Claude Code tool names (PascalCase).
 * Unknown names are passed through as-is (e.g., mcp__server__tool).
 */
const CANONICAL_TO_CLAUDE_TOOL_NAMES: Record<string, string> = {
  bash: "Bash",
  read: "Read",
  edit: "Edit",
  write: "Write",
  webfetch: "WebFetch",
  websearch: "WebSearch",
  grep: "Grep",
  glob: "Glob",
  notebookedit: "NotebookEdit",
  agent: "Agent",
};

/**
 * Reverse mapping from Claude Code tool names to rulesync canonical names.
 */
const CLAUDE_TO_CANONICAL_TOOL_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(CANONICAL_TO_CLAUDE_TOOL_NAMES).map(([k, v]) => [v, k]),
);

function toClaudeToolName(canonical: string): string {
  return CANONICAL_TO_CLAUDE_TOOL_NAMES[canonical] ?? canonical;
}

function toCanonicalToolName(claudeName: string): string {
  return CLAUDE_TO_CANONICAL_TOOL_NAMES[claudeName] ?? claudeName;
}

/**
 * Parse a Claude Code permission entry like "Bash(npm run *)" into tool name and pattern.
 * If no parentheses, returns the tool name with "*" as the pattern.
 */
function parseClaudePermissionEntry(entry: string): { toolName: string; pattern: string } {
  const parenIndex = entry.indexOf("(");
  if (parenIndex === -1) {
    return { toolName: entry, pattern: "*" };
  }
  const toolName = entry.slice(0, parenIndex);
  // Verify closing parenthesis exists at the end before extracting the pattern
  if (!entry.endsWith(")")) {
    return { toolName, pattern: "*" };
  }
  const pattern = entry.slice(parenIndex + 1, -1);
  return { toolName, pattern: pattern || "*" };
}

/**
 * Claude Code's file permission checks match only `Edit(path)` and `Read(path)`
 * rules. A `Write(path)`, `NotebookEdit(path)` or `Glob(path)` rule "is accepted
 * but never matched by those checks, so Claude Code warns at startup for each
 * allow, deny, or ask rule in one of these unmatched forms" — so a canonical
 * `write`/`notebookedit`/`glob` rule with a pattern is emitted in the form the
 * docs prescribe instead. A tool-name rule with no path is unaffected: it
 * matches the tool everywhere and produces no warning.
 * @see https://code.claude.com/docs/en/permissions
 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Merge `patch` into `base`, recursing into plain objects so a sibling key at
 * any depth survives. Arrays and scalars are replaced, since a list the author
 * states is the list they mean.
 */
function deepMergeRecords(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(key)) continue;
    const existing = merged[key];
    merged[key] =
      isPlainRecord(existing) && isPlainRecord(value) ? deepMergeRecords(existing, value) : value;
  }
  return merged;
}

/**
 * `sandbox.*` paths Claude Code honors only from user settings, managed settings
 * and the `--settings` CLI flag. Written into a project `.claude/settings.json`
 * they are silently ignored, so a committed file would read as though it
 * enforced a sandbox policy while doing nothing — security-relevant for
 * `network.strictAllowlist` and the credential-masking keys in particular.
 * Generation therefore drops them at project scope with a per-key warning and
 * emits them only under `--global`.
 *
 * Deliberately NOT listed:
 * - `bwrapPath` / `socatPath`: v2.1.232 added them to the managed-settings
 *   approval dialog, which is a consent prompt, not a project-scope rejection.
 * - `credentials.envVars` / `credentials.files`: the ignored-at-project-scope
 *   unit is the individual entry's mode, not the settings key, and the same
 *   lists carry `deny` entries that project settings *do* honor — dropping a
 *   whole list would remove real restrictions. `stripProjectIgnoredMaskEntries`
 *   filters those lists per entry instead.
 *
 * @see https://code.claude.com/docs/en/sandboxing
 * @see https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md — v2.1.232 scoped `sandbox.ripgrep`
 */
const CLAUDECODE_GLOBAL_ONLY_SANDBOX_PATHS: readonly (readonly string[])[] = [
  ["filesystem", "disabled"],
  ["network", "strictAllowlist"],
  ["network", "tlsTerminate"],
  ["credentials", "allowPlaintextInject"],
  ["credentials", "awsPairs"],
  ["credentials", "sigv4"],
  ["allowAppleEvents"],
  ["ripgrep"],
];

/**
 * Copy of the authored `sandbox` override with the user/managed-only paths
 * removed, warning once per dropped path. Only the override copy is filtered —
 * a value already hand-written in the target file is left untouched, matching
 * the `qwencode` `security.allowPrivateNetworkHooks` precedent.
 */
function stripGlobalOnlySandboxPaths({
  sandbox,
  relativeFilePath,
  logger,
}: {
  sandbox: Record<string, unknown>;
  relativeFilePath: string;
  logger?: Logger;
}): Record<string, unknown> {
  const filtered = structuredClone(sandbox);
  for (const path of CLAUDECODE_GLOBAL_ONLY_SANDBOX_PATHS) {
    const leaf = path.at(-1);
    if (leaf === undefined) continue;
    const parentPath = path.slice(0, -1);
    let parent: Record<string, unknown> = filtered;
    for (const segment of parentPath) {
      const next = parent[segment];
      if (!isPlainRecord(next)) {
        parent = {};
        break;
      }
      parent = next;
    }
    if (parent[leaf] === undefined) continue;
    delete parent[leaf];
    // Drop a container the removal emptied so no `"network": {}` noise is written.
    const [container] = parentPath;
    if (container !== undefined && isPlainRecord(filtered[container])) {
      if (Object.keys(filtered[container]).length === 0) delete filtered[container];
    }
    logger?.warn(
      `Claude Code permissions: 'sandbox.${path.join(".")}' is only honored in user/managed/--settings settings, so it is not written to the project-scoped ${relativeFilePath}. Author it in the global scope instead, and check that file for a stale value an earlier generate may have left there.`,
    );
  }
  return filtered;
}

/** The `sandbox.credentials` lists whose entries accept `"mode": "mask"`. */
const CLAUDECODE_MASKABLE_CREDENTIAL_LISTS = ["envVars", "files"] as const;

/**
 * Copy of the authored `sandbox` override with the `credentials.envVars` /
 * `credentials.files` entries whose `mode` is `"mask"` removed, warning once per
 * list.
 *
 * Masking authorizes the sandbox proxy to send the real credential to the listed
 * hosts, so Claude Code honors it only from user settings, managed settings and
 * the `--settings` CLI flag; a `mask` entry in a repository's
 * `.claude/settings.json` is ignored outright. Keeping it would read as though
 * the credential were masked while nothing protects it — the one project-scope
 * gap whose consequence is a live credential leaving the sandbox unmasked.
 *
 * Filtered per entry rather than per key, because the same lists carry `deny`
 * entries that project settings *do* honor. `mode` is matched exactly: an entry
 * Claude Code cannot read as `mask` is not treated as one either (it degrades
 * such entries to `deny`), so the "reads as masked but isn't" state this guards
 * against cannot slip through a differently-spelled value.
 *
 * Like `stripGlobalOnlySandboxPaths`, only the override copy is filtered — a
 * value already in the target file is left untouched, which is why the warning
 * points at it.
 *
 * @see https://code.claude.com/docs/en/sandboxing — "`mask` entries … are all
 *   ignored in a repository's `.claude/settings.json` or
 *   `.claude/settings.local.json`"; the file-entry section states the same
 *   settings-source restriction applies there.
 */
function stripProjectIgnoredMaskEntries({
  sandbox,
  relativeFilePath,
  logger,
}: {
  sandbox: Record<string, unknown>;
  relativeFilePath: string;
  logger?: Logger;
}): Record<string, unknown> {
  const credentials = sandbox.credentials;
  if (!isPlainRecord(credentials)) return sandbox;

  const filteredCredentials: Record<string, unknown> = { ...credentials };
  let changed = false;
  for (const listKey of CLAUDECODE_MASKABLE_CREDENTIAL_LISTS) {
    const list = filteredCredentials[listKey];
    if (!Array.isArray(list)) continue;
    const kept = list.filter((entry) => !(isPlainRecord(entry) && entry.mode === "mask"));
    if (kept.length === list.length) continue;
    changed = true;
    const dropped = list.length - kept.length;
    logger?.warn(
      `Claude Code permissions: 'sandbox.credentials.${listKey}' entries with 'mode: "mask"' are only honored in user/managed/--settings settings, so ${dropped} of them ${dropped === 1 ? "was" : "were"} not written to the project-scoped ${relativeFilePath}. Author them in the global scope instead, and check that file for a stale value an earlier generate may have left there.`,
    );
    if (kept.length === 0) {
      delete filteredCredentials[listKey];
    } else {
      filteredCredentials[listKey] = kept;
    }
  }
  if (!changed) return sandbox;

  const filtered = { ...sandbox };
  if (Object.keys(filteredCredentials).length === 0) {
    delete filtered.credentials;
  } else {
    filtered.credentials = filteredCredentials;
  }
  return filtered;
}

/**
 * Top-level `.claude/settings.json` keys the generic `claudecode` override
 * passthrough must not carry. `permissions` and `sandbox` have their own merge
 * branches (the managed `allow`/`ask`/`deny` arrays and the scope filtering
 * respectively), `hooks` belongs to the hooks feature, `permission` is
 * rulesync's own canonical tool-scoped block rather than a settings key, and
 * `$schema` is an editor pointer rather than a Claude Code setting.
 */
const CLAUDECODE_NON_PASSTHROUGH_OVERRIDE_KEYS: ReadonlySet<string> = new Set([
  "permission",
  "permissions",
  "sandbox",
  "hooks",
  "$schema",
]);

/**
 * Top-level settings keys Claude Code reads only from user settings, managed
 * settings and the `--settings` CLI flag — the same restriction
 * `CLAUDECODE_GLOBAL_ONLY_SANDBOX_PATHS` records for the `sandbox` subtree, and
 * the reason the passthrough drops them at project scope instead of committing
 * a setting that never applies. `rulesync generate --global` writes the user
 * settings file, so they are emitted there.
 *
 * Derived from the per-key **Scope** column of the settings reference: every
 * top-level key documented as `User or managed` or `User, local, or managed`.
 *
 * @see https://code.claude.com/docs/en/settings-reference
 */
const CLAUDECODE_USER_SCOPE_ONLY_KEYS: readonly string[] = [
  "askUserQuestionTimeout",
  "autoMode",
  "dialogExpiry",
  "enableArtifact",
  "footerLinksRegexes",
  "pluginConfigs",
  "processWrapper",
  "skipAutoPermissionPrompt",
  "skipDangerousModePermissionPrompt",
  "spellcheck",
  "sshConfigs",
  "syncClaudeAiSkills",
  "useAutoModeDuringPlan",
  "vimInsertModeRemaps",
];

/**
 * Top-level settings keys neither file rulesync writes can honor, with the file
 * that does. `Managed` keys are read only from the settings file an organization
 * deploys, and `Global config` keys only from `~/.claude.json` — rulesync writes
 * `.claude/settings.json` and `~/.claude/settings.json`, so authoring either
 * kind through the override would produce a policy that silently never applies.
 *
 * Derived from the per-key **Scope** column of the settings reference.
 *
 * @see https://code.claude.com/docs/en/settings-reference
 */
const CLAUDECODE_UNHONORED_KEY_SOURCES: Readonly<Record<string, string>> = {
  allowAllClaudeAiMcps: "managed settings",
  allowedChannelPlugins: "managed settings",
  allowManagedHooksOnly: "managed settings",
  allowManagedMcpServersOnly: "managed settings",
  allowManagedPermissionRulesOnly: "managed settings",
  autoConnectIde: "~/.claude.json",
  autoInstallIdeExtension: "~/.claude.json",
  blockedMarketplaces: "managed settings",
  browserExternalPageTools: "managed settings",
  channelsEnabled: "managed settings",
  claudeMd: "managed settings",
  diffTool: "~/.claude.json",
  disableBrowserExternalNavigation: "managed settings",
  disableCommandPluginSources: "managed settings",
  disableMobileSimulatorTools: "managed settings",
  disableSideloadFlags: "managed settings",
  externalEditorContext: "~/.claude.json",
  forceLoginGatewayUrl: "managed settings",
  forceRemoteSettingsRefresh: "managed settings",
  parentSettingsBehavior: "managed settings",
  permissionExplainerEnabled: "~/.claude.json",
  pluginSuggestionMarketplaces: "managed settings",
  pluginTrustMessage: "managed settings",
  policyHelper: "managed settings",
  requiredMaximumVersion: "managed settings",
  requiredMinimumVersion: "managed settings",
  sshHostAllowlist: "managed settings",
  strictKnownMarketplaces: "managed settings",
  strictPluginOnlyCustomization: "managed settings",
  teammateDefaultModel: "~/.claude.json",
  wslInheritsWindowsSettings: "managed settings",
};

/**
 * Copy of the authored top-level passthrough with the keys the target file
 * cannot honor removed, warning once per dropped key. Like
 * `stripGlobalOnlySandboxPaths`, only the override copy is filtered — a value
 * already hand-written in the target file is left untouched, which is why the
 * warning points at it.
 */
function stripUnhonoredTopLevelKeys({
  overrides,
  global,
  relativeFilePath,
  logger,
}: {
  overrides: Record<string, unknown>;
  global: boolean;
  relativeFilePath: string;
  logger?: Logger;
}): Record<string, unknown> {
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(overrides)) {
    const unhonoredSource = CLAUDECODE_UNHONORED_KEY_SOURCES[key];
    if (unhonoredSource !== undefined) {
      logger?.warn(
        `Claude Code permissions: '${key}' is only honored in ${unhonoredSource}, which rulesync does not generate, so it is not written to ${relativeFilePath}. Set it in that file by hand, and check ${relativeFilePath} for a stale value an earlier generate may have left there.`,
      );
      continue;
    }
    if (!global && CLAUDECODE_USER_SCOPE_ONLY_KEYS.includes(key)) {
      logger?.warn(
        `Claude Code permissions: '${key}' is only honored in user/managed/--settings settings, so it is not written to the project-scoped ${relativeFilePath}. Author it in the global scope instead, and check that file for a stale value an earlier generate may have left there.`,
      );
      continue;
    }
    filtered[key] = value;
  }
  return filtered;
}

const CLAUDE_PATH_RULE_ALIASES: Record<string, string> = {
  Write: "Edit",
  NotebookEdit: "Edit",
  Glob: "Read",
};

/**
 * Build a Claude Code permission entry like "Bash(npm run *)".
 * If the pattern is "*", returns just the tool name.
 */
function buildClaudePermissionEntry(toolName: string, pattern: string): string {
  if (pattern === "*") {
    return toolName;
  }
  return `${CLAUDE_PATH_RULE_ALIASES[toolName] ?? toolName}(${pattern})`;
}

/**
 * The Claude tool names the canonical config manages. Deliberately the tool
 * names the categories map to and *not* the aliases a path rule is rewritten
 * to: claiming `Edit` because a `write` rule exists would sweep away the
 * `Read`/`Edit` entries the ignore feature and the user wrote in the same file.
 * The rewritten entries are still rulesync's to place — `applyPermissions`
 * replaces an entry this run emits wherever it currently sits — and the
 * original name stays claimed so an entry an older rulesync wrote in the warned
 * form is cleaned up on the next generate.
 */
function managedClaudeToolNames(config: PermissionsConfig): Set<string> {
  return new Set(Object.keys(config.permission).map((category) => toClaudeToolName(category)));
}

export class ClaudecodePermissions extends ToolPermissions {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "{}",
    });
  }

  override isDeletable(): boolean {
    return false;
  }

  static getSettablePaths(): ToolPermissionsSettablePaths {
    return {
      relativeDirPath: CLAUDECODE_DIR,
      relativeFilePath: CLAUDECODE_SETTINGS_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
  }: ToolPermissionsFromFileParams): Promise<ClaudecodePermissions> {
    const paths = ClaudecodePermissions.getSettablePaths();
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? '{"permissions":{}}';
    return new ClaudecodePermissions({
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
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<ClaudecodePermissions> {
    const paths = ClaudecodePermissions.getSettablePaths();
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = (await readFileContentOrNull(filePath)) ?? JSON.stringify({}, null, 2);
    let settings: ClaudeSettingsJson;
    try {
      settings = JSON.parse(existingContent);
    } catch (error) {
      throw new Error(
        `Failed to parse existing Claude settings at ${filePath}: ${formatError(error)}`,
        { cause: error },
      );
    }

    const config = rulesyncPermissions.getJson();
    const { allow, ask, deny } = convertRulesyncToClaudePermissions({ config, logger });

    // Merge the Claude Code-scoped override's non-list `permissions` fields
    // (e.g. `defaultMode`, `additionalDirectories`) into the settings
    // `permissions` object. The managed `allow`/`ask`/`deny` arrays are excluded
    // — rulesync owns them and `applyPermissions` sets them below.
    const overridePermissions = config.claudecode?.permissions;
    if (overridePermissions && typeof overridePermissions === "object") {
      const { allow: _a, ask: _k, deny: _d, ...nonListFields } = overridePermissions;
      settings.permissions = { ...settings.permissions, ...nonListFields };
    }

    // `sandbox` sits next to `permissions` at the top level of settings.json.
    // Deep-merged rather than shallow: its subtrees hold deny lists
    // (`network.deniedDomains`, `filesystem.denyRead`), so replacing `network`
    // wholesale to set one flag would drop the restrictions beside it.
    const overrideSandbox = config.claudecode?.sandbox;
    if (isPlainRecord(overrideSandbox)) {
      // A subset of `sandbox.*` is ignored in a repository's settings.json, so
      // at project scope those paths are dropped rather than committed as a
      // policy that never applies.
      const scopedSandbox = global
        ? overrideSandbox
        : stripProjectIgnoredMaskEntries({
            sandbox: stripGlobalOnlySandboxPaths({
              sandbox: overrideSandbox,
              relativeFilePath: paths.relativeFilePath,
              logger,
            }),
            relativeFilePath: paths.relativeFilePath,
            logger,
          });
      if (Object.keys(scopedSandbox).length > 0) {
        settings.sandbox = deepMergeRecords(
          isPlainRecord(settings.sandbox) ? settings.sandbox : {},
          scopedSandbox,
        );
      }
    }

    // Everything else in the override is a plain top-level settings key, written
    // through generically rather than key by key. Claude Code adds these faster
    // than an allowlist can track (2.1.217-2.1.239 alone added
    // `emojiCompletionEnabled`, `workflowSizeGuideline`, `spellcheck`,
    // `keybindingFlavor` and the `additionalMarketplaces`/`allowedMarketplaces`
    // aliases), and an unmodeled key used to validate and then vanish with no
    // warning. Deep-merged for the same reason `sandbox` is: a nested key the
    // author sets must not replace the siblings already in the file.
    const overrideTopLevel: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(config.claudecode ?? {})) {
      if (CLAUDECODE_NON_PASSTHROUGH_OVERRIDE_KEYS.has(key)) continue;
      if (PROTOTYPE_POLLUTION_KEYS.has(key)) continue;
      if (value === undefined) continue;
      overrideTopLevel[key] = value;
    }
    const scopedTopLevel = stripUnhonoredTopLevelKeys({
      overrides: overrideTopLevel,
      global,
      relativeFilePath: paths.relativeFilePath,
      logger,
    });
    if (Object.keys(scopedTopLevel).length > 0) {
      settings = deepMergeRecords(
        settings as Record<string, unknown>,
        scopedTopLevel,
      ) as ClaudeSettingsJson;
    }

    const managedToolNames = managedClaudeToolNames(config);

    // The gateway owns the shared `permissions` merge and the cross-feature
    // ownership rule; here we only state the intent (managed tools + arrays).
    const merged = applyPermissions({
      settings,
      managedToolNames,
      toolNameOf: (entry) => parseClaudePermissionEntry(entry).toolName,
      allow,
      ask,
      deny,
      logger,
    });
    const fileContent = JSON.stringify(merged, null, 2);

    return new ClaudecodePermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate: true,
    });
  }

  toRulesyncPermissions(): RulesyncPermissions {
    let settings: ClaudeSettingsJson;
    try {
      settings = JSON.parse(this.getFileContent());
    } catch (error) {
      throw new Error(
        `Failed to parse Claude permissions content in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        { cause: error },
      );
    }

    const permissions = settings.permissions ?? {};
    const config = convertClaudeToRulesyncPermissions({
      allow: permissions.allow ?? [],
      ask: permissions.ask ?? [],
      deny: permissions.deny ?? [],
    });

    // Route the non-list `permissions` fields (defaultMode, additionalDirectories,
    // org locks, ...) into the claudecode override so they round-trip without
    // leaking into other tools' configs.
    const { allow: _a, ask: _k, deny: _d, ...nonListFields } = permissions;
    if (Object.keys(nonListFields).length > 0) {
      config.claudecode = { permissions: nonListFields };
    }

    // The sibling `sandbox` subtree round-trips through the same override block.
    const { sandbox } = settings;
    if (isPlainRecord(sandbox) && Object.keys(sandbox).length > 0) {
      config.claudecode = { ...config.claudecode, sandbox };
    }

    // Every remaining top-level key round-trips through the same block, so an
    // imported `.claude/settings.json` survives the next generate instead of
    // being narrowed to the keys this feature happens to model. The keys other
    // features own are left to them: `hooks` is the hooks feature's, and
    // `permissions` is handled above.
    const topLevelPassthrough: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(settings as Record<string, unknown>)) {
      if (CLAUDECODE_NON_PASSTHROUGH_OVERRIDE_KEYS.has(key)) continue;
      if (value === undefined) continue;
      topLevelPassthrough[key] = value;
    }
    if (Object.keys(topLevelPassthrough).length > 0) {
      config.claudecode = { ...config.claudecode, ...topLevelPassthrough };
    }

    return this.toRulesyncPermissionsDefault({
      fileContent: JSON.stringify(config, null, 2),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolPermissionsForDeletionParams): ClaudecodePermissions {
    return new ClaudecodePermissions({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({ permissions: {} }, null, 2),
      validate: false,
    });
  }
}

/**
 * Convert rulesync permissions config to Claude Code allow/ask/deny arrays.
 */
function convertRulesyncToClaudePermissions({
  config,
  logger,
}: {
  config: PermissionsConfig;
  logger?: Logger;
}): {
  allow: string[];
  ask: string[];
  deny: string[];
} {
  const allow: string[] = [];
  const ask: string[] = [];
  const deny: string[] = [];
  // Two categories can now produce the same entry — `write` and `edit` both map
  // to `Edit(path)` — so a disagreement between them becomes a config that says
  // two things at once. Claude Code resolves deny first, but the author should
  // hear about it rather than discover it later.
  const actionByEntry = new Map<string, PermissionAction>();

  for (const [category, rules] of Object.entries(config.permission)) {
    const claudeToolName = toClaudeToolName(category);
    for (const [pattern, action] of Object.entries(rules)) {
      const entry = buildClaudePermissionEntry(claudeToolName, pattern);
      const previous = actionByEntry.get(entry);
      if (previous !== undefined && previous !== action) {
        logger?.warn(
          `Claude Code permissions: rules from different categories both resolve to "${entry}" ` +
            `with conflicting actions (${previous} and ${action}). Both are written; Claude Code ` +
            `applies deny first, then ask, then allow.`,
        );
      }
      actionByEntry.set(entry, action);
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

/**
 * Convert Claude Code allow/ask/deny arrays to rulesync permissions config.
 */
function convertClaudeToRulesyncPermissions(params: {
  allow: string[];
  ask: string[];
  deny: string[];
}): PermissionsConfig {
  const permission: Record<string, Record<string, PermissionAction>> = {};

  const processEntries = (entries: string[], action: PermissionAction) => {
    for (const entry of entries) {
      const { toolName, pattern } = parseClaudePermissionEntry(entry);
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
