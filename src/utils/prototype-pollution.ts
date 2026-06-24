/**
 * Keys that, if walked into when constructing or merging objects from
 * untrusted input, can mutate `Object.prototype` (or otherwise the prototype
 * chain) and propagate state to every other object in the runtime. Any code
 * that copies arbitrary user-supplied keys into a fresh object — frontmatter
 * parsing, MCP config conversion, settings round-trip — should skip these.
 */
export const PROTOTYPE_POLLUTION_KEYS: ReadonlySet<string> = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

export function isPrototypePollutionKey(key: string): boolean {
  return PROTOTYPE_POLLUTION_KEYS.has(key);
}

/**
 * Returns a shallow copy of a record's own entries with every
 * prototype-pollution key (`__proto__`, `constructor`, `prototype`) dropped.
 *
 * Use when copying a nested, user-supplied string map — an MCP server's `env`
 * or `headers` table — into freshly generated config. Carrying such a map by
 * reference, or re-assigning its keys via bracket notation, would let a literal
 * `__proto__` key ride along (and re-assigning it would mutate the target's
 * prototype). Walking the entries through this helper severs that path while
 * preserving every legitimate key.
 */
export function omitPrototypePollutionKeys(
  record: Record<string, unknown>,
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(key)) continue;
    sanitized[key] = value;
  }
  return sanitized;
}
