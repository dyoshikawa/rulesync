/**
 * Type guard to check if a value is a plain object (Record<string, unknown>).
 * This excludes arrays and null values.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Stricter sibling of {@link isRecord}: narrows to *plain* objects whose
 * prototype is either ``Object.prototype`` or ``null`` — i.e. object
 * literals, ``Object.create(null)`` bags, and the output of ``JSON.parse``.
 *
 * Rejects class instances even though they pass ``isRecord``. This is the
 * check needed for prototype-pollution hardening: anything walking
 * arbitrary user-supplied keys (frontmatter parsing, MCP config
 * conversion, etc.) should reject inputs whose prototype could carry
 * malicious accessor descriptors.
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

/**
 * Type guard to check if a value is an array of strings.
 */
export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
