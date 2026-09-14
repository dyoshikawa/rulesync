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
import { fallbackLogger, type Logger } from "../../utils/logger.js";
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

/** Whether `action` outranks `existing` (deny > ask > allow). */
function isStricterAction({
  action,
  existing,
}: {
  action: PermissionAction;
  existing: PermissionAction | undefined;
}): boolean {
  return existing === undefined || ACTION_RANK[action] > ACTION_RANK[existing];
}

/**
 * A Command Code rule read back into canonical terms. `aggressiveOnly` marks
 * the rules Command Code honors only in its aggressive mode, which `deny`
 * and `ask` use, and ignores in `allow` (evaluated conservatively): the
 * server-less wildcards `*` and `mcp__*`, and the tool-name globs and
 * specifier-carrying tool rules that a differently-cased `MCP__...` spelling
 * turns into.
 */
type ParsedCommandcodeRule = { category: string; pattern: string; aggressiveOnly: boolean };

/**
 * Build a Command Code rule (`Shell(git *)`, `Read`, `mcp__github__get_issue`,
 * `mcp__*`, `*`) from a canonical category + pattern. Returns `null` for
 * categories Command Code cannot express so the caller can skip them.
 *
 * MCP tools are keyed by their canonical `mcp__server__tool` name, so a
 * scoped `mcp__<remainder>` category is written verbatim and the bare `mcp`
 * category becomes `mcp__*` (or `mcp__<pattern>` when the pattern names a
 * server or tool). A pattern on an MCP category is still written as the
 * `(specifier)` here; `writableCommandcodeRule` decides what to do with it,
 * because Command Code ignores it. The all-tools `*` category is only
 * written for its catch-all pattern; narrower `*` patterns are shell
 * restrictions and reach the `Shell` entries through `honorAllToolsOnBash`.
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
 * Read an MCP-shaped rule the way Command Code does (`command-code` 1.54.0,
 * `parsePermissionRule` / `parseMcpToken`). The MCP shape is only recognized
 * by its exact `mcp__` prefix, and such a rule never carries a specifier:
 * `mcp__<server>__<tool>(owner:foo)` denies, asks or allows the whole tool,
 * and `mcp__*` (specifier or not) is every server, honored in `deny`/`ask`
 * only. A differently-cased `MCP__...` spelling is read as a plain tool-name
 * rule instead: `MCP__<server>__<tool>` matches that tool by name (so it
 * folds onto the lowercase category), `MCP__<server>__<tool>(specifier)` is
 * scoped by the specifier in `deny`/`ask` but dead in `allow`, the globs
 * `MCP__*` and `MCP__<server>__*` match by name in `deny`/`ask` only, and
 * `MCP__<server>` names no tool at all. Whatever matches nothing anywhere
 * returns `null` and is left alone.
 */
function parseMcpCommandcodeRule({
  tool,
  inner,
}: {
  tool: string;
  inner: string;
}): ParsedCommandcodeRule | null {
  const lowered = tool.toLowerCase();
  const remainder = lowered.slice(MCP_CANONICAL_PREFIX.length);
  if (remainder.length === 0) {
    return null;
  }
  if (tool.startsWith(MCP_CANONICAL_PREFIX)) {
    return remainder === CATCH_ALL_PATTERN
      ? { category: "mcp", pattern: CATCH_ALL_PATTERN, aggressiveOnly: true }
      : { category: lowered, pattern: CATCH_ALL_PATTERN, aggressiveOnly: false };
  }
  const namesTool = remainder.includes("__") && !remainder.includes(CATCH_ALL_PATTERN);
  if (inner.length > 0 && inner !== CATCH_ALL_PATTERN) {
    return namesTool ? { category: lowered, pattern: inner, aggressiveOnly: true } : null;
  }
  if (remainder === CATCH_ALL_PATTERN) {
    return { category: "mcp", pattern: CATCH_ALL_PATTERN, aggressiveOnly: true };
  }
  const serverGlob = /^[^*]+__\*$/.test(remainder);
  if (serverGlob) {
    return { category: lowered, pattern: CATCH_ALL_PATTERN, aggressiveOnly: true };
  }
  return namesTool
    ? { category: lowered, pattern: CATCH_ALL_PATTERN, aggressiveOnly: false }
    : null;
}

/**
 * Parse a Command Code rule back into canonical terms. Tool names fold case;
 * `Tool`, `Tool()` and `Tool(*)` all mean the whole tool; MCP-shaped rules
 * go through `parseMcpCommandcodeRule`. Returns `null` for a rule rulesync
 * cannot model (an exact internal tool name such as `edit_file`, a
 * name-wildcard like `edit_*`, or a specifier on a rule that takes none).
 */
function parseCommandcodeRule(rule: string): ParsedCommandcodeRule | null {
  const { tool, inner } = splitCommandcodeRule(rule);
  const pattern = inner.length > 0 ? inner : CATCH_ALL_PATTERN;
  if (tool === CATCH_ALL_PATTERN) {
    return inner.length === 0
      ? {
          category: ALL_TOOLS_PERMISSION_CATEGORY,
          pattern: CATCH_ALL_PATTERN,
          aggressiveOnly: true,
        }
      : null;
  }
  const lowered = tool.toLowerCase();
  if (lowered.startsWith(MCP_CANONICAL_PREFIX)) {
    return parseMcpCommandcodeRule({ tool, inner });
  }
  const category = Object.hasOwn(COMMANDCODE_TOOL_TO_CATEGORY, lowered)
    ? COMMANDCODE_TOOL_TO_CATEGORY[lowered]
    : undefined;
  if (category === undefined) {
    return null;
  }
  return { category, pattern, aggressiveOnly: false };
}

/** The `Tool` half of `Tool(specifier)`, when the rule is an exact-prefix MCP rule with a specifier. */
function scopedMcpRuleTool(rule: string): string | null {
  const { tool, inner } = splitCommandcodeRule(rule);
  const scoped = inner.length > 0 && inner !== CATCH_ALL_PATTERN;
  return scoped && tool.startsWith(MCP_CANONICAL_PREFIX) ? tool : null;
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
 * interactive approvals into the same lists) and is preserved verbatim.
 * A `deny`/`ask` entry that is reclaimed without an equally strict rule
 * taking its place (say a hand-written `mcp__*` deny next to a canonical
 * `mcp: { github: "deny" }`) is reported, so regenerating never silently
 * loosens what the user wrote. Mirrors `managedClaudeToolNames` in the
 * Claude Code adapter.
 */
function preservedRules({
  existingPermissions,
  key,
  managedCategories,
  written,
  logger,
}: {
  existingPermissions: Record<string, unknown>;
  key: PermissionAction;
  managedCategories: Set<string>;
  written: Map<string, PermissionAction>;
  logger?: Logger;
}): string[] {
  const list = isStringArray(existingPermissions[key]) ? existingPermissions[key] : [];
  return list.filter((rule) => {
    const parsed = parseCommandcodeRule(rule);
    if (parsed === null || !managedCategories.has(parsed.category)) {
      return true;
    }
    const replacement = written.get(`${parsed.category}(${parsed.pattern})`);
    if (key !== "allow" && isStricterAction({ action: key, existing: replacement })) {
      logger?.warn(
        `Command Code permission rule '${rule}' in "${key}" belongs to the '${parsed.category}' ` +
          `category, which the rulesync config now manages, and was replaced by its rules.`,
      );
    }
    return false;
  });
}

/**
 * The rule to write for a canonical rule, or `null` when Command Code would
 * ignore it in the `action` list. A server-less wildcard (`*`, `mcp__*`) in
 * `allow` is warned about and left unwritten rather than written dead. A
 * specifier on an MCP rule is ignored by Command Code in every list, so a
 * scoped `deny`/`ask` is written as the bare tool (which is what Command
 * Code would enforce anyway, only now visibly) with a warning, and a scoped
 * `allow` — which would grant the whole tool — is refused. Judged on the
 * rule as written, so the bare `mcp` category cannot smuggle a specifier in
 * through a `<server>__<tool>(specifier)` pattern.
 */
function writableCommandcodeRule({
  rule,
  emitted,
  action,
  logger,
}: {
  rule: string;
  emitted: ParsedCommandcodeRule;
  action: PermissionAction;
  logger?: Logger;
}): string | null {
  if (action === "allow" && emitted.aggressiveOnly) {
    logger?.warn(
      `Command Code ignores '${rule}' in "allow" (an allow rule must name what it grants), ` +
        `so the '${emitted.category}' allow rule was not written.`,
    );
    return null;
  }
  const tool = scopedMcpRuleTool(rule);
  if (tool === null) {
    return rule;
  }
  if (action === "allow") {
    logger?.warn(
      `Command Code ignores the specifier of an MCP rule and would allow the whole '${tool}' tool, ` +
        `so the '${rule}' allow rule was not written.`,
    );
    return null;
  }
  logger?.warn(
    `Command Code ignores the specifier of an MCP rule, so '${rule}' was written as '${tool}' ` +
      `and applies "${action}" to the whole tool.`,
  );
  return tool;
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
  if (isStricterAction({ action, existing })) {
    ranked.set(rule, action);
  }
}

/**
 * Bucket the canonical rules into Command Code's `allow`/`ask`/`deny` lists.
 * Collisions resolve to the strictest action (deny > ask > allow); categories
 * Command Code cannot express are skipped with a warning when they carry a
 * `deny`; rules Command Code would ignore in the target list are dropped or
 * rewritten by `writableCommandcodeRule`.
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
    const managedCategory = categoryRule === null ? null : parseCommandcodeRule(categoryRule);
    if (managedCategory !== null) {
      managedCategories.add(managedCategory.category);
    }
    for (const [pattern, action] of Object.entries(rules)) {
      const rule = buildCommandcodeRule(category, pattern);
      const emitted = rule === null ? null : parseCommandcodeRule(rule);
      if (rule === null || emitted === null) {
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
      managedCategories.add(emitted.category);
      const written = writableCommandcodeRule({ rule, emitted, action, logger });
      if (written !== null) {
        rankCommandcodeRule({ ranked, rule: written, action, logger });
      }
    }
  }

  const written = new Map<string, PermissionAction>();
  for (const [rule, action] of ranked) {
    const parsed = parseCommandcodeRule(rule);
    if (parsed !== null) {
      written.set(`${parsed.category}(${parsed.pattern})`, action);
    }
  }
  const preserved = { existingPermissions, managedCategories, written, logger };
  const allow = preservedRules({ ...preserved, key: "allow" });
  const ask = preservedRules({ ...preserved, key: "ask" });
  const deny = preservedRules({ ...preserved, key: "deny" });
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
 * once resolves to the strictest action. Each rule is imported as what
 * Command Code enforces for it, never as what it looks like: a rule Command
 * Code ignores in `allow` (`*`, `mcp__*`, an `MCP__...` glob or a scoped
 * `MCP__<server>__<tool>(specifier)`) is skipped there, since importing it
 * would turn a dead line into a live grant for every other target; and the
 * specifier of an exact-prefix `mcp__...` rule, which Command Code drops, is
 * folded to the whole tool in every list — with a warning in `allow`, where
 * the fold widens the grant the user wrote.
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
      if (action === "allow" && parsed.aggressiveOnly) continue;
      const { category, pattern } = parsed;
      if (action === "allow" && scopedMcpRuleTool(rule) !== null) {
        fallbackLogger.warn(
          `Command Code ignores the specifier of an MCP rule, so '${rule}' in "allow" was imported ` +
            `as the whole '${category}' tool, which is what Command Code grants for it.`,
        );
      }
      // A `Shell(__proto__)` entry would read an inherited property below and
      // silently lose its action, so such entries are dropped (as the other
      // permissions adapters do).
      if (isPrototypePollutionKey(category) || isPrototypePollutionKey(pattern)) {
        continue;
      }
      const rules = (permission[category] ??= {});
      if (isStricterAction({ action, existing: rules[pattern] })) {
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
 * alias folds onto `bash`) as what Command Code enforces for each entry;
 * rules for internal tool names rulesync does not model are skipped.
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
