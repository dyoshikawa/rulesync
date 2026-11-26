import { join } from "node:path";

import { OMP_CONFIG_FILE_NAME, OMP_DIR, OMP_GLOBAL_DIR } from "../../constants/omp-paths.js";
import type { AiFileParams } from "../../types/ai-file.js";
import {
  OMP_APPROVAL_MODES,
  type OmpApprovalMode,
  type OmpPermissionsOverride,
  type PermissionAction,
  type PermissionsConfig,
} from "../../types/permissions.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { invertRecord, lookupOwn } from "../../utils/own-lookup.js";
import { isPrototypePollutionKey } from "../../utils/prototype-pollution.js";
import { isRecord, toRecord } from "../../utils/type-guards.js";
import {
  applySharedConfigPatch,
  parseSharedConfig,
  sharedConfigFileKey,
} from "../shared/shared-config-gateway.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
import {
  ALL_TOOLS_PERMISSION_CATEGORY,
  bashRulesHonoringAllTools,
  CATCH_ALL_PATTERN,
  SHELL_PERMISSION_CATEGORY,
} from "./shell-command-categories.js";
import {
  collapseRulesToSingleAction,
  hasPatternSpecificRules,
  PERMISSION_ACTION_PRIORITY,
} from "./single-action-collapse.js";
import {
  ToolPermissions,
  type ToolPermissionsFromFileParams,
  type ToolPermissionsFromRulesyncPermissionsParams,
  type ToolPermissionsSettablePaths,
} from "./tool-permissions.js";

type OmpApproval = "allow" | "prompt" | "deny";

type OmpBashPattern = { match: string; approval: OmpApproval; env?: unknown };

// Keys that scope a `bash.patterns` entry to working directories (v18.20.1+).
// An entry naming a folder under any of them applies only there; one whose
// keys hold no string (such as YAML's `path: ~`) is unscoped.
// https://github.com/can1357/oh-my-pi/blob/ce36c879d72b5a9ddf7d0b8dd10bb8e1bc62c4a4/packages/coding-agent/src/config/settings.ts
const PATH_SCOPE_KEYS = ["path", "paths", "pathPrefix", "pathPrefixes"] as const;

// Keys a path-scoped `bash.patterns` entry nests its rules under.
const SCOPED_RULE_LIST_KEYS = ["patterns", "values", "items"] as const;

// The `tools` key holding oh-my-pi's approval mode, authored through the
// `omp.approvalMode` override.
const APPROVAL_MODE_KEY = "approvalMode";

// The `tools` key holding oh-my-pi's restricted folders (v18.13.1+), authored
// through the `omp.restrictedFolders` override.
const RESTRICTED_FOLDERS_KEY = "restrictedFolders";

const ACTION_TO_OMP_APPROVAL: Record<PermissionAction, OmpApproval> = {
  allow: "allow",
  ask: "prompt",
  deny: "deny",
};

const OMP_APPROVAL_TO_ACTION: Record<OmpApproval, PermissionAction> = {
  allow: "allow",
  prompt: "ask",
  deny: "deny",
};

// Canonical categories whose oh-my-pi tool has a different name. Every other
// canonical category with a built-in tool (`bash`, `read`, `edit`, `write`,
// `grep`, `glob`) keeps its name, and an unknown category (an MCP tool, or an
// omp-only tool such as `eval`) is written verbatim as the `tools.approval` key.
// https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/tools/builtin-names.ts
const CATEGORY_TO_OMP_TOOL: Record<string, string> = {
  websearch: "web_search",
  agent: "task",
};

const OMP_TOOL_TO_CATEGORY: Record<string, string> = invertRecord(CATEGORY_TO_OMP_TOOL);

// Canonical categories with no oh-my-pi tool to key a policy on: web pages are
// fetched through `read` (or a mounted device), there is no notebook tool, and
// there is no key covering every MCP tool. Their rules are skipped with a
// warning rather than widened onto another tool.
const UNSUPPORTED_CATEGORIES: ReadonlySet<string> = new Set(["webfetch", "notebookedit", "mcp"]);

// The `tools.approval` keys rulesync manages. They are rewritten on every
// generate (so a rule removed from the source disappears). Any other key — an
// `eval` or MCP tool policy — is kept unless rulesync writes it this time, so a
// rule for such a tool removed from the source stays in `config.yml`.
const MANAGED_OMP_TOOLS: ReadonlySet<string> = new Set([
  "bash",
  "read",
  "edit",
  "write",
  "grep",
  "glob",
  "web_search",
  "task",
]);

/**
 * Permissions adapter for oh-my-pi (`omp`).
 *
 * oh-my-pi reads approval policy from `config.yml`: `<cwd>/.omp/config.yml` in
 * project scope and `~/.omp/agent/config.yml` (default profile) globally.
 *
 * - `tools.approval.<tool>: allow | prompt | deny` is a per-tool policy honored
 *   in every approval mode. A category's catch-all `*` rule maps here
 *   (`ask` → `prompt`). `tools.approval` has no per-path matcher, so a non-bash
 *   category with pattern-specific rules collapses to one action (deny > ask >
 *   allow, with an implicit `ask` when there is no catch-all) and a warning.
 * - `bash.patterns: [{ match, approval }]` is an ordered, first-match-wins list
 *   of command globs (only `*` is a wildcard). Every `bash` rule except a
 *   catch-all `allow` is written there, ordered deny → prompt → allow so that
 *   the first match agrees with rulesync's deny > ask > allow precedence. A
 *   catch-all `allow` goes to `tools.approval.bash` instead, because by default
 *   (without `bash.allowCompoundCommands`) an `allow` pattern never approves a
 *   compound command line while the tool policy does — unless the category has
 *   an `ask` rule, which makes `tools.approval.bash` `prompt` (see
 *   `convertBashRules`) and the catch-all `allow` a trailing pattern. oh-my-pi
 *   expands no `?` or `[...]`, so a deny or ask pattern widens them to `*`.
 * - The all-tools `*` category has no key of its own: its rules restrict bash
 *   commands, and its deny / ask also restrict every other tool's policy (a
 *   catch-all one at its own strictness, a pattern-specific one as `prompt`).
 *
 * The `omp.approvalMode` override writes `tools.approvalMode` (`always-ask`,
 * `always-ask-cached`, `write` or `yolo`); without it the key is left as it is in the file, and on
 * import a recognized value is read back into the override. Likewise the
 * `omp.restrictedFolders` override writes `tools.restrictedFolders` (folders
 * where every action prompts in every approval mode, `yolo` included), is left
 * alone when absent, and is read back on import.
 *
 * `config.yml` carries every other oh-my-pi setting, so only `tools.approval`
 * (the keys rulesync manages), `bash.patterns` and an authored
 * `tools.approvalMode` or `tools.restrictedFolders` are rewritten; sibling
 * keys such as `bash.enabled` and `bash.allowedEnvVars` are kept, and the file
 * is never deleted.
 *
 * Within `bash.patterns`, rulesync owns only the unscoped entries. Entries
 * scoped to folders (`path` / `paths` / `pathPrefix` / `pathPrefixes`) have no
 * canonical form, so they are kept on generate — placed so that none of their
 * rules can loosen a rulesync deny or prompt rule (see `mergeBashPatterns`) —
 * and a regenerated entry keeps the `env` list of the existing entry with the
 * same `match` and `approval`. On import, a scoped entry's deny and prompt
 * rules become global rules (stricter than the scope) and its allow rules are
 * skipped, both with a warning, so a folder-only allow never comes back as a
 * global one.
 *
 * @see https://github.com/can1357/oh-my-pi/blob/main/docs/settings.md
 * @see https://github.com/can1357/oh-my-pi/blob/main/docs/approval-mode.md
 */
export class OmpPermissions extends ToolPermissions {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "",
    });
  }

  static getSettablePaths({
    global = false,
  }: { global?: boolean } = {}): ToolPermissionsSettablePaths {
    return {
      relativeDirPath: global ? OMP_GLOBAL_DIR : OMP_DIR,
      relativeFilePath: OMP_CONFIG_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolPermissionsFromFileParams): Promise<OmpPermissions> {
    const paths = OmpPermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? "";
    return new OmpPermissions({
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
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<OmpPermissions> {
    const paths = OmpPermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    // Read without initializing so generation stays side-effect-free under
    // `--dry-run`/`--check`; the write happens later in `writeAiFiles`.
    const existingContent = (await readFileContentOrNull(filePath)) ?? "";
    const existing = parseSharedConfig({ format: "yaml", fileContent: existingContent, filePath });

    const config = rulesyncPermissions.getJson();
    const { approval, patterns, floor } = convertRulesyncToOmp({ config, logger });
    const approvalMode = config.omp?.approvalMode;
    const restrictedFolders = config.omp?.restrictedFolders;

    const existingTools = toRecord(existing.tools);
    // A kept key is still raised to the all-tools floor, so a hand-written
    // `eval: allow` cannot outlive an all-tools deny.
    const keptApproval = isRecord(existingTools.approval)
      ? Object.fromEntries(
          Object.entries(existingTools.approval)
            .filter(([tool]) => !MANAGED_OMP_TOOLS.has(tool) && !Object.hasOwn(approval, tool))
            .map(([tool, value]) => [tool, raisedApproval(value, floor)]),
        )
      : {};
    const nextApproval = { ...keptApproval, ...approval };
    const toolsSiblings = withoutKey(existingTools, "approval");
    if (approvalMode !== undefined) {
      toolsSiblings[APPROVAL_MODE_KEY] = approvalMode;
    }
    if (restrictedFolders !== undefined) {
      toolsSiblings[RESTRICTED_FOLDERS_KEY] = restrictedFolders;
    }
    const nextTools =
      Object.keys(nextApproval).length > 0
        ? { ...toolsSiblings, approval: nextApproval }
        : toolsSiblings;

    const existingBash = toRecord(existing.bash);
    const bashSiblings = withoutKey(existingBash, "patterns");
    const nextPatterns = mergeBashPatterns({
      generated: patterns,
      existing: existingBash.patterns,
      logger,
    });
    const nextBash =
      nextPatterns.length > 0 ? { ...bashSiblings, patterns: nextPatterns } : bashSiblings;

    return new OmpPermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: applySharedConfigPatch({
        fileKey: sharedConfigFileKey(paths),
        feature: "permissions",
        existingContent,
        // An emptied block is removed rather than left as `tools: {}`.
        patch: {
          tools: Object.keys(nextTools).length > 0 ? nextTools : undefined,
          bash: Object.keys(nextBash).length > 0 ? nextBash : undefined,
        },
        filePath,
        logger,
      }),
      validate: true,
      global,
    });
  }

  toRulesyncPermissions({ logger }: { logger?: Logger } = {}): RulesyncPermissions {
    let config: Record<string, unknown>;
    try {
      config = parseSharedConfig({ format: "yaml", fileContent: this.getFileContent() });
    } catch (error) {
      throw new Error(
        `Failed to parse oh-my-pi config in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        { cause: error },
      );
    }

    return this.toRulesyncPermissionsDefault({
      fileContent: JSON.stringify(convertOmpToRulesync(config, logger), null, 2),
    });
  }
}

function withoutKey(record: Record<string, unknown>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([name]) => name !== key));
}

function stricter(a: PermissionAction | undefined, b: PermissionAction): PermissionAction {
  return a !== undefined && PERMISSION_ACTION_PRIORITY[a] >= PERMISSION_ACTION_PRIORITY[b] ? a : b;
}

/**
 * The floor the all-tools `*` category puts under every tool's single policy:
 * a catch-all deny / ask at its own strictness, and a pattern-specific one as
 * `ask`, since some input of each tool may match it and a per-tool policy
 * cannot single that input out. `undefined` when `*` restricts nothing.
 */
function allToolsFloor(rules: Record<string, PermissionAction> | undefined): {
  floor: PermissionAction | undefined;
  patternSpecific: boolean;
} {
  let floor: PermissionAction | undefined;
  let patternSpecific = false;
  for (const [pattern, action] of Object.entries(rules ?? {})) {
    if (action === "allow" || isPrototypePollutionKey(pattern)) {
      continue;
    }
    if (pattern === CATCH_ALL_PATTERN) {
      floor = stricter(floor, action);
    } else {
      patternSpecific = true;
      floor = stricter(floor, "ask");
    }
  }
  return { floor, patternSpecific };
}

/**
 * oh-my-pi expands only `*`, so a `?` or `[...]` in a deny / ask pattern widens
 * to `*` (a literal match would restrict almost nothing). An allow pattern is
 * left as is: matched literally it approves less, never more.
 */
function widenRestrictionPattern(pattern: string): string {
  // A class may open with `!` and a literal `]`; an unclosed `[` widens too.
  return pattern.replace(/\[!?\]?[^\]]*\]|\[|\?/gu, "*").replace(/\*{2,}/gu, "*");
}

/**
 * A `bash` category as `bash.patterns` entries (unsorted), plus the
 * `tools.approval.bash` policy it needs.
 *
 * oh-my-pi replaces a `prompt` (or `allow`) pattern match on a critical command
 * such as `rm -rf /` with an override that carries no policy, which yolo mode
 * then resolves by `tools.approval.bash` alone. So any `ask` rule sets the tool
 * policy to `prompt`, and a catch-all `allow` then becomes a trailing
 * `match: "*"` allow pattern (patterns beat the tool policy) instead of an
 * `allow` policy that would wave such a command through.
 */
function convertBashRules({
  rules,
  logger,
}: {
  rules: Record<string, PermissionAction>;
  logger?: Logger;
}): { patterns: OmpBashPattern[]; policy: PermissionAction | undefined } {
  const patterns: OmpBashPattern[] = [];
  const entries = Object.entries(rules).filter(([pattern]) => !isPrototypePollutionKey(pattern));
  const hasAsk = entries.some(([, action]) => action === "ask");
  let policy: PermissionAction | undefined = hasAsk ? "ask" : undefined;
  if (hasAsk && rules[CATCH_ALL_PATTERN] !== "ask") {
    logger?.warn(
      "oh-my-pi lets a critical command (such as `rm -rf /`) skip a bash prompt pattern unless " +
        'the bash tool policy prompts, so `tools.approval.bash` was set to "prompt": a command ' +
        "no bash allow pattern matches now prompts in every approval mode.",
    );
  }
  for (const [pattern, action] of entries) {
    if (pattern === CATCH_ALL_PATTERN && action === "allow") {
      if (hasAsk) {
        patterns.push({ match: CATCH_ALL_PATTERN, approval: "allow" });
      } else {
        policy = "allow";
      }
      continue;
    }
    let match = pattern;
    if (/[?[]/u.test(pattern)) {
      if (action === "allow") {
        logger?.warn(
          `oh-my-pi matches only "*" as a wildcard, so "?" and "[" in the bash allow ` +
            `pattern "${pattern}" are matched literally.`,
        );
      } else {
        match = widenRestrictionPattern(pattern);
        logger?.warn(
          `oh-my-pi matches only "*" as a wildcard, so the bash ${action} pattern ` +
            `"${pattern}" was widened to "${match}".`,
        );
      }
    }
    patterns.push({ match, approval: ACTION_TO_OMP_APPROVAL[action] });
  }
  return { patterns, policy };
}

/** Raise every non-bash tool policy to the all-tools floor (bash is handled by patterns). */
function applyAllToolsFloor({
  actions,
  allTools,
  logger,
}: {
  actions: Record<string, PermissionAction>;
  allTools: ReturnType<typeof allToolsFloor>;
  logger?: Logger;
}): void {
  const { floor } = allTools;
  if (floor === undefined) {
    return;
  }
  if (allTools.patternSpecific) {
    logger?.warn(
      'oh-my-pi sets one approval policy per tool, so the pattern-specific "*" category ' +
        `restrictions were written as "${ACTION_TO_OMP_APPROVAL[floor]}" for every non-bash tool.`,
    );
  }
  for (const tool of new Set([...MANAGED_OMP_TOOLS, ...Object.keys(actions)])) {
    if (tool !== SHELL_PERMISSION_CATEGORY) {
      actions[tool] = stricter(actions[tool], floor);
    }
  }
}

function convertRulesyncToOmp({ config, logger }: { config: PermissionsConfig; logger?: Logger }): {
  approval: Record<string, OmpApproval>;
  patterns: OmpBashPattern[];
  floor: PermissionAction | undefined;
} {
  const actions: Record<string, PermissionAction> = {};
  const patterns: OmpBashPattern[] = [];
  const permission = config.permission;
  const allTools = allToolsFloor(permission[ALL_TOOLS_PERMISSION_CATEGORY]);
  // All-tools restrictions cover shell commands even when there is no `bash`
  // category of its own.
  const categories =
    permission[ALL_TOOLS_PERMISSION_CATEGORY] === undefined
      ? permission
      : { ...permission, bash: bashRulesHonoringAllTools(permission) };

  for (const [category, rules] of Object.entries(categories)) {
    if (isPrototypePollutionKey(category) || Object.keys(rules).length === 0) {
      continue;
    }
    if (category === ALL_TOOLS_PERMISSION_CATEGORY) {
      // Its deny / ask are applied to bash above and to every other tool below.
      if (Object.values(rules).includes("allow")) {
        logger?.warn(
          'oh-my-pi has no all-tools approval key, so the "*" category allow rules were skipped.',
        );
      }
      continue;
    }
    if (UNSUPPORTED_CATEGORIES.has(category)) {
      logger?.warn(
        `oh-my-pi has no "${category}" tool to set an approval policy on, so its rules were skipped` +
          (category === "webfetch" ? " (oh-my-pi fetches web pages through `read`)." : "."),
      );
      continue;
    }

    if (category === SHELL_PERMISSION_CATEGORY) {
      const bash = convertBashRules({ rules, logger });
      patterns.push(...bash.patterns);
      if (bash.policy !== undefined) {
        actions.bash = bash.policy;
      }
      continue;
    }

    const action = collapseRulesToSingleAction({ rules });
    if (action === undefined) {
      continue;
    }
    if (hasPatternSpecificRules(rules)) {
      logger?.warn(
        `oh-my-pi sets one approval policy per tool, so the pattern-specific "${category}" ` +
          `rules were collapsed to "${ACTION_TO_OMP_APPROVAL[action]}" (deny > ask > allow).`,
      );
    }
    // `agent` and a verbatim `task` share one key, so the stricter one wins.
    const tool = lookupOwn({ record: CATEGORY_TO_OMP_TOOL, key: category }) ?? category;
    if (/^mcp__.+__/u.test(tool)) {
      logger?.warn(
        `oh-my-pi registers MCP tools as "mcp__<server>_<tool>", so "${tool}" may never match; ` +
          "write oh-my-pi's registered name under a tool-scoped `omp.permission` block.",
      );
    }
    actions[tool] = stricter(actions[tool], action);
  }

  applyAllToolsFloor({ actions, allTools, logger });

  // First match wins, so the strictest rules lead; the sort is stable, keeping
  // source order within an action.
  const order = (pattern: OmpBashPattern): number =>
    -PERMISSION_ACTION_PRIORITY[OMP_APPROVAL_TO_ACTION[pattern.approval]];
  patterns.sort((a, b) => order(a) - order(b));

  const approval: Record<string, OmpApproval> = Object.fromEntries(
    Object.entries(actions).map(([tool, action]) => [tool, ACTION_TO_OMP_APPROVAL[action]]),
  );
  return { approval, patterns, floor: allTools.floor };
}

/** An existing `tools.approval` value raised to the all-tools floor, if any. */
function raisedApproval(value: unknown, floor: PermissionAction | undefined): unknown {
  if (floor === undefined) {
    return value;
  }
  const approval = toOmpApproval(value);
  const current = approval === undefined ? undefined : OMP_APPROVAL_TO_ACTION[approval];
  return ACTION_TO_OMP_APPROVAL[stricter(current, floor)];
}

function toOmpApproval(value: unknown): OmpApproval | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  // oh-my-pi trims and case-normalizes policy strings and ignores invalid ones.
  const normalized = value.trim().toLowerCase();
  return Object.hasOwn(OMP_APPROVAL_TO_ACTION, normalized)
    ? (normalized as OmpApproval)
    : undefined;
}

/**
 * Fold `tools.approval.bash` (`undefined` when unset) into the imported `bash`
 * rules. A user `deny` is absolute. Otherwise a `*` pattern beats the tool
 * policy, which then reaches only compound and critical command lines — so a
 * `*` allow pattern imports as `allow` only behind an explicit `allow` policy
 * or in the shape rulesync writes (a `prompt` policy next to `ask` patterns).
 * Any other `*` allow pattern still prompts for compound lines and imports as
 * `ask`, so a regenerate cannot widen it into an `allow` policy. A `prompt`
 * policy with no `*` pattern but an `ask` pattern is what rulesync writes for
 * ask rules (see `convertBashRules`), so it adds no catch-all.
 */
function importBashPolicy(
  bashRules: Record<string, PermissionAction>,
  action: PermissionAction | undefined,
): void {
  const catchAll = bashRules[CATCH_ALL_PATTERN];
  const hasAskPattern = Object.values(bashRules).includes("ask");
  if (action === "deny") {
    bashRules[CATCH_ALL_PATTERN] = "deny";
  } else if (catchAll === undefined) {
    if (action !== undefined && !(action === "ask" && hasAskPattern)) {
      bashRules[CATCH_ALL_PATTERN] = action;
    }
  } else if (catchAll === "allow" && action !== "allow" && !(action === "ask" && hasAskPattern)) {
    bashRules[CATCH_ALL_PATTERN] = "ask";
  }
}

/**
 * The folders a `bash.patterns` entry is scoped to, read the way oh-my-pi's
 * `pathScopePrefixes` reads them: every string under a path key. Empty for an
 * unscoped entry.
 */
function pathScopePrefixes(entry: Record<string, unknown>): string[] {
  return PATH_SCOPE_KEYS.flatMap((key) => {
    const value = entry[key];
    if (typeof value === "string") {
      return [value];
    }
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  });
}

function describeScope(entry: Record<string, unknown>): string {
  return pathScopePrefixes(entry)
    .map((prefix) => JSON.stringify(prefix))
    .join(", ");
}

function isPathScopedEntry(entry: Record<string, unknown>): boolean {
  return pathScopePrefixes(entry).length > 0;
}

/**
 * Every rule a path-scoped entry contributes inside its scope: its own
 * `match` / `approval`, then the rules nested under `patterns` / `values` /
 * `items` (recursively; a nested scope only narrows the outer one).
 */
function scopedEntryRules(entry: Record<string, unknown>): Record<string, unknown>[] {
  const rules: Record<string, unknown>[] = [entry];
  for (const key of SCOPED_RULE_LIST_KEYS) {
    const nested = entry[key];
    if (Array.isArray(nested)) {
      for (const item of nested) {
        if (isRecord(item)) {
          rules.push(...scopedEntryRules(item));
        }
      }
    }
  }
  return rules;
}

/** A rule's `match` with whitespace runs collapsed, as oh-my-pi matches it. */
function normalizedMatch(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const match = value.trim().replace(/\s+/gu, " ");
  return match === "" ? undefined : match;
}

/**
 * The generated `bash.patterns` merged with the path-scoped entries of the
 * existing list, which rulesync does not own and keeps verbatim.
 *
 * First match wins, so where a kept entry goes decides what it can override.
 * Each one is placed by the most permissive approval among its rules: one
 * holding only deny rules leads the list; one whose loosest rule prompts goes
 * after rulesync's deny rules; one with an allow rule goes after rulesync's
 * prompt rules, ahead of its allow rules. So no folder-scoped rule can turn a
 * rulesync deny or prompt into something looser, while a scoped restriction
 * still beats a rulesync allow. An entry is kept whole rather than split, so
 * the deny rules of an entry that also allows land after rulesync's prompt
 * rules (a matching rulesync prompt then prompts inside the scope), and an
 * entry placed after a rulesync catch-all `*` restriction is never reached;
 * both are reported with a warning.
 *
 * A generated unscoped rule also keeps the `env` list (oh-my-pi's per-rule
 * env-var allowlist) of the first existing unscoped entry with the same
 * `match`, when that entry has the same approval.
 */
function mergeBashPatterns({
  generated,
  existing,
  logger,
}: {
  generated: OmpBashPattern[];
  existing: unknown;
  logger?: Logger;
}): unknown[] {
  const existingEntries = Array.isArray(existing) ? existing : [];

  const existingEnv = new Map<string, { approval: OmpApproval | undefined; env: unknown }>();
  for (const entry of existingEntries) {
    if (!isRecord(entry) || isPathScopedEntry(entry)) {
      continue;
    }
    const match = normalizedMatch(entry.match);
    if (match !== undefined && !existingEnv.has(match)) {
      existingEnv.set(match, { approval: toOmpApproval(entry.approval), env: entry.env });
    }
  }
  const withEnv = generated.map((pattern) => {
    const previous = existingEnv.get(normalizedMatch(pattern.match) ?? "");
    return previous !== undefined &&
      previous.approval === pattern.approval &&
      previous.env !== undefined
      ? { ...pattern, env: previous.env }
      : pattern;
  });

  const kept: Record<OmpApproval, unknown[]> = { deny: [], prompt: [], allow: [] };
  for (const entry of existingEntries) {
    if (!isRecord(entry) || !isPathScopedEntry(entry)) {
      continue;
    }
    const approvals = new Set(scopedEntryRules(entry).map((rule) => toOmpApproval(rule.approval)));
    const loosest: OmpApproval = approvals.has("allow")
      ? "allow"
      : approvals.has("prompt")
        ? "prompt"
        : "deny";
    if (loosest === "allow" && approvals.has("deny")) {
      logger?.warn(
        `The oh-my-pi bash.patterns entry scoped to ${describeScope(entry)} mixes allow and ` +
          "deny rules, so it was kept after rulesync's prompt patterns: inside that scope a " +
          "command matching both one of its deny rules and a rulesync prompt pattern prompts " +
          "instead of being denied.",
      );
    }
    kept[loosest].push(entry);
  }

  const byApproval = (approval: OmpApproval): OmpBashPattern[] =>
    withEnv.filter((pattern) => pattern.approval === approval);
  warnShadowedScopedEntries({ generated: withEnv, kept, logger });
  return [
    ...kept.deny,
    ...byApproval("deny"),
    ...kept.prompt,
    ...byApproval("prompt"),
    ...kept.allow,
    ...byApproval("allow"),
  ];
}

/**
 * Warn about kept scoped entries placed after a generated catch-all `*`
 * restriction: it matches every command, so nothing after it is consulted.
 */
function warnShadowedScopedEntries({
  generated,
  kept,
  logger,
}: {
  generated: OmpBashPattern[];
  kept: Record<OmpApproval, unknown[]>;
  logger?: Logger;
}): void {
  const catchAll = generated.find(
    (pattern) => pattern.match === CATCH_ALL_PATTERN && pattern.approval !== "allow",
  );
  if (catchAll === undefined) {
    return;
  }
  const shadowed = catchAll.approval === "deny" ? [...kept.prompt, ...kept.allow] : kept.allow;
  for (const entry of shadowed) {
    if (isRecord(entry)) {
      logger?.warn(
        `The oh-my-pi bash.patterns entry scoped to ${describeScope(entry)} was kept after the ` +
          `bash catch-all "*" ${catchAll.approval} pattern, so oh-my-pi never reaches it.`,
      );
    }
  }
}

/**
 * `bash.patterns` as canonical `bash` rules, in first-match order.
 *
 * A path-scoped entry has no canonical form. Its deny and prompt rules are
 * imported as global rules — stricter than the scope, but a restriction is
 * never lost — and its allow rules are skipped, since a global allow would
 * approve the command everywhere. Both are reported with a warning.
 */
function importBashPatterns(value: unknown, logger?: Logger): Record<string, PermissionAction> {
  const bashRules: Record<string, PermissionAction> = {};
  if (!Array.isArray(value)) {
    return bashRules;
  }
  // Patterns whose rule so far came only from a scoped entry. Such a rule
  // holds no first-match slot outside its scope, so a later rule for the same
  // pattern still counts there, and the stricter of the two is kept.
  const fromScope = new Set<string>();
  const addRule = (rawMatch: unknown, rawApproval: unknown, scoped: boolean): boolean => {
    // oh-my-pi collapses whitespace runs before matching, so `git  status`
    // and `git status` are one pattern.
    const match = normalizedMatch(rawMatch);
    const approval = toOmpApproval(rawApproval);
    if (match === undefined || approval === undefined || isPrototypePollutionKey(match)) {
      return false;
    }
    const action = OMP_APPROVAL_TO_ACTION[approval];
    if (!Object.hasOwn(bashRules, match)) {
      bashRules[match] = action;
      if (scoped) {
        fromScope.add(match);
      }
      return true;
    }
    // First match wins, so a later duplicate of an unscoped pattern is never
    // consulted.
    if (!fromScope.has(match)) {
      return false;
    }
    if (!scoped) {
      fromScope.delete(match);
    }
    const previous = bashRules[match];
    bashRules[match] = stricter(previous, action);
    return bashRules[match] !== previous;
  };
  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }
    if (isPathScopedEntry(entry)) {
      importScopedBashEntry({
        entry,
        addRule: (match, approval) => addRule(match, approval, true),
        logger,
      });
      continue;
    }
    addRule(entry.match, entry.approval, false);
  }
  return bashRules;
}

function importScopedBashEntry({
  entry,
  addRule,
  logger,
}: {
  entry: Record<string, unknown>;
  addRule: (match: string, approval: OmpApproval) => boolean;
  logger?: Logger;
}): void {
  const scope = describeScope(entry);
  const restrictions: string[] = [];
  const skippedAllows: string[] = [];
  for (const rule of scopedEntryRules(entry)) {
    const match = normalizedMatch(rule.match);
    const approval = toOmpApproval(rule.approval);
    if (match === undefined || approval === undefined) {
      continue;
    }
    if (approval === "allow") {
      skippedAllows.push(match);
      continue;
    }
    // Only a rule that changed the imported rules is reported.
    if (addRule(match, approval)) {
      restrictions.push(match);
    }
  }
  if (restrictions.length > 0) {
    logger?.warn(
      `oh-my-pi bash.patterns rules scoped to ${scope} have no rulesync equivalent, so their ` +
        `deny/prompt patterns (${restrictions.map((m) => JSON.stringify(m)).join(", ")}) were ` +
        "imported as global bash rules.",
    );
  }
  if (skippedAllows.length > 0) {
    logger?.warn(
      `oh-my-pi bash.patterns rules scoped to ${scope} have no rulesync equivalent, so their ` +
        `allow patterns (${skippedAllows.map((m) => JSON.stringify(m)).join(", ")}) were skipped ` +
        "rather than allowed everywhere.",
    );
  }
}

function convertOmpToRulesync(config: Record<string, unknown>, logger?: Logger): PermissionsConfig {
  const permission: Record<string, Record<string, PermissionAction>> = {};
  const tools = toRecord(config.tools);
  const bash = toRecord(config.bash);

  const bashRules = importBashPatterns(bash.patterns, logger);
  const approvals = toRecord(tools.approval);
  const bashApproval = toOmpApproval(approvals.bash);
  importBashPolicy(
    bashRules,
    bashApproval === undefined ? undefined : OMP_APPROVAL_TO_ACTION[bashApproval],
  );

  if (isRecord(tools.approval)) {
    for (const [tool, value] of Object.entries(tools.approval)) {
      const approval = toOmpApproval(value);
      if (approval === undefined || tool.trim() === "" || isPrototypePollutionKey(tool)) {
        continue;
      }
      const action = OMP_APPROVAL_TO_ACTION[approval];
      if (tool === SHELL_PERMISSION_CATEGORY) {
        continue;
      }
      // A verbatim `agent` key and `task` import to one category; the stricter wins.
      const category = lookupOwn({ record: OMP_TOOL_TO_CATEGORY, key: tool }) ?? tool;
      permission[category] = {
        [CATCH_ALL_PATTERN]: stricter(permission[category]?.[CATCH_ALL_PATTERN], action),
      };
    }
  }

  if (Object.keys(bashRules).length > 0) {
    permission.bash = bashRules;
  }

  const approvalMode = tools[APPROVAL_MODE_KEY];
  const restrictedFolders = importRestrictedFolders(tools[RESTRICTED_FOLDERS_KEY]);
  const omp: OmpPermissionsOverride = {
    // oh-my-pi matches the mode exactly and falls back to `yolo` otherwise, so
    // only a value it honors is carried into the override.
    ...(isOmpApprovalMode(approvalMode) && { approvalMode }),
    ...(restrictedFolders !== undefined && { restrictedFolders }),
  };
  return {
    permission,
    ...(Object.keys(omp).length > 0 && { omp }),
  };
}

/**
 * `tools.restrictedFolders` as the override list: its string entries, or
 * `undefined` when it is unset or no entry survives (so a list of non-strings
 * is not imported as `[]` and then rewritten as an empty list).
 */
function importRestrictedFolders(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const folders = value.filter((entry): entry is string => typeof entry === "string");
  return folders.length === 0 && value.length > 0 ? undefined : folders;
}

function isOmpApprovalMode(value: unknown): value is OmpApprovalMode {
  return OMP_APPROVAL_MODES.some((mode) => mode === value);
}
