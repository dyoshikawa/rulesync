import { describe, expect, it } from "vitest";

import { loadYaml } from "./yaml.js";

describe("loadYaml", () => {
  it("returns undefined for an empty string (js-yaml v5 would otherwise throw)", () => {
    expect(loadYaml("")).toBeUndefined();
  });

  it("returns undefined for whitespace-only input", () => {
    expect(loadYaml("   \n\t\n")).toBeUndefined();
  });

  it("returns undefined for a comment-only document", () => {
    expect(loadYaml("# just a comment\n")).toBeUndefined();
  });

  it("parses non-empty YAML into a value", () => {
    expect(loadYaml("foo: bar\nbaz: 1")).toEqual({ foo: "bar", baz: 1 });
  });

  it("parses a scalar document", () => {
    expect(loadYaml("hello")).toBe("hello");
  });

  it("throws on genuinely invalid YAML (not swallowed)", () => {
    expect(() => loadYaml("foo: [bar")).toThrow();
  });
});
