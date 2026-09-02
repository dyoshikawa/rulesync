import { describe, expect, it } from "vitest";

import { getGlobsStaticPrefix, getGlobStaticPrefix } from "./glob-static-prefix.js";

describe("getGlobStaticPrefix", () => {
  it.each([
    ["path/to/*", "path/to"],
    ["packages/api/**/*", "packages/api"],
    ["packages/api/**/*.ts", "packages/api"],
    ["packages/api/**", "packages/api"],
    ["packages/api/src/**/*.{ts,tsx}", "packages/api/src"],
    ["packages/api/", "packages/api"],
    ["packages/api/README.md", "packages/api"],
    // A wildcard-free final segment is read as a file name, not a directory:
    // a directory is spelled `packages/api/**`.
    ["packages/api", "packages"],
    ["./packages/api/**/*", "packages/api"],
    ["././packages/api/**/*", "packages/api"],
    ["packages/./api/**/*", "packages/api"],
    [".github/workflows/*.yml", ".github/workflows"],
    ["packages/api/*/src/**", "packages/api"],
    ["packages/api/[ab]/**", "packages/api"],
    ["packages/api/file?.ts", "packages/api"],
    ["packages/api/+(a|b)/**", "packages/api"],
    ["packages/{api,web}/**", "packages"],
  ])("derives the static directory prefix of %s", (glob, expected) => {
    expect(getGlobStaticPrefix(glob)).toBe(expected);
  });

  it.each([
    ["**/*.ts"],
    ["*.md"],
    ["**"],
    ["*"],
    [""],
    ["README.md"],
    ["./"],
    ["."],
    ["./README.md"],
    ["{a,b}/**"],
    ["{packages/api,packages/web}/**"],
    ["!packages/api/**"],
    ["/packages/api/**"],
    ["C:/packages/api/**"],
    ["c:\\packages\\api\\**"],
    ["packages\\api\\**"],
    ["../packages/api/**"],
    ["packages/../api/**"],
    ["packages/api/**/../*"],
    ["..//**"],
  ])("yields nothing for %s", (glob) => {
    expect(getGlobStaticPrefix(glob)).toBeUndefined();
  });

  it("returns a POSIX path regardless of platform", () => {
    expect(getGlobStaticPrefix("a/b/c/**")).toBe("a/b/c");
  });

  it("handles a pattern with hundreds of thousands of segments", () => {
    // Spreading the segments into a variadic call would throw a RangeError.
    const segments = 200_000;
    const prefix = getGlobStaticPrefix(`${"a/".repeat(segments)}**`);

    expect(typeof prefix).toBe("string");
    expect(prefix).toBe(Array.from({ length: segments }, () => "a").join("/"));
  });
});

describe("getGlobsStaticPrefix", () => {
  it("derives the shared prefix when every glob names the same directory", () => {
    expect(getGlobsStaticPrefix(["packages/api/**/*.ts", "packages/api/**/*.tsx"])).toBe(
      "packages/api",
    );
    expect(getGlobsStaticPrefix(["packages/api/*", "./packages/api/**"])).toBe("packages/api");
  });

  it("derives from a single glob", () => {
    expect(getGlobsStaticPrefix(["path/to/*"])).toBe("path/to");
  });

  it("yields nothing for an empty list", () => {
    expect(getGlobsStaticPrefix([])).toBeUndefined();
  });

  it("yields nothing when the globs name different directories", () => {
    expect(getGlobsStaticPrefix(["packages/api/**", "packages/web/**"])).toBeUndefined();
    // No common-ancestor fallback: the author never named `packages`.
    expect(getGlobsStaticPrefix(["packages/api/**", "packages/api/src/**"])).toBeUndefined();
  });

  it("yields nothing when any glob has no static prefix", () => {
    expect(getGlobsStaticPrefix(["packages/api/**", "**/*.md"])).toBeUndefined();
    expect(getGlobsStaticPrefix(["packages/api/**", "!packages/api/**/*.test.ts"])).toBeUndefined();
  });
});
