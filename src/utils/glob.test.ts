import { describe, expect, it } from "vitest";

import { globToAnchoredRegexSource, matchesGlob } from "./glob.js";

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

describe("matchesGlob", () => {
  it("should anchor the whole value", () => {
    expect(matchesGlob("npm", "npm")).toBe(true);
    expect(matchesGlob("npm", "npm-check")).toBe(false);
  });

  it("should walk the wildcards", () => {
    expect(matchesGlob("npm*", "npm-check")).toBe(true);
    expect(matchesGlob("*", "anything")).toBe(true);
    expect(matchesGlob("gi?", "git")).toBe(true);
    expect(matchesGlob("gi?", "gits")).toBe(false);
  });

  it("should read a bracket class", () => {
    expect(matchesGlob("git-[abc]", "git-a")).toBe(true);
    expect(matchesGlob("git-[abc]", "git-d")).toBe(false);
    expect(matchesGlob("git-[a-c]", "git-b")).toBe(true);
    expect(matchesGlob("git-[!a-c]", "git-b")).toBe(false);
    expect(matchesGlob("git-[!a-c]", "git-z")).toBe(true);
    // An unclosed bracket is an ordinary character, as in every shell.
    expect(matchesGlob("git-[a", "git-[a")).toBe(true);
  });

  it("should stay linear on the pattern a regex chokes on", () => {
    // `^.*a.*a.*a…b$` against a long name of `a`s takes minutes; walking the
    // steps cannot backtrack that way, and both sides of this comparison come
    // from a file a repository can carry.
    const glob = `${"*a".repeat(24)}X`;
    expect(matchesGlob(glob, "a".repeat(120))).toBe(false);
  });
});
