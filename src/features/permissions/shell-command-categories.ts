import { uniq } from "es-toolkit";

import type { PermissionAction, PermissionsConfig } from "../../types/permissions.js";
import {
  createIntersectionBudget,
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
   * Categories that are neither `bash` nor `*` and carry a `deny` rule, for the
   * warning an adapter emits about a restriction it cannot express at all.
   */
  foreignDenyCategories: string[];
  /**
   * Categories that are neither `bash` nor `*` and carry a `deny` **or** an
   * `ask`, for an adapter that has to know whether the config restricts
   * anything at all — a foreign `ask` restricts as surely as a foreign `deny`.
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
  const foreignDenyCategories: string[] = [];
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
    if (actions.some((action) => action === "deny")) {
      foreignDenyCategories.push(category);
    }
    if (actions.some((action) => action === "deny" || action === "ask")) {
      foreignRestrictingCategories.push(category);
    }
  }

  return {
    rules,
    foreignDenyCategories,
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
  }: { normalizePattern?: (pattern: string) => string } = {},
): (allowPattern: string) => string[] {
  // Each restriction is parsed once for the whole run rather than once per
  // allow rule it is compared against, and the walks share one budget: the
  // caller asks this as many times as it holds allow rules, so a cap on a
  // single pair would bound none of the run.
  const normalized = restrictions.map(({ pattern, fromAllToolsCategory }) => ({
    pattern,
    glob: parseGlobPattern(fromAllToolsCategory ? pattern : normalizePattern(pattern)),
  }));
  const budget = createIntersectionBudget();

  return (allowPattern) => {
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
   * `ask` patterns that withheld no `allow` rule. An `ask` has no list of its
   * own here, so withholding is the only trace it can leave: one that withheld
   * nothing left none at all — see `warnAboutUnwrittenCommandRules`.
   */
  unenforcedAskPatterns: string[];
};

/**
 * Which of the all-tools `*` deny patterns written into the denylist look like
 * they may not name a command at all.
 *
 * "Withheld no allow rule" alone does not say that: a config with no `allow`
 * rules has nothing to withhold, and a pattern the author also wrote under
 * `bash` is a command on their own word. Both are excluded, so what remains is
 * a `*` pattern that had allow rules to overlap, overlapped none of them, and
 * is claimed as a command nowhere else — the shape `secrets/**` has.
 */
export function collectUnenforcedAllToolsDenyPatterns({
  rules,
  writtenAllToolsDenyPatterns,
  withholdingPatterns,
}: {
  rules: readonly ShellCommandRule[];
  writtenAllToolsDenyPatterns: readonly string[];
  withholdingPatterns: ReadonlySet<string>;
}): string[] {
  if (!rules.some(({ action }) => action === "allow")) {
    return [];
  }
  const shellPatterns = new Set(
    rules.filter(({ fromAllToolsCategory }) => !fromAllToolsCategory).map(({ pattern }) => pattern),
  );
  return uniq(writtenAllToolsDenyPatterns).filter(
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
  const askPatterns: string[] = [];

  for (const rule of rules) {
    const { pattern, action, fromAllToolsCategory } = rule;
    if (action === "allow") {
      continue;
    }
    if (action !== "deny") {
      // An `ask` has no list of its own anywhere, so it can only be honored by
      // withholding the allow rules it covers.
      restrictions.push(rule);
      askPatterns.push(pattern);
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

  const shadowingRestrictions = createShadowingRestrictionsTest(restrictions, { normalizePattern });
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
    unenforcedAllToolsDenyPatterns: collectUnenforcedAllToolsDenyPatterns({
      rules,
      writtenAllToolsDenyPatterns,
      withholdingPatterns,
    }),
    // Withholding is all an `ask` can do here, so one that withheld nothing
    // left no trace of the author's rule at all.
    unenforcedAskPatterns: uniq(askPatterns).filter((pattern) => !withholdingPatterns.has(pattern)),
  };
}

/**
 * Report, for one command-only tool, every canonical rule its two lists could
 * not carry. The three adapters that share `partitionCommandRules` share this
 * reporting too, so a rule dropped in one is worded the same way in all.
 */
export function warnAboutUnwrittenCommandRules({
  toolLabel,
  surfaceLabel,
  foreignDenyCategories,
  shadowedAllowPatterns,
  unwrittenDenyPatterns = [],
  unwrittenDenyReason,
  unenforcedAllToolsDenyPatterns = [],
  unenforcedAskPatterns = [],
  ignoredAllToolsAllowPatterns = [],
  logger,
}: {
  /** The tool's display name, e.g. `Warp`. */
  toolLabel: string;
  /** The keys the tool reads, e.g. `commandAllowlist/commandDenylist`. */
  surfaceLabel: string;
  foreignDenyCategories: readonly string[];
  shadowedAllowPatterns: readonly string[];
  unwrittenDenyPatterns?: readonly string[];
  /**
   * Why this tool's denylist cannot carry an all-tools pattern, as a sentence
   * fragment. Required once `unwrittenDenyPatterns` is non-empty, since the
   * reason is the tool's, not this module's.
   */
  unwrittenDenyReason?: string;
  unenforcedAllToolsDenyPatterns?: readonly string[];
  unenforcedAskPatterns?: readonly string[];
  ignoredAllToolsAllowPatterns?: readonly string[];
  logger?: Logger;
}): void {
  for (const category of foreignDenyCategories) {
    warnWithFallback(
      logger,
      `${toolLabel} only models shell-command permissions (${surfaceLabel}); ` +
        `'${category}' deny rules cannot be represented and were skipped.`,
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
  if (unenforcedAskPatterns.length > 0) {
    warnWithFallback(
      logger,
      `${toolLabel} has no ask tier (${surfaceLabel}), so the ask rule(s) for ` +
        `${unenforcedAskPatterns.join(", ")} wrote nothing, and they withheld none of the allow ` +
        `rules beside them either. ${toolLabel} still prompts for whatever its allowlist does ` +
        `not cover; write them under 'bash' as deny rules to block them outright.`,
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
