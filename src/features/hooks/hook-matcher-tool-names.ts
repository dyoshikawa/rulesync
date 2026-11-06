// Splits a matcher regex into escapes (`\S`, `\b`), character classes
// (`[A-Z]`) and whole names. A name is not part of a longer identifier (so
// `mcp__srv__Read` is untouched) but may follow an escape, as in `\bRead\b`.
// Escapes and classes are matched first so their letters are never names.
export const MATCHER_TOKEN_PATTERN =
  /\\.|\[(?:\\.|[^\]\\])*\]|(?<=^|[^\w\\]|\\\w)[A-Za-z_]\w*(?!\w)/gs;

export function isMatcherName(token: string): boolean {
  return !token.startsWith("\\") && !token.startsWith("[");
}

/**
 * The distinct whole names in a matcher that start with a capital letter, for
 * adapters whose runtime tool names are all lowercase: after translation, such
 * a name has no runtime equivalent and can never match.
 */
export function capitalizedMatcherNames(matcher: string): string[] {
  const names = [...matcher.matchAll(MATCHER_TOKEN_PATTERN)]
    .map(([token]) => token)
    .filter((token) => isMatcherName(token) && /^[A-Z]/.test(token));
  return [...new Set(names)];
}

/**
 * Rewrites the whole tool names inside a hook `matcher` regex through `names`,
 * leaving escapes, character classes and unknown names as written. Used by
 * adapters whose runtime tool names differ from the canonical (Claude Code)
 * spelling.
 */
export function replaceMatcherNames(
  matcher: string,
  names: Readonly<Record<string, string>>,
): string {
  return matcher.replace(MATCHER_TOKEN_PATTERN, (token) =>
    isMatcherName(token) && Object.hasOwn(names, token) ? (names[token] ?? token) : token,
  );
}
