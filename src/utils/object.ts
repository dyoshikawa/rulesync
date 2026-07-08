/**
 * Return a shallow copy of `obj` keeping only the entries whose value is
 * neither `undefined` nor `null`.
 *
 * Used to assemble generated config objects without one conditional spread per
 * optional field (which would otherwise exceed the lint complexity budget).
 */
export function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined && value !== null) {
      result[key] = value;
    }
  }
  return result as Partial<T>;
}
