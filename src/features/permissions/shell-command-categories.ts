import type { PermissionAction, PermissionsConfig } from "../../types/permissions.js";
import { globsIntersect } from "../../utils/glob.js";
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
    if (Object.values(categoryRules).some((action) => action === "deny")) {
      foreignDenyCategories.push(category);
    }
  }

  return { rules, foreignDenyCategories, ignoredAllToolsAllowPatterns };
}

/**
 * Build the test an adapter applies to an `allow` pattern before writing it:
 * does any restriction it cannot write name some of the same commands?
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
export function createShadowedAllowTest(
  restrictions: readonly Pick<ShellCommandRule, "pattern" | "fromAllToolsCategory">[],
  {
    normalizePattern = (pattern: string) => pattern,
  }: { normalizePattern?: (pattern: string) => string } = {},
): (allowPattern: string) => boolean {
  const normalized = restrictions.map(({ pattern, fromAllToolsCategory }) => ({
    pattern,
    glob: fromAllToolsCategory ? pattern : normalizePattern(pattern),
  }));

  return (allowPattern) => {
    const allowGlob = normalizePattern(allowPattern);
    return normalized.some(
      ({ pattern, glob }) => pattern === allowPattern || globsIntersect(glob, allowGlob),
    );
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
   * write covers the same commands — see `createShadowedAllowTest`.
   */
  shadowedAllowPatterns: string[];
  /** All-tools `deny` patterns left out of the denylist, when `writesAllToolsDeny` is false. */
  unwrittenDenyPatterns: string[];
};

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
 * A deny that *is* written withholds nothing, whichever category wrote it: the
 * tool's denylist outranks its allowlist, so the commands the two rules share
 * are blocked where the author asked and the rest of the allow keeps working.
 * Withholding there would make the same intent behave differently depending on
 * the category it was written under — `{"*": {"git push *": "deny"}}` beside an
 * allowed `git *` would drop the allowlist that `{"bash": ...}` keeps.
 *
 * `normalizePattern` is handed to `createShadowedAllowTest` for a tool whose
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

  for (const rule of rules) {
    const { pattern, action, fromAllToolsCategory } = rule;
    if (action === "allow") {
      continue;
    }
    if (action === "deny") {
      if (writesAllToolsDeny || !fromAllToolsCategory) {
        // Written into the denylist, where the tool's own deny-beats-allow
        // precedence enforces it against the very commands it names.
        deny.push(pattern);
        continue;
      }
      unwrittenDenyPatterns.push(pattern);
    }
    restrictions.push(rule);
  }

  const isShadowed = createShadowedAllowTest(restrictions, { normalizePattern });
  const allow: string[] = [];
  const shadowedAllowPatterns: string[] = [];
  for (const { pattern, action } of rules) {
    if (action !== "allow") {
      continue;
    }
    if (isShadowed(pattern)) {
      shadowedAllowPatterns.push(pattern);
      continue;
    }
    allow.push(pattern);
  }

  return { allow, deny, shadowedAllowPatterns, unwrittenDenyPatterns };
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
