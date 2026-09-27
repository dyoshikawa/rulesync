import { describe, expect, it } from "vitest";

import { ClaudecodeArgumentHintSchema, joinArgumentHint } from "./claudecode-argument-hint.js";

describe("joinArgumentHint", () => {
  it("returns a string unchanged", () => {
    expect(joinArgumentHint("[filename] [format]")).toBe("[filename] [format]");
  });

  it("brackets each list entry and joins them with a space", () => {
    expect(joinArgumentHint(["issue-number"])).toBe("[issue-number]");
    expect(joinArgumentHint(["filename", "format"])).toBe("[filename] [format]");
    expect(joinArgumentHint(["pr", 1])).toBe("[pr] [1]");
  });
});

describe("ClaudecodeArgumentHintSchema", () => {
  it("normalizes a YAML list to the bracketed string", () => {
    expect(ClaudecodeArgumentHintSchema.parse(["issue-number"])).toBe("[issue-number]");
  });

  it("rejects values that are neither a string nor a list of scalars", () => {
    expect(ClaudecodeArgumentHintSchema.safeParse({ a: 1 }).success).toBe(false);
    expect(ClaudecodeArgumentHintSchema.safeParse([{ a: 1 }]).success).toBe(false);
    expect(ClaudecodeArgumentHintSchema.safeParse(true).success).toBe(false);
  });
});
