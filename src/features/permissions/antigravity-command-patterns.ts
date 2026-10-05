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
 * - A trailing ` *` is dropped, since extra words already match. A `*` that
 *   has a literal word after it can stand for any number of words, which a
 *   word-by-word match cannot say, so such a pattern is not translated.
 * - A canonical pattern that already starts with `regex:` is passed through,
 *   so a rule imported from Antigravity round-trips.
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
    return { target: pattern };
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
  // Extra words after the target already match, so a trailing ` *` adds nothing.
  if (words.length > 1 && isStarWord(words.at(-1) ?? [])) {
    words.pop();
  }
  // A `*` stands for any number of words, but each regex word matches one. Only
  // `*` words may follow it, since they each take one word and the rest of the
  // command is free anyway.
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
  // Extra words after the last one still match. A last word like `install*`
  // already says so; a `*` word still needs a word of its own.
  const last = globs.at(-1) ?? "";
  const glob = globs.join(" ");
  return last.endsWith("*") && last !== "*" ? glob : `${glob} *`;
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
