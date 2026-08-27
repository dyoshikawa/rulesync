import { describe, expect, it } from "vitest";

import { parseJsonc, parseJsoncReportingDroppedKeys } from "./jsonc.js";

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

describe("parseJsoncReportingDroppedKeys", () => {
  it("should parse identically to parseJsonc", () => {
    const content = '{"a": 1, "nested": {"b": 2}}';

    expect(parseJsoncReportingDroppedKeys({ content }).value).toEqual(parseJsonc(content));
  });

  it("should report an empty list when nothing was dropped", () => {
    expect(parseJsoncReportingDroppedKeys({ content: '{"a": 1}' }).droppedKeys).toEqual([]);
  });

  it("should report dropped keys as dotted paths", () => {
    const { value, droppedKeys } = parseJsoncReportingDroppedKeys({
      content: '{"__proto__": 1, "permission": {"bash": {"__proto__": "deny", "git *": "allow"}}}',
    });

    expect(value).toEqual({ permission: { bash: { "git *": "allow" } } });
    expect(droppedKeys).toEqual(["__proto__", "permission.bash.__proto__"]);
  });

  it("should index array elements in the reported path", () => {
    const { droppedKeys } = parseJsoncReportingDroppedKeys({
      content: '{"hooks": [{"ok": 1}, {"prototype": 2}]}',
    });

    expect(droppedKeys).toEqual(["hooks[1].prototype"]);
  });

  it("should report a duplicated pollution key only once", () => {
    // Two properties in the syntax tree, but one dropped entry to the reader.
    expect(
      parseJsoncReportingDroppedKeys({ content: '{"__proto__": 1, "__proto__": 2}' }).droppedKeys,
    ).toEqual(["__proto__"]);
  });

  it("should throw SyntaxError for invalid content", () => {
    expect(() => parseJsoncReportingDroppedKeys({ content: "{ invalid json }" })).toThrow(
      SyntaxError,
    );
  });
});
