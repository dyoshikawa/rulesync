import { stripHiddenCharacters } from "./control-characters.js";

/**
 * The scripts a name is checked against. A character that belongs to none of
 * them is counted as `Other`, which is deliberately one bucket rather than one
 * per script.
 *
 * Two groups are named. The first is the alphabets that share letter shapes
 * with Latin: Cyrillic and Greek, and the less obvious Armenian, Cherokee,
 * Coptic, Lisu, Canadian Aboriginal Syllabics, Osage, Deseret, Vai and
 * Tifinagh, each of which UTS #39 records as confusable with Latin. Naming them
 * is what keeps them out of the `Other` bucket, where a mixture with Latin
 * counts as ordinary — `rules` with an Osage letter for the r has to be
 * reported, while `rules` with a Thai one is a name in two writing systems and
 * is not.
 *
 * The second group is the scripts the East Asian writing systems are built
 * from, named so that a Japanese, Korean or Chinese name is recognized as the
 * ordinary mixture it is rather than a suspicious one.
 */
const SCRIPT_PATTERNS = [
  ["Latin", /\p{Script=Latin}/u],
  ["Cyrillic", /\p{Script=Cyrillic}/u],
  ["Greek", /\p{Script=Greek}/u],
  ["Armenian", /\p{Script=Armenian}/u],
  ["Cherokee", /\p{Script=Cherokee}/u],
  ["Coptic", /\p{Script=Coptic}/u],
  ["Lisu", /\p{Script=Lisu}/u],
  ["Canadian Aboriginal", /\p{Script=Canadian_Aboriginal}/u],
  ["Osage", /\p{Script=Osage}/u],
  ["Deseret", /\p{Script=Deseret}/u],
  ["Vai", /\p{Script=Vai}/u],
  ["Tifinagh", /\p{Script=Tifinagh}/u],
  ["Han", /\p{Script=Han}/u],
  ["Hiragana", /\p{Script=Hiragana}/u],
  ["Katakana", /\p{Script=Katakana}/u],
  ["Hangul", /\p{Script=Hangul}/u],
  ["Bopomofo", /\p{Script=Bopomofo}/u],
] as const;

/**
 * The Latin letter each non-Latin character is drawn as, for the characters
 * where that is true of nearly every font.
 *
 * This is the confusable table of UTS #39, cut down to the pairs that carry the
 * attack: the Cyrillic and Greek letters that spell Latin words, and the few
 * Armenian ones that join them. Being a table rather than a rule is the point —
 * "different script" alone says nothing about whether two names look alike, and
 * a check built on that marks `rules` against a five-letter Greek word while
 * the two share not one letter shape.
 *
 * The Latin letters that are drawn as other Latin letters belong here too. A
 * name does not have to leave the alphabet to read as another one: `c0py` with
 * a zero, `git` with the script g (U+0261) and `git` with the dotless i are all
 * spelled in characters this project's own names are spelled in.
 *
 * Keyed by the lowercase form, because the names are compared in their display
 * form, which is already lowercased. The pairs that only exist before the case
 * is dropped — a capital I drawn as an l — are in the table below instead.
 */
const LATIN_LOOKALIKES: ReadonlyMap<string, string> = new Map([
  // Cyrillic
  ["а", "a"],
  ["в", "b"],
  ["е", "e"],
  ["к", "k"],
  ["м", "m"],
  ["н", "h"],
  ["о", "o"],
  ["р", "p"],
  ["с", "c"],
  ["т", "t"],
  ["у", "y"],
  ["х", "x"],
  ["ѕ", "s"],
  ["і", "i"],
  ["ј", "j"],
  ["ѵ", "v"],
  ["һ", "h"],
  ["ӏ", "l"],
  ["ԁ", "d"],
  ["ԛ", "q"],
  ["ԝ", "w"],
  ["ү", "y"],
  ["ұ", "y"],
  ["ө", "o"],
  ["ҽ", "e"],
  ["ҫ", "c"],
  ["ҭ", "t"],
  ["ҳ", "x"],
  ["ӽ", "x"],
  ["ԍ", "g"],
  ["ԃ", "d"],
  ["ѡ", "w"],
  // Greek
  ["α", "a"],
  ["β", "b"],
  ["γ", "y"],
  ["ε", "e"],
  ["ζ", "z"],
  ["η", "n"],
  ["ι", "i"],
  ["κ", "k"],
  ["μ", "u"],
  ["ν", "v"],
  ["ο", "o"],
  ["ρ", "p"],
  ["τ", "t"],
  ["υ", "u"],
  ["χ", "x"],
  ["ω", "w"],
  ["ϲ", "c"],
  ["ϱ", "p"],
  ["ϰ", "k"],
  ["ϳ", "j"],
  ["ϵ", "e"],
  ["ϙ", "q"],
  // Armenian
  ["հ", "h"],
  ["յ", "j"],
  ["ո", "n"],
  ["ս", "u"],
  ["ց", "g"],
  ["օ", "o"],
  // Latin, where the lookalike is a letter of the same script as the name it
  // imitates: the phonetic alphabet and the small capitals, neither of which
  // spells an ordinary word.
  ["ɡ", "g"],
  ["ı", "i"],
  ["ɩ", "i"],
  ["ǀ", "l"],
  ["ɑ", "a"],
  ["ɪ", "i"],
  ["ɵ", "o"],
  ["ʏ", "y"],
  ["ᴀ", "a"],
  ["ʙ", "b"],
  ["ᴄ", "c"],
  ["ᴅ", "d"],
  ["ᴇ", "e"],
  ["ɢ", "g"],
  ["ʜ", "h"],
  ["ᴊ", "j"],
  ["ᴋ", "k"],
  ["ʟ", "l"],
  ["ᴍ", "m"],
  ["ɴ", "n"],
  ["ᴏ", "o"],
  ["ᴘ", "p"],
  ["ʀ", "r"],
  ["ᴛ", "t"],
  ["ᴜ", "u"],
  ["ᴠ", "v"],
  ["ᴡ", "w"],
  ["ᴢ", "z"],
]);

/**
 * The characters a Latin letter is drawn as before the case is dropped.
 *
 * A capital I and a lowercase l are one shape in most terminal fonts, and so
 * are a one and an l, and a zero and an o. Lowercasing the name destroys the
 * pairing, since a capital I becomes the letter i rather than the l it is drawn
 * as, so these are folded first, onto the letter the shape is read as.
 */
const CASE_SENSITIVE_LOOKALIKES: ReadonlyMap<string, string> = new Map([
  ["I", "l"],
  ["1", "l"],
  ["0", "o"],
  ["|", "l"],
]);

/** Digits, punctuation and combining marks belong to no script of their own. */
const NO_SCRIPT_PATTERN = /[\p{Script=Common}\p{Script=Inherited}]/u;

/** The one bucket every script the list above does not name is counted in. */
const OTHER_SCRIPT = "Other";

/**
 * Script combinations that are ordinary rather than suspicious, following the
 * augmented script sets of UTS #39: Japanese, Korean and Chinese names each mix
 * several scripts by nature, and all three routinely carry Latin alongside.
 *
 * `Latin` with `Other` is ordinary too. The scripts that share letter shapes
 * with Latin are named above, so what is left in the bucket is mostly Thai,
 * Devanagari, Hebrew and the like, which do not — and a name that mixes Latin
 * with one of the few lookalike scripts the list above misses is still caught
 * by the table check, which does not go through this bucket at all.
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

/** Runs of whitespace, which a terminal draws as one gap however many there are. */
const WHITESPACE_RUN_PATTERN = /\s+/gu;

/**
 * The form a name is compared in: the hidden characters removed, the
 * compatibility forms folded, the whitespace collapsed, and the case dropped.
 *
 * NFKC folds the forms — fullwidth, circled, ligatures — that a terminal
 * renders as the plain characters they stand for, and lowercasing covers the
 * pair a case-insensitive filesystem would also confuse. The hidden characters
 * are stripped on both sides of the normalization because it neither removes
 * them nor leaves them alone: a zero-width space survives it untouched, while
 * U+3164 HANGUL FILLER — invisible — normalizes into U+1160, invisible too. A
 * single strip would miss one of the two. Whitespace is collapsed last, since
 * `pdf` and `pdf ` are one and the same row on screen.
 */
function normalizedFormOf(name: string): string {
  return stripHiddenCharacters(stripHiddenCharacters(name).normalize("NFKC"))
    .replace(WHITESPACE_RUN_PATTERN, " ")
    .trim();
}

function displayFormOf(name: string): string {
  return normalizedFormOf(name).toLowerCase();
}

/**
 * The form of `name` a terminal draws, for callers that need to compare two
 * pieces of text the way a reader would rather than the way `===` does.
 *
 * Exported so that the rule for what counts as the same thing on screen — which
 * hidden characters vanish, which compatibility forms fold together — is
 * decided here and not a second time somewhere else.
 */
export function displayFormOfName(name: string): string {
  return displayFormOf(name);
}

/**
 * Every character that is drawn as a Latin letter replaced by the Latin letter
 * it is drawn as, with the case-sensitive pairs folded before the case is.
 */
function foldLookalikes(text: string): string {
  const cased = [...text]
    .map((character) => CASE_SENSITIVE_LOOKALIKES.get(character) ?? character)
    .join("")
    .toLowerCase();
  return [...cased].map((character) => LATIN_LOOKALIKES.get(character) ?? character).join("");
}

/**
 * The name with every character that is drawn as a Latin letter replaced by the
 * Latin letter it is drawn as.
 *
 * Two names with the same skeleton read the same on screen, whatever scripts
 * they are spelled in. This is the shape of the check UTS #39 describes, with
 * the mapping cut down to the tables above.
 *
 * The fold runs on both sides of the normalization, because the normalization
 * cuts both ways: it is what turns a fullwidth or circled letter into the plain
 * one, and it is also what turns U+03F2 GREEK LUNATE SIGMA SYMBOL — drawn as a
 * c — into a σ that is drawn as nothing of the sort. A fold that ran only after
 * it would lose exactly the shapes it is looking for.
 */
function latinSkeletonOf(name: string): string {
  return foldLookalikes(normalizedFormOf(foldLookalikes(name)));
}

/**
 * The script a name written entirely in Latin lookalikes is really spelled in,
 * or `undefined` when it is not such a name.
 *
 * This is the whole-script confusable of UTS #39, and it is the one shape that
 * neither of the other checks can see: `copy` spelled with four Cyrillic
 * letters is a single script, so it mixes nothing, and with no Latin twin
 * beside it on the list there is nothing to compare it against. Every letter
 * has to be a lookalike for the name to qualify, which is what keeps an
 * ordinary Russian or Greek word — whose letters are mostly not drawn as Latin
 * ones — from being reported.
 */
function scriptReadAsLatinIn(form: string): string | undefined {
  let impostorScript: string | undefined;
  let hasLetters = false;
  for (const character of form) {
    const script = scriptOf(character);
    if (script === undefined) {
      continue;
    }
    hasLetters = true;
    if (script === "Latin") {
      continue;
    }
    if (!LATIN_LOOKALIKES.has(character)) {
      return undefined;
    }
    impostorScript ??= script;
  }
  return hasLetters ? impostorScript : undefined;
}

/**
 * The same question asked of both forms of the name, since the normalization
 * that folds a fullwidth letter onto the plain one also folds some lookalikes
 * onto letters that are not lookalikes at all. A name qualifies when either
 * form is written wholly in letters read as Latin ones.
 */
function scriptReadAsLatin(name: string): string | undefined {
  return (
    scriptReadAsLatinIn(displayFormOf(name)) ??
    scriptReadAsLatinIn(stripHiddenCharacters(name).toLowerCase())
  );
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
 * Four things are reported: two names with the same display form, two names
 * that read the same once the lookalike letters are matched up, a name spelled
 * entirely in letters that read as Latin ones, and a name that mixes scripts it
 * has no ordinary reason to. None of the four is a complete answer — the
 * lookalike tables hold the common pairs rather than all of them, a name
 * written entirely in a script the tables do not map is compared against
 * nothing, and a hand-picked pair of unrelated-looking names from one script
 * escapes every check — so the note is a prompt to look closer, not a guarantee
 * that unmarked entries are distinct.
 *
 * Names absent from the returned map carry no note. Duplicates in `names` are
 * folded first, so a list that repeats a name does not report that name as
 * colliding with itself.
 */
export function describeConfusableNames(names: string[]): Map<string, string> {
  const entries = [...new Set(names)].map((name) => {
    const normalizedForm = normalizedFormOf(name);
    return {
      name,
      displayForm: normalizedForm.toLowerCase(),
      skeleton: latinSkeletonOf(name),
    };
  });

  const displayFormCounts = new Map<string, number>();
  const skeletonCounts = new Map<string, number>();
  for (const entry of entries) {
    displayFormCounts.set(entry.displayForm, (displayFormCounts.get(entry.displayForm) ?? 0) + 1);
    skeletonCounts.set(entry.skeleton, (skeletonCounts.get(entry.skeleton) ?? 0) + 1);
  }

  const notes = new Map<string, string>();
  for (const entry of entries) {
    const reasons: string[] = [];
    const sameDisplayForm = displayFormCounts.get(entry.displayForm) ?? 0;
    if (sameDisplayForm > 1) {
      reasons.push("another entry has the same display form");
    }
    // Counted against the entries that share the display form rather than
    // against one: three names can read alike while only two of them are the
    // same string, and the third is the one worth naming.
    if ((skeletonCounts.get(entry.skeleton) ?? 0) > sameDisplayForm) {
      reasons.push("another entry differs from it only by lookalike letters");
    }
    // The display form is what a reader sees, so it is what the script checks
    // are asked about: a circled or fullwidth letter carries the script of the
    // plain letter it is drawn as.
    const mixedScripts = mixedScriptsOf(entry.displayForm);
    if (mixedScripts === undefined) {
      const impostorScript = scriptReadAsLatin(entry.name);
      if (impostorScript !== undefined) {
        reasons.push(`reads as Latin letters but is written in ${describeScript(impostorScript)}`);
      }
    } else {
      reasons.push(`mixes characters from ${formatScriptList(mixedScripts)}`);
    }
    if (reasons.length > 0) {
      notes.set(entry.name, reasons.join("; "));
    }
  }
  return notes;
}
