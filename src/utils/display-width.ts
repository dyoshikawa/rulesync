/**
 * Characters a terminal draws two columns wide: the East Asian Wide and
 * Fullwidth ranges of UAX #11, plus the emoji blocks that are drawn the same
 * way.
 *
 * The ranges are the standard ones rather than a lookup of the full property
 * table, which Unicode revises with every release and which is not worth
 * carrying for the one thing it is used for here — deciding when a label is
 * long enough to wrap. Ambiguous-width characters are counted as one column,
 * which is what a terminal running a Latin font does.
 */
const WIDE_CHARACTERS_PATTERN =
  /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏ꥠ-꥿가-힣豈-﫿︐-︙︰-﹯＀-｠￠-￦]|[\u{17000}-\u{18aff}]|[\u{1f300}-\u{1f9ff}]|[\u{20000}-\u{3fffd}]/u;

/** Combining marks are drawn on top of the character before them, not beside it. */
const ZERO_WIDTH_CHARACTERS_PATTERN = /[\p{Mn}\p{Me}\p{Cf}\p{Default_Ignorable_Code_Point}]/u;

function widthOfCharacter(character: string): number {
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
  for (const character of text) {
    width += widthOfCharacter(character);
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
  const kept: string[] = [];
  for (const character of text) {
    const characterWidth = widthOfCharacter(character);
    if (width + characterWidth > target) {
      break;
    }
    kept.push(character);
    width += characterWidth;
  }
  return `${kept.join("")}…`;
}
