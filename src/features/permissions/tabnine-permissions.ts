import { join } from "node:path";

import { uniq } from "es-toolkit";

import {
  TABNINE_AGENT_DIR_PATH,
  TABNINE_SETTINGS_FILE_NAME,
} from "../../constants/tabnine-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import type { PermissionAction, PermissionsConfig } from "../../types/permissions.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import { fallbackLogger, type Logger, warnWithFallback } from "../../utils/logger.js";
import { lookupOwn } from "../../utils/own-lookup.js";
import { isPrototypePollutionKey } from "../../utils/prototype-pollution.js";
import { quoteValueForWarning } from "../../utils/quote-value.js";
import { isRecord, isStringArray } from "../../utils/type-guards.js";
import {
  applySharedConfigPatch,
  parseSharedConfig,
  sharedConfigFileKey,
} from "../shared/shared-config-gateway.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
import {
  formatTrustAffectingEntries,
  isNotTrue,
  type TrustAffectingEntry,
  warnOnTrustAffectingEntries,
} from "./sandbox-trust.js";
import {
  collectShellCommandRules,
  createShadowingRestrictionsTest,
  partitionCommandRules,
  SHELL_PERMISSION_CATEGORY,
  warnAboutUnwrittenCommandRules,
} from "./shell-command-categories.js";
import {
  ToolPermissions,
  type ToolPermissionsForDeletionParams,
  type ToolPermissionsFromFileParams,
  type ToolPermissionsFromRulesyncPermissionsParams,
  type ToolPermissionsSettablePaths,
} from "./tool-permissions.js";

/** The `settings.json` key group that carries the two tool lists. */
const TOOLS_KEY = "tools";
/** `tools.allowed`: tool names (and `run_shell_command(<prefix>)`) that skip the confirmation prompt. */
const ALLOWED_KEY = "allowed";
/** `tools.exclude`: tool names removed from discovery entirely. */
const EXCLUDE_KEY = "exclude";
/** The `settings.json` key group whose keys the `tabnine` override may author. */
const GENERAL_KEY = "general";

/** The Tabnine CLI built-in that runs shell commands. */
const SHELL_TOOL_NAME = "run_shell_command";

/** The two override groups the permissions feature writes. */
type OverrideGroup = typeof TOOLS_KEY | typeof GENERAL_KEY;

/**
 * The paths of the `tabnine` override that are refused with a warning rather
 * than written — the line Claude Code's sandbox paths draw. Under `tools`, the
 * values Tabnine CLI spawns as a command (`discoveryCommand` and `callCommand`
 * at startup, `shell.pager` on every shell output, `sandbox.command` to start
 * the sandbox); under `general`, the host every login and API call goes to
 * (`tabnineHost`) and the editor executable (`preferredEditor`, "any editor
 * path"). A fetched `.rulesync/permissions.jsonc` must not be able to point
 * Tabnine CLI at an executable, or a server, of its choosing.
 * @see https://docs.tabnine.com/main/getting-started/tabnine-cli/features/settings/settings-reference
 */
const REFUSED_OVERRIDE_PATHS: Readonly<Record<OverrideGroup, readonly (readonly string[])[]>> = {
  [TOOLS_KEY]: [["discoveryCommand"], ["callCommand"], ["shell", "pager"], ["sandbox", "command"]],
  [GENERAL_KEY]: [["tabnineHost"], ["preferredEditor"]],
};

/** `tools.sandbox`: `true` keeps tool calls contained; anything else disables or picks the sandbox. */
const SANDBOX_KEY = "sandbox";
/** `general.defaultApprovalMode`: the modes that still ask before a tool call runs. */
const DEFAULT_APPROVAL_MODE_KEY = "defaultApprovalMode";
const PROMPTING_APPROVAL_MODES: ReadonlySet<unknown> = new Set(["default", "plan"]);

/**
 * Canonical categories with a one-to-one Tabnine CLI built-in tool. `bash` is
 * handled separately because it is the only tool whose list entries carry a
 * command prefix.
 *
 * @see https://docs.tabnine.com/main/getting-started/tabnine-cli/features/built-in-tools
 */
const CANONICAL_TO_TABNINE_TOOL_NAMES: Record<string, string> = {
  read: "read_file",
  edit: "replace",
  write: "write_file",
  webfetch: "web_fetch",
  websearch: "google_web_search",
  grep: "grep_search",
  glob: "glob",
};

const TABNINE_TO_CANONICAL_TOOL_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(CANONICAL_TO_TABNINE_TOOL_NAMES).map(([canonical, tabnine]) => [
    tabnine,
    canonical,
  ]),
);

// Shared fallback logger used by the importing direction (toRulesyncPermissions), where the
// instance method has no `logger` parameter. The exporting direction (fromRulesyncPermissions)
// forwards the caller-supplied logger explicitly.
const moduleLogger: Logger = fallbackLogger;

/**
 * Turn a canonical `bash` glob into the command prefix a
 * `run_shell_command(<prefix>)` entry carries. Tabnine matches the prefix
 * against the start of the command line, so only two glob shapes map cleanly:
 * `<prefix> *` and a bare `<prefix>` with no wildcard at all. Anything else
 * (`git * push`, `*.sh`, `npm run:*`) matches commands a prefix cannot name, so
 * it is reported and left out rather than approximated. `*` alone names the
 * tool itself and is returned as the empty prefix.
 */
function toShellPrefix(pattern: string): string | undefined {
  if (pattern === "*") {
    return "";
  }
  const prefix = pattern.endsWith(" *") ? pattern.slice(0, -2) : pattern;
  if (prefix.length === 0 || /[*?[\]]/.test(prefix)) {
    return undefined;
  }
  return prefix;
}

/**
 * The Tabnine tool a canonical category names. An unknown category is passed
 * through as a tool name (that is how an MCP tool is named); the read is an
 * own-property lookup so a category spelled `toString` does not pick up an
 * `Object.prototype` member.
 */
function toTabnineToolName(category: string): string {
  return lookupOwn({ record: CANONICAL_TO_TABNINE_TOOL_NAMES, key: category }) ?? category;
}

/**
 * The widest glob a `bash` pattern stands for once it is written as a
 * `run_shell_command(<prefix>)` entry: the prefix matches the start of the
 * command line, so a bare `pnpm` also covers `pnpm install`. Used only to
 * compare allows against the restrictions (`bash` deny and `ask` rules, and
 * the rules of `*`), where widening can only withhold more, never fail open.
 */
function widenToPrefixGlob(pattern: string): string {
  const prefix = toShellPrefix(pattern);
  if (prefix === undefined) {
    return pattern;
  }
  return prefix === "" ? "*" : `${prefix}*`;
}

function toShellEntry(prefix: string): string {
  return prefix === "" ? SHELL_TOOL_NAME : `${SHELL_TOOL_NAME}(${prefix})`;
}

type ParsedTabnineEntry = { toolName: string; prefix: string | undefined };

/**
 * The `bash` pattern a `run_shell_command(<prefix>)` entry stands for. A
 * prefix Tabnine matches literally, so one an author spelled glob-like
 * (`git *`, `*`) is read as the glob it looks like rather than doubled into
 * `git * *`, which no comparison or warning could make sense of.
 */
function toShellPattern(prefix: string | undefined): string {
  if (prefix === undefined || prefix === "" || prefix === "*") {
    return "*";
  }
  return prefix.endsWith(" *") ? prefix : `${prefix} *`;
}

/**
 * Whether {@link toShellPattern} read the prefix as a glob: such an entry
 * would never fire on Tabnine as spelled (the prefix is matched literally, so
 * `run_shell_command(git *)` only matches a command line starting with the
 * two characters `git *`), and rulesync writes it back as the prefix the glob
 * denotes — a wider entry that the author is told about.
 */
function isGlobSpelledPrefix(prefix: string | undefined): boolean {
  return prefix !== undefined && (prefix === "*" || prefix.endsWith(" *"));
}

/**
 * Split a `tools.allowed`/`tools.exclude` entry into its tool name and the
 * optional `(<prefix>)` suffix. An entry whose parenthesis never closes, or
 * that carries text after the closing one, is malformed and yields `undefined`.
 */
function parseTabnineEntry(entry: string): ParsedTabnineEntry | undefined {
  const open = entry.indexOf("(");
  if (open === -1) {
    return entry.length > 0 ? { toolName: entry, prefix: undefined } : undefined;
  }
  if (open === 0 || !entry.endsWith(")")) {
    return undefined;
  }
  return { toolName: entry.slice(0, open), prefix: entry.slice(open + 1, -1) };
}

/**
 * `record` without the value at `path`, when there is one, and without any
 * container the removal emptied. Containers on the way are copied, never
 * mutated, so the override the caller read stays intact.
 */
function omitPath({ record, path }: { record: Record<string, unknown>; path: readonly string[] }): {
  record: Record<string, unknown>;
  removed: boolean;
} {
  const [head, ...rest] = path;
  if (head === undefined || !Object.hasOwn(record, head)) {
    return { record, removed: false };
  }
  if (rest.length === 0) {
    const { [head]: _removed, ...others } = record;
    return { record: others, removed: true };
  }
  const child = record[head];
  if (!isRecord(child)) {
    return { record, removed: false };
  }
  const inner = omitPath({ record: child, path: rest });
  if (!inner.removed) {
    return { record, removed: false };
  }
  // A container the removal emptied goes too, so no `"shell": {}` is left behind.
  if (Object.keys(inner.record).length === 0) {
    const { [head]: _emptied, ...others } = record;
    return { record: others, removed: true };
  }
  return { record: { ...record, [head]: inner.record }, removed: true };
}

/**
 * The `tabnine.<group>` record with every refused path removed, and the dotted
 * names of the paths that were there. Nothing else of the group is touched:
 * the rest is written verbatim (and announced where it widens trust).
 */
function stripRefusedPaths({
  group,
  record,
}: {
  group: OverrideGroup;
  record: Record<string, unknown>;
}): {
  record: Record<string, unknown>;
  refused: string[];
} {
  const refused: string[] = [];
  let stripped = record;
  for (const path of REFUSED_OVERRIDE_PATHS[group]) {
    const result = omitPath({ record: stripped, path });
    if (result.removed) {
      refused.push(`${group}.${path.join(".")}`);
      stripped = result.record;
    }
  }
  return { record: stripped, refused };
}

/**
 * The `tools` and `general` groups of an override with the refused paths taken
 * out, and every refused path named. A `general` that is absent or that the
 * refusals emptied is reported as absent so no `general: {}` is written or
 * lifted. (The `TabninePermissionsOverrideSchema` already rejects a group that
 * is not an object; the `isRecord` guards only keep an unvalidated file from
 * throwing.)
 */
function stripRefusedOverridePaths(override: Record<string, unknown>): {
  tools: Record<string, unknown>;
  general: Record<string, unknown> | undefined;
  refused: string[];
} {
  const tools = stripRefusedPaths({
    group: TOOLS_KEY,
    record: isRecord(override[TOOLS_KEY]) ? override[TOOLS_KEY] : {},
  });
  const general = isRecord(override[GENERAL_KEY])
    ? stripRefusedPaths({ group: GENERAL_KEY, record: override[GENERAL_KEY] })
    : undefined;
  return {
    tools: tools.record,
    general:
      general !== undefined && Object.keys(general.record).length > 0 ? general.record : undefined,
    refused: [...tools.refused, ...(general?.refused ?? [])],
  };
}

/**
 * The settings of a `tabnine` override that widen what Tabnine CLI does without
 * asking, so the generate can name them. `tools.allowed` counts because an
 * override-authored entry skips the confirmation prompt on the strength of the
 * override alone (its `run_shell_command(...)` entries are not here: they are
 * compared as `bash` allows and withheld like them); `tools.sandbox` and
 * `general.defaultApprovalMode` decide whether tool calls are contained and
 * whether they are confirmed at all. Called on the override, not the file, so a
 * value the file already held is not reported as something rulesync opened.
 */
function collectTrustAffectingOverrideEntries({
  tools,
  general,
}: {
  tools: Record<string, unknown>;
  general: Record<string, unknown> | undefined;
}): TrustAffectingEntry[] {
  const entries: TrustAffectingEntry[] = [];
  const allowed = isStringArray(tools[ALLOWED_KEY]) ? tools[ALLOWED_KEY] : [];
  if (allowed.length > 0) {
    entries.push({
      label: `tools.allowed (${allowed.map(quoteValueForWarning).join(", ")})`,
      reason:
        "auto-approves what it names as the override spells it; a non-shell entry is only checked against a whole-tool deny of its tool",
    });
  }
  if (Object.hasOwn(tools, SANDBOX_KEY) && isNotTrue(tools[SANDBOX_KEY])) {
    entries.push({
      label: `tools.sandbox = ${quoteValueForWarning(tools[SANDBOX_KEY])}`,
      reason:
        "is not the plain `true` that keeps tool calls contained, so it either disables the sandbox or picks the command, image, paths and network that contain them",
    });
  }
  const approvalMode = general?.[DEFAULT_APPROVAL_MODE_KEY];
  if (
    general !== undefined &&
    Object.hasOwn(general, DEFAULT_APPROVAL_MODE_KEY) &&
    !PROMPTING_APPROVAL_MODES.has(approvalMode)
  ) {
    entries.push({
      label: `general.defaultApprovalMode = ${quoteValueForWarning(approvalMode)}`,
      reason:
        "auto-approves tool calls instead of asking; only `default` and `plan` keep the prompt",
    });
  }
  return entries;
}

/**
 * What a later generate would announce from the override an import builds,
 * said now, so the file the import writes into `.rulesync/` is read with the
 * same eyes as one that arrived with a clone. `refused` names the paths the
 * import left in `settings.json`, the ones generate refuses to write — an
 * override must not carry a value that only ever produces a warning.
 */
function announceLiftedOverride({
  tools,
  general,
  refused,
}: {
  tools: Record<string, unknown>;
  general: Record<string, unknown> | undefined;
  refused: readonly string[];
}): void {
  if (refused.length > 0) {
    const one = refused.length === 1;
    moduleLogger.info(
      `Tabnine CLI permissions: left ${refused.join(", ")} in settings.json rather than lifting ` +
        `${one ? "it" : "them"} into the tabnine override; Tabnine CLI runs ${one ? "that value" : "those values"} ` +
        `as a command or sends its traffic there, and 'rulesync generate' refuses to write ` +
        `${one ? "it" : "them"} from the override.`,
    );
  }
  const trustAffecting = collectTrustAffectingOverrideEntries({ tools, general });
  if (trustAffecting.length > 0) {
    const one = trustAffecting.length === 1;
    moduleLogger.warn(
      `Tabnine CLI permissions: the tabnine override now carries ${trustAffecting.length} ` +
        `trust-affecting setting${one ? "" : "s"} that 'rulesync generate' writes back as ` +
        `authored: ${formatTrustAffectingEntries(trustAffecting)}.`,
    );
  }
}

type TabnineToolLists = {
  allowed: string[];
  exclude: string[];
};

/**
 * Build the two tool lists from the canonical block; the rules that could not
 * be carried are reported through `logger` here.
 */
function buildToolLists({
  permission,
  overrideShellAllowPatterns,
  logger,
}: {
  permission: PermissionsConfig["permission"];
  /**
   * The `bash` patterns of the override's own `run_shell_command(...)` allow
   * entries. They join the canonical `bash` allows so the deny/ask comparison
   * withholds them just the same — an override is not a way around it.
   */
  overrideShellAllowPatterns: readonly string[];
  logger?: Logger | undefined;
}): TabnineToolLists {
  const allowed: string[] = [];
  const exclude: string[] = [];

  // Shell commands: the `bash` category plus the restricting rules of `*`.
  // `ask` has no list of its own — Tabnine prompts for every command the
  // allowlist does not cover — so it only withholds the allows it shadows.
  const { rules: canonicalRules, ignoredAllToolsAllowPatterns } =
    collectShellCommandRules(permission);
  const rules = [
    ...canonicalRules,
    ...overrideShellAllowPatterns.map((pattern) => ({
      pattern,
      action: "allow" as const,
      fromAllToolsCategory: false,
    })),
  ];
  const {
    allow: shellAllow,
    deny: shellDeny,
    shadowedAllowPatterns,
    unwrittenDenyPatterns,
    unenforcedAllToolsAskPatterns,
    intersectionBudgetExhausted,
  } = partitionCommandRules({
    rules,
    writesAllToolsDeny: false,
    // A `bash` pattern is written as a prefix that also covers every longer
    // command line, so it is compared at that width: a bare `pnpm` allow
    // overlaps a `pnpm publish *` ask and is withheld rather than written.
    normalizePattern: widenToPrefixGlob,
  });
  warnAboutUnwrittenCommandRules({
    toolLabel: "Tabnine CLI",
    surfaceLabel: "tools.allowed/tools.exclude",
    foreignRestrictingCategories: [],
    shadowedAllowPatterns,
    unwrittenDenyPatterns,
    unwrittenDenyReason:
      "tools.exclude removes a tool from discovery, and a pattern written under '*' need " +
      "not be a command at all.",
    unenforcedAllToolsAskPatterns,
    ignoredAllToolsAllowPatterns,
    intersectionBudgetExhausted,
    logger,
  });
  const unmappedShellPatterns: string[] = [];
  for (const pattern of shellDeny) {
    const prefix = toShellPrefix(pattern);
    if (prefix === undefined) {
      unmappedShellPatterns.push(pattern);
      continue;
    }
    exclude.push(toShellEntry(prefix));
  }
  // No `bash` deny is relied on to enforce itself: Tabnine documents the
  // `run_shell_command(<prefix>)` form for `tools.allowed` only, so a prefixed
  // `tools.exclude` entry is written for the case where it is honored but may
  // exclude nothing, and a deny that is no prefix at all has no entry. Every
  // deny therefore withholds the allows it overlaps — otherwise `git *` allowed
  // with `git push *` denied would auto-approve the very command the author
  // meant to stop.
  const shadowingShellDenies = createShadowingRestrictionsTest(
    shellDeny.map((pattern) => ({ pattern, fromAllToolsCategory: false })),
    { normalizePattern: widenToPrefixGlob },
  );
  const withheldAllowPatterns: string[] = [];
  for (const pattern of shellAllow) {
    const prefix = toShellPrefix(pattern);
    if (prefix === undefined) {
      unmappedShellPatterns.push(pattern);
      continue;
    }
    if (shadowingShellDenies(pattern).length > 0) {
      withheldAllowPatterns.push(pattern);
      continue;
    }
    allowed.push(toShellEntry(prefix));
  }
  if (unmappedShellPatterns.length > 0) {
    warnWithFallback(
      logger,
      `Tabnine CLI permissions: skipped ${unmappedShellPatterns.length} 'bash' rule(s) whose ` +
        `pattern is not a command prefix (${unmappedShellPatterns.map(quoteValueForWarning).join(", ")}). ` +
        `run_shell_command(<prefix>) matches the start of the command line, so only '<prefix> *' ` +
        `and a bare '<prefix>' can be written.`,
    );
  }
  if (withheldAllowPatterns.length > 0) {
    warnWithFallback(
      logger,
      `Tabnine CLI permissions: withheld ${withheldAllowPatterns.length} 'bash' allow rule(s) ` +
        `(${withheldAllowPatterns.map(quoteValueForWarning).join(", ")}) that overlap a 'bash' deny ` +
        `rule; writing them could auto-approve the denied commands, since tools.exclude is not ` +
        `documented to narrow run_shell_command to a prefix.`,
    );
  }

  // Every other tool is named as a whole: Tabnine has no per-path or per-URL
  // pattern for `read_file`, `web_fetch`, ..., so only the `*` pattern maps.
  const unmappedPatterns: string[] = [];
  for (const [category, categoryRules] of Object.entries(permission)) {
    if (category === SHELL_PERMISSION_CATEGORY || category === "*") {
      continue;
    }
    const toolName = toTabnineToolName(category);
    for (const [pattern, action] of Object.entries(categoryRules)) {
      if (pattern !== "*") {
        unmappedPatterns.push(`${category}: ${pattern}`);
        continue;
      }
      if (action === "allow") {
        allowed.push(toolName);
      } else if (action === "deny") {
        exclude.push(toolName);
      }
      // `ask` writes nothing: a tool in neither list keeps Tabnine's default
      // confirmation prompt (read-only tools never prompt, which is documented).
    }
  }
  if (unmappedPatterns.length > 0) {
    warnWithFallback(
      logger,
      `Tabnine CLI permissions: skipped ${unmappedPatterns.length} rule(s) with a pattern ` +
        `other than '*' (${unmappedPatterns.map(quoteValueForWarning).join(", ")}). ` +
        `tools.allowed/tools.exclude name whole tools; only run_shell_command takes a prefix.`,
    );
  }

  return { allowed: uniq(allowed), exclude: uniq(exclude) };
}

/**
 * Names the glob-spelled `run_shell_command(...)` override entries that were
 * written as the prefix their glob denotes. Said only for the entries that
 * made it into the list: one that a deny or ask overlaps is announced as
 * withheld by the comparison instead, and one whose glob names no prefix at
 * all is skipped by it.
 */
function warnAboutGlobSpelledOverrideEntries({
  entries,
  allowed,
  logger,
}: {
  entries: readonly { entry: string; pattern: string }[];
  allowed: readonly string[];
  logger: Logger | undefined;
}): void {
  for (const { entry, pattern } of entries) {
    const prefix = toShellPrefix(pattern);
    const written = prefix === undefined ? undefined : toShellEntry(prefix);
    if (written === undefined || !allowed.includes(written)) {
      continue;
    }
    warnWithFallback(
      logger,
      `Tabnine CLI permissions: read tools.allowed entry ${quoteValueForWarning(entry)} of ` +
        `the tabnine override as the 'bash' allow rule ${quoteValueForWarning(pattern)}; ` +
        `Tabnine matches a prefix literally, so it is written as ` +
        `${quoteValueForWarning(written)}, which auto-approves every command it covers.`,
    );
  }
}

/**
 * A verbatim override allow naming a tool the canonical block denies is
 * withheld the way a shadowed `bash` allow is: Tabnine never loads an excluded
 * tool whatever `allowed` says, so the entry would only ever contradict the
 * deny it sits beside — and an override is not a way around a canonical rule.
 * Returns the entries that may be written.
 */
function withholdDeniedOverrideAllowed({
  overrideVerbatimAllowed,
  exclude,
  logger,
}: {
  overrideVerbatimAllowed: readonly string[];
  exclude: readonly string[];
  logger: Logger | undefined;
}): string[] {
  const denied = overrideVerbatimAllowed.filter((entry) => {
    const toolName = parseTabnineEntry(entry)?.toolName;
    return toolName !== undefined && exclude.includes(toolName);
  });
  if (denied.length > 0) {
    warnWithFallback(
      logger,
      `Tabnine CLI permissions: withheld ${denied.length} tools.allowed entry(ies) of the ` +
        `tabnine override (${denied.map(quoteValueForWarning).join(", ")}) that name a tool the ` +
        `canonical block denies; Tabnine never loads an excluded tool, so remove the deny rule ` +
        `from .rulesync/permissions.jsonc to allow it.`,
    );
  }
  return overrideVerbatimAllowed.filter((entry) => !denied.includes(entry));
}

/**
 * The entries of a managed tool that the canonical block did not re-derive are
 * named rather than removed silently. Dropping an exclude loosens the policy,
 * so it is a warning; dropping an allow only brings back Tabnine's confirmation
 * prompt, so it is said at info level for the author who wonders where a
 * hand-written entry went.
 */
function reportDroppedManagedEntries({
  existingTools,
  allowedList,
  excludeList,
  logger,
}: {
  existingTools: Record<string, unknown> | undefined;
  allowedList: readonly string[];
  excludeList: readonly string[];
  logger: Logger | undefined;
}): void {
  const dropped = (key: string, list: readonly string[]): string[] =>
    uniq(isStringArray(existingTools?.[key]) ? existingTools[key] : []).filter((entry) => {
      if (list.includes(entry)) {
        return false;
      }
      // A whole-tool entry subsumes every prefixed entry of that tool.
      const toolName = parseTabnineEntry(entry)?.toolName;
      return toolName === undefined || !list.includes(toolName);
    });
  const droppedExclude = dropped(EXCLUDE_KEY, excludeList);
  if (droppedExclude.length > 0) {
    warnWithFallback(
      logger,
      `Tabnine CLI permissions: removed ${droppedExclude.length} existing tools.exclude ` +
        `entry(ies) (${droppedExclude.map(quoteValueForWarning).join(", ")}) of a tool the ` +
        `canonical block manages; add a deny rule to .rulesync/permissions.jsonc to keep them.`,
    );
  }
  const droppedAllowed = dropped(ALLOWED_KEY, allowedList);
  if (droppedAllowed.length > 0) {
    (logger ?? moduleLogger).info(
      `Tabnine CLI permissions: removed ${droppedAllowed.length} existing tools.allowed ` +
        `entry(ies) (${droppedAllowed.map(quoteValueForWarning).join(", ")}) of a tool the ` +
        `canonical block manages; add an allow rule to .rulesync/permissions.jsonc to keep them.`,
    );
  }
}

/**
 * Permissions generator for the Tabnine CLI.
 *
 * Tabnine CLI keeps its tool policy in `.tabnine/agent/settings.json` (project)
 * and `~/.tabnine/agent/settings.json` (user), a shared file that also carries
 * `mcpServers`, `hooks`, `general.*`, `context.*` and more, so writes go through
 * the shared-config gateway as a deep merge and the file is never deleted.
 *
 * Two keys are driven by the canonical block:
 * - `tools.allowed` — `allow` rules. A tool name skips the confirmation prompt;
 *   `run_shell_command(<prefix>)` narrows that to one command prefix.
 * - `tools.exclude` — `deny` rules. A tool name removes the tool from discovery.
 *   A `bash` deny is written as `run_shell_command(<prefix>)` there, the form
 *   Gemini CLI's `excludeTools` (which Tabnine derives from) honors, but Tabnine
 *   documents the prefix for `tools.allowed` only — so the entry is not relied
 *   on, and every allow the deny overlaps is withheld as well.
 *
 * `ask` writes nothing: a tool that is in neither list keeps Tabnine's default
 * prompt. Every other `tools.*` key (`core`, `shell.*`, `enableWebTools`, ...)
 * and the `general.*` group are authored through the `tabnine` override, which
 * is deep-merged beneath the two canonical lists; entries in the lists that
 * cannot be mapped back (a prefix on a non-shell tool, an MCP tool name) round
 * trip through the override too.
 *
 * @see https://docs.tabnine.com/main/getting-started/tabnine-cli/features/built-in-tools
 * @see https://docs.tabnine.com/main/getting-started/tabnine-cli/features/settings/settings-reference
 */
export class TabninePermissions extends ToolPermissions {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "{}",
    });
  }

  /**
   * `settings.json` holds unrelated user settings (`mcpServers`, `hooks`,
   * `general`, ...), so it must not be deleted.
   */
  override isDeletable(): boolean {
    return false;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolPermissionsSettablePaths {
    return {
      relativeDirPath: TABNINE_AGENT_DIR_PATH,
      relativeFilePath: TABNINE_SETTINGS_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolPermissionsFromFileParams): Promise<TabninePermissions> {
    const paths = TabninePermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? "{}";
    return new TabninePermissions({
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
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<TabninePermissions> {
    const paths = TabninePermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    // Read without initializing so this stays side-effect-free under
    // `--dry-run`/`--check`; the actual write happens later in `writeAiFiles`.
    const existingContent = (await readFileContentOrNull(filePath)) ?? "{}";

    const config = rulesyncPermissions.getJson();
    const override = isRecord(config.tabnine) ? config.tabnine : {};
    const {
      tools: overrideTools,
      general: overrideGeneral,
      refused: refusedPaths,
    } = stripRefusedOverridePaths(override);
    if (refusedPaths.length > 0) {
      const one = refusedPaths.length === 1;
      warnWithFallback(
        logger,
        `Tabnine CLI permissions: refused to write ${refusedPaths.join(", ")} from the tabnine ` +
          `override; Tabnine CLI runs ${one ? "that value" : "those values"} as a command or ` +
          `sends its traffic there, and a permissions file (one that came from 'rulesync fetch' ` +
          `included) must not be able to point it at an executable or a server of its choosing. ` +
          `Set ${one ? "it" : "them"} by hand in ` +
          `${join(paths.relativeDirPath, paths.relativeFilePath)} if you need ${one ? "it" : "them"}.`,
      );
    }
    // The override's own list entries. A `run_shell_command(...)` allow is a
    // `bash` allow spelled the Tabnine way, so it is handed to the canonical
    // comparison rather than written past it; the rest is appended verbatim.
    // A list that is not a list is reported, not skipped in silence.
    const overrideList = (key: string): string[] => {
      const value = overrideTools[key];
      if (value === undefined || isStringArray(value)) {
        return value ?? [];
      }
      warnWithFallback(
        logger,
        `Tabnine CLI permissions: ignored tools.${key} of the tabnine override ` +
          `(${quoteValueForWarning(value)}); it must be a list of tool names.`,
      );
      return [];
    };
    const overrideShellAllowPatterns: string[] = [];
    const overrideVerbatimAllowed: string[] = [];
    const globSpelledOverrideEntries: { entry: string; pattern: string }[] = [];
    for (const entry of overrideList(ALLOWED_KEY)) {
      const parsed = parseTabnineEntry(entry);
      if (parsed?.toolName === SHELL_TOOL_NAME) {
        const pattern = toShellPattern(parsed.prefix);
        if (isGlobSpelledPrefix(parsed.prefix)) {
          globSpelledOverrideEntries.push({ entry, pattern });
        }
        overrideShellAllowPatterns.push(pattern);
      } else {
        overrideVerbatimAllowed.push(entry);
      }
    }
    const overrideExclude = overrideList(EXCLUDE_KEY);
    const { allowed, exclude } = buildToolLists({
      permission: config.permission,
      overrideShellAllowPatterns,
      logger,
    });
    warnAboutGlobSpelledOverrideEntries({ entries: globSpelledOverrideEntries, allowed, logger });
    const writableOverrideAllowed = withholdDeniedOverrideAllowed({
      overrideVerbatimAllowed,
      exclude,
      logger,
    });

    // The override may only author the `tools` and `general` groups. Any other
    // top-level key would ride into the shared file through the permissions
    // feature, past the adapter that owns it (`mcpServers`, `hooks`, ...).
    const ignoredOverrideKeys = Object.keys(override).filter(
      (key) => key !== TOOLS_KEY && key !== GENERAL_KEY,
    );
    if (ignoredOverrideKeys.length > 0) {
      warnWithFallback(
        logger,
        `Tabnine CLI permissions: ignored ${ignoredOverrideKeys.length} key(s) of the tabnine ` +
          `override (${ignoredOverrideKeys.map(quoteValueForWarning).join(", ")}); only 'tools' ` +
          `and 'general' are written through the permissions feature.`,
      );
    }

    // Entries of the existing lists that name a tool the canonical block does
    // not manage are hand-written (an MCP tool, a prefix rulesync cannot
    // spell) and are kept; entries for managed tools are rulesync's to rewrite.
    const existingTools = this.existingToolsGroup(existingContent);
    const managedToolNames = new Set(
      Object.keys(config.permission).map((category) =>
        // The rules of `*` apply to shell commands, so they manage the shell
        // tool too: a stale `run_shell_command(git)` allow must not outlive
        // the `bash` category it came from once `*` restricts `git *`.
        category === SHELL_PERMISSION_CATEGORY || category === "*"
          ? SHELL_TOOL_NAME
          : toTabnineToolName(category),
      ),
    );
    const preservedEntries = (key: string): string[] =>
      (isStringArray(existingTools?.[key]) ? existingTools[key] : []).filter((entry) => {
        const toolName = parseTabnineEntry(entry)?.toolName;
        return toolName === undefined || !managedToolNames.has(toolName);
      });

    // The override's own `tools.allowed`/`tools.exclude` carry the entries the
    // canonical block cannot spell (see `toRulesyncPermissions`); they are
    // appended after the canonical ones so a round trip is lossless.
    const allowedList = uniq([
      ...allowed,
      ...writableOverrideAllowed,
      ...preservedEntries(ALLOWED_KEY),
    ]);
    const excludeList = uniq([...exclude, ...overrideExclude, ...preservedEntries(EXCLUDE_KEY)]);
    reportDroppedManagedEntries({ existingTools, allowedList, excludeList, logger });

    // An empty list retracts its key: rulesync owns the entries of the tools it
    // manages, and the hand-written ones were kept above. The `tools` group
    // itself is only touched when there is something to write into it or it
    // already exists, so a config without tool rules does not leave an empty
    // `tools: {}` behind.
    const tools: Record<string, unknown> = {
      ...overrideTools,
      [ALLOWED_KEY]: allowedList.length > 0 ? allowedList : undefined,
      [EXCLUDE_KEY]: excludeList.length > 0 ? excludeList : undefined,
    };
    const patch: Record<string, unknown> = {};
    if (overrideGeneral !== undefined) {
      patch[GENERAL_KEY] = overrideGeneral;
    }
    const hasToolsToWrite = Object.values(tools).some((value) => value !== undefined);
    if (hasToolsToWrite || existingTools !== undefined) {
      patch[TOOLS_KEY] = tools;
    }
    // The rest of the override is written as authored, but not silently: the
    // settings that widen what Tabnine CLI does unattended are named once.
    warnOnTrustAffectingEntries({
      toolLabel: "Tabnine CLI",
      entries: collectTrustAffectingOverrideEntries({
        tools: { ...overrideTools, [ALLOWED_KEY]: writableOverrideAllowed },
        general: overrideGeneral,
      }),
      relativeFilePath: join(paths.relativeDirPath, paths.relativeFilePath),
      logger,
    });

    return new TabninePermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: applySharedConfigPatch({
        fileKey: sharedConfigFileKey(paths),
        feature: "permissions",
        existingContent,
        patch,
        filePath,
      }),
      validate: true,
      global,
    });
  }

  /** The `tools` group of the existing file, or `undefined` when it has none. */
  private static existingToolsGroup(existingContent: string): Record<string, unknown> | undefined {
    try {
      const existing = parseSharedConfig({
        format: "json",
        fileContent: existingContent || "{}",
        invalidRootPolicy: "error",
      });
      return isRecord(existing[TOOLS_KEY]) ? existing[TOOLS_KEY] : undefined;
    } catch {
      // The gateway reports the broken file itself when the patch is applied.
      return undefined;
    }
  }

  toRulesyncPermissions(): RulesyncPermissions {
    const settings = this.parseSettings();
    const tools = isRecord(settings[TOOLS_KEY]) ? settings[TOOLS_KEY] : {};

    const permission: Record<string, Record<string, PermissionAction>> = {};
    const leftovers: Record<string, string[]> = {};
    const setRule = (category: string, pattern: string, action: PermissionAction): void => {
      // Own-property reads and writes only: the category is a tool name taken
      // from the file, and the caller keeps prototype-pollution keys out.
      const rules = Object.hasOwn(permission, category)
        ? permission[category]
        : (permission[category] = {});
      // `exclude` is read before `allowed`, so a name in both lists stays a deny —
      // Tabnine never loads an excluded tool, whatever `allowed` says.
      if (rules !== undefined && !Object.hasOwn(rules, pattern)) {
        rules[pattern] = action;
      }
    };
    for (const [key, action] of [
      [EXCLUDE_KEY, "deny"],
      [ALLOWED_KEY, "allow"],
    ] as const) {
      const entries = isStringArray(tools[key]) ? tools[key] : [];
      for (const entry of entries) {
        const parsed = parseTabnineEntry(entry);
        if (parsed === undefined) {
          moduleLogger.warn(
            `Tabnine CLI permissions: kept malformed tools.${key} entry ${quoteValueForWarning(entry)} in the tabnine override.`,
          );
          (leftovers[key] ??= []).push(entry);
          continue;
        }
        const { toolName, prefix } = parsed;
        if (toolName === SHELL_TOOL_NAME) {
          setRule(SHELL_PERMISSION_CATEGORY, toShellPattern(prefix), action);
          continue;
        }
        if (prefix !== undefined) {
          // Only the shell tool documents a prefix; keep anything else verbatim.
          (leftovers[key] ??= []).push(entry);
          continue;
        }
        const category =
          lookupOwn({ record: TABNINE_TO_CANONICAL_TOOL_NAMES, key: toolName }) ?? toolName;
        if (isPrototypePollutionKey(category)) {
          // A tool named `__proto__` would land on `Object.prototype` as a
          // permission category; it stays a verbatim entry of the override.
          moduleLogger.warn(
            `Tabnine CLI permissions: kept tools.${key} entry ${quoteValueForWarning(entry)} in the tabnine override; its name cannot be a permission category.`,
          );
          (leftovers[key] ??= []).push(entry);
          continue;
        }
        setRule(category, "*", action);
      }
    }

    // Everything else under `tools`, and the `general` group, belongs to the
    // `tabnine` override so a generate after import writes it back unchanged.
    // The refused paths stay in `settings.json`: generate refuses to write
    // them, so lifting them would only ever produce that warning.
    const {
      tools: overrideTools,
      general,
      refused,
    } = stripRefusedOverridePaths({
      [TOOLS_KEY]: Object.fromEntries(
        Object.entries(tools).filter(([key]) => key !== ALLOWED_KEY && key !== EXCLUDE_KEY),
      ),
      [GENERAL_KEY]: settings[GENERAL_KEY],
    });
    for (const [key, entries] of Object.entries(leftovers)) {
      overrideTools[key] = entries;
    }
    const override: Record<string, unknown> = {};
    if (Object.keys(overrideTools).length > 0) {
      override[TOOLS_KEY] = overrideTools;
    }
    if (general !== undefined) {
      override[GENERAL_KEY] = general;
    }
    announceLiftedOverride({ tools: overrideTools, general, refused });

    const imported: Record<string, unknown> = { permission };
    if (Object.keys(override).length > 0) {
      imported.tabnine = override;
    }
    return this.toRulesyncPermissionsDefault({
      fileContent: JSON.stringify(imported, null, 2),
    });
  }

  private parseSettings(): Record<string, unknown> {
    const relativePath = join(this.getRelativeDirPath(), this.getRelativeFilePath());
    try {
      // Fail-closed on a syntax error / non-mapping root, matching the write
      // path's shared-config declaration, so a broken file is surfaced rather
      // than partially imported.
      return parseSharedConfig({
        format: "json",
        fileContent: this.getFileContent() || "{}",
        filePath: relativePath,
        invalidRootPolicy: "error",
      });
    } catch (error) {
      throw new Error(
        `Failed to parse Tabnine CLI settings in ${relativePath}: ${formatError(error)}`,
        { cause: error },
      );
    }
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolPermissionsForDeletionParams): TabninePermissions {
    return new TabninePermissions({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
      global,
    });
  }
}
