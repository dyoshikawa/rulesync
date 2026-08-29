/**
 * Convert a glob-like pattern into an anchored regex source string.
 *
 * Only `*` (any run of characters) and `?` (one character) carry meaning;
 * every other regex metacharacter is escaped so it matches literally. The
 * result is anchored at both ends, because the callers ask "is this the whole
 * name?" rather than "does this appear somewhere in it?".
 *
 * Shared by the tools that have to compare a canonical glob against a concrete
 * string — AugmentCode writes the regex into its own config, while
 * deepagents-cli uses it to test a rule's executable glob against the names
 * actually written to `allow_list`.
 */
export function globToAnchoredRegexSource(glob: string): string {
  let source = "";
  for (const char of glob) {
    if (char === "*") {
      source += ".*";
    } else if (char === "?") {
      source += ".";
    } else if (/[\\^$.|+(){}[\]]/.test(char)) {
      source += `\\${char}`;
    } else {
      source += char;
    }
  }
  return `^${source}$`;
}
