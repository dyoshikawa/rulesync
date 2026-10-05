import { parseGlobPattern } from "../../utils/glob.js";

/**
 * Translation between rulesync's canonical `bash` patterns and the targets of
 * Antigravity `command(...)` permission rules, shared by the Antigravity CLI
 * and IDE generators (both use the same permissions engine).
 *
 * The canonical patterns use Claude Code glob semantics: `npm run *` matches
 * anything that starts with `npm run`, and `git status` matches only that
 * command. Antigravity reads a `command` target differently. A plain target is
 * a literal, token-based prefix, and a target that starts with `regex:` is a
 * regular expression. A `*` inside a plain target is a literal character, so a
 * glob copied verbatim (`command(rm -rf *)`) never matches a real command — a
 * deny written that way blocks nothing.
 *
 * - `<literal> *` becomes the literal prefix `<literal>`, which is what a
 *   prefix match already means.
 * - Any other pattern becomes an anchored `regex:^...$`. That includes a
 *   pattern with no wildcard at all: a plain target would be read as a prefix,
 *   which is broader than the exact match the canonical pattern asks for.
 * - A canonical pattern that already starts with `regex:` is passed through,
 *   so a rule imported from Antigravity round-trips.
 *
 * @see https://antigravity.google/docs/permissions?tab=cli
 */

const REGEX_PREFIX = "regex:";

// Characters that carry meaning in a JavaScript-style regex and so are escaped
// when they stand for themselves.
const REGEX_METACHARACTERS = /[\\^$.|?*+()[\]{}]/;

function escapeRegexCharacter(character: string): string {
  return REGEX_METACHARACTERS.test(character) ? `\\${character}` : character;
}

function hasGlob(pattern: string): boolean {
  return parseGlobPattern(pattern).steps.some((step) => step.kind !== "literal");
}

function globToRegexSource(glob: string): string {
  let source = "";
  for (const step of parseGlobPattern(glob).steps) {
    switch (step.kind) {
      case "star":
        source += ".*";
        break;
      case "any":
        source += ".";
        break;
      case "literal":
        source += escapeRegexCharacter(step.character);
        break;
      case "class": {
        const members = [...step.members].map((member) =>
          /[\\\]^-]/.test(member) ? `\\${member}` : member,
        );
        const ranges = step.ranges.map(
          ([low, high]) => `${String.fromCodePoint(low)}-${String.fromCodePoint(high)}`,
        );
        source += `[${step.negated ? "^" : ""}${members.join("")}${ranges.join("")}]`;
        break;
      }
    }
  }
  return `^${source}$`;
}

/**
 * Turn a canonical bash pattern into an Antigravity `command` target. The bare
 * `*` (every command) is left to the caller, which writes a bare `command`.
 */
export function toAntigravityCommandTarget(pattern: string): string {
  if (pattern.startsWith(REGEX_PREFIX)) {
    return pattern;
  }
  // Only one trailing wildcard word is a prefix: `docker * *` needs at least
  // two more words, which a prefix cannot require.
  const prefix = pattern.replace(/\s+\*$/, "");
  if (prefix !== pattern && prefix.length > 0 && !hasGlob(prefix)) {
    return prefix;
  }
  return `${REGEX_PREFIX}${globToRegexSource(pattern)}`;
}

/**
 * Read an anchored regex body back as a glob, or `undefined` when it uses
 * anything a glob cannot say. Only escaped characters, `.` and `.*` translate;
 * a literal `*`, `?` or `[` has no glob spelling and keeps the rule a regex.
 */
function regexSourceToGlob(source: string): string | undefined {
  if (!source.startsWith("^") || !source.endsWith("$") || source.length < 2) {
    return undefined;
  }
  const characters = Array.from(source.slice(1, -1));
  let glob = "";
  for (let index = 0; index < characters.length; index++) {
    const character = characters[index] ?? "";
    if (character === "\\") {
      const escaped = characters[index + 1];
      if (escaped === undefined || !REGEX_METACHARACTERS.test(escaped) || /[*?[]/.test(escaped)) {
        return undefined;
      }
      glob += escaped;
      index += 1;
    } else if (character === ".") {
      if (characters[index + 1] === "*") {
        glob += "*";
        index += 1;
      } else {
        glob += "?";
      }
    } else if (REGEX_METACHARACTERS.test(character)) {
      return undefined;
    } else {
      glob += character;
    }
  }
  return glob;
}

/**
 * Turn an Antigravity `command` target back into a canonical bash pattern. A
 * plain target is a prefix, so it imports as `<target> *`. A `regex:` target
 * that this module could have written imports as the glob it came from; any
 * other `regex:` target is kept as is.
 */
export function fromAntigravityCommandTarget(target: string): string {
  if (target.startsWith(REGEX_PREFIX)) {
    return regexSourceToGlob(target.slice(REGEX_PREFIX.length)) ?? target;
  }
  if (target === "*") {
    return target;
  }
  return `${target} *`;
}
