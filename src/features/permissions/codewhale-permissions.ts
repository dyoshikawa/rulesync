import { join } from "node:path";

import * as smolToml from "smol-toml";

import {
  CODEWHALE_CONSTITUTION_FILE_NAME,
  CODEWHALE_DIR,
  CODEWHALE_PERMISSIONS_FILE_NAME,
} from "../../constants/codewhale-paths.js";
import type { AiFileParams } from "../../types/ai-file.js";
import {
  type CodewhalePermissionRule,
  CodewhalePermissionRuleSchema,
  type PermissionAction,
  type PermissionsConfig,
} from "../../types/permissions.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import { createIntersectionBudget } from "../../utils/glob.js";
import type { Logger } from "../../utils/logger.js";
import {
  codewhaleConstitutionToCanonical,
  mergeCodewhaleConstitution,
  parseCodewhaleConstitution,
} from "./codewhale-repo-law.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
import {
  ALL_TOOLS_PERMISSION_CATEGORY,
  collectShellCommandRules,
  createShadowingRestrictionsTest,
  SHELL_PERMISSION_CATEGORY,
} from "./shell-command-categories.js";
import { PERMISSION_ACTION_PRIORITY } from "./single-action-collapse.js";
import {
  ToolPermissions,
  type ToolPermissionsForDeletionParams,
  type ToolPermissionsFromFileParams,
  type ToolPermissionsFromRulesyncPermissionsParams,
  type ToolPermissionsSettablePaths,
} from "./tool-permissions.js";

const CODEWHALE_SHELL_TOOL = "exec_shell";

/**
 * Canonical path categories and the Codewhale policy tool names their rules are
 * written for. Codewhale consults typed rules only for `exec_shell` and these
 * file tools, so a rule for any other tool (`fetch_url`, `web_search`, an MCP
 * tool, ...) is never evaluated. `edit` covers `apply_patch` too: both modify
 * existing files, and an `edit` deny that left `apply_patch` open would not
 * hold.
 *
 * @see https://github.com/Hmbown/Codewhale/blob/main/crates/tui/src/core/engine.rs (`file_tool_permission_paths`)
 * @see https://github.com/Hmbown/Codewhale/blob/main/crates/tui/src/tools/canonical_action.rs
 */
const CODEWHALE_PATH_CATEGORY_TOOLS: Record<string, readonly string[]> = {
  read: ["read_file"],
  write: ["write_file"],
  edit: ["edit_file", "apply_patch"],
  grep: ["grep_files"],
  glob: ["file_search"],
  list: ["list_dir"],
};

/**
 * `apply_patch` can also create files (a `--- /dev/null` hunk), so a `write`
 * restriction is written for it too; a `write` allow is not, since it would
 * approve edits to existing files the `edit` category never allowed.
 *
 * @see https://github.com/Hmbown/Codewhale/blob/main/crates/tui/src/tools/apply_patch.rs
 */
const CODEWHALE_WRITE_RESTRICTION_TOOLS: readonly string[] = ["write_file", "apply_patch"];

/** The Codewhale tools a canonical path rule is written for. */
function pathCategoryTools(category: string, action: PermissionAction): readonly string[] {
  if (category === "write" && action !== "allow") {
    return CODEWHALE_WRITE_RESTRICTION_TOOLS;
  }
  return CODEWHALE_PATH_CATEGORY_TOOLS[category] ?? [];
}

/** The canonical path categories a Codewhale file tool's rule can come from. */
const CODEWHALE_TOOL_TO_PATH_CATEGORIES: Record<string, readonly string[]> = {
  read_file: ["read"],
  write_file: ["write"],
  edit_file: ["edit"],
  apply_patch: ["edit", "write"],
  grep_files: ["grep"],
  file_search: ["glob"],
  list_dir: ["list"],
};

const COMMAND_WILDCARD_CHARACTERS = /[*?[]/;
const PATH_GLOB_CHARACTERS = /[*?[\]{}]/;

type ResolvedCodewhaleRule = CodewhalePermissionRule & { action: PermissionAction };

function isCatchAllPattern(pattern: string): boolean {
  return pattern === "*" || pattern === "**";
}

/**
 * The literal command prefix a wildcard pattern pins down, cut back to a word
 * boundary so it never names a partial word (`git push* --force` pins down
 * `git`, not `git push`). Empty when the pattern starts with a wildcard.
 */
function literalCommandPrefix(pattern: string): string {
  const firstWildcard = pattern.search(COMMAND_WILDCARD_CHARACTERS);
  const head = pattern.slice(0, firstWildcard);
  if (/\s$/.test(head)) {
    return head.trim();
  }
  const lastBoundary = head.search(/\s\S*$/);
  return lastBoundary < 0 ? "" : head.slice(0, lastBoundary).trim();
}

/**
 * Convert one canonical `bash` rule. Codewhale matches `command` as a
 * word-boundary prefix of the invocation (or the whole invocation with
 * `command_exact = true`); it expands no wildcards.
 *
 * - `*` / `**` → a tool-wide rule.
 * - `git *` → the prefix `git`.
 * - A wildcard-free `allow` → an exact command, so it approves nothing more
 *   than the command it names. A wildcard-free `deny` / `ask` → a prefix, the
 *   way Codewhale's own deny rules are matched, so the restriction also covers
 *   the command with more arguments.
 * - Any other wildcard: a restricting rule is broadened to the literal prefix
 *   it pins down; an `allow` is skipped, since no prefix approves only what it
 *   names.
 */
function convertShellRule({
  pattern,
  action,
  source = SHELL_PERMISSION_CATEGORY,
  logger,
}: {
  pattern: string;
  action: PermissionAction;
  /** The canonical category the rule was written under, for warnings. */
  source?: string;
  logger?: Logger;
}): ResolvedCodewhaleRule | null {
  const trimmed = pattern.trim();
  if (isCatchAllPattern(trimmed)) {
    return { tool: CODEWHALE_SHELL_TOOL, action };
  }
  if (trimmed === "") {
    logger?.warn(`Codewhale permissions: skipping empty ${source} ${action} pattern.`);
    return null;
  }
  if (!COMMAND_WILDCARD_CHARACTERS.test(trimmed)) {
    return action === "allow"
      ? { tool: CODEWHALE_SHELL_TOOL, command: trimmed, command_exact: true, action }
      : { tool: CODEWHALE_SHELL_TOOL, command: trimmed, action };
  }
  const trailingPrefix = trimmed.endsWith(" *") ? trimmed.slice(0, -2).trim() : null;
  if (trailingPrefix && !COMMAND_WILDCARD_CHARACTERS.test(trailingPrefix)) {
    return { tool: CODEWHALE_SHELL_TOOL, command: trailingPrefix, action };
  }
  if (action === "allow") {
    logger?.warn(
      `Codewhale permissions: skipping ${source} allow "${pattern}" because Codewhale matches commands by prefix and expands no wildcards.`,
    );
    return null;
  }
  const prefix = literalCommandPrefix(trimmed);
  if (prefix === "") {
    logger?.warn(
      `Codewhale permissions: skipping ${source} ${action} "${pattern}" because it pins down no literal command prefix Codewhale could match.`,
    );
    return null;
  }
  logger?.warn(
    `Codewhale permissions: broadening ${source} ${action} "${pattern}" to the command prefix "${prefix}" because Codewhale expands no wildcards.`,
  );
  return { tool: CODEWHALE_SHELL_TOOL, command: prefix, action };
}

/**
 * Convert one canonical path rule. Codewhale matches `path` exactly (after
 * normalizing it against the workspace) and expands no globs, so `*` / `**`
 * become a tool-wide rule and any other glob is skipped: narrowing it to a
 * single path would leave the rest of the glob unrestricted, and widening it to
 * the whole tool would restrict far more than written.
 */
function convertPathRules({
  category,
  pattern,
  action,
  logger,
}: {
  category: string;
  pattern: string;
  action: PermissionAction;
  logger?: Logger;
}): ResolvedCodewhaleRule[] {
  const tools = pathCategoryTools(category, action);
  const trimmed = pattern.trim();
  if (isCatchAllPattern(trimmed)) {
    return tools.map((tool) => ({ tool, action }));
  }
  if (trimmed === "" || PATH_GLOB_CHARACTERS.test(trimmed)) {
    logger?.warn(
      `Codewhale permissions: skipping ${category} ${action} "${pattern}" because Codewhale matches exact paths and expands no globs.`,
    );
    return [];
  }
  return tools.map((tool) => ({ tool, path: trimmed, action }));
}

function ruleKey(rule: CodewhalePermissionRule): string {
  return JSON.stringify([
    rule.tool,
    rule.command ?? null,
    rule.command_exact ?? false,
    rule.path ?? null,
    rule.workspace ?? null,
    rule.action ?? "ask",
  ]);
}

function withExplicitAction(rule: CodewhalePermissionRule): ResolvedCodewhaleRule {
  return { ...rule, action: rule.action ?? "ask" };
}

/**
 * Codewhale picks the matching rule by action (`deny` > `ask` > `allow`) before
 * specificity, so file order never changes a decision. The rules are still
 * sorted that way, then by tool, so the output is stable and reads in the order
 * Codewhale applies it.
 */
function sortRules(rules: ResolvedCodewhaleRule[]): ResolvedCodewhaleRule[] {
  return rules
    .map((rule, index) => ({ rule, index }))
    .toSorted((left, right) => {
      const actionOrder =
        PERMISSION_ACTION_PRIORITY[right.rule.action] -
        PERMISSION_ACTION_PRIORITY[left.rule.action];
      if (actionOrder !== 0) return actionOrder;
      const toolOrder = left.rule.tool.localeCompare(right.rule.tool);
      if (toolOrder !== 0) return toolOrder;
      return left.index - right.index;
    })
    .map(({ rule }) => rule);
}

/**
 * The `deny` / `ask` patterns that could not be written, per Codewhale tool, as
 * globs an `allow` rule for that tool is compared against.
 */
type DroppedRestrictions = Map<string, string[]>;

function recordDroppedRestriction({
  dropped,
  tools,
  glob,
}: {
  dropped: DroppedRestrictions;
  tools: readonly string[];
  glob: string;
}): void {
  for (const tool of tools) {
    dropped.set(tool, [...(dropped.get(tool) ?? []), glob]);
  }
}

/**
 * A `[...]` class in a restriction widens to `?` (any one character): matched
 * after lowercasing, a negated or mixed-case class would otherwise narrow what
 * the restriction covers.
 */
function widenRestrictionClasses(pattern: string): string {
  return pattern.replace(/\[[!^]?\]?[^\]]*\]/g, "?");
}

/**
 * An `allow` rule names a literal command or path, so a `[` in it widens to `?`
 * rather than opening a class that would not even match the rule itself.
 */
function literalAsGlob(value: string): string {
  return value.replaceAll("[", "?");
}

/**
 * Codewhale matches commands case-insensitively and word by word, so commands
 * are compared lowercased with their whitespace collapsed.
 */
function normalizeCommandGlob(glob: string): string {
  return glob.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Codewhale normalizes a rule's path against the workspace, dropping empty and
 * `.` segments, so the same file can be spelled several ways. Paths are
 * compared lowercased (for case-insensitive file systems) with those segments
 * dropped, a `{a,b}` group widens to `*`, a `**` segment widens so it also
 * matches no directory at all (a leading `**` segment before `*.pem` reaches
 * `dev.pem`, and `secrets/**` reaches `secrets`), and a path that is absolute,
 * home-relative or climbs with `..` widens to `*` outright, since it cannot be
 * compared against a workspace-relative one. Every rewrite only widens a
 * pattern, so an inexact comparison withholds an `allow` rather than writing
 * one a dropped restriction overlaps.
 */
function normalizePathGlob(glob: string): string {
  const normalized = glob.trim().replaceAll("\\", "/").toLowerCase();
  if (/^(?:\/|~|[a-z]:)/.test(normalized) || /(?:^|\/)\.\.(?:\/|$)/.test(normalized)) {
    return "*";
  }
  return normalized
    .split("/")
    .filter((segment) => segment !== "" && segment !== ".")
    .join("/")
    .replace(/\{.*\}/g, "*")
    .replace(/\*\*\//g, "*")
    .replace(/\/\*\*$/, "*");
}

/** A dropped `bash` (or all-tools) restriction, as a glob to compare `allow` rules against. */
function shellRestrictionGlob(pattern: string): string {
  return normalizeCommandGlob(widenRestrictionClasses(pattern));
}

/** A dropped path restriction, as a glob to compare `allow` rules against. */
function pathRestrictionGlob(pattern: string): string {
  return normalizePathGlob(widenRestrictionClasses(pattern));
}

/**
 * The file tools whose `path` is the directory a search or listing starts from,
 * so an `allow` on a directory reaches everything under it.
 */
const CODEWHALE_DIRECTORY_ROOTED_TOOLS: ReadonlySet<string> = new Set([
  "grep_files",
  "file_search",
  "list_dir",
]);

/**
 * The globs a written `allow` rule approves, for comparison with dropped
 * restrictions. A path that normalizes to the workspace root (`.`) approves
 * everything, and a directory-rooted tool's path approves what lies under it.
 */
function allowRuleComparisonGlobs(rule: CodewhalePermissionRule): string[] {
  if (rule.tool === CODEWHALE_SHELL_TOOL) {
    if (rule.command === undefined) return ["*"];
    const command = normalizeCommandGlob(literalAsGlob(rule.command));
    return rule.command_exact ? [command] : [command, `${command} *`];
  }
  const path = rule.path === undefined ? "" : normalizePathGlob(literalAsGlob(rule.path));
  if (path === "") return ["*"];
  return CODEWHALE_DIRECTORY_ROOTED_TOOLS.has(rule.tool) ? [path, `${path}/*`] : [path];
}

/**
 * Drop every `allow` rule that a restriction which could not be written
 * overlaps (any one command or path matches both), so what the restriction
 * named reaches Codewhale's approval prompt instead of being auto-approved. An
 * `allow` no dropped restriction overlaps is kept. Comparisons share one budget;
 * once it runs out every comparison answers "overlaps", so the rule is withheld.
 */
function withholdShadowedAllowRules<T extends CodewhalePermissionRule>({
  rules,
  dropped,
  logger,
}: {
  rules: T[];
  dropped: DroppedRestrictions;
  logger?: Logger;
}): T[] {
  const budget = createIntersectionBudget();
  const tests = new Map(
    [...dropped].map(([tool, globs]) => [
      tool,
      createShadowingRestrictionsTest(
        globs.map((pattern) => ({ pattern, fromAllToolsCategory: false })),
        { budget },
      ),
    ]),
  );
  return rules.filter((rule) => {
    const test = tests.get(rule.tool);
    if ((rule.action ?? "ask") !== "allow" || test === undefined) {
      return true;
    }
    const shadowing = [...new Set(allowRuleComparisonGlobs(rule).flatMap((glob) => test(glob)))];
    if (shadowing.length === 0) {
      return true;
    }
    logger?.warn(
      `Codewhale permissions: withholding ${rule.tool} allow ${JSON.stringify(rule.command ?? rule.path ?? "*")}${rule.workspace === undefined ? "" : ` (workspace ${rule.workspace})`} because the deny/ask rule(s) ${shadowing.map((pattern) => JSON.stringify(pattern)).join(", ")} for ${rule.tool} could not be written; those calls keep Codewhale's approval prompt.`,
    );
    return false;
  });
}

/**
 * An all-tools `deny` / `ask` names paths as much as commands (`secrets/**`
 * under `*` denies a path), so it is written for every file tool as well. A
 * pattern Codewhale cannot match as a path is recorded as dropped for every file
 * tool instead, the same way a skipped restriction of a path category is.
 */
function convertAllToolsPathRestriction({
  pattern,
  action,
  converted,
  dropped,
  logger,
}: {
  pattern: string;
  action: PermissionAction;
  converted: ResolvedCodewhaleRule[];
  dropped: DroppedRestrictions;
  logger?: Logger;
}): void {
  const categories = Object.keys(CODEWHALE_PATH_CATEGORY_TOOLS);
  const pathRules = categories.flatMap((category) =>
    convertPathRules({ category, pattern, action }),
  );
  if (pathRules.length > 0) {
    converted.push(...pathRules);
    return;
  }
  logger?.warn(
    `Codewhale permissions: all-tools ${action} "${pattern}" cannot be written for Codewhale's file tools, which match exact paths and expand no globs.`,
  );
  for (const category of categories) {
    recordDroppedRestriction({
      dropped,
      tools: pathCategoryTools(category, action),
      glob: pathRestrictionGlob(pattern),
    });
  }
}

/**
 * Convert the rules that govern shell commands (`bash`, plus the restricting
 * rules of the all-tools `*` category) into `converted`, recording in
 * `dropped` each restriction that could not be written.
 */
function convertShellCommandRules({
  config,
  converted,
  dropped,
  logger,
}: {
  config: PermissionsConfig;
  converted: ResolvedCodewhaleRule[];
  dropped: DroppedRestrictions;
  logger?: Logger;
}): void {
  const { rules: shellRules, ignoredAllToolsAllowPatterns } = collectShellCommandRules(
    config.permission,
  );
  for (const { pattern, action, fromAllToolsCategory } of shellRules) {
    const rule = convertShellRule({
      pattern,
      action,
      source: fromAllToolsCategory ? "all-tools (as a shell command)" : SHELL_PERMISSION_CATEGORY,
      logger,
    });
    if (rule) {
      converted.push(rule);
    } else if (action !== "allow") {
      recordDroppedRestriction({
        dropped,
        tools: [CODEWHALE_SHELL_TOOL],
        glob: shellRestrictionGlob(pattern),
      });
    }
    if (fromAllToolsCategory) {
      convertAllToolsPathRestriction({
        pattern,
        action,
        converted,
        dropped,
        logger,
      });
    }
  }
  if (ignoredAllToolsAllowPatterns.length > 0) {
    logger?.warn(
      `Codewhale permissions: skipping all-tools allow rule(s) ${ignoredAllToolsAllowPatterns.map((pattern) => `"${pattern}"`).join(", ")}; an allow under "*" is never widened to Codewhale's tools.`,
    );
  }
}

/**
 * Convert the canonical block. The all-tools `*` category contributes its
 * restricting rules to shell commands (as every command-only adapter reads it,
 * see `collectShellCommandRules`), and its catch-all `*` restriction to every
 * file tool as well.
 *
 * A `deny` / `ask` Codewhale cannot express is not merely skipped: every
 * `allow` rule it overlaps for a tool it was meant to restrict is withheld too —
 * the generated ones and the preserved workspace-scoped grants alike — so the
 * commands or paths it named reach Codewhale's approval prompt instead of being
 * auto-approved by a broader `allow` (`{ "*": "allow", "secrets/**": "deny" }`
 * must not become a bare tool-wide allow). The `codewhale.rules` passthrough is
 * written as it stands.
 */
function canonicalToCodewhaleRules({
  config,
  preservedRules,
  logger,
}: {
  config: PermissionsConfig;
  preservedRules: CodewhalePermissionRule[];
  logger?: Logger;
}): CodewhalePermissionRule[] {
  const converted: ResolvedCodewhaleRule[] = [];
  const dropped: DroppedRestrictions = new Map();
  convertShellCommandRules({ config, converted, dropped, logger });

  for (const [category, rules] of Object.entries(config.permission)) {
    if (category === SHELL_PERMISSION_CATEGORY || category === ALL_TOOLS_PERMISSION_CATEGORY) {
      continue;
    }
    if (CODEWHALE_PATH_CATEGORY_TOOLS[category] === undefined) {
      if (Object.keys(rules).length > 0) {
        logger?.warn(
          `Codewhale permissions: skipping unsupported category "${category}"; Codewhale evaluates permission rules only for shell commands and file tools.`,
        );
      }
      continue;
    }
    for (const [pattern, action] of Object.entries(rules)) {
      const pathRules = convertPathRules({ category, pattern, action, logger });
      converted.push(...pathRules);
      if (pathRules.length === 0 && action !== "allow") {
        recordDroppedRestriction({
          dropped,
          tools: pathCategoryTools(category, action),
          glob: pathRestrictionGlob(pattern),
        });
      }
    }
  }

  const kept = withholdShadowedAllowRules({ rules: converted, dropped, logger });
  const keptPreserved = withholdShadowedAllowRules({ rules: preservedRules, dropped, logger });
  const overrideRules = (config.codewhale?.rules ?? []).map(withExplicitAction);
  return [...overrideRules, ...sortRules(kept), ...keptPreserved];
}

function parsePermissionsDocument({
  fileContent,
  filePath,
}: {
  fileContent: string;
  filePath: string;
}): Record<string, unknown> {
  if (fileContent.trim() === "") {
    return {};
  }
  try {
    return smolToml.parse(fileContent);
  } catch (error) {
    throw new Error(
      `Failed to parse existing Codewhale permissions at ${filePath}: ${formatError(error)}`,
      { cause: error },
    );
  }
}

/**
 * The workspace-scoped rules already in the file. Codewhale's approval card
 * appends one ("Always allow this exact rule in this repo") with the absolute
 * `workspace` it was granted in, and rulesync never derives a `workspace` from
 * the canonical block, so these are remembered grants rather than earlier
 * rulesync output and survive a regenerate. A record Codewhale would reject is
 * not carried over, since it would make Codewhale refuse the whole file.
 */
function collectWorkspaceScopedRules({
  document,
  logger,
}: {
  document: Record<string, unknown>;
  logger?: Logger;
}): CodewhalePermissionRule[] {
  const { valid, invalidCount } = partitionRuleRecords(document);
  if (invalidCount > 0) {
    logger?.warn(
      `Codewhale permissions: dropping ${invalidCount} existing rule record(s) Codewhale would reject (an unknown key or a wrong type).`,
    );
  }
  return valid.filter((rule) => rule.workspace !== undefined);
}

/**
 * Codewhale reads `permissions.toml` next to the `config.toml` in use, which
 * `CODEWHALE_HOME` or `CODEWHALE_CONFIG_PATH` can move away from
 * `~/.codewhale/`. rulesync always writes `~/.codewhale/permissions.toml`, so
 * say so when either is set rather than let the rules go unread.
 */
function warnAboutRelocatedConfig(logger?: Logger): void {
  for (const name of ["CODEWHALE_HOME", "CODEWHALE_CONFIG_PATH"]) {
    if (process.env[name]) {
      logger?.warn(
        `Codewhale permissions: ${name} is set, but rulesync only syncs ~/.codewhale/permissions.toml; Codewhale reads permissions.toml next to the config.toml in use.`,
      );
    }
  }
}

/** The records of a parsed file that Codewhale itself would accept. */
function partitionRuleRecords(document: Record<string, unknown>): {
  valid: CodewhalePermissionRule[];
  invalidCount: number;
} {
  const rawRules = Array.isArray(document.rules) ? document.rules : [];
  const valid: CodewhalePermissionRule[] = [];
  let invalidCount = 0;
  for (const raw of rawRules) {
    const parsed = CodewhalePermissionRuleSchema.safeParse(raw);
    if (parsed.success) {
      valid.push(parsed.data);
    } else {
      invalidCount += 1;
    }
  }
  return { valid, invalidCount };
}

type ImportCandidate = {
  category: string;
  pattern: string;
  rule: ResolvedCodewhaleRule;
};

/**
 * The canonical `bash` pattern a native shell rule round-trips through, or
 * `null` when the next generate would not write the same rule back from it.
 */
function shellRuleToPattern(rule: ResolvedCodewhaleRule): string | null {
  if (rule.path !== undefined) {
    return null;
  }
  if (rule.command === undefined) {
    return rule.command_exact ? null : "*";
  }
  const command = rule.command.trim();
  if (command === "" || COMMAND_WILDCARD_CHARACTERS.test(command)) {
    return null;
  }
  if (rule.command_exact) {
    // Only an `allow` is written back as an exact command.
    return rule.action === "allow" ? command : null;
  }
  return `${command} *`;
}

function pathRuleToPattern(rule: ResolvedCodewhaleRule): string | null {
  if (rule.command !== undefined || rule.command_exact) {
    return null;
  }
  if (rule.path === undefined) {
    return "*";
  }
  const path = rule.path.trim();
  return path === "" || PATH_GLOB_CHARACTERS.test(path) ? null : path;
}

function toImportCandidates(rule: ResolvedCodewhaleRule): ImportCandidate[] {
  if (rule.workspace !== undefined) {
    return [];
  }
  if (rule.tool === CODEWHALE_SHELL_TOOL) {
    const pattern = shellRuleToPattern(rule);
    return pattern === null ? [] : [{ category: SHELL_PERMISSION_CATEGORY, pattern, rule }];
  }
  const pattern = pathRuleToPattern(rule);
  if (pattern === null) {
    return [];
  }
  return (CODEWHALE_TOOL_TO_PATH_CATEGORIES[rule.tool] ?? []).map((category) => ({
    category,
    pattern,
    rule,
  }));
}

/**
 * Split the native rules into the canonical block and the `codewhale.rules`
 * passthrough so that the next generate writes the same file back. A canonical
 * pattern is taken only when every tool its category expands to carries the
 * same rule (`edit` needs both `edit_file` and `apply_patch`, a `write`
 * restriction both `write_file` and `apply_patch`). A rule no canonical pattern
 * claims — including the weaker of two rules for one pattern — stays native.
 */
function codewhaleRulesToCanonical(rules: ResolvedCodewhaleRule[]): {
  permission: PermissionsConfig["permission"];
  nativeRules: ResolvedCodewhaleRule[];
} {
  const permission: PermissionsConfig["permission"] = {};
  const claimedIndexes = new Set<number>();
  const grouped = new Map<string, Array<ImportCandidate & { index: number }>>();
  for (const [index, rule] of rules.entries()) {
    for (const candidate of toImportCandidates(rule)) {
      const key = JSON.stringify([candidate.category, candidate.pattern, rule.action]);
      grouped.set(key, [...(grouped.get(key) ?? []), { ...candidate, index }]);
    }
  }

  const strongestFirst = [...grouped.values()].toSorted(
    (left, right) =>
      PERMISSION_ACTION_PRIORITY[right[0]!.rule.action] -
      PERMISSION_ACTION_PRIORITY[left[0]!.rule.action],
  );
  for (const group of strongestFirst) {
    const { category, pattern, rule } = group[0]!;
    const expectedTools =
      category === SHELL_PERMISSION_CATEGORY
        ? [CODEWHALE_SHELL_TOOL]
        : pathCategoryTools(category, rule.action);
    const presentTools = new Set(group.map((candidate) => candidate.rule.tool));
    const complete = expectedTools.every((tool) => presentTools.has(tool));
    const categoryRules = permission[category] ?? {};
    if (!complete || Object.hasOwn(categoryRules, pattern)) {
      continue;
    }
    permission[category] = { ...categoryRules, [pattern]: rule.action };
    for (const candidate of group) {
      if (expectedTools.includes(candidate.rule.tool)) claimedIndexes.add(candidate.index);
    }
  }

  // Native rules keep the order they had in the file.
  const nativeRules = rules.filter((_rule, index) => !claimedIndexes.has(index));
  return { permission, nativeRules };
}

/**
 * Codewhale permissions.
 *
 * Global scope manages the typed `[[rules]]` records of
 * `~/.codewhale/permissions.toml`, the only permission-rule source Codewhale
 * reads. Each record has a `tool`, an optional `command` prefix or exact
 * `path`, an optional `command_exact`, an optional absolute `workspace`, and
 * an `action`. rulesync owns the file's rules, except for workspace-scoped
 * ones: those are the grants Codewhale's approval card remembers per
 * repository, and they are kept across a regenerate. Codewhale also appends
 * plain `exec_shell` ask rules from the approval card (`S`), which cannot be
 * told apart from rulesync's own output and are replaced; run an import first
 * to keep them.
 *
 * Project scope manages the enforced `protected_invariants` of the repo
 * constitution `.codewhale/constitution.json` (see `codewhale-repo-law.ts`):
 * the project `.codewhale/config.toml` overlay cannot carry rules, but repo
 * law can hold writes to protected paths.
 *
 * @see https://github.com/Hmbown/Codewhale/blob/main/docs/CONFIGURATION.md
 * @see https://github.com/Hmbown/Codewhale/blob/main/docs/AUTHORIZATION_ORDER.md
 */
export class CodewhalePermissions extends ToolPermissions {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "",
    });
  }

  /**
   * Codewhale's approval card writes to the global file, and the constitution
   * carries repo policy rulesync does not own, so this feature never deletes
   * either.
   */
  override isDeletable(): boolean {
    return false;
  }

  override shouldSkipCreationWhenPayloadEmpty(): boolean {
    return true;
  }

  static getSettablePaths(options?: { global?: boolean }): ToolPermissionsSettablePaths {
    return {
      relativeDirPath: CODEWHALE_DIR,
      relativeFilePath: options?.global
        ? CODEWHALE_PERMISSIONS_FILE_NAME
        : CODEWHALE_CONSTITUTION_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
    logger,
  }: ToolPermissionsFromFileParams): Promise<CodewhalePermissions> {
    const paths = CodewhalePermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? "";
    if (global) {
      warnAboutRelocatedConfig(logger);
      // A record Codewhale itself would reject is not imported; say so, since
      // the next generate drops it from the file too.
      const { invalidCount } = partitionRuleRecords(
        parsePermissionsDocument({ fileContent, filePath }),
      );
      if (invalidCount > 0) {
        logger?.warn(
          `Codewhale permissions: skipping ${invalidCount} rule record(s) in ${filePath} that Codewhale would reject (an unknown key or a wrong type).`,
        );
      }
    }
    return new CodewhalePermissions({
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
    logger,
    global = false,
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<CodewhalePermissions> {
    const paths = CodewhalePermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    // Read without initializing so a dry run or `--check` stays side-effect-free.
    const existingContent = (await readFileContentOrNull(filePath)) ?? "";

    if (!global) {
      const merged = mergeCodewhaleConstitution({
        existing: parseCodewhaleConstitution({ fileContent: existingContent, filePath }),
        config: rulesyncPermissions.getJson(),
        logger,
      });
      return new CodewhalePermissions({
        outputRoot,
        relativeDirPath: paths.relativeDirPath,
        relativeFilePath: paths.relativeFilePath,
        fileContent: JSON.stringify(merged, null, 2),
        validate: true,
        global: false,
      });
    }

    warnAboutRelocatedConfig(logger);
    const existing = parsePermissionsDocument({ fileContent: existingContent, filePath });

    const generated = canonicalToCodewhaleRules({
      config: rulesyncPermissions.getJson(),
      preservedRules: collectWorkspaceScopedRules({ document: existing, logger }),
      logger,
    });
    const seen = new Set<string>();
    const rules: CodewhalePermissionRule[] = [];
    for (const rule of generated) {
      const key = ruleKey(rule);
      if (seen.has(key)) continue;
      seen.add(key);
      rules.push(rule);
    }

    return new CodewhalePermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: rules.length > 0 ? smolToml.stringify({ rules }) : "",
      validate: true,
      global: true,
    });
  }

  toRulesyncPermissions(): RulesyncPermissions {
    const filePath = join(this.getRelativeDirPath(), this.getRelativeFilePath());
    if (!this.global) {
      const document = parseCodewhaleConstitution({
        fileContent: this.getFileContent(),
        filePath,
      });
      return this.toRulesyncPermissionsDefault({
        fileContent: JSON.stringify(
          { permission: codewhaleConstitutionToCanonical(document) },
          null,
          2,
        ),
      });
    }
    const document = parsePermissionsDocument({ fileContent: this.getFileContent(), filePath });
    // A record Codewhale itself would reject (an unknown key, a wrong type) is
    // not carried over: it cannot be expressed, and writing it back would make
    // Codewhale refuse the whole file.
    const rules = partitionRuleRecords(document).valid.map(withExplicitAction);
    const { permission, nativeRules } = codewhaleRulesToCanonical(rules);
    return this.toRulesyncPermissionsDefault({
      fileContent: JSON.stringify(
        {
          permission,
          ...(nativeRules.length > 0 && { codewhale: { rules: nativeRules } }),
        },
        null,
        2,
      ),
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolPermissionsForDeletionParams): CodewhalePermissions {
    return new CodewhalePermissions({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      global,
    });
  }
}
