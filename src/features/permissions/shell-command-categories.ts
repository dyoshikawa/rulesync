import { uniq } from "es-toolkit";

import type { PermissionAction, PermissionsConfig } from "../../types/permissions.js";
import {
  createIntersectionBudget,
  type IntersectionBudget,
  parseGlobPattern,
  parsedGlobsIntersect,
} from "../../utils/glob.js";
import { type Logger, warnWithFallback } from "../../utils/logger.js";

/** The canonical category that names a shell command's permissions. */
export const SHELL_PERMISSION_CATEGORY = "bash";

/**
 * The canonical all-tools category. A rule written under it applies to every
 * tool, shell commands included, so an adapter that models only shell commands
 * still has to read it — see `collectShellCommandRules`.
 */
export const ALL_TOOLS_PERMISSION_CATEGORY = "*";

/** One canonical rule that governs shell commands, and where it was written. */
export type ShellCommandRule = {
  pattern: string;
  action: PermissionAction;
  /**
   * Whether the rule comes from the all-tools `*` category rather than from
   * `bash`. A tool whose command list cannot carry such a pattern needs to tell
   * the two apart — see `partitionCommandRules`.
   */
  fromAllToolsCategory: boolean;
};

export type ShellCommandRules = {
  /** The rules that govern shell commands, in the order the source file wrote them. */
  rules: ShellCommandRule[];
  /**
   * Categories that are neither `bash` nor `*` and carry a `deny` **or** an
   * `ask`, for the warning an adapter emits about a restriction it cannot
   * express at all — a foreign `ask` restricts as surely as a foreign `deny`.
   */
  foreignRestrictingCategories: string[];
  /**
   * All-tools `allow` patterns deliberately left out of `rules`, so an adapter
   * can report what it dropped rather than dropping it in silence.
   */
  ignoredAllToolsAllowPatterns: string[];
};

/**
 * Collect the canonical rules that govern shell commands, for the adapters
 * whose tool models commands and nothing else.
 *
 * The `bash` category contributes every rule. The all-tools `*` category
 * contributes its **restricting** rules — `deny` and `ask` — because a rule
 * written there covers shell commands too, and dropping it inverts the
 * author's intent: with `{"*": {"rm *": "deny"}, "bash": {"rm *": "allow"}}`,
 * an adapter that reads only `bash` auto-approves the very command the file
 * denies.
 *
 * Its `allow` rules are deliberately **not** contributed. A pattern under `*`
 * need not be a command at all — `secrets/**` under `*` denies a path — and
 * carrying it in the restricting direction only over-restricts, while carrying
 * it in the permissive direction would grant something the author never said
 * about commands. Both directions therefore fail closed.
 */
export function collectShellCommandRules(
  permission: PermissionsConfig["permission"],
): ShellCommandRules {
  const rules: ShellCommandRule[] = [];
  const foreignRestrictingCategories: string[] = [];
  const ignoredAllToolsAllowPatterns: string[] = [];

  for (const [category, categoryRules] of Object.entries(permission)) {
    if (category === SHELL_PERMISSION_CATEGORY) {
      for (const [pattern, action] of Object.entries(categoryRules)) {
        rules.push({ pattern, action, fromAllToolsCategory: false });
      }
      continue;
    }
    if (category === ALL_TOOLS_PERMISSION_CATEGORY) {
      for (const [pattern, action] of Object.entries(categoryRules)) {
        if (action === "allow") {
          ignoredAllToolsAllowPatterns.push(pattern);
          continue;
        }
        rules.push({ pattern, action, fromAllToolsCategory: true });
      }
      continue;
    }
    const actions = Object.values(categoryRules);
    if (actions.some((action) => action === "deny" || action === "ask")) {
      foreignRestrictingCategories.push(category);
    }
  }

  return {
    rules,
    foreignRestrictingCategories,
    ignoredAllToolsAllowPatterns,
  };
}

/**
 * Build the test an adapter applies to an `allow` pattern before writing it:
 * which restrictions it cannot write name some of the same commands? The
 * answer is the list of those restrictions — empty when the `allow` may be
 * written — so a caller can report both the allow rules it withheld and the
 * restrictions that withheld nothing.
 *
 * Canonically the stricter rule wins **whatever its width** — rulesync collapses
 * colliding rules as `deny > ask > allow` — so the two patterns are compared by
 * asking whether any one command matches both. Width does not enter into it: an
 * `ask` on `*` overlaps an allowed `git *`, an `ask` on `npm publish` overlaps
 * an allowed `npm *`, and an `ask` on `* --force` overlaps an allowed `git *`
 * on every `git ... --force` command even though neither pattern covers the
 * other's spelling. Comparing only identical spellings would let the most
 * ordinary catch-all (`{"*": {"*": "ask"}}`) disappear without a word.
 *
 * Identical spellings are still compared as strings first, as a shortcut past
 * the walk for the commonest case.
 *
 * `normalizePattern` rewrites a pattern written in the tool's own language into
 * the widest glob it could stand for, for a tool whose patterns are not globs.
 * It reaches the `bash` rules and the `allow` rules, which is where such a
 * pattern is written; an all-tools `*` pattern is canonical — it is read by
 * every tool, so it is a glob already — and is compared as it stands. The
 * rewrite must only ever widen what a pattern covers, so an inexact reading
 * withholds an allow rather than writing one the config restricts — see
 * `warpCommandPatternToGlob`.
 */
export function createShadowingRestrictionsTest(
  restrictions: readonly Pick<ShellCommandRule, "pattern" | "fromAllToolsCategory">[],
  {
    normalizePattern = (pattern: string) => pattern,
    budget = createIntersectionBudget(),
  }: { normalizePattern?: (pattern: string) => string; budget?: IntersectionBudget } = {},
): (allowPattern: string) => string[] {
  // Each restriction is parsed once for the whole run rather than once per
  // allow rule it is compared against, and the walks share one budget: the
  // caller asks this as many times as it holds allow rules, so a cap on a
  // single pair would bound none of the run. Pass a budget in to see whether it
  // ran out; leave it out for a run of its own.
  const normalized = restrictions.map(({ pattern, fromAllToolsCategory }) => ({
    pattern,
    glob: parseGlobPattern(fromAllToolsCategory ? pattern : normalizePattern(pattern)),
  }));

  return (allowPattern) => {
    if (budget.remaining === 0) {
      // Out of budget every comparison answers "intersects", so the whole list
      // withholds this allow. Saying so without walking it once per restriction
      // matters: asking anyway is the restriction-times-allow enumeration the
      // budget exists to stop, and it costs the same whether or not each pair
      // is walked.
      return normalized.map(({ pattern }) => pattern);
    }
    const allowGlob = parseGlobPattern(normalizePattern(allowPattern));
    return normalized
      .filter(
        ({ pattern, glob }) =>
          pattern === allowPattern || parsedGlobsIntersect(glob, allowGlob, budget),
      )
      .map(({ pattern }) => pattern);
  };
}

/** The allow/deny lists a command-only tool writes, and what was withheld. */
export type CommandListPartition = {
  /** Patterns to auto-approve. */
  allow: string[];
  /** Patterns to block. */
  deny: string[];
  /**
   * Patterns whose `allow` was withheld because a restriction the tool cannot
   * write covers the same commands — see `createShadowingRestrictionsTest`.
   */
  shadowedAllowPatterns: string[];
  /** All-tools `deny` patterns left out of the denylist, when `writesAllToolsDeny` is false. */
  unwrittenDenyPatterns: string[];
  /**
   * All-tools `deny` patterns that were written into the denylist and withheld
   * none of the `allow` rules beside them, so nothing observed says they name a
   * command the tool can act on — see `warnAboutUnwrittenCommandRules`.
   */
  unenforcedAllToolsDenyPatterns: string[];
  /**
   * All-tools `ask` patterns that withheld none of the `allow` rules beside
   * them and are not written under `bash` either, so nothing observed says they
   * name a command — see `warnAboutUnwrittenCommandRules`.
   */
  unenforcedAllToolsAskPatterns: string[];
  /**
   * Whether the run ran out of comparison budget, so every allow rule left was
   * withheld without being compared — see `createIntersectionBudget`.
   */
  intersectionBudgetExhausted: boolean;
};

/**
 * Which of the given all-tools `*` restrictions look like they may not name a
 * command at all — the question a `deny` and an `ask` written there both raise.
 *
 * "Withheld no allow rule" alone does not answer it: a config with no `allow`
 * rules has nothing to withhold, and a pattern the author also wrote under
 * `bash` is a command on their own word. Both are excluded, so what remains is
 * a `*` pattern that had allow rules to overlap, overlapped none of them, and
 * is claimed as a command nowhere else — the shape `secrets/**` has.
 *
 * A `bash` restriction never belongs here: it names a command by construction,
 * so overlapping no allow rule says nothing is wrong with it.
 */
export function collectUnenforcedAllToolsPatterns({
  rules,
  allToolsPatterns,
  withholdingPatterns,
}: {
  rules: readonly ShellCommandRule[];
  allToolsPatterns: readonly string[];
  withholdingPatterns: ReadonlySet<string>;
}): string[] {
  if (!rules.some(({ action }) => action === "allow")) {
    return [];
  }
  const shellPatterns = new Set(
    rules.filter(({ fromAllToolsCategory }) => !fromAllToolsCategory).map(({ pattern }) => pattern),
  );
  return uniq(allToolsPatterns).filter(
    (pattern) => !withholdingPatterns.has(pattern) && !shellPatterns.has(pattern),
  );
}

/**
 * Split shell-command rules into the allow and deny lists of a tool that models
 * commands with those two tiers and nothing else.
 *
 * `ask` has no list of its own — such a tool already prompts for whatever it
 * does not auto-approve, so an `ask` rule is satisfied by writing nothing. It
 * still has to *withhold* the `allow` rules it covers, though: the canonical
 * order is `deny > ask > allow`, so auto-approving a command the file also asks
 * about would answer the prompt the author wanted.
 *
 * `writesAllToolsDeny` says whether the tool's denylist can carry a pattern
 * from the all-tools `*` category. Warp's cannot: it matches commands with
 * regular expressions rather than globs, and writing any denylist **replaces**
 * Warp's built-in default one, so an inert `secrets/**` entry there would trade
 * the tool's own protection for a rule that matches no command. Where the deny
 * cannot be written it withholds the allow rules it covers instead, which
 * restricts in the same direction without touching the denylist.
 *
 * A `bash` deny withholds nothing: it names a command by construction, so the
 * denylist entry enforces it wherever the tool's deny-beats-allow order applies,
 * and a narrow deny keeps carving an exception out of a wider allow (`git *`
 * allowed, `git push *` denied). An all-tools `*` deny withholds all the same,
 * even where it is written: a pattern under `*` need not name a command —
 * `secrets/**` there denies a path — so as a denylist entry it may match nothing
 * at all, and leaving an overlapping allow beside it would auto-approve the very
 * commands the author meant to stop. Over-restricting a `*` deny that *was* a
 * command pattern is reported; failing open would not be.
 *
 * `normalizePattern` is handed to `createShadowingRestrictionsTest` for a tool whose
 * patterns are not globs.
 */
export function partitionCommandRules({
  rules,
  writesAllToolsDeny,
  normalizePattern,
}: {
  rules: readonly ShellCommandRule[];
  writesAllToolsDeny: boolean;
  normalizePattern?: (pattern: string) => string;
}): CommandListPartition {
  const deny: string[] = [];
  const unwrittenDenyPatterns: string[] = [];
  const restrictions: ShellCommandRule[] = [];
  const writtenAllToolsDenyPatterns: string[] = [];
  const allToolsAskPatterns: string[] = [];

  for (const rule of rules) {
    const { pattern, action, fromAllToolsCategory } = rule;
    if (action === "allow") {
      continue;
    }
    if (action !== "deny") {
      // An `ask` has no list of its own anywhere, so it can only be honored by
      // withholding the allow rules it covers. A `bash` ask that withholds
      // nothing is still honored — these tools prompt for whatever their
      // allowlist does not cover — but one written under `*` may simply name no
      // command, which is worth saying.
      restrictions.push(rule);
      if (fromAllToolsCategory) {
        allToolsAskPatterns.push(pattern);
      }
      continue;
    }
    if (writesAllToolsDeny || !fromAllToolsCategory) {
      // Written into the denylist, where the tool's own deny-beats-allow
      // precedence enforces it against the very commands it names.
      deny.push(pattern);
      if (fromAllToolsCategory) {
        writtenAllToolsDenyPatterns.push(pattern);
      }
    } else {
      unwrittenDenyPatterns.push(pattern);
    }
    if (fromAllToolsCategory) {
      // A pattern under `*` need not name a command, so the denylist entry may
      // enforce nothing; it withholds the allow rules it covers as well.
      restrictions.push(rule);
    }
    // A `bash` pattern is a command, so that denylist entry is the whole
    // enforcement — the allow rules beside it stay.
  }

  const budget = createIntersectionBudget();
  const shadowingRestrictions = createShadowingRestrictionsTest(restrictions, {
    normalizePattern,
    budget,
  });
  const allow: string[] = [];
  const shadowedAllowPatterns: string[] = [];
  const withholdingPatterns = new Set<string>();
  for (const { pattern, action } of rules) {
    if (action !== "allow") {
      continue;
    }
    const shadowing = shadowingRestrictions(pattern);
    if (shadowing.length > 0) {
      shadowedAllowPatterns.push(pattern);
      for (const restriction of shadowing) {
        withholdingPatterns.add(restriction);
      }
      continue;
    }
    allow.push(pattern);
  }

  return {
    allow,
    deny,
    shadowedAllowPatterns,
    unwrittenDenyPatterns,
    unenforcedAllToolsDenyPatterns: collectUnenforcedAllToolsPatterns({
      rules,
      allToolsPatterns: writtenAllToolsDenyPatterns,
      withholdingPatterns,
    }),
    unenforcedAllToolsAskPatterns: collectUnenforcedAllToolsPatterns({
      rules,
      allToolsPatterns: allToolsAskPatterns,
      withholdingPatterns,
    }),
    intersectionBudgetExhausted: budget.remaining === 0,
  };
}

/**
 * Report, for one command-only tool, every canonical rule its two lists could
 * not carry. Every command-only adapter shares this reporting, so a rule
 * dropped in one is worded the same way in all.
 */
export function warnAboutUnwrittenCommandRules({
  toolLabel,
  surfaceLabel,
  foreignRestrictingCategories,
  shadowedAllowPatterns,
  unwrittenDenyPatterns = [],
  unwrittenDenyReason,
  unenforcedAllToolsDenyPatterns = [],
  unenforcedAllToolsAskPatterns = [],
  ignoredAllToolsAllowPatterns = [],
  intersectionBudgetExhausted = false,
  logger,
}: {
  /** The tool's display name, e.g. `Warp`. */
  toolLabel: string;
  /** The keys the tool reads, e.g. `commandAllowlist/commandDenylist`. */
  surfaceLabel: string;
  /**
   * Categories the tool cannot express that carry a `deny` **or** an `ask`. Both
   * restrict, so both are reported — naming only the denies would leave a
   * foreign `ask` dropped in silence.
   */
  foreignRestrictingCategories: readonly string[];
  shadowedAllowPatterns: readonly string[];
  unwrittenDenyPatterns?: readonly string[];
  /**
   * Why this tool's denylist cannot carry an all-tools pattern, as a sentence
   * fragment. Required once `unwrittenDenyPatterns` is non-empty, since the
   * reason is the tool's, not this module's.
   */
  unwrittenDenyReason?: string;
  unenforcedAllToolsDenyPatterns?: readonly string[];
  unenforcedAllToolsAskPatterns?: readonly string[];
  ignoredAllToolsAllowPatterns?: readonly string[];
  intersectionBudgetExhausted?: boolean;
  logger?: Logger;
}): void {
  if (intersectionBudgetExhausted) {
    warnWithFallback(
      logger,
      `${toolLabel} reached the limit on how much work one generation may spend comparing ` +
        `.rulesync/permissions.jsonc's allow rules against its deny and ask rules, so the ` +
        `allow rules left over were withheld rather than compared — the safe answer, but a ` +
        `wider one than the file asks for. Write fewer or shorter command patterns to have ` +
        `them all compared.`,
    );
  }
  for (const category of foreignRestrictingCategories) {
    warnWithFallback(
      logger,
      `${toolLabel} only models shell-command permissions (${surfaceLabel}); ` +
        `'${category}' deny and ask rules cannot be represented and were skipped.`,
    );
  }
  if (unwrittenDenyPatterns.length > 0) {
    warnWithFallback(
      logger,
      `${toolLabel} did not write the all-tools '*' deny rule(s) for ` +
        `${unwrittenDenyPatterns.join(", ")} into its denylist.${
          unwrittenDenyReason === undefined ? "" : ` ${unwrittenDenyReason}`
        } They restrict only by withholding the allow rules they cover; write them under ` +
        `'bash' to have them enforced as commands.`,
    );
  }
  if (unenforcedAllToolsDenyPatterns.length > 0) {
    warnWithFallback(
      logger,
      `${toolLabel} wrote the all-tools '*' deny rule(s) for ` +
        `${unenforcedAllToolsDenyPatterns.join(", ")} into its denylist as they stand, but they ` +
        `withheld none of the allow rules beside them. A pattern written under '*' need not ` +
        `name a command — 'secrets/**' there denies a path — and a denylist entry that names ` +
        `none blocks nothing; write it under 'bash' too if it is a command pattern.`,
    );
  }
  if (unenforcedAllToolsAskPatterns.length > 0) {
    warnWithFallback(
      logger,
      `${toolLabel} has no ask tier (${surfaceLabel}), so the all-tools '*' ask rule(s) for ` +
        `${unenforcedAllToolsAskPatterns.join(", ")} restrict only by withholding the allow ` +
        `rules they cover — and they covered none. A pattern written under '*' need not name ` +
        `a command, so nothing observed says these ones do; write them under 'bash' if they ` +
        `are command patterns.`,
    );
  }
  if (ignoredAllToolsAllowPatterns.length > 0) {
    warnWithFallback(
      logger,
      `${toolLabel} reads the all-tools '*' category for its deny and ask rules only, so the ` +
        `allow rule(s) for ${ignoredAllToolsAllowPatterns.join(", ")} were skipped — a pattern ` +
        `written under '*' need not be a command. Write them under 'bash' to auto-approve ` +
        `them as commands.`,
    );
  }
  if (shadowedAllowPatterns.length > 0) {
    warnWithFallback(
      logger,
      `${toolLabel} was not given the allow rule(s) for ${shadowedAllowPatterns.join(", ")} ` +
        `because .rulesync/permissions.jsonc restricts the same commands elsewhere, and the ` +
        `stricter rule wins whatever its width.`,
    );
  }
}

/** The `bash` map plus allow/deny lists after all-tools `*` restrictions apply. */
export type ResolvedShellCommandLists = {
  allow: string[];
  deny: string[];
  /**
   * The `bash` category an adapter should write: bash `ask` rules kept, shadowed
   * allows dropped, and — when `writesAllToolsDeny` — all-tools `*` denies copied
   * in so a command list can enforce them.
   */
  bash: Record<string, PermissionAction>;
};

function resolveShellCommandState(
  permission: PermissionsConfig["permission"],
  writesAllToolsDeny: boolean,
): ResolvedShellCommandLists & {
  foreignRestrictingCategories: string[];
  ignoredAllToolsAllowPatterns: string[];
  shadowedAllowPatterns: string[];
  unwrittenDenyPatterns: string[];
  unenforcedAllToolsDenyPatterns: string[];
  unenforcedAllToolsAskPatterns: string[];
  intersectionBudgetExhausted: boolean;
} {
  const { rules, foreignRestrictingCategories, ignoredAllToolsAllowPatterns } =
    collectShellCommandRules(permission);
  const partitioned = partitionCommandRules({ rules, writesAllToolsDeny });
  return {
    allow: partitioned.allow,
    deny: partitioned.deny,
    bash: bashRulesHonoringAllTools(permission),
    foreignRestrictingCategories,
    ignoredAllToolsAllowPatterns,
    shadowedAllowPatterns: partitioned.shadowedAllowPatterns,
    unwrittenDenyPatterns: partitioned.unwrittenDenyPatterns,
    unenforcedAllToolsDenyPatterns: partitioned.unenforcedAllToolsDenyPatterns,
    unenforcedAllToolsAskPatterns: partitioned.unenforcedAllToolsAskPatterns,
    intersectionBudgetExhausted: partitioned.intersectionBudgetExhausted,
  };
}

/**
 * Collect shell-command allow/deny lists the way the command-only adapters do,
 * and report every restriction the surface cannot carry.
 */
export function resolveShellCommandLists({
  permission,
  writesAllToolsDeny,
  toolLabel,
  surfaceLabel,
  logger,
}: {
  permission: PermissionsConfig["permission"];
  writesAllToolsDeny: boolean;
  toolLabel: string;
  surfaceLabel: string;
  logger?: Logger;
}): ResolvedShellCommandLists {
  const resolved = resolveShellCommandState(permission, writesAllToolsDeny);
  warnAboutUnwrittenCommandRules({
    toolLabel,
    surfaceLabel,
    foreignRestrictingCategories: resolved.foreignRestrictingCategories,
    shadowedAllowPatterns: resolved.shadowedAllowPatterns,
    unwrittenDenyPatterns: resolved.unwrittenDenyPatterns,
    unenforcedAllToolsDenyPatterns: resolved.unenforcedAllToolsDenyPatterns,
    unenforcedAllToolsAskPatterns: resolved.unenforcedAllToolsAskPatterns,
    ignoredAllToolsAllowPatterns: resolved.ignoredAllToolsAllowPatterns,
    intersectionBudgetExhausted: resolved.intersectionBudgetExhausted,
    logger,
  });
  return { allow: resolved.allow, deny: resolved.deny, bash: resolved.bash };
}

/**
 * The `bash` category after all-tools `*` restrictions have been applied. A
 * `deny`/`ask` written under `*` covers shell commands too, so a bash `allow`
 * it overlaps is withheld and a `*` deny is copied in. Bash `ask` rules stay:
 * adapters that have an ask tier write both, and command-only ones omit `ask`
 * themselves.
 */
export function bashRulesHonoringAllTools(
  permission: PermissionsConfig["permission"],
): Record<string, PermissionAction> {
  const { rules } = collectShellCommandRules(permission);
  const allToolsRestrictions = rules.filter(({ fromAllToolsCategory }) => fromAllToolsCategory);
  const shadowingRestrictions = createShadowingRestrictionsTest(allToolsRestrictions);
  const bash: Record<string, PermissionAction> = { ...permission.bash };
  for (const [pattern, action] of Object.entries(bash)) {
    if (action === "allow" && shadowingRestrictions(pattern).length > 0) {
      delete bash[pattern];
    }
  }
  for (const { pattern, action } of allToolsRestrictions) {
    if (action === "deny" && bash[pattern] !== "ask") {
      bash[pattern] = "deny";
    }
  }
  return bash;
}

/**
 * Return a permission block whose `bash` category honors all-tools `*`
 * restrictions. Other categories are unchanged, so adapters that already model
 * `*` keep doing so.
 */
export function honorAllToolsOnBash(
  permission: PermissionsConfig["permission"],
): PermissionsConfig["permission"] {
  // Do not invent a `bash` category. Adapters that already model `*` as a
  // tool-wide default (Zed, Rovo, OpenCode) would otherwise grow a redundant
  // bash deny that pollutes import.
  if (permission.bash === undefined) {
    return permission;
  }
  return { ...permission, bash: bashRulesHonoringAllTools(permission) };
}
