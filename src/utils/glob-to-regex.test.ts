import { describe, expect, it } from "vitest";

import { globToAnchoredRegexSource } from "./glob-to-regex.js";

const matches = (glob: string, value: string): boolean =>
  new RegExp(globToAnchoredRegexSource(glob)).test(value);

describe("globToAnchoredRegexSource", () => {
  it("should anchor at both ends", () => {
    expect(globToAnchoredRegexSource("npm")).toBe("^npm$");
    expect(matches("npm", "npm run build")).toBe(false);
  });

  it("should translate the two glob wildcards", () => {
    expect(matches("npm*", "npm")).toBe(true);
    expect(matches("npm*", "npm-check")).toBe(true);
    expect(matches("gi?", "git")).toBe(true);
    expect(matches("gi?", "gits")).toBe(false);
  });

  it("should match every other metacharacter literally", () => {
    // Without escaping, `.` and `+` would widen the pattern instead of naming
    // the one command the author wrote.
    expect(matches("a.b", "axb")).toBe(false);
    expect(matches("a.b", "a.b")).toBe(true);
    expect(matches("g++", "g++")).toBe(true);
    expect(matches("g++", "g")).toBe(false);
  });
});
