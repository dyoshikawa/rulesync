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
import { isPrototypePollutionKey } from "../../utils/prototype-pollution.js";
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
// is read but never written). The permissions docs list the first six; the
// rule parser (`command-code` 1.54.0, `parsePermissionRule`) also resolves
// `Grep`, `Glob`, `NotebookEdit` (the edit tools) and `Agent`
// case-insensitively, so the canonical `grep`/`glob`/`notebookedit`/`agent`
// categories get a rule of their own instead of being widened onto `Read`.
// Any other category has no rule name and is skipped.
// https://commandcode.ai/docs/permissions
const CATEGORY_TO_COMMANDCODE_TOOL: Record<string, string> = {
  bash: "Shell",
  read: "Read",
  edit: "Edit",
  write: "Write",
  grep: "Grep",
  glob: "Glob",
  notebookedit: "NotebookEdit",
  webfetch: "WebFetch",
  websearch: "WebSearch",
  agent: "Agent",
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
 * `mcp__github__get_issue(owner:foo)`, `mcp__*`, `*`) from a canonical
 * category + pattern. Returns `null` for categories Command Code cannot
 * express so the caller can skip them.
 *
 * MCP tools are keyed by their canonical `mcp__server__tool` name, so a scoped
 * `mcp__<remainder>` category is written verbatim — with its pattern as the
 * `(specifier)`, never widened to the whole tool — and the bare `mcp`
 * category becomes `mcp__*` (or `mcp__<pattern>` when the pattern names a
 * server or tool). The all-tools `*` category is only written for its
 * catch-all pattern; narrower `*` patterns are shell restrictions and reach
 * the `Shell` entries through `honorAllToolsOnBash`.
 */
function buildCommandcodeRule(category: string, pattern: string): string | null {
  const catchAll = pattern === CATCH_ALL_PATTERN || pattern === "";
  if (category.startsWith(MCP_CANONICAL_PREFIX)) {
    return catchAll ? category : `${category}(${pattern})`;
  }
  if (category === "mcp") {
    return catchAll ? COMMANDCODE_ALL_MCP_RULE : `${MCP_CANONICAL_PREFIX}${pattern}`;
  }
  if (category === ALL_TOOLS_PERMISSION_CATEGORY) {
    return catchAll ? CATCH_ALL_PATTERN : null;
  }
  const tool = Object.hasOwn(CATEGORY_TO_COMMANDCODE_TOOL, category)
    ? CATEGORY_TO_COMMANDCODE_TOOL[category]
    : undefined;
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
 * The canonical counterpart of `isServerlessWildcardRule`, checked on the
 * parsed rule so that `*()` / `mcp__*()` (an empty specifier means none to
 * Command Code) are caught too.
 */
function isServerlessWildcardCategory({
  category,
  pattern,
}: {
  category: string;
  pattern: string;
}): boolean {
  return (
    category === ALL_TOOLS_PERMISSION_CATEGORY ||
    (category === "mcp" && pattern === CATCH_ALL_PATTERN)
  );
}

/**
 * Command Code only consults a rule's `(specifier)` in its aggressive mode,
 * which `deny` and `ask` use; `allow` is evaluated conservatively, where an
 * MCP rule matches on the server/tool name alone. An `allow` written as
 * `mcp__<server>__<tool>(specifier)` would therefore grant the whole tool.
 */
function isScopedMcpAllow({
  category,
  pattern,
  action,
}: {
  category: string;
  pattern: string;
  action: PermissionAction;
}): boolean {
  return (
    action === "allow" &&
    category.startsWith(MCP_CANONICAL_PREFIX) &&
    pattern !== CATCH_ALL_PATTERN &&
    pattern !== ""
  );
}

/**
 * Split `Tool(specifier)` into its two halves; `Tool` alone has an empty
 * specifier. Only the outermost parentheses count, so a specifier may itself
 * contain `(`/`)`.
 */
function splitCommandcodeRule(rule: string): { tool: string; inner: string } {
  const trimmed = rule.trim();
  const parenIndex = trimmed.indexOf("(");
  if (parenIndex === -1 || !trimmed.endsWith(")")) {
    return { tool: trimmed, inner: "" };
  }
  return { tool: trimmed.slice(0, parenIndex), inner: trimmed.slice(parenIndex + 1, -1).trim() };
}

/**
 * Parse a Command Code rule back into a canonical category + pattern. Tool
 * names fold case; `Tool`, `Tool()` and `Tool(*)` all mean the whole tool,
 * and an `mcp__<server>__<tool>(specifier)` keeps its specifier as the
 * pattern. Command Code only recognizes the MCP shape by its exact `mcp__`
 * prefix: a differently-cased `MCP__<server>__<tool>` still matches that tool
 * by name (so it folds to the lowercase category), but `MCP__<server>` and
 * `MCP__*` match nothing there and are not modeled. Returns `null` for a
 * rule rulesync cannot model (an exact internal tool name such as
 * `edit_file`, a name-wildcard like `edit_*`, or a specifier on a rule that
 * takes none).
 */
function parseCommandcodeRule(rule: string): { category: string; pattern: string } | null {
  const { tool, inner } = splitCommandcodeRule(rule);
  const pattern = inner.length > 0 ? inner : CATCH_ALL_PATTERN;
  if (tool === CATCH_ALL_PATTERN) {
    return inner.length === 0
      ? { category: ALL_TOOLS_PERMISSION_CATEGORY, pattern: CATCH_ALL_PATTERN }
      : null;
  }
  const lowered = tool.toLowerCase();
  if (lowered.startsWith(MCP_CANONICAL_PREFIX)) {
    if (lowered === COMMANDCODE_ALL_MCP_RULE) {
      return inner.length === 0 && tool === COMMANDCODE_ALL_MCP_RULE
        ? { category: "mcp", pattern: CATCH_ALL_PATTERN }
        : null;
    }
    const exactPrefix = tool.startsWith(MCP_CANONICAL_PREFIX);
    const namesTool =
      lowered.slice(MCP_CANONICAL_PREFIX.length).includes("__") && !lowered.endsWith("*");
    return exactPrefix || namesTool ? { category: lowered, pattern } : null;
  }
  const category = Object.hasOwn(COMMANDCODE_TOOL_TO_CATEGORY, lowered)
    ? COMMANDCODE_TOOL_TO_CATEGORY[lowered]
    : undefined;
  if (category === undefined) {
    return null;
  }
  return { category, pattern };
}

/**
 * The canonical categories this run rebuilds — every category the canonical
 * config names (an empty `bash: {}` still reclaims the previous `Shell(...)`
 * entries, as in the Claude Code adapter) plus every rule it emits, keyed the
 * way an existing entry parses back (so `mcp: { github: "deny" }`, written as
 * `mcp__github`, claims the `mcp__github` entries of the previous run, and
 * case variants fold together). An existing entry whose tool folds onto one of them is
 * rulesync's to replace, whatever list it sits in — otherwise flipping a rule
 * from deny to allow would leave the old deny behind and win. Every other
 * entry — an internal tool name rulesync cannot model, or a modeled tool the
 * canonical config does not mention — is the user's (Command Code writes
 * interactive approvals into the same lists) and is preserved verbatim, so
 * regenerating never silently drops a `deny` the user wrote. Mirrors
 * `managedClaudeToolNames` in the Claude Code adapter.
 */
function preservedRules({
  existingPermissions,
  key,
  managedCategories,
}: {
  existingPermissions: Record<string, unknown>;
  key: string;
  managedCategories: Set<string>;
}): string[] {
  const list = isStringArray(existingPermissions[key]) ? existingPermissions[key] : [];
  return list.filter((rule) => {
    const parsed = parseCommandcodeRule(rule);
    return parsed === null || !managedCategories.has(parsed.category);
  });
}

/**
 * Whether Command Code would honor `rule` in the `action` list. The rejected
 * shapes are the ones it silently ignores there — a server-less wildcard and
 * the specifier of an MCP rule in `allow` — so they are warned about and left
 * unwritten rather than written dead (or, for the latter, over-broad).
 */
function isWritableCommandcodeRule({
  rule,
  emitted,
  action,
  logger,
}: {
  rule: string;
  emitted: { category: string; pattern: string };
  action: PermissionAction;
  logger?: Logger;
}): boolean {
  if (action === "allow" && isServerlessWildcardRule(rule)) {
    logger?.warn(
      `Command Code ignores '${rule}' in "allow" (an allow rule must name what it grants), ` +
        `so the '${emitted.category}' allow rule was not written.`,
    );
    return false;
  }
  // Judged on the rule as written, so the bare `mcp` category cannot smuggle
  // a specifier in through a `<server>__<tool>(specifier)` pattern.
  if (isScopedMcpAllow({ ...emitted, action })) {
    logger?.warn(
      `Command Code ignores the specifier of an MCP rule in "allow" and would allow the whole ` +
        `'${emitted.category}' tool, so the '${emitted.pattern}' allow rule was not written.`,
    );
    return false;
  }
  return true;
}

/**
 * Record `action` for `rule`, keeping the stricter one (deny > ask > allow)
 * when two canonical rules collapse onto the same Command Code entry.
 */
function rankCommandcodeRule({
  ranked,
  rule,
  action,
  logger,
}: {
  ranked: Map<string, PermissionAction>;
  rule: string;
  action: PermissionAction;
  logger?: Logger;
}): void {
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

/**
 * Bucket the canonical rules into Command Code's `allow`/`ask`/`deny` lists.
 * Collisions resolve to the strictest action (deny > ask > allow); categories
 * Command Code cannot express are skipped with a warning when they carry a
 * `deny`; server-less wildcards and specifier-carrying MCP rules are dropped
 * from `allow` because Command Code ignores them (or, for the latter, the
 * specifier) there.
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
  const permission = honorAllToolsOnBash(config.permission);
  const ranked = new Map<string, PermissionAction>();
  const managedCategories = new Set<string>();
  for (const [category, rules] of Object.entries(permission)) {
    const categoryRule = buildCommandcodeRule(category, CATCH_ALL_PATTERN);
    const managedCategory = categoryRule === null ? undefined : parseCommandcodeRule(categoryRule);
    if (managedCategory !== undefined && managedCategory !== null) {
      managedCategories.add(managedCategory.category);
    }
    for (const [pattern, action] of Object.entries(rules)) {
      const rule = buildCommandcodeRule(category, pattern);
      if (rule === null) {
        // A narrower `*` pattern next to a `bash` category was already
        // honored as a `Shell(...)` entry by `honorAllToolsOnBash`.
        const honoredOnShell =
          category === ALL_TOOLS_PERMISSION_CATEGORY && permission.bash !== undefined;
        if (action === "deny" && !honoredOnShell) {
          logger?.warn(
            `Command Code has no permission rule for the '${category}' category with pattern '${pattern}'; ` +
              `its 'deny' rule could not be represented and was skipped.`,
          );
        }
        continue;
      }
      const emitted = parseCommandcodeRule(rule);
      if (emitted === null) {
        continue;
      }
      managedCategories.add(emitted.category);
      if (isWritableCommandcodeRule({ rule, emitted, action, logger })) {
        rankCommandcodeRule({ ranked, rule, action, logger });
      }
    }
  }

  const allow = preservedRules({ existingPermissions, key: "allow", managedCategories });
  const ask = preservedRules({ existingPermissions, key: "ask", managedCategories });
  const deny = preservedRules({ existingPermissions, key: "deny", managedCategories });
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
 * once resolves to the strictest action. A server-less wildcard (`*`,
 * `mcp__*`) in `allow` is skipped, symmetric with the generate side: Command
 * Code ignores it there, so importing it would turn a dead line into a live
 * allow-all for every other target. A scoped MCP rule in `allow` is imported
 * as the whole tool, which is what Command Code enforces for it (the
 * specifier is ignored there); the regenerate then rewrites it as the bare
 * tool name instead of dropping the grant.
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
      if (action === "allow" && isServerlessWildcardCategory(parsed)) continue;
      const { category } = parsed;
      const pattern = isScopedMcpAllow({ ...parsed, action }) ? CATCH_ALL_PATTERN : parsed.pattern;
      // A `Shell(__proto__)` entry would read an inherited property below and
      // silently lose its action, so such entries are dropped (as the other
      // permissions adapters do).
      if (isPrototypePollutionKey(category) || isPrototypePollutionKey(pattern)) {
        continue;
      }
      const rules = (permission[category] ??= {});
      const existing = rules[pattern];
      if (existing === undefined || ACTION_RANK[action] > ACTION_RANK[existing]) {
        rules[pattern] = action;
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
 * Only the entries of the categories the canonical config names are rebuilt;
 * every other existing entry is preserved verbatim.
 * Import: the lists are parsed back case-insensitively (the legacy `Bash`
 * alias folds onto `bash`); rules for internal tool names rulesync does not
 * model are skipped.
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
