import { describe, expect, it } from "vitest";

import {
  isPrototypePollutionKey,
  omitPrototypePollutionKeys,
  omitPrototypePollutionKeysDeep,
  PROTOTYPE_POLLUTION_KEYS,
} from "./prototype-pollution.js";

describe("PROTOTYPE_POLLUTION_KEYS", () => {
  it("contains the three prototype-mutating keys", () => {
    expect([...PROTOTYPE_POLLUTION_KEYS].toSorted()).toEqual([
      "__proto__",
      "constructor",
      "prototype",
    ]);
  });
});

describe("isPrototypePollutionKey", () => {
  it("flags prototype-pollution keys", () => {
    expect(isPrototypePollutionKey("__proto__")).toBe(true);
    expect(isPrototypePollutionKey("constructor")).toBe(true);
    expect(isPrototypePollutionKey("prototype")).toBe(true);
  });

  it("passes ordinary keys", () => {
    expect(isPrototypePollutionKey("TOKEN")).toBe(false);
    expect(isPrototypePollutionKey("Authorization")).toBe(false);
  });
});

describe("omitPrototypePollutionKeys", () => {
  it("drops prototype-pollution keys while preserving the rest", () => {
    // Authored as raw JSON text so `__proto__` lands as an own enumerable key
    // (an object literal would set the prototype instead).
    const input = JSON.parse(
      '{"__proto__":"polluted","constructor":"polluted","prototype":"polluted","TOKEN":"safe"}',
    ) as Record<string, unknown>;

    const result = omitPrototypePollutionKeys(input);

    expect(result).toEqual({ TOKEN: "safe" });
    expect(Object.keys(result)).toEqual(["TOKEN"]);
  });

  it("returns a fresh object and leaves an already-clean record's entries intact", () => {
    const input = { A: "1", B: "2" };
    const result = omitPrototypePollutionKeys(input);

    expect(result).toEqual({ A: "1", B: "2" });
    expect(result).not.toBe(input);
  });

  it("returns an empty object for an empty record", () => {
    expect(omitPrototypePollutionKeys({})).toEqual({});
  });
});

describe("omitPrototypePollutionKeysDeep", () => {
  it("drops prototype-pollution keys at every depth, through arrays too", () => {
    const input = JSON.parse(
      '{"__proto__":{"x":1},"keep":{"constructor":{"y":2},"nested":{"prototype":3,"ok":true}},' +
        '"list":[{"__proto__":{"z":4},"a":1},"s",[{"constructor":1}]]}',
    ) as unknown;

    expect(omitPrototypePollutionKeysDeep(input)).toEqual({
      keep: { nested: { ok: true } },
      list: [{ a: 1 }, "s", [{}]],
    });
  });

  it("returns scalars and null as they are and copies a clean object", () => {
    expect(omitPrototypePollutionKeysDeep("s")).toBe("s");
    expect(omitPrototypePollutionKeysDeep(3)).toBe(3);
    expect(omitPrototypePollutionKeysDeep(null)).toBeNull();
    expect(omitPrototypePollutionKeysDeep(undefined)).toBeUndefined();
    const input = { a: [1, { b: "c" }] };
    const result = omitPrototypePollutionKeysDeep(input);
    expect(result).toEqual(input);
    expect(result).not.toBe(input);
  });
});
