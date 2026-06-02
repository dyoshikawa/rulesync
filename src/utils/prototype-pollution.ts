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
