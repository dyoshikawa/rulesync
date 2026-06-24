import { describe, expect, it } from "vitest";

import {
  isPrototypePollutionKey,
  omitPrototypePollutionKeys,
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
