/**
 * Read a key from a plain string map without walking its prototype chain.
 *
 * A bracket read on an object literal resolves inherited members too, so a
 * user-supplied key such as `toString` or `constructor` "succeeds" with an
 * `Object.prototype` function instead of falling through to the caller's
 * `?? fallback`. Hook adapters translate native event names this way from
 * `Object.entries()` over a config file, so route the read through here to keep
 * the fallback honest: only a key the map itself defines yields a value.
 */
export function lookupOwn<V>({
  record,
  key,
}: {
  record: Readonly<Record<string, V>>;
  key: string;
}): V | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}
