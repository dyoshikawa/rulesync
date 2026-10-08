// cspell:ignore alnum cntrl punct xdigit CLMNPSZ -- POSIX classes and Unicode categories
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

// The whitespace Go's `unicode.IsSpace` counts, which is where Antigravity
// splits a command into words. JavaScript's `\s` is not the same set: it adds
// U+FEFF and leaves out U+0085.
const WHITESPACE_CODES = [
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0x85, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004,
  0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
];

const WHITESPACE_CLASS = `[${WHITESPACE_CODES.map((code) => `\\u{${code.toString(16)}}`).join("")}]`;
const WHITESPACE = new RegExp(WHITESPACE_CLASS, "u");
const WHITESPACE_RUN = new RegExp(`${WHITESPACE_CLASS}+`, "u");

/** Split a target into words as Antigravity does. */
function splitWords(text: string): string[] {
  return text.split(WHITESPACE_RUN).filter((word) => word.length > 0);
}

type GlobStep = ReturnType<typeof parseGlobPattern>["steps"][number];

export type CommandTargetResult = { target: string; note?: string } | { skipReason: string };

function escapeRegexCharacter(character: string): string {
  return REGEX_METACHARACTERS.test(character) ? `\\${character}` : character;
}

// Inside `[...]`, only these characters carry meaning. Range endpoints are
// escaped too, so `[\-z]` stays a range rather than becoming `-` or `z`.
// Whitespace is written as `\x{20}` and the like: a bare space or tab would
// split the regex word in two. The braces keep `\x{2003}` from being read as
// `\x20` followed by `03`.
function escapeClassCharacter(character: string): string {
  if (WHITESPACE.test(character)) {
    return `\\x{${(character.codePointAt(0) ?? 0).toString(16)}}`;
  }
  return /[\\\]^-]/.test(character) ? `\\${character}` : character;
}

// A range that runs backwards is an invalid regex, and a deny that fails to
// compile blocks nothing.
function hasBackwardRange(step: GlobStep): boolean {
  return step.kind === "class" && step.ranges.some(([low, high]) => low > high);
}

// Lookahead and lookbehind, which JavaScript has and RE2 does not.
const LOOKAROUND = /\(\?<?[=!]/;

// The letter escapes Go's RE2 knows. Any other letter or digit after a
// backslash (`\k<name>`, `\cA`, `\u0061`, `\C`, `\1`) is refused, as Go
// refuses it; `\0` is octal. `\Q...\E` is read as a whole before this check.
// cspell:disable-next-line
const RE2_LETTER_ESCAPES = new Set("aftnrvdDsSwWbBAzxpP0");

// RE2's quoted literal text: `\Q` up to `\E` or the end. An escaped backslash
// is matched first, so the `Q` in `\\Q` is a plain letter.
const RE2_QUOTED = /\\\\|\\Q[\s\S]*?(?:\\E|$)/g;

// RE2 refuses a repeat count above 1000.
const RE2_MAX_REPEAT = 1000;

const POSIX_CLASSES = new Set([
  "alnum",
  "alpha",
  "ascii",
  "blank",
  "cntrl",
  "digit",
  "graph",
  "lower",
  "print",
  "punct",
  "space",
  "upper",
  "word",
  "xdigit",
]);

/**
 * Whether the text after `\p` names a Unicode class RE2 knows: a one-letter
 * category (`\pL`) or a category or script in braces (`\p{Lu}`, `\p{Greek}`,
 * `\p{^Greek}`). JavaScript checks the name; RE2 also takes it in lower case.
 */
function isUnicodeClass(rest: string): boolean {
  const name = /^\{\^?([A-Za-z_]+)\}/.exec(rest)?.[1] ?? /^[CLMNPSZ]/i.exec(rest)?.[0];
  if (name === undefined) {
    return false;
  }
  const spellings = [name, `${name.charAt(0).toUpperCase()}${name.slice(1)}`];
  return spellings.some(
    (spelling) =>
      spelling === "Any" ||
      ["General_Category=", "Script="].some((property) => {
        try {
          new RegExp(`\\p{${property}${spelling}}`, "u");
          return true;
        } catch {
          return false;
        }
      }),
  );
}

/**
 * Replace each POSIX class (`[:alpha:]`) inside a bracket class with a plain
 * character, so JavaScript can compile the rest, or return `undefined` for an
 * unknown one. Only inside a bracket is `[:name:]` a POSIX class; a bare
 * `[:foobar:]` is an ordinary class of those characters, as in RE2.
 */
function replacePosixClasses(source: string): string | undefined {
  let result = "";
  let inClass = false;
  let index = 0;
  while (index < source.length) {
    const character = source[index] ?? "";
    if (character === "\\") {
      // Assertions are not characters, so Go refuses them inside a class.
      if (inClass && /[AzbB]/.test(source[index + 1] ?? "")) {
        return undefined;
      }
      result += source.slice(index, index + 2);
      index += 2;
      continue;
    }
    if (!inClass) {
      result += character;
      index += 1;
      if (character === "[") {
        inClass = true;
        if (source[index] === "^") {
          result += "^";
          index += 1;
        }
        // A `]` first in the class is a member in RE2; JavaScript needs it escaped.
        if (source[index] === "]") {
          result += "\\]";
          index += 1;
        }
      }
      continue;
    }
    // Go reads anything from `[:` to the next `:]` as a class name, so
    // `[:FOO:]` or `[:alpha1:]` is an unknown class, not three members.
    const posix = /^\[:\^?([\s\S]*?):\]/.exec(source.slice(index));
    if (posix !== null) {
      if (!POSIX_CLASSES.has(posix[1] ?? "")) {
        return undefined;
      }
      result += "a";
      index += posix[0].length;
      continue;
    }
    if (character === "]") {
      inClass = false;
    }
    result += character;
    index += 1;
  }
  return result;
}

/**
 * Whether Antigravity (Go, RE2) would refuse a regex word, so that a word like
 * `^ls(` is caught. There is no RE2 here, so the check is conservative: it
 * refuses what RE2 lacks (lookaround, unknown escapes, repeats over 1000,
 * unknown POSIX classes), rewrites RE2's own spellings (`(?P<name>`, `(?i)`,
 * `(?-i)`, `\A`, `\z`, `[[:alpha:]]`) into JavaScript, and then compiles the
 * result. `(?<name>` is valid in both (RE2 since Go 1.22).
 */
function isInvalidRegex(source: string): boolean {
  // Quoted text is literal, so it stands in as one plain character.
  const unquoted = source.replace(RE2_QUOTED, (match) => (match === "\\\\" ? match : "q"));
  if (LOOKAROUND.test(unquoted) || hasRefusedEscape(unquoted)) {
    return true;
  }
  const withoutPosixClasses = replacePosixClasses(unquoted);
  if (withoutPosixClasses === undefined || hasRefusedRepeat(withoutPosixClasses)) {
    return true;
  }
  const asJavaScript = withoutPosixClasses
    .replace(/\(\?P</g, "(?<")
    .replace(/\(\?[imsU]*-?[imsU]*\)/g, "")
    .replace(/\(\?[imsU]*-?[imsU]*:/g, "(?:")
    .replace(/\\A/g, "^")
    .replace(/\\z/g, "$");
  try {
    new RegExp(asJavaScript);
    return false;
  } catch {
    return true;
  }
}

/** Whether a backslash escape is one Go refuses but JavaScript reads as a letter. */
function hasRefusedEscape(source: string): boolean {
  for (const match of source.matchAll(/\\([\s\S])/g)) {
    const escaped = match[1] ?? "";
    if (/[a-zA-Z0-9]/.test(escaped) && !RE2_LETTER_ESCAPES.has(escaped)) {
      return true;
    }
    const rest = source.slice((match.index ?? 0) + 2);
    if (escaped === "x") {
      const hex = /^(?:[0-9a-fA-F]{2}|\{([0-9a-fA-F]+)\})/.exec(rest);
      // Go refuses a malformed `\x`, and a code point past the last one
      // Unicode has.
      if (hex === null || Number.parseInt(hex[1] ?? "0", 16) > 0x10ffff) {
        return true;
      }
    }
    if ((escaped === "p" || escaped === "P") && !isUnicodeClass(rest)) {
      return true;
    }
  }
  return false;
}

/**
 * Whether a repeat count is over Go's limit. Braces inside a bracket class
 * (`[a{1001}]`) and in `\x{2003}` or `\p{Greek}` are not repeats, so those
 * are blanked out first. POSIX classes must already be replaced.
 */
function hasRefusedRepeat(source: string): boolean {
  const plain = blankClasses(source.replace(/\\[xpP]\{[^}]*\}/g, "e"));
  for (const [, low = "", high = ""] of plain.matchAll(/(?<!\\)\{(\d+)(?:,(\d*))?\}/g)) {
    if (Number(low) > RE2_MAX_REPEAT || Number(high) > RE2_MAX_REPEAT) {
      return true;
    }
  }
  return false;
}

/** Replace each bracket class with one plain character. */
function blankClasses(source: string): string {
  let result = "";
  let index = 0;
  while (index < source.length) {
    const character = source[index] ?? "";
    if (character === "\\") {
      result += source.slice(index, index + 2);
      index += 2;
      continue;
    }
    if (character !== "[") {
      result += character;
      index += 1;
      continue;
    }
    // Skip to the closing `]`; a `]` first in the class is a member.
    index += source[index + 1] === "^" ? 2 : 1;
    if (source[index] === "]") {
      index += 1;
    }
    while (index < source.length && source[index] !== "]") {
      index += source[index] === "\\" ? 2 : 1;
    }
    index += 1;
    result += "c";
  }
  return result;
}

// A class that lists whitespace. Written into a regex word, the whitespace
// would split that word in two.
function listsWhitespace(step: GlobStep): boolean {
  return (
    step.kind === "class" &&
    !step.negated &&
    WHITESPACE_CODES.some((code) => classHolds(step, code))
  );
}

function classHolds(step: GlobStep & { kind: "class" }, code: number): boolean {
  return (
    step.members.has(String.fromCodePoint(code)) ||
    step.ranges.some(([low, high]) => low <= code && high >= code)
  );
}

// Whether a step can stand for whitespace: `?`, or a negated class that does
// not exclude every whitespace character (`[!\t]` and `[! ]` still admit one).
function canMatchSpace(step: GlobStep): boolean {
  if (step.kind === "any") {
    return true;
  }
  if (step.kind !== "class") {
    return false;
  }
  if (!step.negated) {
    return listsWhitespace(step);
  }
  return !WHITESPACE_CODES.every((code) => classHolds(step, code));
}

// `{a,b}` alternatives and `{1..3}` ranges, which canonical patterns treat as
// a glob. Any other brace, such as `{}` or `{name}`, is a literal.
export const BRACE_ALTERNATIVES = /\{[^{}]*(?:,|\.\.)[^{}]*\}/;

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
    const regexWords = splitWords(pattern.slice(REGEX_PREFIX.length));
    if (regexWords.length === 0) {
      return { skipReason: "The regex is empty" };
    }
    const invalid = regexWords.find(isInvalidRegex);
    return invalid === undefined
      ? { target: pattern }
      : {
          skipReason: `Antigravity compiles each word of a regex on its own, and \`${invalid}\` is not a valid regex`,
        };
  }
  if (BRACE_ALTERNATIVES.test(pattern)) {
    return { skipReason: "Antigravity has no `{a,b}` alternatives in a command target" };
  }
  const steps = parseGlobPattern(pattern).steps;
  // At the very end, `?` or `[!x]` only adds a trailing space, which shells
  // and Antigravity strip. Anywhere else it can join two words.
  if (steps.some(listsWhitespace) || steps.slice(0, -1).some(canMatchSpace)) {
    return {
      skipReason:
        "A `?` or bracket that can match a space spans two words, and Antigravity matches a command word by word",
    };
  }
  if (steps.some(hasBackwardRange)) {
    return { skipReason: "A bracket range runs backwards, so it has no regex spelling" };
  }
  const words = splitIntoWords(steps);
  // A `*` can stand for several words, but a regex word matches one. So a `*`
  // is safe only at the end of its word, with nothing after that word but `*`
  // words: each takes one word, and the rest are free, since Antigravity lets
  // extra words follow. `rm *.env` also matches `rm -f foo.env`, which
  // `^rm$ ^.*\.env$` misses.
  const multiWordStar = words.some(
    (word, index) =>
      word.some((step, stepIndex) => step.kind === "star" && stepIndex < word.length - 1) ||
      (word.some((step) => step.kind === "star") &&
        !words.slice(index + 1).every((later) => isStarWord(later))),
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
 * The leading literal words of a canonical bash pattern (`git push` for
 * `git push * --force`), or `undefined` when it has none. Every command the
 * pattern matches starts with these words, so a plain target of them matches
 * at least as much. A `regex:` pattern has no literal words to read, and a
 * word with a brace may be part of `{a,b}` alternatives, so it ends the prefix.
 */
export function toAntigravityCommandLiteralPrefix(pattern: string): string | undefined {
  if (pattern.startsWith(REGEX_PREFIX)) {
    return undefined;
  }
  const words = splitIntoWords(parseGlobPattern(pattern).steps);
  const prefix: string[] = [];
  for (const word of words) {
    const literal = isLiteralWord(word) ? wordToLiteral(word) : undefined;
    if (literal === undefined || literal.includes("{") || literal.includes("}")) {
      break;
    }
    prefix.push(literal);
  }
  // A first word that starts with `regex:` would turn the target into a regex.
  if (prefix.length === 0 || prefix[0]?.startsWith(REGEX_PREFIX)) {
    return undefined;
  }
  return prefix.join(" ");
}

/**
 * Read one regex word back as a glob, or `undefined` when it uses anything a
 * glob cannot say. Antigravity anchors each word anyway, so `^` and `$` are
 * optional. Only escaped characters and `.*` translate; anything else keeps
 * the rule a regex.
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
      // `*`, `?`, `[`, `{`, `}` and `\` mean something in a glob, so they keep
      // the rule a regex.
      if (
        escaped === undefined ||
        !REGEX_METACHARACTERS.test(escaped) ||
        /[*?[{}\\]/.test(escaped)
      ) {
        return undefined;
      }
      glob += escaped;
      index += 1;
    } else if (character === ".") {
      // A lone `.` would read back as `?`, which can match a space and so
      // joins two words in a glob; such a rule stays a regex.
      if (characters[index + 1] !== "*") {
        return undefined;
      }
      glob += "*";
      index += 1;
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
  for (const word of splitWords(source)) {
    const glob = regexWordToGlob(word);
    if (glob === undefined) {
      return undefined;
    }
    globs.push(glob);
  }
  // In Antigravity a `*` stays inside its word; in a glob it can stand for any
  // number of words unless it ends the pattern, so `^.*\.env$` and
  // `^.*status.*$` stay regexes.
  const multiWordStar = globs.some(
    (glob, index) =>
      glob.slice(0, -1).includes("*") ||
      (glob.endsWith("*") && !globs.slice(index + 1).every((later) => later === "*")),
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
  // A plain target is literal, but `*`, `?`, `[`, `{` and `\` mean more in a glob,
  // so such a target imports as the regex that says what Antigravity does:
  // `command(rm -rf *)` matches a literal `*` word.
  if (/[*?[{\\]/.test(target)) {
    const words = splitWords(target);
    return `${REGEX_PREFIX}${words.map((word) => `^${[...word].map(escapeRegexCharacter).join("")}$`).join(" ")}`;
  }
  return `${target} *`;
}
