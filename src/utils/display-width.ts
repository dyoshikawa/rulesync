/**
 * Characters a terminal draws two columns wide: the East Asian Wide and
 * Fullwidth ranges of UAX #11, plus the emoji, which are drawn the same way.
 *
 * The emoji are matched by `Emoji_Presentation`, the property for the ones
 * drawn as pictures without being asked to be. That is what reaches the ones
 * living among the ordinary symbols — U+2705 and U+2B50 are two columns each
 * while U+2600, drawn as text unless a selector says otherwise, is one — and
 * a range list would have to name them one by one. The wide symbols that are
 * not emoji at all are named beside it: the angle brackets, the trigrams and
 * digrams, and the hexagrams of U+4DC0–U+4DFF.
 *
 * The ranges are the standard blocks rather than the full `East_Asian_Width`
 * property, because the wide characters sit in blocks and a block is coarse in
 * the safe direction: the whole of U+1F000–U+1FAFF is counted as wide, which
 * overstates the few narrow symbols in it, because overstating a width shortens
 * a label that did not need it while understating one lets a label wrap. That
 * is also why an emoji built from a chain of joiners is counted per component:
 * two columns each rather than the two the whole chain draws.
 *
 * The East Asian Ambiguous class is counted at two columns as well, by the
 * table below this one rather than by these ranges, and that table is the
 * whole of its property: the class is scattered among the Neutral characters
 * rather than gathered in blocks, so a block list over it would either miss
 * members or take in characters that are not wide anywhere. The reason for
 * counting it, and how the table is kept in step with Unicode, is given there.
 *
 * Two of the ranges are here for a narrower reason: a name the skill prompt can
 * offer may not be counted narrower here than the prompt's own renderer counts
 * it, or a label that fits the budget wraps anyway and paints the second row
 * the budget exists to prevent. `@inquirer/core` measures with
 * `fast-string-width`, which takes the whole of `Script=Hangul` as wide and
 * every `Emoji_Modifier_Base` as an emoji. So the Hangul jamo are taken to
 * U+11FF rather than stopping at the leading consonants, and the modifier bases
 * are named beside the emoji: U+261D, U+26F9 and the two hands of U+270C–U+270D
 * are `Emoji` without being `Emoji_Presentation`, and were the only characters
 * outside Hangul this counted at one column while the renderer counted two.
 *
 * The rule is over the names that can reach the prompt, which is a smaller set
 * than the characters that exist. The renderer counts a tab at eight columns and
 * the Hangul fillers at two, where this counts one and none: a name carrying
 * either is refused outright by `hasDeceptiveHiddenCharacters` — the tab as a
 * control character, the fillers as characters that draw as nothing — and never
 * becomes a row to be measured. The two joiners are the invisible characters
 * that check lets through, so they are counted below rather than left to the
 * zero-width rule. Where this is used to lay out text of the tool's own rather
 * than to bound an untrusted name, the difference is a column of alignment and
 * not a forged row.
 *
 * The wide planes are taken whole rather than range by range — Tangut, Khitan
 * and Nushu together are U+17000–U+18DFF, and the kana supplements are
 * U+1AFF0–U+1B2FF — because a gap between two of them is exactly the character
 * a name would be padded with: one that draws two columns and is counted as
 * one.
 *
 * Every range is written as escapes rather than as the characters themselves.
 * A range spelled with literal endpoints reads well and is one normalization
 * away from meaning something else: U+F900, the first compatibility ideograph,
 * is canonically the ordinary ideograph U+8C48, and a range that starts there
 * instead silently swallows thirty thousand code points that are not wide.
 */
const WIDE_CHARACTERS_PATTERN =
  /\p{Emoji_Presentation}|\p{Emoji_Modifier_Base}|[\u2329\u232a\u2630-\u2637\u268a-\u268f\u4dc0-\u4dff]|[\u1100-\u11ff\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\u9fff\ua000-\ua4cf\ua960-\ua97f\uac00-\ud7a3\ud7b0-\ud7fb\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]|[\u{16fe0}-\u{16ff6}]|[\u{17000}-\u{18dff}]|[\u{1aff0}-\u{1b2ff}]|[\u{1f000}-\u{1faff}]|[\u{20000}-\u{3fffd}]/u;

/**
 * The East Asian Ambiguous class of UAX #11: the characters a terminal draws
 * one column wide under a Latin font and two columns wide where it is set to
 * draw the ambiguous class wide, which is a common setting in CJK locales. The
 * box-drawing characters, the geometric shapes, the Greek and Cyrillic
 * alphabets, and the accented letters of the Latin-1 supplement are all here.
 *
 * Counted at two columns, which is the wider of the two answers, because the
 * two ways of being wrong are not the same size. Overstating a width shortens
 * a label that did not need it: a name carrying a Greek letter or an accented
 * letter is cut a little earlier on a Latin terminal than it had to be.
 * Understating one lets a forged row wrap: a name of sixty box-drawing
 * characters and `● pdf-tools` measures 71 columns at one column apiece,
 * inside the prompt's budget, and draws at 132 in a terminal that draws the
 * class wide, so the terminal breaks the row itself and puts `● pdf-tools` at
 * the left margin of a continuation line that carries no pointer and no
 * checkbox.
 *
 * The prompt's own renderer, `fast-string-width`, counts the class at one
 * column and never sees the wrap coming either; the terminal is what breaks
 * the row, and only the budget can keep the row short enough not to be broken.
 *
 * One width model rather than two — a wide one for bounding an untrusted name
 * and a narrow one for laying out the tool's own text — because the second
 * model would buy a column or two of alignment in the tool's own output at the
 * price of two measurements that have to be kept from being confused for each
 * other. Where this is used to lay out text of the tool's own, the cost of the
 * single model is a line cut a little earlier than it needed to be.
 *
 * The ranges are the `East_Asian_Width=A` property of Unicode 17.0, taken from
 * the table `get-east-asian-width` 1.6.0 carries and merged where two are
 * adjacent. The table is written out here rather than read from the package so
 * that the one lookup adds no dependency of its own, and the drift test in
 * `display-width.test.ts` is what keeps it honest: it loads the package through
 * the prompt renderer that already depends on it, walks every code point, and
 * fails when this table and the property disagree in either direction. When
 * the renderer's copy moves to a newer Unicode, that test is what fails, and
 * the table is regenerated from the new property — its ranges, marks aside,
 * merged where adjacent and written as escapes — with the version named here.
 *
 * Three stretches of the property are left out because they never reach this
 * pattern: the combining diacritical marks of U+0300–U+036F and the variation
 * selectors of U+FE00–U+FE0F and U+E0100–U+E01EF are marks by category and are
 * counted by the mark rule before the width of a character is looked up.
 * Leaving them out is also what keeps the class from holding a combining
 * character, which `no-misleading-character-class` is there to catch, and they
 * are the one exception the drift test allows. U+00AD SOFT HYPHEN never reaches
 * this pattern either — it is a format character, and the zero-width rule
 * counts it at nothing first — but it is kept, as the property has it, so that
 * the test holds the table to the property exactly rather than to a list of
 * exceptions. The private use areas are in it, as the property says they are: a
 * name is free to carry them and a terminal is free to draw them wide.
 *
 * Escapes rather than the characters themselves, for the reason given above.
 * Exported for the drift test alone; the width of a string is asked for
 * through `displayWidthOf`.
 */
// cspell:ignore ffffd -- the last code point of the first private use plane
export const AMBIGUOUS_CHARACTERS_PATTERN =
  /[\u00a1\u00a4\u00a7-\u00a8\u00aa\u00ad-\u00ae\u00b0-\u00b4\u00b6-\u00ba\u00bc-\u00bf\u00c6\u00d0\u00d7-\u00d8\u00de-\u00e1\u00e6\u00e8-\u00ea\u00ec-\u00ed\u00f0\u00f2-\u00f3\u00f7-\u00fa\u00fc\u00fe\u0101\u0111\u0113\u011b\u0126-\u0127\u012b\u0131-\u0133\u0138\u013f-\u0142\u0144\u0148-\u014b\u014d\u0152-\u0153\u0166-\u0167\u016b\u01ce\u01d0\u01d2\u01d4\u01d6\u01d8\u01da\u01dc\u0251\u0261\u02c4\u02c7\u02c9-\u02cb\u02cd\u02d0\u02d8-\u02db\u02dd\u02df\u0391-\u03a1\u03a3-\u03a9\u03b1-\u03c1\u03c3-\u03c9\u0401\u0410-\u044f\u0451\u2010\u2013-\u2016\u2018-\u2019\u201c-\u201d\u2020-\u2022\u2024-\u2027\u2030\u2032-\u2033\u2035\u203b\u203e\u2074\u207f\u2081-\u2084\u20ac\u2103\u2105\u2109\u2113\u2116\u2121-\u2122\u2126\u212b\u2153-\u2154\u215b-\u215e\u2160-\u216b\u2170-\u2179\u2189\u2190-\u2199\u21b8-\u21b9\u21d2\u21d4\u21e7\u2200\u2202-\u2203\u2207-\u2208\u220b\u220f\u2211\u2215\u221a\u221d-\u2220\u2223\u2225\u2227-\u222c\u222e\u2234-\u2237\u223c-\u223d\u2248\u224c\u2252\u2260-\u2261\u2264-\u2267\u226a-\u226b\u226e-\u226f\u2282-\u2283\u2286-\u2287\u2295\u2299\u22a5\u22bf\u2312\u2460-\u24e9\u24eb-\u254b\u2550-\u2573\u2580-\u258f\u2592-\u2595\u25a0-\u25a1\u25a3-\u25a9\u25b2-\u25b3\u25b6-\u25b7\u25bc-\u25bd\u25c0-\u25c1\u25c6-\u25c8\u25cb\u25ce-\u25d1\u25e2-\u25e5\u25ef\u2605-\u2606\u2609\u260e-\u260f\u261c\u261e\u2640\u2642\u2660-\u2661\u2663-\u2665\u2667-\u266a\u266c-\u266d\u266f\u269e-\u269f\u26bf\u26c6-\u26cd\u26cf-\u26d3\u26d5-\u26e1\u26e3\u26e8-\u26e9\u26eb-\u26f1\u26f4\u26f6-\u26f9\u26fb-\u26fc\u26fe-\u26ff\u273d\u2776-\u277f\u2b56-\u2b59\u3248-\u324f\ue000-\uf8ff\ufffd\u{1f100}-\u{1f10a}\u{1f110}-\u{1f12d}\u{1f130}-\u{1f169}\u{1f170}-\u{1f18d}\u{1f18f}-\u{1f190}\u{1f19b}-\u{1f1ac}\u{f0000}-\u{ffffd}\u{100000}-\u{10fffd}]/u;

/**
 * U+FE0F VARIATION SELECTOR-16, which takes no width of its own but asks the
 * character before it to be drawn as an emoji — that is, in two columns rather
 * than one. Counting it as a column of its own is how that promotion is paid
 * for without looking behind: `\u2764\ufe0f` then measures the two columns it
 * draws rather than the one the heart alone would.
 */
const EMOJI_PRESENTATION_SELECTOR = "\ufe0f";

/** Combining marks are drawn on top of the character before them, not beside it. */
const COMBINING_MARK_PATTERN = /[\p{Mn}\p{Me}]/u;

/** The characters that take no width at all, marks aside. */
const ZERO_WIDTH_CHARACTERS_PATTERN = /[\p{Cf}\p{Default_Ignorable_Code_Point}]/u;

/**
 * The zero-width joiner and its non-joining twin, which the renderer spends a
 * column on apiece.
 *
 * A terminal draws neither, and every other character that draws as nothing is
 * counted at nothing here. These two are the exception because they are the
 * only invisible characters `hasDeceptiveHiddenCharacters` lets through — a
 * Persian or Indic name spells a word with one, and an emoji is a chain of them
 * — so they are the only ones an attacker can put in a name that reaches the
 * prompt. `fast-string-width`, which is where the prompt's own wrapping is
 * decided, counts each of them as a column, and 40 of them in a name is 40
 * columns of budget this would otherwise hand over for free: enough for a name
 * measured at 39 columns to be drawn at 77 and wrap a forged row underneath
 * itself.
 *
 * The cost is that an emoji built from a chain is overstated by a column per
 * joiner, on top of the two columns per component it is already overstated by.
 * Overstating shortens a label that did not need it; understating lets one
 * wrap.
 */
// Alternatives rather than a class: a class holding two joiners side by side is
// what `no-misleading-character-class` exists to catch.
const RENDERER_COUNTED_JOINERS = /\u200c|\u200d/u;

/**
 * How many marks a single character is allowed to carry for free.
 *
 * A written language stacks two or three at most — a Devanagari vowel sign and
 * a dot below it, a Hebrew point and an accent — so the free ones cover every
 * name that is a name. Past that the marks are not decorating a letter but
 * piling up into the lines above and below it: a name of one letter and three
 * hundred marks measures one column while painting over half the screen.
 * Counting the surplus is what keeps such a name inside the budget.
 */
const FREE_MARKS_PER_CHARACTER = 2;

/**
 * The emoji presentation selector is a mark by category but not by effect: it
 * promotes the character before it to its emoji form, which the terminal draws
 * two columns wide where the plain form took one. Counting the extra column on
 * the selector is what makes the pair add up.
 */
function isCombiningMark(character: string): boolean {
  return character !== EMOJI_PRESENTATION_SELECTOR && COMBINING_MARK_PATTERN.test(character);
}

/**
 * A lone surrogate, which is no character at all: a string can carry one — a
 * `"\ud800"` escape in JSON is enough — and the encoder that writes stdout
 * replaces it with U+FFFD on the way out, so the replacement character is what
 * the terminal draws and what has to be measured. U+FFFD is East Asian
 * Ambiguous, so the difference is a column apiece: 72 of them measured as
 * themselves fit a 72-column budget and are drawn in 144.
 */
const LONE_SURROGATE_PATTERN = /\p{Cs}/u;

/** What the stdout encoder writes in place of a lone surrogate. */
const REPLACEMENT_CHARACTER = "\ufffd";

/**
 * The width of one character, given how many marks already sit on the character
 * before it.
 */
function widthInContext(params: { character: string; precedingMarks: number }): number {
  const { precedingMarks } = params;
  // Measured as what is drawn rather than as what is in the string.
  const character = LONE_SURROGATE_PATTERN.test(params.character)
    ? REPLACEMENT_CHARACTER
    : params.character;
  if (character === EMOJI_PRESENTATION_SELECTOR) {
    return 1;
  }
  if (isCombiningMark(character)) {
    return precedingMarks < FREE_MARKS_PER_CHARACTER ? 0 : 1;
  }
  if (RENDERER_COUNTED_JOINERS.test(character)) {
    return 1;
  }
  if (ZERO_WIDTH_CHARACTERS_PATTERN.test(character)) {
    return 0;
  }
  return WIDE_CHARACTERS_PATTERN.test(character) || AMBIGUOUS_CHARACTERS_PATTERN.test(character)
    ? 2
    : 1;
}

/**
 * How many terminal columns a string occupies.
 *
 * Counting code points instead is what makes a length limit miss its purpose: a
 * name of 66 ideographic spaces is well under a 72-character limit and still
 * draws 132 columns, wrapping across two lines of any ordinary terminal.
 */
export function displayWidthOf(text: string): number {
  let width = 0;
  let marks = 0;
  for (const character of text) {
    width += widthInContext({ character, precedingMarks: marks });
    marks = isCombiningMark(character) ? marks + 1 : 0;
  }
  return width;
}

/** The mark a cut string ends in. */
const SHORTENING_ELLIPSIS = "\u2026";

/**
 * The columns a cut string is drawn in at the very least: what is left when
 * the budget has room for the mark of the cut and nothing before it. Two, since
 * the ellipsis is itself East Asian Ambiguous and is measured the way every
 * other such character is, so that a shortened label is not wider than it was
 * measured to be on the terminal the measurement is for.
 *
 * Exported because a caller composing several shortened pieces into one line
 * has to leave room for it to decide which of them gives way, and the width of
 * the mark is this module's business rather than something to be counted again
 * at the other end. Leaving room for it is not what bounds the line: cutting
 * the composed line is.
 */
export const ELLIPSIS_WIDTH = displayWidthOf(SHORTENING_ELLIPSIS);

/**
 * Cut `text` down to at most `budget` columns, marking the cut with an ellipsis.
 *
 * The ellipsis is paid for out of the budget rather than added on top of it, so
 * a shortened string is never wider than one that was left alone. A budget of
 * zero or less still yields the ellipsis: a row that shows nothing at all is
 * harder to read than one that shows it was cut.
 */
export function shortenToWidth(params: { text: string; budget: number }): string {
  const { text, budget } = params;
  if (displayWidthOf(text) <= budget) {
    return text;
  }
  const target = budget - ELLIPSIS_WIDTH;
  let width = 0;
  let marks = 0;
  const kept: string[] = [];
  for (const character of text) {
    const characterWidth = widthInContext({ character, precedingMarks: marks });
    if (width + characterWidth > target) {
      break;
    }
    kept.push(character);
    width += characterWidth;
    marks = isCombiningMark(character) ? marks + 1 : 0;
  }
  return `${kept.join("")}${SHORTENING_ELLIPSIS}`;
}
