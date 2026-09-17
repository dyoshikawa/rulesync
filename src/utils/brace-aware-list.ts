/**
 * Splits a comma-separated pattern list on the commas that separate its
 * entries, leaving the commas inside a brace group alone: in
 * `{src,lib}/**\/*.ts, tests/**\/*.test.ts` the first comma belongs to the
 * brace expansion and the second separates the two globs. Entries are trimmed;
 * empty entries are dropped.
 *
 * @example
 * splitBraceAwareList("src/**\/*.{ts,tsx}, docs/**")
 * // => ["src/**\/*.{ts,tsx}", "docs/**"]
 */
export const splitBraceAwareList = (value: string): string[] => {
  const entries: string[] = [];
  let current = "";
  let braceDepth = 0;
  for (const char of value) {
    if (char === "{") {
      braceDepth += 1;
    } else if (char === "}" && braceDepth > 0) {
      braceDepth -= 1;
    } else if (char === "," && braceDepth === 0) {
      entries.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  entries.push(current);
  return entries.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
};

/**
 * Expands the comma alternations of a glob (`a.{ts,tsx}` → `a.ts`, `a.tsx`)
 * into one pattern per combination, innermost group first, so the result can
 * be handed to a consumer that splits its pattern list on bare commas. A glob
 * without a brace alternation is returned as is; a brace group without a
 * comma (e.g. `{a}`) is left untouched.
 *
 * @example
 * expandBraceAlternations("src/**\/*.{ts,tsx}")
 * // => ["src/**\/*.ts", "src/**\/*.tsx"]
 */
const expandInnermostGroup = (glob: string): string[] => {
  const match = /\{([^{}]*,[^{}]*)\}/.exec(glob);
  if (match === null) {
    return [glob];
  }
  const prefix = glob.slice(0, match.index);
  const suffix = glob.slice(match.index + match[0].length);
  return (match[1] ?? "")
    .split(",")
    .flatMap((alternative) => expandInnermostGroup(`${prefix}${alternative}${suffix}`));
};

export const expandBraceAlternations = (glob: string): string[] => [
  ...new Set(expandInnermostGroup(glob)),
];
