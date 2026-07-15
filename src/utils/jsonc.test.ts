import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setupTestDirectory } from "../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "./file.js";
import { parseJsonc, readJsoncTwinOrNull } from "./jsonc.js";

describe("parseJsonc", () => {
  it("parses plain JSON", () => {
    expect(parseJsonc('{"a": 1, "b": [true, null]}')).toEqual({ a: 1, b: [true, null] });
  });

  it("parses JSONC with comments and trailing commas", () => {
    const content = [
      "{",
      "  // line comment",
      '  "a": 1, /* block comment */',
      '  "b": { "c": "d", },',
      "}",
    ].join("\n");
    expect(parseJsonc(content)).toEqual({ a: 1, b: { c: "d" } });
  });

  it("parses scalar values", () => {
    expect(parseJsonc('"text"')).toBe("text");
    expect(parseJsonc("42")).toBe(42);
    expect(parseJsonc("null")).toBeNull();
  });

  it("throws on empty content", () => {
    expect(() => parseJsonc("")).toThrow(/Failed to parse JSONC content/);
  });

  it("throws on invalid content with every error location", () => {
    expect(() => parseJsonc("{ invalid json }")).toThrow(
      /Failed to parse JSONC content: .*at offset \d+/,
    );
  });

  it("throws on comment-only content", () => {
    expect(() => parseJsonc("// only a comment")).toThrow(/Failed to parse JSONC content/);
  });
});

describe("readJsoncTwinOrNull", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  it("returns the twin file name and content when the twin exists", async () => {
    await ensureDir(join(testDir, ".rulesync"));
    await writeFileContent(join(testDir, ".rulesync", "mcp.jsonc"), '{ "mcpServers": {} }');

    const twin = await readJsoncTwinOrNull({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      jsoncFileName: "mcp.jsonc",
    });

    expect(twin).toEqual({
      relativeFilePath: "mcp.jsonc",
      fileContent: '{ "mcpServers": {} }',
    });
  });

  it("returns null when the twin does not exist", async () => {
    await ensureDir(join(testDir, ".rulesync"));

    const twin = await readJsoncTwinOrNull({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      jsoncFileName: "mcp.jsonc",
    });

    expect(twin).toBeNull();
  });
});
