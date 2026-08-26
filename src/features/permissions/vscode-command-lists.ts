import type { PermissionAction } from "../../types/permissions.js";
import type { Logger } from "../../utils/logger.js";
import { warnWithFallback } from "../../utils/logger.js";

/**
 * A `/…/`-delimited pattern written as an **anchored** regex literal, with the
 * body after `^` captured so the prefix can be read out of it.
 *
 * The anchor is required for two reasons. An absolute command path
 * (`/usr/bin/curl`, `/bin/sh`, `/etc/init.d/x`) has the delimiters and nothing
 * else, so matching on those alone would read `/bin/sh` as the regex `bin` and
 * throw the real command prefix away. And an unanchored regex pins down no
 * prefix in the first place — only `^` promises that a match starts where the
 * pattern starts, which is the sole reason a prefix can be derived at all.
 */
const REGEX_LITERAL = /^\/\^(.*)\/[a-z]*$/;

/**
 * Grouping and alternation. A pattern using them names alternatives rather
 * than one prefix, and `parseCommand` splits a command chain on `|` before
 * matching, so such a pattern cannot match a parsed subcommand at all. No
 * sound prefix can be derived either — the prefix common to `npm run (build|
 * test)` is `npm run `, which denies every script rather than the two named —
 * so these are reported as inert instead of widened. Tested before any prefix
 * is derived, so `npm run (build|test)`, `^npm run (build|test)` and
 * `/^npm run (build|test)/` all reach that same answer.
 */
const ALTERNATION = /[()|]/;

/**
 * Where a regex stops pinning down literal text. Deliberately the full regex
 * metacharacter set, since a pattern that announces itself as a regex has to be
 * read as one.
 */
const REGEX_METACHARACTERS = /[.*+?^${}()|[\]\\]/;

/**
 * What a pattern is, once read the way the Roo Code / Zoo Code lineage reads
 * it: `findLongestPrefixMatch` lowercases both sides and compares with
 * `startsWith`, with exactly one special case — the entry `"*"` on its own,
 * which matches any command.
 *
 * `literal` is the overwhelmingly common case and covers far more than it
 * looks like it does. `parseCommand` splits a chain on `&&`, `||`, `;`, `|` and
 * `&`, but every other shell character is put back verbatim by
 * `restorePlaceholders` before matching — variables, parameter expansions,
 * bracket and brace syntax, quoted strings — so `echo $HOME`, `[ -f x ]` and
 * `mv a{,.bak}` are all real command prefixes that really do match. Only
 * syntax that cannot be anything but a matcher is treated as one, because the
 * remedy below (widening a deny) is destructive when misapplied: turning
 * `echo $HOME` into `echo ` would auto-deny every `echo`.
 *
 * @see https://github.com/RooCodeInc/Roo-Code/blob/v3.54.0/src/core/auto-approval/commands.ts
 * @see https://github.com/RooCodeInc/Roo-Code/blob/v3.54.0/src/shared/parse-command.ts
 */
type PatternShape =
  /** Compared as-is, and correct as written. Includes the bare `"*"` wildcard. */
  | { kind: "literal" }
  /** Glob or regex syntax, pinning down this literal command prefix. */
  | { kind: "matcher"; prefix: string }
  /** Glob or regex syntax pinning down no prefix at all, e.g. `"*.sh"`. */
  | { kind: "matcher"; prefix: undefined };

function firstPrefix(text: string, stopAt: RegExp): string | undefined {
  const index = text.search(stopAt);
  const prefix = index < 0 ? text : text.slice(0, index);
  // A blank prefix is not a usable answer. The empty string is a prefix of
  // every command, so acting on it would deny everything; a whitespace-only one
  // is dropped outright by `mergeCommandLists`, which filters on
  // `cmd.trim().length > 0`, so claiming the deny now takes effect would be a
  // lie.
  return prefix.trim() === "" ? undefined : prefix;
}

function classifyPattern(pattern: string): PatternShape {
  if (pattern === "*") {
    return { kind: "literal" };
  }
  // A leading anchor is regex syntax wherever it appears, so the rest is read
  // as a regex whether or not the pattern also carries the `/…/` delimiters.
  const regexBody =
    REGEX_LITERAL.exec(pattern)?.[1] ?? (pattern.startsWith("^") ? pattern.slice(1) : undefined);
  const body = regexBody ?? pattern;
  // Checked before any prefix is derived, and against the regex body rather
  // than the whole pattern, so that all three spellings of an alternation reach
  // the same answer. `REGEX_METACHARACTERS` includes `(`, so deriving first
  // would cut `/^npm run (build|test)/` down to the common prefix `npm run `
  // that the inert tier exists to avoid.
  if (ALTERNATION.test(body)) {
    return { kind: "matcher", prefix: undefined };
  }
  if (regexBody !== undefined) {
    return { kind: "matcher", prefix: firstPrefix(regexBody, REGEX_METACHARACTERS) };
  }
  if (pattern.includes("*")) {
    return { kind: "matcher", prefix: firstPrefix(pattern, /\*/) };
  }
  return { kind: "literal" };
}

function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

function formatPatterns(patterns: string[]): string {
  return patterns.map((pattern) => JSON.stringify(pattern)).join(", ");
}

function formatAdditions(additions: { from: string; prefix: string }[]): string {
  return additions
    .map(({ from, prefix }) => `${JSON.stringify(from)} → ${JSON.stringify(prefix)}`)
    .join(", ");
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
 * Glob- and regex-shaped patterns — which the canonical `bash` category carries
 * for most other targets, since claudecode writes `Bash(rm -rf *)` — are
 * handled asymmetrically too, and for the same reason: which way the mismatch
 * fails.
 *
 * - A matcher-shaped **deny** fails **open**: `{"*": "allow", "rm -rf *":
 *   "deny"}` yields a denied entry that never matches `rm -rf /` — the literal
 *   text `rm -rf *` is not a prefix of it — while the bare `"*"` on the allow
 *   side still matches everything, so the command auto-approves with no prompt.
 *   The literal prefix such a pattern pins down (`"rm -rf "`) is therefore
 *   **added alongside** it, which makes the deny take effect. Adding rather
 *   than replacing keeps the author's own text in the file, so importing the
 *   settings back does not quietly narrow the canonical rule and degrade what
 *   every other target generates from it; the added prefix only ever widens
 *   what is denied, so both directions stay on the safe side.
 * - A matcher-shaped **allow** fails **closed**: it approves fewer commands
 *   than it looks like it does, and the rest reach the approval prompt. Adding
 *   its prefix would widen what runs unattended, so allow patterns are passed
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
  const widenedDenies: { from: string; prefix: string }[] = [];
  const inertDenies: string[] = [];
  for (const [pattern, action] of Object.entries(rules)) {
    if (action !== "allow" && action !== "deny") {
      continue;
    }
    const shape = classifyPattern(pattern);
    if (action === "allow") {
      allowed.push(pattern);
      if (shape.kind === "matcher") {
        matcherAllows.push(pattern);
      }
      continue;
    }
    denied.push(pattern);
    if (shape.kind !== "matcher") {
      continue;
    }
    if (shape.prefix === undefined) {
      inertDenies.push(pattern);
      continue;
    }
    denied.push(shape.prefix);
    widenedDenies.push({ from: pattern, prefix: shape.prefix });
  }

  // Denies are reported first: they are the direction that widens what runs
  // unattended, while a matcher-shaped allow only narrows it.
  if (widenedDenies.length > 0) {
    const count = widenedDenies.length;
    warnWithFallback(
      logger,
      `${toolLabel}: deny ${pluralize(count, "pattern", "patterns")} ` +
        `${formatAdditions(widenedDenies)} — glob or regex syntax compared as literal command ` +
        `prefix text, so ${pluralize(count, "it cannot match on its", "they cannot match on their")} ` +
        `own. ${pluralize(count, "The literal prefix it pins down has", "The literal prefix each one pins down has")} ` +
        `been added alongside it so the deny takes effect. Each added prefix denies at least ` +
        `everything its pattern named, so review it if that is wider than you intended.`,
    );
  }
  if (inertDenies.length > 0) {
    const count = inertDenies.length;
    warnWithFallback(
      logger,
      `${toolLabel}: deny ${pluralize(count, "pattern", "patterns")} ${formatPatterns(inertDenies)} ` +
        `${pluralize(count, "uses", "use")} glob or regex syntax that pins down no command ` +
        `prefix, so ${pluralize(count, "it is", "they are")} written unchanged and will never ` +
        `match. That leaves the command auto-approved whenever an allow entry does match; rewrite ` +
        `each one as the literal text a command starts with — an alternation needs one entry per ` +
        `alternative.`,
    );
  }
  // An added prefix can land on a pattern the author allowed. Deny wins on an
  // equal-length match, so the allow entry stops approving anything — the safe
  // direction, but not obviously what was written.
  const allowedSet = new Set(allowed);
  // Deduplicated before it is counted: two matcher denies can pin down the same
  // prefix, and the message names each shadowed allow entry once.
  const shadowedAllows = [
    ...new Set(
      widenedDenies.map(({ prefix }) => prefix).filter((prefix) => allowedSet.has(prefix)),
    ),
  ];
  if (shadowedAllows.length > 0) {
    const count = shadowedAllows.length;
    warnWithFallback(
      logger,
      `${toolLabel}: the added deny ${pluralize(count, "prefix", "prefixes")} ` +
        `${formatPatterns(shadowedAllows)} also ${pluralize(count, "appears", "appear")} ` +
        `in the allow list. A denied match of equal length wins over an allowed one, so ` +
        `${pluralize(count, "that allow entry", "those allow entries")} no longer ` +
        `${pluralize(count, "approves", "approve")} anything.`,
    );
  }
  if (matcherAllows.length > 0) {
    const count = matcherAllows.length;
    warnWithFallback(
      logger,
      `${toolLabel}: allow ${pluralize(count, "pattern", "patterns")} ` +
        `${formatPatterns(matcherAllows)} will be compared as literal command prefix text, not as ` +
        `a glob or regex, so ${pluralize(count, "it approves", "they approve")} fewer commands ` +
        `than ${pluralize(count, "it looks", "they look")} like. ` +
        `${pluralize(count, "It is", "They are")} left unchanged, since narrowing an allow is the ` +
        `safe direction; write the literal prefix instead if you meant more. A bare "*" is the one ` +
        `entry treated as a wildcard.`,
    );
  }

  // A widened prefix can coincide with another entry — with a second matcher
  // that pins down the same prefix, or with a literal the author already wrote.
  const deduped = [...new Set(denied)];
  return { allowed, denied: deduped.length > 0 ? deduped : undefined };
}
