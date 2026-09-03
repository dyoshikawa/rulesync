/**
 * Matches C0 controls, DEL, the C1 range (which includes the 8-bit CSI
 * introducer U+009B), the bidirectional overrides and isolates, the Unicode
 * line and paragraph separators, and the plain LRM/RLM/ALM marks. A name or
 * value copied out of an untrusted config file, a fetched repository, or a
 * tool's own settings file must never reach the terminal with these intact:
 * they let the text forge log lines, reorder what is printed around them, or
 * inject escape sequences. LRM, RLM and the Arabic letter mark open no bidi
 * scope of their own, but they still reorder the neutral characters beside
 * them, so they go too — a diagnostic line is not the place to preserve the
 * typography of a right-to-left name.
 */
const CONTROL_CHARACTERS_PATTERN =
  // oxlint-disable-next-line no-control-regex
  /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069\u2028\u2029]/g;

/**
 * Removes every control character from `text` so it is safe to splice into a
 * log line or other terminal output.
 */
export function stripControlCharacters(text: string): string {
  return text.replace(CONTROL_CHARACTERS_PATTERN, "");
}

/**
 * Strips the control characters from `text` and then JSON-quotes it, which is
 * the form a remote-derived name — a fetched path, a directory name read off
 * the disk, a branch name chosen by a remote repository — takes in a log line.
 *
 * The two steps do different jobs, and neither is enough on its own. The
 * quoting delimits the untrusted text, so a reader can tell where the name
 * ends and the diagnostic resumes, and it escapes the quotes and backslashes
 * that would blur that edge. But `JSON.stringify` escapes the C0 controls and
 * nothing else: the C1 range, the 8-bit CSI introducer among it, and the bidi
 * overrides pass through it intact, and any one of them reaches the terminal
 * with its power to forge a line or reorder one. The strip is what takes those
 * out. It runs first so that the quoting sees only printable text and the line
 * carries no escaped control characters the reader has to decode — what could
 * do harm is gone rather than spelled out — and so that the rationale for the
 * order lives here, once, rather than at every call site.
 */
export function quoteForLog(text: string): string {
  return JSON.stringify(stripControlCharacters(text));
}

/**
 * Removes every control character from `text` except the line feed, so a
 * message written to be read over several lines still is.
 *
 * `stripControlCharacters` takes newlines out because a diagnostic is one line
 * and a name that carries one can forge a second. An error message is not: a
 * lock file names the process holding it over several lines, and the MCP
 * `generate` failure lists one unreadable source per line. The carriage return
 * still goes, since on its own it paints over the line already written — which
 * is why this splits on the line feed and strips each line rather than carrying
 * a second character class that has to be kept in step with the first.
 */
export function stripControlCharactersKeepingLineFeeds(text: string): string {
  return text.split("\n").map(stripControlCharacters).join("\n");
}

/**
 * Matches the characters that take no width of their own.
 *
 * `Default_Ignorable_Code_Point` is the Unicode property for exactly this — the
 * zero-width joiners, the soft hyphen, the variation selectors, the Hangul
 * fillers, the tag characters — and the format category `Cf` covers the few
 * that sit outside it, such as the interlinear annotation marks. Both are used
 * rather than a list of ranges because a list has to be revisited every time
 * Unicode adds one, and the one that is missed is the one an attacker reaches
 * for: U+3164 HANGUL FILLER, the classic of the homograph domain names, is a
 * letter of the Hangul script and would pass every check aimed at Latin.
 *
 * The braille blank is named on its own. It carries no dots, so it draws as
 * nothing while belonging to neither set.
 *
 * None of these is a control character, so none is caught by
 * `stripControlCharacters` — and none of them shows. A name that differs from
 * another only by one of these is drawn exactly like it, which is why a name
 * that carries one is not a name a user can be asked to judge.
 */
const INVISIBLE_CHARACTERS_PATTERN = /[\p{Default_Ignorable_Code_Point}\p{Cf}\u2800]/gu;

/**
 * Removes every zero-width and otherwise invisible character from `text`.
 *
 * Kept apart from `stripControlCharacters` because the two answer different
 * questions. That one asks what is safe to print; this one asks whether a name
 * shows everything it contains, which is what a prompt needs before it offers
 * the name as something to pick.
 */
export function stripInvisibleCharacters(text: string): string {
  return text.replace(INVISIBLE_CHARACTERS_PATTERN, "");
}

/**
 * Removes every character that does not show: the control characters and the
 * invisible ones alike.
 *
 * This is the form a name has to survive unchanged before it can be offered as
 * something to choose. Callers that need the whole answer should reach for this
 * rather than composing the two strippers themselves, so that the order — and
 * the definition of "hidden" — lives in one place.
 */
export function stripHiddenCharacters(text: string): string {
  return stripInvisibleCharacters(stripControlCharacters(text));
}

/**
 * The invisible characters that do a job in some scripts rather than only
 * hiding: the two zero-width joiners and the variation selectors.
 *
 * A Persian or Indic name spells a word with ZWNJ (U+200C) in it, and an emoji
 * name is a chain of ZWJ (U+200D) and variation selectors. Refusing those
 * outright would refuse names that are written the only way their script writes
 * them, so they are judged by where they sit rather than by what they are.
 */
// Written as alternatives rather than one class: a class holding a joiner and a
// variation selector side by side is the very shape `no-misleading-character-class`
// exists to catch, and here they are listed one by one on purpose.
const ZERO_WIDTH_JOINER_PATTERN = /\u200c|\u200d/u;
const VARIATION_SELECTOR_PATTERN = /[\u{fe00}-\u{fe0f}]|[\u{e0100}-\u{e01ef}]/u;

/** The twelve characters a keycap can be built on, per ED-14 of UTS #51. */
const KEYCAP_BASE_PATTERN = /[0-9#*]/u;
/** The selector that asks for the emoji form of the character before it. */
const EMOJI_PRESENTATION_SELECTOR = "\u{fe0f}";
/** U+20E3, which draws the box the base and the selector go inside. */
const COMBINING_ENCLOSING_KEYCAP = "\u{20e3}";

/**
 * Whether the three characters are an emoji keycap, spelled as UTS #51 spells
 * it: `Emoji_Keycap_Sequence := [0-9#*] FE0F 20E3`.
 *
 * The twelve bases are the only ASCII characters Unicode gives the `Emoji`
 * property to, and not one of them is a pictograph — `1` is a digit and `#` is
 * punctuation — so the joining list below cannot see the sequence, and a
 * directory named `1\u{fe0f}\u{20e3}` would be turned away as a digit padded
 * with a variation selector. It is not padding: the selector is what asks for
 * the emoji form of the digit, and the enclosing keycap behind it is what draws
 * the box around it. Both neighbors are required, which is what keeps the
 * exception to the sequence rather than handing it to every digit in every
 * name: `pdf1` with a variation selector and no keycap after it is padding
 * still, and is refused still.
 *
 * @see https://www.unicode.org/reports/tr51/#def_emoji_keycap_sequence
 */
function isKeycapSequence(params: {
  base: string | undefined;
  selector: string;
  following: string | undefined;
}): boolean {
  const { base, selector, following } = params;
  return (
    base !== undefined &&
    KEYCAP_BASE_PATTERN.test(base) &&
    selector === EMOJI_PRESENTATION_SELECTOR &&
    following === COMBINING_ENCLOSING_KEYCAP
  );
}

/**
 * The characters a joiner has work to do beside: the scripts whose words are
 * written with one, and the pictographs an emoji sequence is built from.
 *
 * A list of what may join rather than of what may not, because the two are not
 * the same size. `pdf` with a ZWNJ between the d and the f is `pdf` on screen
 * and a different directory underneath, and the same is true of `設定` with a
 * ZWJ after the first character: neither Latin nor Han joins anything that way,
 * and nor does Cyrillic, Greek, Hangul or kana. Naming the scripts that do —
 * the Arabic family, the Indic ones, Mongolian, and the pictographs — is what
 * keeps the exception to the names that need it, instead of handing it to every
 * writing system that is merely not Latin.
 */
const JOINING_CONTEXT_PATTERN =
  /[\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Mongolian}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Gurmukhi}\p{Script=Gujarati}\p{Script=Oriya}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Kannada}\p{Script=Malayalam}\p{Script=Sinhala}\p{Script=Myanmar}\p{Script=Khmer}\p{Script=Tibetan}\p{Script=Adlam}\p{Extended_Pictographic}]/u;

/** Non-global copies, because `test` on a global regex carries state between calls. */
const CONTROL_CHARACTER_PATTERN = new RegExp(CONTROL_CHARACTERS_PATTERN.source, "u");
const INVISIBLE_CHARACTER_PATTERN = new RegExp(INVISIBLE_CHARACTERS_PATTERN.source, "u");

/**
 * Whether `text` carries a hidden character that is there to hide something.
 *
 * This is the question a name has to answer before it can be offered as
 * something to pick, and it is a narrower one than `stripHiddenCharacters`
 * answers. Every control character counts, and so does every invisible
 * character — except a joiner or variation selector standing where its own
 * script would put one, which is to say beside a character from a script that
 * is written with joiners, or beside a pictograph.
 *
 * A joiner is held to both of its neighbors, since it exists to bind two
 * characters and a name that ends in one is binding nothing: `設定` with a ZWJ
 * after it is `設定` on screen and a second directory underneath. A variation
 * selector is held only to the character before it, which is the one it selects
 * a form for, and which is why an emoji name may end in one.
 *
 * The keycap sequence is the one emoji the joining list cannot recognize on its
 * own, since what it is built on is a digit or an ASCII sign rather than a
 * pictograph, so it is matched whole instead.
 *
 * Han is not on the joining list, so an ideographic variation sequence — a Han
 * character followed by one of U+E0100 onward — is refused along with the rest.
 * That is the intended trade: no skill directory here is named with one, and
 * the pair is drawn as the bare character on every terminal that has no font
 * for the variant, which is the shape the check exists to refuse.
 *
 * The test is a heuristic in place of the CONTEXTJ joining rules of IDNA,
 * which decide the same question by the joining type of the characters around
 * the joiner. It errs toward accepting a name written in a script that needs
 * these characters, and toward rejecting one that mixes them into Latin, where
 * they can only be padding.
 */
export function hasDeceptiveHiddenCharacters(text: string): boolean {
  const characters = [...text];
  const joinsCharacter = (neighbor: string | undefined): boolean =>
    neighbor !== undefined && JOINING_CONTEXT_PATTERN.test(neighbor);
  return characters.some((character, index) => {
    if (CONTROL_CHARACTER_PATTERN.test(character)) {
      return true;
    }
    if (!INVISIBLE_CHARACTER_PATTERN.test(character)) {
      return false;
    }
    if (VARIATION_SELECTOR_PATTERN.test(character)) {
      if (
        isKeycapSequence({
          base: characters[index - 1],
          selector: character,
          following: characters[index + 1],
        })
      ) {
        return false;
      }
      return !joinsCharacter(characters[index - 1]);
    }
    if (!ZERO_WIDTH_JOINER_PATTERN.test(character)) {
      return true;
    }
    return !joinsCharacter(characters[index - 1]) || !joinsCharacter(characters[index + 1]);
  });
}

/** A mark that draws around the character before it — a circle, a square, a keycap box. */
const ENCLOSING_MARK_PATTERN = /\p{Me}/u;

/**
 * Whether `text` carries an enclosing mark that is not the keycap of an emoji
 * keycap sequence.
 *
 * An enclosing mark (`\p{Me}`: U+20DD COMBINING ENCLOSING CIRCLE, U+20E3
 * COMBINING ENCLOSING KEYCAP, the Cyrillic and Vedic ones) is drawn over the
 * character before it and takes no column of its own, so `pdf` with one after
 * it occupies the three columns of `pdf` and is a fourth directory underneath.
 * Unlike a joiner or a variation selector it is not invisible — the box is
 * drawn — which is why `hasDeceptiveHiddenCharacters` does not refuse it and
 * why it is a question for the confusable-name note instead: the row is drawn,
 * only not the way its name reads. The one place an enclosing mark belongs in
 * a name is the keycap sequence of UTS #51, which `isKeycapSequence` matches
 * whole; every other one is left over.
 *
 * Restricted to `\p{Me}` on purpose: a non-spacing mark (`\p{Mn}`) is how
 * Devanagari, Arabic and Vietnamese write, and folding those would mark
 * ordinary names in every one of them.
 */
export function hasEnclosingMarkOutsideKeycap(text: string): boolean {
  const characters = [...text];
  return characters.some(
    (character, index) =>
      ENCLOSING_MARK_PATTERN.test(character) &&
      !isKeycapSequence({
        base: characters[index - 2],
        selector: characters[index - 1] ?? "",
        following: character,
      }),
  );
}
