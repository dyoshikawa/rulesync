import type { PermissionAction, PermissionsConfig } from "../../types/permissions.js";
import { compileGlob } from "../../utils/glob.js";
import type { Logger } from "../../utils/logger.js";

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

  return { rules, foreignDenyCategories };
}

/**
 * Build the test an adapter applies to an `allow` pattern before writing it:
 * does any restriction it cannot write cover the same commands?
 *
 * Canonically the stricter rule wins **whatever its width** — rulesync collapses
 * colliding rules as `deny > ask > allow` — so the two patterns are compared in
 * both directions: an `ask` on `*` covers an allowed `git *`, and an `ask` on
 * `npm publish` is covered by an allowed `npm *`. Comparing only identical
 * spellings would let the most ordinary catch-all (`{"*": {"*": "ask"}}`)
 * disappear without a word.
 */
export function createShadowedAllowTest(
  restrictingPatterns: readonly string[],
): (allowPattern: string) => boolean {
  const restrictions = restrictingPatterns.map((pattern) => ({
    pattern,
    covers: compileGlob(pattern),
  }));

  return (allowPattern) => {
    const allowCovers = compileGlob(allowPattern);
    return restrictions.some(({ pattern, covers }) => covers(allowPattern) || allowCovers(pattern));
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
 * restricts in the same direction without touching the denylist. A deny that
 * *is* written needs no such treatment, because the tool's own denylist already
 * outranks its allowlist.
 */
export function partitionCommandRules({
  rules,
  writesAllToolsDeny,
}: {
  rules: readonly ShellCommandRule[];
  writesAllToolsDeny: boolean;
}): CommandListPartition {
  const deny: string[] = [];
  const unwrittenDenyPatterns: string[] = [];
  const restrictingPatterns: string[] = [];

  for (const { pattern, action, fromAllToolsCategory } of rules) {
    if (action === "allow") {
      continue;
    }
    if (action === "deny" && (writesAllToolsDeny || !fromAllToolsCategory)) {
      deny.push(pattern);
      continue;
    }
    if (action === "deny") {
      unwrittenDenyPatterns.push(pattern);
    }
    restrictingPatterns.push(pattern);
  }

  const isShadowed = createShadowedAllowTest(restrictingPatterns);
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
  unwrittenDenyPatterns,
  logger,
}: {
  /** The tool's display name, e.g. `Warp`. */
  toolLabel: string;
  /** The keys the tool reads, e.g. `commandAllowlist/commandDenylist`. */
  surfaceLabel: string;
  foreignDenyCategories: readonly string[];
  shadowedAllowPatterns: readonly string[];
  unwrittenDenyPatterns: readonly string[];
  logger?: Logger;
}): void {
  for (const category of foreignDenyCategories) {
    logger?.warn(
      `${toolLabel} only models shell-command permissions (${surfaceLabel}); ` +
        `'${category}' deny rules cannot be represented and were skipped.`,
    );
  }
  if (unwrittenDenyPatterns.length > 0) {
    logger?.warn(
      `${toolLabel} matches commands with regular expressions, and writing any denylist ` +
        `replaces its built-in default one, so the all-tools '*' deny rule(s) for ` +
        `${unwrittenDenyPatterns.join(", ")} were not written there — a pattern from that ` +
        `category need not be a command at all. The allow rules they cover were withheld ` +
        `instead; write them under 'bash' as regexes to have them enforced as commands.`,
    );
  }
  if (shadowedAllowPatterns.length > 0) {
    logger?.warn(
      `${toolLabel} was not given the allow rule(s) for ${shadowedAllowPatterns.join(", ")} ` +
        `because .rulesync/permissions.jsonc restricts the same commands elsewhere, and the ` +
        `stricter rule wins whatever its width.`,
    );
  }
}
