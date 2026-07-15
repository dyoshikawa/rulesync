import { describe, expect, it } from "vitest";

import { parseJsonc } from "./jsonc.js";

describe("parseJsonc", () => {
  it("should parse plain JSON", () => {
    expect(parseJsonc('{"a": 1, "b": ["x"]}')).toEqual({ a: 1, b: ["x"] });
  });

  it("should parse JSONC with line comments", () => {
    const content = `{
      // comment
      "a": 1
    }`;
    expect(parseJsonc(content)).toEqual({ a: 1 });
  });

  it("should parse JSONC with block comments", () => {
    const content = `{
      /* block
         comment */
      "a": 1
    }`;
    expect(parseJsonc(content)).toEqual({ a: 1 });
  });

  it("should parse JSONC with trailing commas", () => {
    const content = `{
      "a": [1, 2,],
      "b": { "c": 3, },
    }`;
    expect(parseJsonc(content)).toEqual({ a: [1, 2], b: { c: 3 } });
  });

  it("should throw SyntaxError for invalid content", () => {
    expect(() => parseJsonc("{ invalid json }")).toThrow(SyntaxError);
  });

  it("should throw SyntaxError for empty content", () => {
    expect(() => parseJsonc("")).toThrow(SyntaxError);
  });

  it("should throw SyntaxError for whitespace-only content", () => {
    expect(() => parseJsonc("   \n  ")).toThrow(SyntaxError);
  });

  it("should throw SyntaxError for truncated content", () => {
    expect(() => parseJsonc('{"a": ')).toThrow(SyntaxError);
  });

  it("should drop prototype-pollution keys and normalize prototypes", () => {
    const parsed = parseJsonc(
      '{"a": 1, "__proto__": {"polluted": true}, "nested": {"constructor": 1, "b": 2}}',
    );

    expect(parsed).toEqual({ a: 1, nested: { b: 2 } });
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
