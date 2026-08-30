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
    return text;
  }
  const cut = [...text].slice(0, maxLength).join("");
  // An escape `JSON.stringify` produced ends the cut with an odd run of
  // backslashes; drop the unpaired one so the tail cannot read as an escape.
  const trailingBackslashes = /\\*$/.exec(cut)?.[0].length ?? 0;
  const kept = trailingBackslashes % 2 === 0 ? cut : cut.slice(0, -1);
  return `${kept}${suffix}`;
}
