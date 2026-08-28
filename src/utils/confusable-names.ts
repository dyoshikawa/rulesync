import { stripInvisibleCharacters } from "./control-characters.js";

/**
 * The scripts a name is checked against. A character that belongs to none of
 * them is counted as `Other`, which is deliberately one bucket rather than one
 * per script: the point is to notice a name built out of two alphabets that
 * look alike, and Latin, Cyrillic and Greek are the pairs that actually collide
 * in practice.
 */
const SCRIPT_PATTERNS = [
  ["Latin", /\p{Script=Latin}/u],
  ["Cyrillic", /\p{Script=Cyrillic}/u],
  ["Greek", /\p{Script=Greek}/u],
  ["Han", /\p{Script=Han}/u],
  ["Hiragana", /\p{Script=Hiragana}/u],
  ["Katakana", /\p{Script=Katakana}/u],
  ["Hangul", /\p{Script=Hangul}/u],
  ["Bopomofo", /\p{Script=Bopomofo}/u],
] as const;

/** Digits, punctuation and combining marks belong to no script of their own. */
const NO_SCRIPT_PATTERN = /[\p{Script=Common}\p{Script=Inherited}]/u;

/** The one bucket every script the list above does not name is counted in. */
const OTHER_SCRIPT = "Other";

/**
 * Script combinations that are ordinary rather than suspicious, following the
 * augmented script sets of UTS #39: Japanese, Korean and Chinese names each mix
 * several scripts by nature, and all three routinely carry Latin alongside.
 *
 * `Latin` with `Other` is ordinary too, since `Other` stands for every script
 * this file does not name — Thai, Devanagari, Hebrew and the rest, none of
 * which is confusable with Latin. What is left as suspicious is Latin beside
 * Cyrillic or Greek, the pairs that share letter shapes.
 */
const ORDINARY_SCRIPT_SETS: readonly (readonly string[])[] = [
  ["Han", "Hiragana", "Katakana", "Latin"],
  ["Han", "Hangul", "Latin"],
  ["Han", "Bopomofo", "Latin"],
  ["Latin", OTHER_SCRIPT],
];

function scriptOf(character: string): string | undefined {
  if (NO_SCRIPT_PATTERN.test(character)) {
    return undefined;
  }
  for (const [script, pattern] of SCRIPT_PATTERNS) {
    if (pattern.test(character)) {
      return script;
    }
  }
  return OTHER_SCRIPT;
}

/** `Other` names an internal bucket, so it is not what a reader is shown. */
function describeScript(script: string): string {
  return script === OTHER_SCRIPT ? "another script" : script;
}

function formatScriptList(scripts: string[]): string {
  const described = scripts.map(describeScript);
  const last = described.at(-1);
  if (last === undefined) {
    return "";
  }
  if (described.length === 1) {
    return last;
  }
  return `${described.slice(0, -1).join(", ")} and ${last}`;
}

/**
 * The form a name is compared in: the invisible characters removed, the
 * compatibility forms folded, and the case dropped.
 *
 * NFKC folds the forms — fullwidth, circled, ligatures — that a terminal
 * renders as the plain characters they stand for, and lowercasing covers the
 * pair a case-insensitive filesystem would also confuse. The invisible
 * characters go first because NFKC keeps them: a zero-width space between two
 * letters survives normalization while showing nothing at all.
 */
function displayFormOf(name: string): string {
  return stripInvisibleCharacters(name).normalize("NFKC").toLowerCase();
}

/**
 * The scripts a name mixes, or `undefined` when the mixture is an ordinary one.
 *
 * A name written in a single script is never reported, and neither is one of
 * the everyday multi-script combinations. What is left is the shape a homograph
 * takes: `good` spelled with two Cyrillic o (U+043E) reads as the Latin word
 * but carries both scripts, so the mixture is visible even though the two names
 * are not side by side to compare.
 */
export function mixedScriptsOf(name: string): string[] | undefined {
  const scripts = new Set<string>();
  for (const character of name) {
    const script = scriptOf(character);
    if (script !== undefined) {
      scripts.add(script);
    }
  }
  if (scripts.size <= 1) {
    return undefined;
  }
  const found = [...scripts].toSorted();
  if (ORDINARY_SCRIPT_SETS.some((ordinary) => found.every((script) => ordinary.includes(script)))) {
    return undefined;
  }
  return found;
}

/**
 * Whether two names are the same name with some of its characters swapped for
 * characters of another script.
 *
 * This is the case the mixture check above cannot see: a name spelled entirely
 * in Cyrillic — `copy` with each of its four letters swapped for the Cyrillic
 * letter drawn the same way — is a single script, so it is not a mixture,
 * and no normalization folds it onto its Latin twin. Set against the twin it
 * imitates, though, it is unmistakable: same length, and every position the two
 * disagree on holds characters of two different scripts. A name that differs
 * from another in its own script (`skill-a` and `skill-b`) never matches.
 */
function differsOnlyByScript(left: string, right: string): boolean {
  const leftCharacters = [...left];
  const rightCharacters = [...right];
  if (leftCharacters.length !== rightCharacters.length) {
    return false;
  }
  let differences = 0;
  for (const [index, leftCharacter] of leftCharacters.entries()) {
    const rightCharacter = rightCharacters[index];
    if (rightCharacter === undefined || leftCharacter === rightCharacter) {
      continue;
    }
    differences++;
    const leftScript = scriptOf(leftCharacter);
    const rightScript = scriptOf(rightCharacter);
    if (leftScript === undefined || rightScript === undefined || leftScript === rightScript) {
      return false;
    }
  }
  return differences > 0;
}

/**
 * Note, per name, why it may not be told apart from another name on sight.
 *
 * This is display-only: it never removes a name from a list or changes what a
 * name stands for. Two directories whose names differ only in code points the
 * terminal draws the same way are still two separate entries, so a selection
 * still writes exactly what was picked — the note is there so the picker can
 * tell that two entries which look identical are not.
 *
 * Three things are reported: two names that normalize to the same display form,
 * two names that differ only in which script their characters come from, and a
 * single name that mixes scripts it has no ordinary reason to. None of the
 * three is a complete answer — a hand-picked pair of unrelated-looking names
 * from one script escapes all of them — so the note is a prompt to look closer,
 * not a guarantee that unmarked entries are distinct.
 *
 * Names absent from the returned map carry no note. Duplicates in `names` are
 * folded first, so a list that repeats a name does not report that name as
 * colliding with itself.
 */
export function describeConfusableNames(names: string[]): Map<string, string> {
  const uniqueNames = [...new Set(names)];
  const displayForms = new Map(uniqueNames.map((name) => [name, displayFormOf(name)]));
  const sharedDisplayForms = new Set<string>();
  const seenDisplayForms = new Set<string>();
  for (const displayForm of displayForms.values()) {
    if (seenDisplayForms.has(displayForm)) {
      sharedDisplayForms.add(displayForm);
    }
    seenDisplayForms.add(displayForm);
  }

  const scriptTwins = new Set<string>();
  for (const [index, name] of uniqueNames.entries()) {
    for (const other of uniqueNames.slice(index + 1)) {
      // Compared in display form so that case and compatibility differences do
      // not hide the swap: a capitalized name against an all-Cyrillic spelling
      // of its lowercase form is the same attempt.
      if (differsOnlyByScript(displayForms.get(name) ?? name, displayForms.get(other) ?? other)) {
        scriptTwins.add(name);
        scriptTwins.add(other);
      }
    }
  }

  const notes = new Map<string, string>();
  for (const name of uniqueNames) {
    const reasons: string[] = [];
    if (sharedDisplayForms.has(displayForms.get(name) ?? name)) {
      reasons.push("another entry has the same display form");
    }
    if (scriptTwins.has(name)) {
      reasons.push("another entry is the same name in a different script");
    }
    const mixedScripts = mixedScriptsOf(name);
    if (mixedScripts !== undefined) {
      reasons.push(`mixes characters from ${formatScriptList(mixedScripts)}`);
    }
    if (reasons.length > 0) {
      notes.set(name, reasons.join("; "));
    }
  }
  return notes;
}
