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
 * - `credentials.files[].mode: "mask"`: the ignored-at-project-scope unit is the
 *   individual entry's mode, not a settings key, and the same `files` list
 *   carries `deny` entries that project settings *do* honor — dropping the list
 *   would remove real restrictions.
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
        : stripGlobalOnlySandboxPaths({
            sandbox: overrideSandbox,
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
