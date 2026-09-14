import { join } from "node:path";

import { uniq } from "es-toolkit";

import {
  COMMANDCODE_DIR,
  COMMANDCODE_SETTINGS_FILE_NAME,
} from "../../constants/commandcode-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import type { PermissionAction, PermissionsConfig } from "../../types/permissions.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { isRecord, isStringArray } from "../../utils/type-guards.js";
import {
  applySharedConfigPatch,
  parseSharedConfig,
  sharedConfigFileKey,
} from "../shared/shared-config-gateway.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
import { ALL_TOOLS_PERMISSION_CATEGORY, honorAllToolsOnBash } from "./shell-command-categories.js";
import {
  ToolPermissions,
  type ToolPermissionsForDeletionParams,
  type ToolPermissionsFromFileParams,
  type ToolPermissionsFromRulesyncPermissionsParams,
  type ToolPermissionsSettablePaths,
} from "./tool-permissions.js";

/** Top-level key of `.commandcode/settings.json` that rulesync owns. */
const COMMANDCODE_PERMISSIONS_KEY = "permissions";

const CATCH_ALL_PATTERN = "*";
const MCP_CANONICAL_PREFIX = "mcp__";
const COMMANDCODE_ALL_MCP_RULE = "mcp__*";

// Canonical category ⇒ Command Code friendly tool name. `Shell` is the
// documented name of the shell tool (`Bash(...)` is only a legacy alias that
// is read but never written). `Read` covers the file, directory, glob and grep
// tools upstream, but a canonical `grep`/`glob` rule would then gate every
// read, so those categories — and `notebookedit`/`agent`, which have no rule
// name at all — are skipped instead of widened.
// https://commandcode.ai/docs/permissions
const CATEGORY_TO_COMMANDCODE_TOOL: Record<string, string> = {
  bash: "Shell",
  read: "Read",
  edit: "Edit",
  write: "Write",
  webfetch: "WebFetch",
  websearch: "WebSearch",
};

// Lowercased tool name ⇒ canonical category. Command Code matches tool names
// case-insensitively, and the legacy `Bash` alias folds onto `bash`.
const COMMANDCODE_TOOL_TO_CATEGORY: Record<string, string> = {
  ...Object.fromEntries(
    Object.entries(CATEGORY_TO_COMMANDCODE_TOOL).map(([category, tool]) => [
      tool.toLowerCase(),
      category,
    ]),
  ),
  bash: "bash",
};

// Command Code's documented precedence: deny wins, then ask, then allow. Used
// when two canonical rules collapse onto one entry.
const ACTION_RANK: Record<PermissionAction, number> = { allow: 0, ask: 1, deny: 2 };

/**
 * Build a Command Code rule (`Shell(git *)`, `Read`, `mcp__github__get_issue`,
 * `mcp__*`, `*`) from a canonical category + pattern. Returns `null` for
 * categories Command Code cannot express so the caller can skip them.
 *
 * MCP tools are keyed by their canonical `mcp__server__tool` name, so a scoped
 * `mcp__<remainder>` category is written verbatim and the bare `mcp` category
 * becomes `mcp__*` (or `mcp__<pattern>` when the pattern names a server or
 * tool). The all-tools `*` category is only written for its catch-all
 * pattern; narrower `*` patterns are shell restrictions and reach the `Shell`
 * entries through `honorAllToolsOnBash`.
 */
function buildCommandcodeRule(category: string, pattern: string): string | null {
  const catchAll = pattern === CATCH_ALL_PATTERN || pattern === "";
  if (category.startsWith(MCP_CANONICAL_PREFIX)) {
    return category;
  }
  if (category === "mcp") {
    return catchAll ? COMMANDCODE_ALL_MCP_RULE : `${MCP_CANONICAL_PREFIX}${pattern}`;
  }
  if (category === ALL_TOOLS_PERMISSION_CATEGORY) {
    return catchAll ? CATCH_ALL_PATTERN : null;
  }
  const tool = CATEGORY_TO_COMMANDCODE_TOOL[category];
  if (tool === undefined) {
    return null;
  }
  return catchAll ? tool : `${tool}(${pattern})`;
}

/**
 * Whether a rule is a tool-name wildcard (`*`, `mcp__*`, `mcp__github__*`).
 * Command Code ignores such a rule in `allow` unless it names a server, so
 * the two server-less spellings are refused there instead of written dead.
 */
function isServerlessWildcardRule(rule: string): boolean {
  return rule === CATCH_ALL_PATTERN || rule === COMMANDCODE_ALL_MCP_RULE;
}

/**
 * Parse a Command Code rule back into a canonical category + pattern. Tool
 * names fold case; `Tool`, `Tool()` and `Tool(*)` all mean the whole tool.
 * Returns `null` for a tool name rulesync cannot model (an exact internal
 * tool name such as `edit_file`, or a name-wildcard like `edit_*`).
 */
function parseCommandcodeRule(rule: string): { category: string; pattern: string } | null {
  const trimmed = rule.trim();
  if (trimmed === CATCH_ALL_PATTERN) {
    return { category: ALL_TOOLS_PERMISSION_CATEGORY, pattern: CATCH_ALL_PATTERN };
  }
  if (trimmed.toLowerCase().startsWith(MCP_CANONICAL_PREFIX)) {
    return trimmed === COMMANDCODE_ALL_MCP_RULE
      ? { category: "mcp", pattern: CATCH_ALL_PATTERN }
      : { category: trimmed, pattern: CATCH_ALL_PATTERN };
  }

  const parenIndex = trimmed.indexOf("(");
  let tool: string;
  let inner: string;
  if (parenIndex === -1 || !trimmed.endsWith(")")) {
    tool = trimmed;
    inner = "";
  } else {
    tool = trimmed.slice(0, parenIndex);
    inner = trimmed.slice(parenIndex + 1, -1).trim();
  }
  const category = COMMANDCODE_TOOL_TO_CATEGORY[tool.toLowerCase()];
  if (category === undefined) {
    return null;
  }
  return { category, pattern: inner.length > 0 ? inner : CATCH_ALL_PATTERN };
}

/**
 * Entries of an existing list whose tool name rulesync cannot model. They are
 * kept verbatim so regenerating the lists never drops a rule the user wrote
 * for an internal tool name.
 */
function unmanagedRules(existingPermissions: Record<string, unknown>, key: string): string[] {
  const list = isStringArray(existingPermissions[key]) ? existingPermissions[key] : [];
  return list.filter((rule) => parseCommandcodeRule(rule) === null);
}

/**
 * Bucket the canonical rules into Command Code's `allow`/`ask`/`deny` lists.
 * Collisions resolve to the strictest action (deny > ask > allow); categories
 * Command Code cannot express are skipped with a warning when they carry a
 * `deny`; server-less wildcards are dropped from `allow` because Command Code
 * ignores them there.
 */
function buildCommandcodeRuleLists({
  config,
  existingPermissions,
  logger,
}: {
  config: PermissionsConfig;
  existingPermissions: Record<string, unknown>;
  logger?: Logger;
}): { allow: string[]; ask: string[]; deny: string[] } {
  const ranked = new Map<string, PermissionAction>();
  for (const [category, rules] of Object.entries(honorAllToolsOnBash(config.permission))) {
    for (const [pattern, action] of Object.entries(rules)) {
      const rule = buildCommandcodeRule(category, pattern);
      if (rule === null) {
        if (action === "deny") {
          logger?.warn(
            `Command Code has no permission rule for the '${category}' category with pattern '${pattern}'; ` +
              `its 'deny' rule could not be represented and was skipped.`,
          );
        }
        continue;
      }
      if (action === "allow" && isServerlessWildcardRule(rule)) {
        logger?.warn(
          `Command Code ignores '${rule}' in "allow" (an allow rule must name what it grants), ` +
            `so the '${category}' allow rule was not written.`,
        );
        continue;
      }
      const existing = ranked.get(rule);
      if (existing !== undefined && existing !== action) {
        logger?.warn(
          `Command Code permission rule '${rule}' received conflicting actions ` +
            `('${existing}' and '${action}'); keeping the stricter one (deny > ask > allow).`,
        );
      }
      if (existing === undefined || ACTION_RANK[action] > ACTION_RANK[existing]) {
        ranked.set(rule, action);
      }
    }
  }

  const allow = unmanagedRules(existingPermissions, "allow");
  const ask = unmanagedRules(existingPermissions, "ask");
  const deny = unmanagedRules(existingPermissions, "deny");
  for (const [rule, action] of ranked) {
    if (action === "allow") allow.push(rule);
    else if (action === "ask") ask.push(rule);
    else deny.push(rule);
  }
  return { allow: uniq(allow.toSorted()), ask: uniq(ask.toSorted()), deny: uniq(deny.toSorted()) };
}

/**
 * Parse Command Code's `permissions` lists back into a canonical permission
 * map with `deny > ask > allow` precedence, so a tool described more than
 * once resolves to the strictest action.
 */
function parseCommandcodeRuleLists(
  permissions: Record<string, unknown>,
): Record<string, Record<string, PermissionAction>> {
  const permission: Record<string, Record<string, PermissionAction>> = {};
  const lists: [PermissionAction, unknown][] = [
    ["allow", permissions.allow],
    ["ask", permissions.ask],
    ["deny", permissions.deny],
  ];
  for (const [action, list] of lists) {
    if (!isStringArray(list)) continue;
    for (const rule of list) {
      const parsed = parseCommandcodeRule(rule);
      if (parsed === null) continue;
      const rules = (permission[parsed.category] ??= {});
      const existing = rules[parsed.pattern];
      if (existing === undefined || ACTION_RANK[action] > ACTION_RANK[existing]) {
        rules[parsed.pattern] = action;
      }
    }
  }
  return permission;
}

/**
 * Permissions generator for Command Code.
 *
 * Rules live under the `permissions` key of `.commandcode/settings.json`
 * (project) and `~/.commandcode/settings.json` (user) as three lists of
 * Claude-style entries: `deny` (always wins), `ask`, `allow`. The same key
 * also carries `defaultMode`, `additionalDirectories` and `disableBypass`,
 * and the file holds `hooks` and other settings, so writes go through the
 * shared-config gateway: rulesync replaces the three lists, keeps every
 * sibling key, and never deletes the file.
 *
 * Generate: `permission.<category>.<pattern>` becomes `Tool(pattern)` with
 * the friendly names (`Shell`, `Read`, `Edit`, `Write`, `WebFetch`,
 * `WebSearch`), `mcp__<server>__<tool>` names pass through, and the all-tools
 * `*` category becomes the bare `*` rule Command Code accepts in `deny`/`ask`.
 * Import: the lists are parsed back case-insensitively (the legacy `Bash`
 * alias folds onto `bash`); rules for internal tool names rulesync does not
 * model are preserved on generate and skipped on import.
 *
 * @see https://commandcode.ai/docs/permissions
 * @see https://commandcode.ai/docs/settings
 */
export class CommandcodePermissions extends ToolPermissions {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "{}",
    });
  }

  /**
   * `settings.json` holds hooks and other user settings, so it is never
   * deleted; clearing permissions happens via an in-place merge.
   */
  override isDeletable(): boolean {
    return false;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolPermissionsSettablePaths {
    // The same relative path is used for both scopes; the processor supplies
    // the home directory as outputRoot in global mode.
    return {
      relativeDirPath: COMMANDCODE_DIR,
      relativeFilePath: COMMANDCODE_SETTINGS_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolPermissionsFromFileParams): Promise<CommandcodePermissions> {
    const paths = CommandcodePermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? "{}";
    return new CommandcodePermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
      global,
    });
  }

  static async fromRulesyncPermissions({
    outputRoot = process.cwd(),
    rulesyncPermissions,
    global = false,
    logger,
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<CommandcodePermissions> {
    const paths = CommandcodePermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    // Read without initializing so this stays side-effect-free under
    // `--dry-run`/`--check`; the actual write happens later in `writeAiFiles`.
    const existingContent = (await readFileContentOrNull(filePath)) ?? "{}";
    const existing = parseCommandcodeSettings({
      fileContent: existingContent,
      relativePath: join(paths.relativeDirPath, paths.relativeFilePath),
    });
    const existingPermissions = isRecord(existing[COMMANDCODE_PERMISSIONS_KEY])
      ? existing[COMMANDCODE_PERMISSIONS_KEY]
      : {};

    const lists = buildCommandcodeRuleLists({
      config: rulesyncPermissions.getJson(),
      existingPermissions,
      logger,
    });
    // Sibling keys of `permissions` (`defaultMode`, `additionalDirectories`,
    // ...) are the user's; only the three lists are regenerated, and an empty
    // list is omitted rather than written as `[]`.
    const permissions: Record<string, unknown> = { ...existingPermissions };
    for (const key of ["allow", "ask", "deny"] as const) {
      if (lists[key].length > 0) {
        permissions[key] = lists[key];
      } else {
        delete permissions[key];
      }
    }

    return new CommandcodePermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: applySharedConfigPatch({
        fileKey: sharedConfigFileKey(paths),
        feature: "permissions",
        existingContent,
        patch: { [COMMANDCODE_PERMISSIONS_KEY]: permissions },
        filePath,
      }),
      validate: true,
      global,
    });
  }

  toRulesyncPermissions(): RulesyncPermissions {
    const settings = parseCommandcodeSettings({
      fileContent: this.getFileContent() || "{}",
      relativePath: join(this.getRelativeDirPath(), this.getRelativeFilePath()),
    });
    const permissions = isRecord(settings[COMMANDCODE_PERMISSIONS_KEY])
      ? settings[COMMANDCODE_PERMISSIONS_KEY]
      : {};
    return this.toRulesyncPermissionsDefault({
      fileContent: JSON.stringify({ permission: parseCommandcodeRuleLists(permissions) }, null, 2),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolPermissionsForDeletionParams): CommandcodePermissions {
    return new CommandcodePermissions({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
      global,
    });
  }
}

/**
 * Fail closed on a syntax error or non-object root, matching the write path's
 * shared-config declaration, so a broken file is surfaced rather than
 * partially imported or overwritten.
 */
function parseCommandcodeSettings({
  fileContent,
  relativePath,
}: {
  fileContent: string;
  relativePath: string;
}): Record<string, unknown> {
  try {
    return parseSharedConfig({
      format: "json",
      fileContent,
      filePath: relativePath,
      invalidRootPolicy: "error",
    });
  } catch (error) {
    throw new Error(
      `Failed to parse Command Code settings in ${relativePath}: ${formatError(error)}`,
      { cause: error },
    );
  }
}
