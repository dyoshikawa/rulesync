import { parseGlobPattern } from "../../utils/glob.js";

/**
 * Translation between rulesync's canonical `bash` patterns and the targets of
 * Antigravity `command(...)` permission rules, shared by the Antigravity CLI
 * and IDE generators (both use the same permissions engine).
 *
 * The canonical patterns use Claude Code glob semantics over the whole command
 * line: `npm run *` matches anything that starts with `npm run`, and a `*` can
 * span several words. Antigravity matches word by word instead. It splits both
 * the command and the target on whitespace and compares them one word at a
 * time; extra words at the end of the command still match. A plain target
 * compares each word literally. A `regex:` target holds one regex per word, and
 * each is anchored to its word, so `.*` never spans a space and
 * `regex:^git status$` also matches `git status --short`. A `*` inside a plain
 * target is a literal character, so a glob copied verbatim
 * (`command(rm -rf *)`) never matches a real command, and a deny written that
 * way blocks nothing.
 *
 * - Literal words become a plain target (`git status *` → `git status`). An
 *   exact command cannot be expressed: its target also matches the command
 *   with more words after it.
 * - A word with a glob in it becomes a per-word regex, and so do the literal
 *   words around it (`npm run test:*` → `regex:^npm$ ^run$ ^test:.*$`).
 * - A `*` that has a literal word after it can stand for any number of
 *   words, which a word-by-word match cannot say, so such a pattern is not
 *   translated. Trailing `*` words each need one word (`docker * *` →
 *   `regex:^docker$ ^.*$ ^.*$`), except that `<words> *` is a plain prefix.
 * - A canonical pattern that already starts with `regex:` is passed through,
 *   so a rule imported from Antigravity round-trips, unless one of its words
 *   is not a valid regex on its own (`regex:^ls( -la)?$` splits at the space).
 *
 * @see https://antigravity.google/docs/permissions?tab=cli
 */

const REGEX_PREFIX = "regex:";

// Characters that carry meaning in a JavaScript-style regex and so are escaped
// when they stand for themselves.
const REGEX_METACHARACTERS = /[\\^$.|?*+()[\]{}]/;

const WHITESPACE = /\s/;

type GlobStep = ReturnType<typeof parseGlobPattern>["steps"][number];

export type CommandTargetResult = { target: string; note?: string } | { skipReason: string };

function escapeRegexCharacter(character: string): string {
  return REGEX_METACHARACTERS.test(character) ? `\\${character}` : character;
}

// Inside `[...]`, only these characters carry meaning. Range endpoints are
// escaped too, so `[\-z]` stays a range rather than becoming `-` or `z`.
function escapeClassCharacter(character: string): string {
  return /[\\\]^-]/.test(character) ? `\\${character}` : character;
}

// A range that runs backwards is an invalid regex, and a deny that fails to
// compile blocks nothing.
function hasBackwardRange(step: GlobStep): boolean {
  return step.kind === "class" && step.ranges.some(([low, high]) => low > high);
}

// Syntax JavaScript accepts and RE2 refuses: lookahead, lookbehind and backreferences.
const JAVASCRIPT_ONLY_REGEX = /\(\?<?[=!]|\\[1-9]|\\k</;

/**
 * Whether Antigravity (Go, RE2) would refuse a regex word, so that a word like
 * `^ls(` is caught. There is no RE2 here, so the check runs in JavaScript:
 * syntax only JavaScript has fails, and RE2's own spellings (`(?P<name>`,
 * `(?i)`, `(?-i)`, `\A`, `\z`, `[[:alpha:]]`) are rewritten into JavaScript
 * before it compiles. `(?<name>` is valid in both (RE2 since Go 1.22).
 */
function isInvalidRegex(source: string): boolean {
  if (JAVASCRIPT_ONLY_REGEX.test(source)) {
    return true;
  }
  const asJavaScript = source
    .replace(/\(\?P</g, "(?<")
    .replace(/\(\?[imsU]*-?[imsU]*\)/g, "")
    .replace(/\(\?[imsU]*-?[imsU]*:/g, "(?:")
    .replace(/\\A/g, "^")
    .replace(/\\z/g, "$")
    .replace(/\[:\^?[a-z]+:\]/g, "a");
  try {
    new RegExp(asJavaScript);
    return false;
  } catch {
    return true;
  }
}

// A bracket class that holds a space can match across two words.
function classMatchesWhitespace(step: GlobStep): boolean {
  return (
    step.kind === "class" &&
    ([...step.members].some((member) => WHITESPACE.test(member)) ||
      step.ranges.some(([low, high]) => low <= 0x20 && high >= 0x20))
  );
}

/** Split parsed glob steps into words at literal whitespace. */
function splitIntoWords(steps: readonly GlobStep[]): GlobStep[][] {
  const words: GlobStep[][] = [];
  let current: GlobStep[] = [];
  for (const step of steps) {
    if (step.kind === "literal" && WHITESPACE.test(step.character)) {
      if (current.length > 0) {
        words.push(current);
        current = [];
      }
    } else {
      current.push(step);
    }
  }
  if (current.length > 0) {
    words.push(current);
  }
  return words;
}

function isLiteralWord(word: readonly GlobStep[]): boolean {
  return word.every((step) => step.kind === "literal");
}

function isStarWord(word: readonly GlobStep[]): boolean {
  return word.length === 1 && word[0]?.kind === "star";
}

function wordToLiteral(word: readonly GlobStep[]): string {
  return word.map((step) => (step.kind === "literal" ? step.character : "")).join("");
}

function wordToRegexSource(word: readonly GlobStep[]): string {
  let source = "";
  for (const step of word) {
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
        const members = [...step.members].map(escapeClassCharacter);
        const ranges = step.ranges.map(
          ([low, high]) =>
            `${escapeClassCharacter(String.fromCodePoint(low))}-${escapeClassCharacter(String.fromCodePoint(high))}`,
        );
        source += `[${step.negated ? "^" : ""}${members.join("")}${ranges.join("")}]`;
        break;
      }
    }
  }
  return `^${source}$`;
}

/**
 * Turn a canonical bash pattern into an Antigravity `command` target, or say
 * why it has none. The bare `*` (every command) is left to the caller, which
 * writes a bare `command`. A `note` says the target matches more than the
 * pattern does.
 */
export function toAntigravityCommandTarget(pattern: string): CommandTargetResult {
  if (pattern.startsWith(REGEX_PREFIX)) {
    const invalid = pattern.slice(REGEX_PREFIX.length).trim().split(/\s+/).find(isInvalidRegex);
    return invalid === undefined
      ? { target: pattern }
      : {
          skipReason: `Antigravity compiles each word of a regex on its own, and \`${invalid}\` is not a valid regex`,
        };
  }
  const steps = parseGlobPattern(pattern).steps;
  if (steps.some(classMatchesWhitespace)) {
    return {
      skipReason:
        "A bracket that matches a space spans two words, and Antigravity matches a command word by word",
    };
  }
  if (steps.some(hasBackwardRange)) {
    return { skipReason: "A bracket range runs backwards, so it has no regex spelling" };
  }
  const words = splitIntoWords(steps);
  // A `*` stands for any number of words, but each regex word matches one. Only
  // `*` words may follow it: each takes one word, and the last one's extra
  // words are free, since Antigravity lets them follow anyway.
  const multiWordStar = words.some(
    (word, index) =>
      word.some((step) => step.kind === "star") &&
      !words.slice(index + 1).every((later) => isStarWord(later)),
  );
  if (multiWordStar) {
    return {
      skipReason:
        "A `*` before another word can stand for several words, and Antigravity matches a command word by word",
    };
  }
  // A pattern that ends in `*` already covers whatever follows.
  const note =
    steps.at(-1)?.kind === "star"
      ? undefined
      : "Antigravity also matches the command with more words after it";
  if (words.every(isLiteralWord)) {
    return { target: words.map(wordToLiteral).join(" "), note };
  }
  // `<words> *` is a plain prefix. It also matches the bare command, as a
  // prefix rule does in the other adapters. More `*` words stay regex words,
  // so `docker * *` still needs two more words.
  const head = words.slice(0, -1);
  if (head.length > 0 && isStarWord(words.at(-1) ?? []) && head.every(isLiteralWord)) {
    return { target: head.map(wordToLiteral).join(" ") };
  }
  return { target: `${REGEX_PREFIX}${words.map(wordToRegexSource).join(" ")}`, note };
}

/**
 * Read one regex word back as a glob, or `undefined` when it uses anything a
 * glob cannot say. Antigravity anchors each word anyway, so `^` and `$` are
 * optional. Only escaped characters, `.` and `.*` translate; a literal `*`,
 * `?` or `[` has no glob spelling and keeps the rule a regex.
 */
function regexWordToGlob(word: string): string | undefined {
  const body = word.replace(/^\^/, "").replace(/(?<!\\)\$$/, "");
  const characters = Array.from(body);
  if (characters.length === 0) {
    return undefined;
  }
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

/** Read a per-word regex back as a glob, or `undefined` when it has no glob spelling. */
function regexToGlob(source: string): string | undefined {
  const globs: string[] = [];
  for (const word of source.trim().split(/\s+/)) {
    const glob = regexWordToGlob(word);
    if (glob === undefined) {
      return undefined;
    }
    globs.push(glob);
  }
  // In Antigravity a `*` stays inside its word; as a glob followed by a literal
  // word it would stand for any number of words.
  const multiWordStar = globs.some(
    (glob, index) => glob.includes("*") && !globs.slice(index + 1).every((later) => later === "*"),
  );
  if (multiWordStar) {
    return undefined;
  }
  // Extra words after the last one still match. A last word that ends in `*`
  // already says so.
  const glob = globs.join(" ");
  return glob.endsWith("*") ? glob : `${glob} *`;
}

/**
 * Turn an Antigravity `command` target back into a canonical bash pattern. A
 * plain target matches extra words, so it imports as `<target> *`. A `regex:`
 * target that only uses what a glob can say imports as that glob; any other
 * `regex:` target is kept as is.
 */
export function fromAntigravityCommandTarget(target: string): string {
  if (target.startsWith(REGEX_PREFIX)) {
    return regexToGlob(target.slice(REGEX_PREFIX.length)) ?? target;
  }
  if (target === "*") {
    return target;
  }
  return `${target} *`;
}
