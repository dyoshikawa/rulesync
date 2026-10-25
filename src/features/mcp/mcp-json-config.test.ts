import { describe, expect, it } from "vitest";

import { parseJsonc } from "../../utils/jsonc.js";
import { parseMcpJsonObjectOrThrow } from "./mcp-json-config.js";

describe("parseMcpJsonObjectOrThrow", () => {
  it("returns the parsed root object", () => {
    expect(
      parseMcpJsonObjectOrThrow({
        fileContent: '{"mcpServers":{}}',
        relativePath: ".tool/mcp.json",
        label: "Tool",
        parse: JSON.parse,
      }),
    ).toEqual({ mcpServers: {} });
  });

  it("uses the given parser", () => {
    expect(
      parseMcpJsonObjectOrThrow({
        fileContent: '{\n  // comment\n  "a": 1,\n}',
        relativePath: ".tool/mcp.json",
        label: "Tool",
        parse: parseJsonc,
      }),
    ).toEqual({ a: 1 });
  });

  it("wraps a parse failure with the label, path and cause", () => {
    let thrown: unknown;
    try {
      parseMcpJsonObjectOrThrow({
        fileContent: "{not json",
        relativePath: ".tool/mcp.json",
        label: "Tool",
        parse: JSON.parse,
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toMatch(
      /^Failed to parse Tool MCP config at \.tool\/mcp\.json: /,
    );
    expect((thrown as Error).cause).toBeInstanceOf(SyntaxError);
  });

  it.each(["null", "[]", "1", '"text"'])("rejects a non-object root: %s", (fileContent) => {
    expect(() =>
      parseMcpJsonObjectOrThrow({
        fileContent,
        relativePath: ".tool/mcp.json",
        label: "Tool",
        parse: JSON.parse,
      }),
    ).toThrow(
      new Error(
        "Failed to parse Tool MCP config at .tool/mcp.json: expected a JSON object at the root",
      ),
    );
  });
});
