import { describe, expect, it } from "vitest";

import { compileGlob, globToAnchoredRegexSource, globsIntersect, matchesGlob } from "./glob.js";

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
    // A `]` in the first position is a member, not the terminator — which is
    // what leaves at most one `]` behind an unclosed bracket, and so lets the
    // parser stop looking for a closing one after the first failure.
    expect(matchesGlob("git-[]a]", "git-]")).toBe(true);
    expect(matchesGlob("git-[a[b", "git-[a[b")).toBe(true);
  });

  it("should stay linear on a pattern that never closes a bracket", () => {
    // Scanning to the end again for every `[` would be quadratic, and a pattern
    // this shape can come from a file a repository carries.
    expect(matchesGlob("[".repeat(50_000), "a")).toBe(false);
  });

  it("should stay linear on the pattern a regex chokes on", () => {
    // `^.*a.*a.*a…b$` against a long name of `a`s takes minutes; walking the
    // steps cannot backtrack that way, and both sides of this comparison come
    // from a file a repository can carry.
    const glob = `${"*a".repeat(24)}X`;
    expect(matchesGlob(glob, "a".repeat(120))).toBe(false);
  });
});

describe("compileGlob", () => {
  it("parses once and answers for every name", () => {
    const matchesCompiled = compileGlob("git-*");

    expect(matchesCompiled("git-a")).toBe(true);
    expect(matchesCompiled("npm")).toBe(false);
  });
});

describe("globsIntersect", () => {
  it("finds the commands two crossing patterns share", () => {
    // Neither pattern's text matches the other, yet `git push --force` matches
    // both — the pair a coverage test misses.
    expect(globsIntersect("* --force", "git *")).toBe(true);
    expect(globsIntersect("*sudo*", "bash -c *")).toBe(true);
  });

  it("sees a wider pattern from either side", () => {
    expect(globsIntersect("*", "git *")).toBe(true);
    expect(globsIntersect("npm *", "npm publish")).toBe(true);
    expect(globsIntersect("npm publish", "npm *")).toBe(true);
  });

  it("says no when nothing matches both", () => {
    expect(globsIntersect("npm publish", "git *")).toBe(false);
    expect(globsIntersect("secrets/**", "git *")).toBe(false);
    expect(globsIntersect("rm -rf *", "git status")).toBe(false);
  });

  it("lets a star stand for nothing at all", () => {
    expect(globsIntersect("a*b", "ab")).toBe(true);
    expect(globsIntersect("*", "")).toBe(true);
    expect(globsIntersect("", "a")).toBe(false);
  });

  it("reads `?` and `[...]` as the characters they admit", () => {
    expect(globsIntersect("rm -?", "rm -r")).toBe(true);
    expect(globsIntersect("rm -[rf]", "rm -r")).toBe(true);
    expect(globsIntersect("rm -[rf]", "rm -x")).toBe(false);
    // Two classes are assumed to overlap rather than expanded, which
    // over-reports rather than missing a restriction.
    expect(globsIntersect("rm -[rf]", "rm -[x]")).toBe(true);
  });

  it("stays fast on the patterns that make a regex blow up", () => {
    const start = performance.now();
    // Two patterns that must end on different characters share nothing, and
    // the answer comes from a table rather than from backtracking.
    expect(globsIntersect("*a*a*a*a*a*a*a*a*b", "*a*a*a*a*a*a*a*a*c")).toBe(false);
    expect(globsIntersect("*a*a*a*a*a*a*a*a*b", "*a*a*a*a*a*a*a*a*b*")).toBe(true);
    expect(performance.now() - start).toBeLessThan(1000);
  });
});
