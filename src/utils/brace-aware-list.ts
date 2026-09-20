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
 * Upper bound on the patterns one glob may expand to; past it the glob is
 * returned verbatim, since `{a,b}` repeated k times yields 2^k branches.
 */
const MAX_BRACE_EXPANSIONS = 256;

/** Matches an innermost brace group with at least one comma: `{a,b}`, not `{a}` or `{a,{b,c}}`. */
const INNERMOST_BRACE_GROUP_REGEX = /\{([^{},]*(?:,[^{},]*)+)\}/;

/**
 * Expands the comma alternations of a glob (`a.{ts,tsx}` → `a.ts`, `a.tsx`)
 * into one pattern per combination, innermost group first, so the result can
 * be handed to a consumer that splits its pattern list on bare commas. A glob
 * without a brace alternation is returned as is; a brace group without a
 * comma (e.g. `{a}`) is left untouched. A glob whose expansion would exceed
 * `MAX_BRACE_EXPANSIONS` patterns is returned as is as well.
 *
 * The cap is enforced on the work list itself rather than by counting the
 * groups up front: a nested group such as `{{a,b},c}` is rewritten into one
 * new group per inner alternative, so the number of patterns in flight is the
 * only bound that holds for arbitrary nesting.
 *
 * @example
 * expandBraceAlternations("src/**\/*.{ts,tsx}")
 * // => ["src/**\/*.ts", "src/**\/*.tsx"]
 */
export const expandBraceAlternations = (glob: string): string[] => {
  let pending = [glob];
  for (;;) {
    const next: string[] = [];
    let expanded = false;
    for (const pattern of pending) {
      const match = INNERMOST_BRACE_GROUP_REGEX.exec(pattern);
      if (match === null) {
        next.push(pattern);
        continue;
      }
      expanded = true;
      const prefix = pattern.slice(0, match.index);
      const suffix = pattern.slice(match.index + match[0].length);
      for (const alternative of (match[1] ?? "").split(",")) {
        next.push(`${prefix}${alternative}${suffix}`);
      }
      if (next.length > MAX_BRACE_EXPANSIONS) {
        return [glob];
      }
    }
    if (!expanded) {
      return [...new Set(next)];
    }
    pending = next;
  }
};
