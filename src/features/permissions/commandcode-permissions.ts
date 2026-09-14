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
import { isRecord } from "../../utils/type-guards.js";
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
// `Grep` and `Glob` case-insensitively, so the canonical `grep`/`glob`
// categories get a rule of their own instead of being widened onto `Read`.
// Two categories the parser also resolves are deliberately absent: Command
// Code has no notebook tool, so `NotebookEdit` is the same `edit_file` /
// `write_file` set as `Edit` and a `notebookedit` rule would govern every
// file edit; and its permission check answers `allow` for the `agent` tool
// before it consults any rule, so an `Agent` deny or ask is never enforced.
// Any other category has no rule name and is skipped.
// https://commandcode.ai/docs/permissions
const CATEGORY_TO_COMMANDCODE_TOOL: Record<string, string> = {
  bash: "Shell",
  read: "Read",
  edit: "Edit",
  write: "Write",
  grep: "Grep",
  glob: "Glob",
  webfetch: "WebFetch",
  websearch: "WebSearch",
};

// Lowercased tool name ⇒ canonical category. Command Code resolves these
// names case-insensitively, and its rule parser (`command-code` 1.54.0,
// `parsePermissionRule`) also accepts the internal names that mean exactly
// the same tools: `Bash`, `PowerShell`, `shell_command`, `monitor_command`
// and `kill_shell` are `Shell`; `NotebookEdit` is `Edit`; `write_file` is
// `Write`; `web_fetch` / `web_search` are `WebFetch` / `WebSearch`. They are
// read (so a deny written with one of them is not lost) but never written.
// `Agent` / `Task` rules enforce nothing (see above) and other internal names
// (`read_file`, `edit_file`, ...) cover a narrower tool set than their
// friendly counterpart, so they stay unmodeled.
const COMMANDCODE_TOOL_TO_CATEGORY: Record<string, string> = {
  ...Object.fromEntries(
    Object.entries(CATEGORY_TO_COMMANDCODE_TOOL).map(([category, tool]) => [
      tool.toLowerCase(),
      category,
    ]),
  ),
  bash: "bash",
  powershell: "bash",
  shell_command: "bash",
  monitor_command: "bash",
  kill_shell: "bash",
  notebookedit: "edit",
  write_file: "write",
  web_fetch: "webfetch",
  web_search: "websearch",
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
 * A Command Code rule read back into canonical terms. `notInAllow` marks the
 * rules that cannot be written to or imported from `allow`: the server-less
 * wildcards `*` and `mcp__*` and the tool-name globs (`MCP__*`,
 * `MCP__<server>__*`), which Command Code honors only in its aggressive mode
 * (`deny` and `ask`) and ignores in `allow`; and a specifier-carrying
 * `MCP__<server>__<tool>(specifier)`, which Command Code does enforce in
 * `allow` — as a glob over the call's arguments — but which rulesync cannot
 * import there without widening the grant to the whole tool; likewise a
 * padded `Shell( * )`, every command in `deny`/`ask` but a narrower grant
 * than the bare `Shell` in `allow`.
 */
type ParsedCommandcodeRule = { category: string; pattern: string; notInAllow: boolean };

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
 * Split `Tool(specifier)` into its two halves the way Command Code's
 * `splitRule` does (`command-code` 1.54.0): the rule is split at the first
 * unescaped `(` and must end with `)`, the tool half is trimmed (so
 * `Shell (rm -rf *)` is a `Shell` rule), and a `\(` / `\)` in the specifier
 * is an escaped parenthesis. `Tool` alone has an empty specifier. A rule that
 * opens a parenthesis without closing one is not a rule to Command Code at
 * all, so it comes back with an empty tool half and stays unmodeled. Nothing
 * else in the specifier is touched: Command Code does not trim it (the shell
 * matcher normalizes whitespace on its own, see `parseCommandcodeRule`), so
 * `Read( )` is a rule for the pattern `" "`, which matches nothing, not for
 * the whole tool.
 */
function splitCommandcodeRule(rule: string): { tool: string; inner: string } {
  const trimmed = rule.trim();
  const parenIndex = trimmed.search(/(?<!\\)\(/);
  if (parenIndex === -1) {
    return { tool: trimmed, inner: "" };
  }
  if (!trimmed.endsWith(")")) {
    return { tool: "", inner: "" };
  }
  return {
    tool: trimmed.slice(0, parenIndex).trim(),
    inner: trimmed.slice(parenIndex + 1, -1).replace(/\\([()])/g, "$1"),
  };
}

/** Whether a specifier means "no specifier" to Command Code: only `` and `*` do. */
function isCatchAllSpecifier(inner: string): boolean {
  return inner === "" || inner === CATCH_ALL_PATTERN;
}

/**
 * Read an MCP-shaped rule the way Command Code does (`command-code` 1.54.0,
 * `parsePermissionRule` / `parseMcpToken`). The MCP shape is only recognized
 * by its exact `mcp__` prefix, and such a rule never carries a specifier:
 * `mcp__<server>__<tool>(owner:foo)` denies, asks or allows the whole tool.
 * Its names are matched case-sensitively against the registered server and
 * tool (Command Code never lowercases them), so the remainder keeps its case
 * as the canonical category. `mcp__<server>`, `mcp__<server>__` and
 * `mcp__<server>__*` are the whole server (category `mcp__<server>`), and a
 * `*` server (`mcp__*`, `mcp__*__<tool>`) is every MCP tool, honored in
 * `deny`/`ask` only. A differently-cased `MCP__...` spelling is read as a
 * plain tool-name rule instead, matched case-insensitively:
 * `MCP__<server>__<tool>` matches that tool by name (so it folds onto the
 * `mcp__` category, remainder as written), `MCP__<server>__<tool>(specifier)`
 * globs the specifier against the call's `command` / `file_path` / `path` /
 * `url` / `pattern` argument (in `deny`/`ask` a `param:glob` form is tried
 * first) — kept as a pattern in `deny`/`ask`, but not imported from `allow`,
 * where a grant scoped that way cannot be modeled without widening it; the
 * globs
 * `MCP__*` (every MCP tool) and `MCP__<server>__*` (the whole server) match
 * by name in `deny`/`ask` only, and `MCP__<server>` names no tool at all.
 * Whatever matches nothing anywhere (or a glob rulesync does not model)
 * returns `null` and is left alone.
 */
function parseMcpCommandcodeRule({
  tool,
  inner,
}: {
  tool: string;
  inner: string;
}): ParsedCommandcodeRule | null {
  const remainder = tool.slice(MCP_CANONICAL_PREFIX.length);
  const separator = remainder.indexOf("__");
  const server = separator === -1 ? remainder : remainder.slice(0, separator);
  const rest = separator === -1 ? "" : remainder.slice(separator + 2);
  if (server.length === 0) {
    return null;
  }
  const everyServer = { category: "mcp", pattern: CATCH_ALL_PATTERN, notInAllow: true };
  if (tool.startsWith(MCP_CANONICAL_PREFIX)) {
    if (server === CATCH_ALL_PATTERN) {
      return everyServer;
    }
    // Only a server of exactly `*` is a wildcard; a registered server name
    // never contains `*`, so `mcp__git*` compares literally and matches nothing.
    if (server.includes(CATCH_ALL_PATTERN)) {
      return null;
    }
    const wholeServer = rest === "" || rest === CATCH_ALL_PATTERN;
    const category = wholeServer
      ? `${MCP_CANONICAL_PREFIX}${server}`
      : `${MCP_CANONICAL_PREFIX}${remainder}`;
    return { category, pattern: CATCH_ALL_PATTERN, notInAllow: false };
  }
  const category = `${MCP_CANONICAL_PREFIX}${remainder}`;
  const namesTool = separator !== -1 && rest.length > 0 && !remainder.includes(CATCH_ALL_PATTERN);
  if (!isCatchAllSpecifier(inner)) {
    return namesTool ? { category, pattern: inner, notInAllow: true } : null;
  }
  if (remainder === CATCH_ALL_PATTERN) {
    return everyServer;
  }
  if (rest === CATCH_ALL_PATTERN && !server.includes(CATCH_ALL_PATTERN)) {
    // `MCP__<server>__*` matches every tool of that server by name, which is
    // the whole server — the same thing the exact-prefix `mcp__<server>` says.
    return {
      category: `${MCP_CANONICAL_PREFIX}${server}`,
      pattern: CATCH_ALL_PATTERN,
      notInAllow: true,
    };
  }
  return namesTool ? { category, pattern: CATCH_ALL_PATTERN, notInAllow: false } : null;
}

/**
 * A rule on one of the friendly tools, with its specifier read as Command
 * Code matches it. The shell matcher trims and collapses whitespace on both
 * the pattern and the command, so `Shell( git  * )` is `Shell(git *)` and a
 * pattern that is blank once normalized (`Shell( )`) matches nothing. A
 * padded `Shell( * )` is not the bare `Shell`: only a specifier of exactly
 * `` or `*` is dropped by the rule parser, so `( * )` stays a pattern rule —
 * in `deny`/`ask` it matches every command (the whole tool), while in `allow`
 * it is narrower than the bare `Shell` (it needs a command that parses into
 * words and has no environment-assignment prefix), so it is the whole tool
 * marked `notInAllow`. The path, web and tool-name matchers use the
 * specifier as written, so one that is blank or `*` only once trimmed
 * (`Read( * )`) matches nothing. What matches nothing comes back as `null`:
 * the rule is unmodeled and left alone.
 */
function friendlyToolRule({
  category,
  inner,
}: {
  category: string;
  inner: string;
}): ParsedCommandcodeRule | null {
  if (category === "bash") {
    if (isCatchAllSpecifier(inner)) {
      return { category, pattern: CATCH_ALL_PATTERN, notInAllow: false };
    }
    const normalized = inner.trim().replace(/\s+/g, " ");
    if (normalized === "") {
      return null;
    }
    return isCatchAllSpecifier(normalized)
      ? { category, pattern: CATCH_ALL_PATTERN, notInAllow: true }
      : { category, pattern: normalized, notInAllow: false };
  }
  if (isCatchAllSpecifier(inner)) {
    return { category, pattern: CATCH_ALL_PATTERN, notInAllow: false };
  }
  return isCatchAllSpecifier(inner.trim()) ? null : { category, pattern: inner, notInAllow: false };
}

/**
 * Parse a Command Code rule back into canonical terms. Tool names fold case;
 * `Tool`, `Tool()` and `Tool(*)` all mean the whole tool; MCP-shaped rules
 * go through `parseMcpCommandcodeRule`. Returns `null` for a rule rulesync
 * cannot model (an exact internal tool name such as `edit_file`, a
 * name-wildcard like `edit_*`, a specifier on a rule that takes none, or a
 * rule Command Code enforces nothing for, such as `Agent`).
 */
function parseCommandcodeRule(rule: string): ParsedCommandcodeRule | null {
  const { tool, inner } = splitCommandcodeRule(rule);
  if (tool === CATCH_ALL_PATTERN) {
    return isCatchAllSpecifier(inner)
      ? {
          category: ALL_TOOLS_PERMISSION_CATEGORY,
          pattern: CATCH_ALL_PATTERN,
          notInAllow: true,
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
  return friendlyToolRule({ category, inner });
}

/**
 * Whether an imported rule is a differently-cased `MCP__<server>__<tool>`
 * name that folded onto an exact-prefix `mcp__` category (which Command Code
 * matches case-sensitively, unlike the name rule it came from).
 */
function isFoldedMcpToolNameRule({ rule, category }: { rule: string; category: string }): boolean {
  const { tool } = splitCommandcodeRule(rule);
  return category.startsWith(MCP_CANONICAL_PREFIX) && !tool.startsWith(MCP_CANONICAL_PREFIX);
}

/** The `Tool` half of `Tool(specifier)`, when the rule is an exact-prefix MCP rule with a specifier. */
function scopedMcpRuleTool(rule: string): string | null {
  const { tool, inner } = splitCommandcodeRule(rule);
  return !isCatchAllSpecifier(inner) && tool.startsWith(MCP_CANONICAL_PREFIX) ? tool : null;
}

/**
 * The string entries of a Command Code permission list. Command Code reads
 * each entry on its own and skips one that is not a string, so a stray
 * `null` beside `Shell(rm -rf *)` must not throw the deny away with it; the
 * skipped entries are counted in a warning because they cannot be kept.
 */
function stringRules({
  list,
  action,
  outcome,
  warn,
}: {
  list: unknown;
  action: PermissionAction;
  outcome: string;
  warn: (message: string) => void;
}): string[] {
  if (!Array.isArray(list)) {
    return [];
  }
  const rules = list.filter((entry): entry is string => typeof entry === "string");
  const skipped = list.length - rules.length;
  if (skipped > 0) {
    warn(
      `Command Code permission list "${action}" holds ${skipped} ${skipped === 1 ? "entry" : "entries"} ` +
        `that ${skipped === 1 ? "is" : "are"} not a string, which Command Code skips; ` +
        `${skipped === 1 ? "that entry was" : "those entries were"} ${outcome}.`,
    );
  }
  return rules;
}

/**
 * The canonical categories this run rebuilds — every category the canonical
 * config names (an empty `bash: {}` still reclaims the previous `Shell(...)`
 * entries, as in the Claude Code adapter) plus every rule it emits, keyed the
 * way an existing entry parses back (so `mcp: { github: "deny" }`, written as
 * `mcp__github`, claims the `mcp__github` entries of the previous run; case
 * variants of the friendly tool names fold together, while MCP names are
 * matched exactly, as Command Code does). An existing entry whose tool folds onto one of them is
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
  const list = stringRules({
    list: existingPermissions[key],
    action: key,
    outcome: "dropped from the regenerated list",
    warn: (message) => logger?.warn(message),
  });
  return list.filter((rule) => {
    const parsed = parseCommandcodeRule(rule);
    if (parsed === null || !managedCategories.has(parsed.category)) {
      return true;
    }
    // The same rule, or the category-wide rule (which covers every pattern of
    // the tool), taking its place at the same strength is not a loosening.
    const replacement =
      written.get(`${parsed.category}(${parsed.pattern})`) ??
      written.get(`${parsed.category}(${CATCH_ALL_PATTERN})`);
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
  if (action === "allow" && emitted.notInAllow) {
    logger?.warn(
      `Command Code does not honor '${rule}' in "allow" as written (an allow rule must name ` +
        `what it grants), so the '${emitted.category}' allow rule was not written.`,
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
 * Why a rule marked `notInAllow` is not imported from `allow`: Command Code
 * ignores a server-less wildcard or a tool-name glob there, while it does
 * enforce a scoped `MCP__<server>__<tool>(specifier)` — as a glob over the
 * call's arguments — and a padded `Shell( * )` — as a pattern narrower than
 * the bare `Shell` — which rulesync cannot model in `allow` without widening
 * the grant.
 */
function skippedAllowImportMessage({ rule, category }: { rule: string; category: string }): string {
  const { tool, inner } = splitCommandcodeRule(rule);
  if (category === "bash") {
    return (
      `Command Code reads '${rule}' in "allow" as a pattern narrower than the bare 'Shell' (the command ` +
      `must parse into words and carry no environment assignment), which rulesync cannot import ` +
      `without widening the grant to every command, so it was not imported.`
    );
  }
  if (tool.startsWith(MCP_CANONICAL_PREFIX) || isCatchAllSpecifier(inner)) {
    return `Command Code ignores '${rule}' in "allow" (an allow rule must name what it grants), so it was not imported.`;
  }
  return (
    `Command Code globs the specifier of '${rule}' in "allow" against the call's arguments, ` +
    `which rulesync cannot import without widening the grant to the whole tool, so it was not imported.`
  );
}

/**
 * Parse Command Code's `permissions` lists back into a canonical permission
 * map with `deny > ask > allow` precedence, so a tool described more than
 * once resolves to the strictest action. Each rule is imported as what
 * Command Code enforces for it, never as what it looks like: a rule Command
 * Code ignores in `allow` (`*`, `mcp__*`, an `MCP__...` glob) is skipped
 * there with a warning, since importing it would turn a dead line into a
 * live grant for every other target, and so is a scoped
 * `MCP__<server>__<tool>(specifier)` allow, which Command Code enforces as a
 * glob over the call's arguments but rulesync cannot import without widening
 * it to the whole tool; the specifier of an exact-prefix `mcp__...` rule,
 * which Command Code drops, is folded to the whole tool in every list — with
 * a warning in `allow`, where the fold widens the grant the user wrote. A
 * tool-half glob in that exact-prefix spelling (`mcp__<server>__get_*`), which
 * Command Code matches against tool names in every list, is imported as the
 * category spelled that way, the same one the generator writes back; other
 * targets read it as a literal tool name.
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
  for (const [action, rawList] of lists) {
    const list = stringRules({
      list: rawList,
      action,
      outcome: "not imported",
      warn: (message) => fallbackLogger.warn(message),
    });
    for (const rule of list) {
      const parsed = parseCommandcodeRule(rule);
      if (parsed === null) {
        if (action !== "allow") {
          fallbackLogger.warn(
            `Command Code permission rule '${rule}' in "${action}" is not one rulesync can model, so it ` +
              `could not be imported; it stays in the Command Code settings, where a regenerate keeps it.`,
          );
        }
        continue;
      }
      const { category, pattern } = parsed;
      if (action === "allow" && parsed.notInAllow) {
        fallbackLogger.warn(skippedAllowImportMessage({ rule, category }));
        continue;
      }
      if (action === "allow" && scopedMcpRuleTool(rule) !== null) {
        fallbackLogger.warn(
          `Command Code ignores the specifier of an MCP rule, so '${rule}' in "allow" was imported ` +
            `as the whole '${category}' tool, which is what Command Code grants for it.`,
        );
      }
      if (isFoldedMcpToolNameRule({ rule, category })) {
        fallbackLogger.warn(
          `Command Code matches '${rule}' in "${action}" against MCP tool names case-insensitively, ` +
            `but the '${category}' rule generated from it matches the server and tool names exactly ` +
            `as written; spell the rule the way the tool is registered if they differ.`,
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
 * Import: the lists are parsed back as what Command Code enforces for each
 * entry — friendly tool names case-insensitively (with the internal aliases
 * such as `Bash`, `PowerShell` and `write_file` folding onto their
 * category), MCP names exactly; rules for internal tool names rulesync does
 * not model are skipped.
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
