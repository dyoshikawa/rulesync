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

/**
 * Return the value a map holds under its own `key`, first storing `create()`
 * there when it has none. A bracket read would find an inherited member for a
 * key such as `toString`, so an importer bucketing rules by a user-supplied
 * name would write into an `Object.prototype` function instead of a fresh
 * bucket.
 */
export function getOrCreateOwn<V>({
  record,
  key,
  create,
}: {
  record: Record<string, V>;
  key: string;
  create: () => NoInfer<V>;
}): V {
  if (Object.hasOwn(record, key)) {
    return record[key] as V;
  }
  const created = create();
  // A plain assignment of `__proto__` would run the inherited setter and swap
  // the record's prototype instead of adding a key, so define it as data.
  Object.defineProperty(record, key, {
    value: created,
    writable: true,
    enumerable: true,
    configurable: true,
  });
  return created;
}

/**
 * Swap the keys and values of a name map, e.g. a canonical-to-tool map into
 * the tool-to-canonical map an importer reads. When two keys share a value,
 * the later key wins.
 */
export function invertRecord(record: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [value, key]));
}
