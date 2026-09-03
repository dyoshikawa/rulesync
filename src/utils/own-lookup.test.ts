import { describe, expect, it } from "vitest";

import { lookupOwn } from "./own-lookup.js";

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
