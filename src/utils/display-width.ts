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
 * The ranges are the standard ones rather than a lookup of the full property
 * table, which Unicode revises with every release and which is not worth
 * carrying for the one thing it is used for here — deciding when a label is
 * long enough to wrap. Where a range is coarse it is coarse in the safe
 * direction: the whole of U+1F000–U+1FAFF is counted as wide, which overstates
 * the few narrow symbols in it, because overstating a width shortens a label
 * that did not need it while understating one lets a label wrap. That is also
 * why an emoji built from a chain of joiners is counted per component: two
 * columns each rather than the two the whole chain draws.
 *
 * Ambiguous-width characters are counted as one column, which is what a
 * terminal running a Latin font does.
 *
 * Two of the ranges are here for a narrower reason: nothing may be counted
 * narrower here than the prompt's own renderer counts it, or a label that fits
 * the budget wraps anyway and paints the second row the budget exists to
 * prevent. `@inquirer/core` measures with `fast-string-width`, which takes the
 * whole of `Script=Hangul` as wide and every `Emoji_Modifier_Base` as an emoji.
 * So the Hangul jamo are taken to U+11FF rather than stopping at the leading
 * consonants, and the modifier bases are named beside the emoji: U+261D, U+26F9
 * and the two hands of U+270C–U+270D are `Emoji` without being
 * `Emoji_Presentation`, and were the only characters outside Hangul this
 * counted at one column while the renderer counted two.
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
 * The width of one character, given how many marks already sit on the character
 * before it.
 */
function widthInContext(params: { character: string; precedingMarks: number }): number {
  const { character, precedingMarks } = params;
  if (character === EMOJI_PRESENTATION_SELECTOR) {
    return 1;
  }
  if (isCombiningMark(character)) {
    return precedingMarks < FREE_MARKS_PER_CHARACTER ? 0 : 1;
  }
  if (ZERO_WIDTH_CHARACTERS_PATTERN.test(character)) {
    return 0;
  }
  return WIDE_CHARACTERS_PATTERN.test(character) ? 2 : 1;
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
  const target = budget - 1;
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
  return `${kept.join("")}…`;
}
