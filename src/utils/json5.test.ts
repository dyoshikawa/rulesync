import { describe, expect, it } from "vitest";

import { MAX_JSON5_DEPTH, parseJson5 } from "./json5.js";

describe("parseJson5", () => {
  it("parses strict JSON like JSON.parse", () => {
    const text = '{"a": 1, "b": [true, false, null], "c": {"d": "e"}, "f": -1.5e3}';
    expect(parseJson5(text)).toEqual(JSON.parse(text));
  });

  it("parses OpenClaw's documented config shape", () => {
    const text = `{
      // MCP servers
      mcp: {
        servers: {
          docs: {
            command: "uvx",
            args: ["mcp-server-fetch"],
          },
          remote: {
            url: "https://example.com/mcp",
            transport: "streamable-http", // streamable-http | sse
            headers: {
              Authorization: "Bearer \${MCP_REMOTE_TOKEN}",
            },
          },
        },
      },
    }`;
    expect(parseJson5(text)).toEqual({
      mcp: {
        servers: {
          docs: { command: "uvx", args: ["mcp-server-fetch"] },
          remote: {
            url: "https://example.com/mcp",
            transport: "streamable-http",
            headers: { Authorization: "Bearer ${MCP_REMOTE_TOKEN}" },
          },
        },
      },
    });
  });

  it("reads comments, single quotes and escapes", () => {
    const text = `/* lead */ {
      'single': 'it\\'s',
      $id_1: "tab\\tnewline\\nhex \\x41 uni \\u0042",
      cont: 'a\\
b',
      nul: "\\0",
      other: "\\q",
    } // trailing`;
    expect(parseJson5(text)).toEqual({
      single: "it's",
      $id_1: "tab\tnewline\nhex A uni B",
      cont: "ab",
      nul: "\0",
      other: "q",
    });
  });

  it("reads JSON5 numbers", () => {
    expect(parseJson5("[0x1F, -0xa, .5, 5., +1, Infinity, -Infinity, 1e2]")).toEqual([
      31,
      -10,
      0.5,
      5,
      1,
      Infinity,
      -Infinity,
      100,
    ]);
    expect(parseJson5("NaN")).toBeNaN();
  });

  it("reads identifier keys with unicode escapes", () => {
    expect(parseJson5("{ \\u0061b: 1, ünï: 2 }")).toEqual({ ab: 1, ünï: 2 });
  });

  it("keeps the last value of a duplicate key", () => {
    expect(parseJson5("{ a: 1, a: 2 }")).toEqual({ a: 2 });
  });

  it("records __proto__ as an own key instead of replacing the prototype", () => {
    const parsed = parseJson5("{ __proto__: { polluted: true }, a: 1 }") as Record<string, unknown>;
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    expect(Object.hasOwn(parsed, "__proto__")).toBe(true);
    expect((parsed as { polluted?: unknown }).polluted).toBeUndefined();
  });

  it.each([
    ["{ a: 1", "expected ',' or '}'"],
    ["{ a 1 }", "expected ':'"],
    ["[1 2]", "expected ',' or ']'"],
    ["'abc", "unterminated string"],
    ['"a\nb"', "unescaped line break"],
    ["/* open", "unterminated block comment"],
    ["01", "invalid number"],
    ['"\\1"', "octal escapes"],
    ["{ 1a: 1 }", "expected a key"],
    ["true1", "unexpected"],
    ["{} {}", "after the end of the document"],
    ["[,]", "unexpected"],
  ])("rejects %j", (text, message) => {
    expect(() => parseJson5(text)).toThrow(message);
  });

  it("names the line and column of a syntax error", () => {
    expect(() => parseJson5("{\n  a: ?\n}")).toThrow("line 2, column 6");
  });

  it("refuses documents nested deeper than the cap", () => {
    const deep = "[".repeat(MAX_JSON5_DEPTH + 1) + "]".repeat(MAX_JSON5_DEPTH + 1);
    expect(() => parseJson5(deep)).toThrow("nests deeper");
    const ok = "[".repeat(MAX_JSON5_DEPTH) + "]".repeat(MAX_JSON5_DEPTH);
    expect(() => parseJson5(ok)).not.toThrow();
  });
});
