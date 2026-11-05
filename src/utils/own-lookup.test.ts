import { describe, expect, it } from "vite-plus/test";

import { getOrCreateOwn, invertRecord, lookupOwn } from "./own-lookup.js";

describe("lookupOwn", () => {
  const record: Record<string, string> = { PreToolUse: "preToolUse" };

  it("returns the value of an own key", () => {
    expect(lookupOwn({ record, key: "PreToolUse" })).toBe("preToolUse");
  });

  it("returns undefined for a key the record does not define", () => {
    expect(lookupOwn({ record, key: "Unknown" })).toBeUndefined();
  });

  it.each(["toString", "valueOf", "hasOwnProperty", "constructor", "__proto__"])(
    "does not resolve the inherited member %s",
    (key) => {
      expect(lookupOwn({ record, key })).toBeUndefined();
    },
  );
});

describe("getOrCreateOwn", () => {
  it("returns the existing value of an own key without calling create", () => {
    const existing = { a: "allow" };
    const record: Record<string, Record<string, string>> = { bash: existing };
    expect(
      getOrCreateOwn({
        record,
        key: "bash",
        create: () => {
          throw new Error("create must not run");
        },
      }),
    ).toBe(existing);
  });

  it.each(["toString", "valueOf", "hasOwnProperty"])(
    "stores a fresh value under the inherited member name %s",
    (key) => {
      const record: Record<string, Record<string, string>> = {};
      const bucket = getOrCreateOwn({ record, key, create: () => ({}) });
      bucket["*"] = "allow";
      expect(Object.hasOwn(record, key)).toBe(true);
      expect(record[key]).toEqual({ "*": "allow" });
      expect(Object.hasOwn(Object.prototype[key as keyof object] as object, "*")).toBe(false);
    },
  );
});

describe("invertRecord", () => {
  it("swaps keys and values", () => {
    expect(invertRecord({ Bash: "RunCommand", Read: "read" })).toEqual({
      RunCommand: "Bash",
      read: "Read",
    });
  });

  it("keeps the later key when two keys share a value", () => {
    expect(invertRecord({ first: "same", second: "same" })).toEqual({ same: "second" });
  });
});
