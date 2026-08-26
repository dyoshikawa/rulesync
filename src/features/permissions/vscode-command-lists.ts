import type { PermissionAction } from "../../types/permissions.js";
import type { Logger } from "../../utils/logger.js";
import { warnWithFallback } from "../../utils/logger.js";

/**
 * Characters that make a pattern read as a matcher — a glob, a regex anchor, an
 * alternation — where the Roo Code / Zoo Code lineage sees only literal text.
 *
 * `findLongestPrefixMatch` lowercases both sides and compares with
 * `startsWith`, with exactly one special case: the entry `"*"` on its own,
 * which matches any command. Everything else is part of the prefix, `*` in the
 * middle or at the end included. `^`, `$`, `(`, `)` and `|` are in the class
 * for the same reason and cost no realistic false positives: the extension
 * splits a command chain on `|` and `&&` before matching, so none of them can
 * begin a real command prefix either.
 *
 * @see https://github.com/RooCodeInc/Roo-Code/blob/v3.54.0/src/core/auto-approval/commands.ts
 */
const MATCHER_METACHARACTERS = /[*?[\]{}^$()|]/;

/** A `/…/`-delimited pattern, i.e. one written as a regex literal. */
const REGEX_LITERAL = /^\/.*\/[a-z]*$/;

/**
 * Whether a pattern reads as a matcher but will be compared as a literal
 * prefix.
 *
 * The bare `"*"` is excluded because it is the one entry the extension does
 * interpret, so writing it is correct rather than a mistake.
 */
function looksLikeAnUnsupportedMatcher(pattern: string): boolean {
  return pattern !== "*" && (MATCHER_METACHARACTERS.test(pattern) || REGEX_LITERAL.test(pattern));
}

/**
 * The literal command prefix a matcher-shaped pattern still pins down: the
 * regex-literal delimiters and a leading `^` are peeled off, then everything
 * from the first remaining metacharacter on is dropped, since that is where the
 * pattern stops constraining the start of the command.
 *
 * Returns `undefined` when nothing is left — a pattern that opens with matcher
 * syntax (`"*.sh"`, `"(rm|mv) "`) constrains no prefix at all, and an empty
 * prefix is not a usable answer here: `"".startsWith` is true for every
 * command, so writing it would deny everything.
 */
function toPrefixHint(pattern: string): string | undefined {
  const unwrapped = REGEX_LITERAL.test(pattern)
    ? pattern.slice(1, pattern.lastIndexOf("/"))
    : pattern;
  const unanchored = unwrapped.startsWith("^") ? unwrapped.slice(1) : unwrapped;
  const index = unanchored.search(MATCHER_METACHARACTERS);
  const hint = index < 0 ? unanchored : unanchored.slice(0, index);
  return hint === "" ? undefined : hint;
}

function formatPatterns(patterns: string[]): string {
  const quoted = patterns.map((pattern) => JSON.stringify(pattern));
  return quoted.length === 1 ? `pattern ${quoted[0]}` : `patterns ${quoted.join(", ")}`;
}

function formatRewrites(rewrites: { from: string; to: string }[]): string {
  const arrows = rewrites.map(({ from, to }) => `${JSON.stringify(from)} → ${JSON.stringify(to)}`);
  return arrows.length === 1 ? `pattern ${arrows[0]}` : `patterns ${arrows.join(", ")}`;
}

/**
 * Split one canonical category's rules into the two command lists the Roo Code
 * and Zoo Code lineages read from `.vscode/settings.json`.
 *
 * Entries are matched as command **prefixes**, and a command matching both
 * lists is resolved by the longer match: auto-approval needs a strictly longer
 * allowed match, and a denied match that is longer or equal auto-denies. `ask`
 * is represented by listing the pattern in neither list, which leaves the
 * extension's own approval prompt in charge.
 *
 * The two lists are handled **asymmetrically when empty**, because their
 * contributed defaults are asymmetric. The extension reads the effective
 * configuration value, so an absent key resolves to whatever the wider scopes
 * supply:
 *
 * - `allowedCommands` is contributed as `["git log", "git diff", "git show"]`,
 *   so an empty allow list must be written as `[]`. Retracting the key would
 *   re-grant those three auto-approvals, leaving a canonical config of
 *   `{"git ": "deny"}` with `git log` still auto-approved; `[]` overrides them
 *   at workspace scope and short-circuits `isAutoApprovedSingleCommand` on
 *   `!allowedCommands?.length`. It is returned unconditionally for that reason.
 * - `deniedCommands` is contributed as `[]`, so nothing resurfaces when the key
 *   is absent — and VS Code resolves array settings by scope precedence rather
 *   than by merging, which means writing `[]` at workspace scope would *erase*
 *   a deny list the user hand-authored in their user-scope `settings.json` for
 *   every project rulesync manages. An empty deny list is therefore returned as
 *   `undefined` so the caller retracts the key and leaves the wider scope
 *   intact.
 *
 * (The lists the extension finally uses are still merged with its own
 * global-state entries, which live in VS Code extension storage rather than in
 * any committable file, so they are outside what rulesync can express.)
 *
 * Matcher-shaped patterns are handled asymmetrically too, and for the same
 * reason — which way the mismatch fails. The canonical `bash` category is
 * glob-shaped for most other targets (claudecode writes `Bash(rm -rf *)`), so
 * such patterns do reach this target in practice:
 *
 * - A **deny** written as a matcher fails **open**: `{"*": "allow", "rm -rf *":
 *   "deny"}` yields a denied entry that never matches `rm -rf /` — the literal
 *   text `rm -rf *` is not a prefix of it — while the bare `"*"` on the allow
 *   side still matches everything, so the command auto-approves with no prompt.
 *   Such a pattern is therefore rewritten to the literal prefix it pins down
 *   (`"rm -rf "`) and the rewrite is reported. Truncating a deny only ever
 *   widens what is denied, so the result stays on the safe side of the author's
 *   intent, and a warning that is merely advisory would leave the generated
 *   file genuinely fail-open once the log scrolls past.
 * - An **allow** written as a matcher fails **closed**: it approves fewer
 *   commands than it looks like it does, and the rest reach the approval
 *   prompt. Truncating it would widen what runs unattended, so it is passed
 *   through unchanged and only warned about.
 */
export function buildVscodeCommandLists({
  rules,
  toolLabel,
  logger,
}: {
  rules: Record<string, PermissionAction>;
  toolLabel: string;
  logger?: Logger | undefined;
}): { allowed: string[]; denied: string[] | undefined } {
  const allowed: string[] = [];
  const denied: string[] = [];
  const matcherAllows: string[] = [];
  const rewrittenDenies: { from: string; to: string }[] = [];
  const inexpressibleDenies: string[] = [];
  for (const [pattern, action] of Object.entries(rules)) {
    if (action === "allow") {
      allowed.push(pattern);
      if (looksLikeAnUnsupportedMatcher(pattern)) {
        matcherAllows.push(pattern);
      }
      continue;
    }
    if (action !== "deny") {
      continue;
    }
    if (!looksLikeAnUnsupportedMatcher(pattern)) {
      denied.push(pattern);
      continue;
    }
    const hint = toPrefixHint(pattern);
    if (hint === undefined) {
      // No literal prefix to fall back on, and an empty one would deny every
      // command. Keep the author's text so nothing is silently dropped, and say
      // plainly that it cannot match.
      denied.push(pattern);
      inexpressibleDenies.push(pattern);
      continue;
    }
    denied.push(hint);
    rewrittenDenies.push({ from: pattern, to: hint });
  }

  // Denies are reported first: they are the direction that widens what runs
  // unattended, while a matcher-shaped allow only narrows it.
  if (rewrittenDenies.length > 0) {
    warnWithFallback(
      logger,
      `${toolLabel}: deny ${formatRewrites(rewrittenDenies)} rewritten to the literal command ` +
        `prefix it pins down, because entries are compared as prefix text rather than as a glob ` +
        `or regex and the original would never have matched. The rewritten prefix denies at ` +
        `least everything the original named, so review it if that is wider than you intended.`,
    );
  }
  if (inexpressibleDenies.length > 0) {
    warnWithFallback(
      logger,
      `${toolLabel}: deny ${formatPatterns(inexpressibleDenies)} starts with glob or regex ` +
        `syntax, so it pins down no command prefix and is written unchanged — it will never ` +
        `match, which leaves the command auto-approved whenever an allow entry does match. ` +
        `Rewrite it as the literal text a command starts with.`,
    );
  }
  if (matcherAllows.length > 0) {
    warnWithFallback(
      logger,
      `${toolLabel}: allow ${formatPatterns(matcherAllows)} will be compared as literal command ` +
        `prefix text, not as a glob or regex, so it approves fewer commands than it looks like it ` +
        `does. It is left unchanged, since narrowing an allow is the safe direction; write the ` +
        `literal prefix instead if you meant more. A bare "*" is the one entry treated as a ` +
        `wildcard.`,
    );
  }

  // Two matcher-shaped denies can truncate to the same prefix, so the deny list
  // is the one that needs deduplicating; canonical rule keys are unique.
  const deduped = [...new Set(denied)];
  return { allowed, denied: deduped.length > 0 ? deduped : undefined };
}
