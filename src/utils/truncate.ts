/**
 * Cut `text` to `maxLength` without splitting a character in half.
 *
 * `String.prototype.slice` counts UTF-16 units, so cutting inside a surrogate
 * pair leaves a lone surrogate that the next encoder turns into a replacement
 * character, and cutting inside a `\uXXXX` escape that `JSON.stringify` wrote
 * leaves a dangling backslash. Diagnostics quote files rulesync did not write,
 * so both are reachable from a repository's own content rather than only from
 * a hand-crafted string.
 */
export function truncateText({
  text,
  maxLength,
  suffix,
}: {
  text: string;
  maxLength: number;
  suffix: string;
}): string {
  if (text.length <= maxLength) {
    // Fewer UTF-16 units than the limit means fewer code points than the limit,
    // so there is nothing to cut and nothing to count.
    return text;
  }
  // Counted in code points rather than UTF-16 units, so the cut below decides
  // the same way this test does: measuring one and cutting by the other both
  // marks a string as truncated that was never cut, and lets a run of astral
  // characters return twice the length the caller asked for.
  //
  // Only the head is spread. A code point takes at most two UTF-16 units, so
  // `maxLength * 2 + 2` units hold more than `maxLength` code points whenever
  // the text has more — which is what makes the test below sound — and a text
  // the size of a minified file is never materialized as an array of its
  // characters just to be cut to sixty of them.
  // `Array.from` rather than a spread so the lint that reads `slice` as an
  // array method has nothing to say; both split the string by code point.
  const characters = Array.from(text.slice(0, maxLength * 2 + 2));
  if (characters.length <= maxLength) {
    return text;
  }
  const cut = characters.slice(0, maxLength).join("");
  // An escape `JSON.stringify` produced ends the cut with an odd run of
  // backslashes; drop the unpaired one so the tail cannot read as an escape.
  const trailingBackslashes = /\\*$/.exec(cut)?.[0].length ?? 0;
  const kept = trailingBackslashes % 2 === 0 ? cut : cut.slice(0, -1);
  return `${kept}${suffix}`;
}
