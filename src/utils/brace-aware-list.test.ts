import { describe, expect, it } from "vitest";

import { expandBraceAlternations, splitBraceAwareList } from "./brace-aware-list.js";

describe("splitBraceAwareList", () => {
  it("splits on top-level commas only", () => {
    expect(splitBraceAwareList("{src,lib}/**/*.ts, tests/**/*.test.ts")).toEqual([
      "{src,lib}/**/*.ts",
      "tests/**/*.test.ts",
    ]);
  });

  it("keeps nested brace groups intact", () => {
    expect(splitBraceAwareList("a/{b,{c,d}}/*.md,e")).toEqual(["a/{b,{c,d}}/*.md", "e"]);
  });

  it("trims entries and drops empty ones", () => {
    expect(splitBraceAwareList(" a ,, b ,")).toEqual(["a", "b"]);
    expect(splitBraceAwareList("")).toEqual([]);
  });

  it("treats an unbalanced closing brace as a literal", () => {
    expect(splitBraceAwareList("a},b")).toEqual(["a}", "b"]);
  });
});

describe("expandBraceAlternations", () => {
  it("returns a glob without alternations unchanged", () => {
    expect(expandBraceAlternations("src/**/*.ts")).toEqual(["src/**/*.ts"]);
    expect(expandBraceAlternations("{a}/*.ts")).toEqual(["{a}/*.ts"]);
  });

  it("expands a single group", () => {
    expect(expandBraceAlternations("src/**/*.{ts,tsx}")).toEqual(["src/**/*.ts", "src/**/*.tsx"]);
  });

  it("expands several and nested groups into every combination", () => {
    expect(expandBraceAlternations("{src,lib}/*.{ts,js}")).toEqual([
      "src/*.ts",
      "src/*.js",
      "lib/*.ts",
      "lib/*.js",
    ]);
    expect(expandBraceAlternations("a/{b,{c,d}}/*.md")).toEqual([
      "a/b/*.md",
      "a/c/*.md",
      "a/d/*.md",
    ]);
  });
});
