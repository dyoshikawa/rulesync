import { describe, expect, it } from "vite-plus/test";

import { invertRecord, lookupOwn } from "./own-lookup.js";

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
