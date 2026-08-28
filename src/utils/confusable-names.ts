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

/**
 * Script combinations that are ordinary rather than suspicious, following the
 * augmented script sets of UTS #39: Japanese, Korean and Chinese names each mix
 * several scripts by nature, and all three routinely carry Latin alongside.
 */
const ORDINARY_SCRIPT_SETS: readonly (readonly string[])[] = [
  ["Han", "Hiragana", "Katakana", "Latin"],
  ["Han", "Hangul", "Latin"],
  ["Han", "Bopomofo", "Latin"],
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
  return "Other";
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
 * Note, per name, why it may not be told apart from another name on sight.
 *
 * This is display-only: it never removes a name from a list or changes what a
 * name stands for. Two directories whose names differ only in code points the
 * terminal draws the same way are still two separate entries, so a selection
 * still writes exactly what was picked — the note is there so the picker can
 * tell that two entries which look identical are not.
 *
 * Names absent from the returned map carry no note. Duplicates in `names` are
 * folded first, so a list that repeats a name does not report that name as
 * colliding with itself.
 */
export function describeConfusableNames(names: string[]): Map<string, string> {
  const uniqueNames = [...new Set(names)];
  const byDisplayForm = new Map<string, number>();
  for (const name of uniqueNames) {
    // NFKC folds the compatibility forms — fullwidth, circled, ligatures — that
    // a terminal renders as the plain characters they stand for; lowercasing
    // covers the pair a case-insensitive filesystem would also confuse.
    const displayForm = name.normalize("NFKC").toLowerCase();
    byDisplayForm.set(displayForm, (byDisplayForm.get(displayForm) ?? 0) + 1);
  }

  const notes = new Map<string, string>();
  for (const name of uniqueNames) {
    const reasons: string[] = [];
    if ((byDisplayForm.get(name.normalize("NFKC").toLowerCase()) ?? 0) > 1) {
      reasons.push("another entry has the same display form");
    }
    const mixedScripts = mixedScriptsOf(name);
    if (mixedScripts !== undefined) {
      reasons.push(`mixes ${mixedScripts.join(" and ")} characters`);
    }
    if (reasons.length > 0) {
      notes.set(name, reasons.join("; "));
    }
  }
  return notes;
}
