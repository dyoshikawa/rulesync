import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../../test-utils/index.js";
import { CursorIgnoreParser } from "./cursor.js";

describe("CursorIgnoreParser", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;
  let parser: CursorIgnoreParser;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    parser = new CursorIgnoreParser();
  });

  afterEach(async () => {
    await cleanup();
  });

  it("should parse .cursorignore file correctly", async () => {
    const cursorignoreContent = `
# This is a comment
node_modules/
*.log
dist/

# Another comment
.env
`;

    await writeFile(join(testDir, ".cursorignore"), cursorignoreContent);

    const result = await parser.parseIgnorePatterns(testDir);

    expect(result.patterns).toEqual(["node_modules/", "*.log", "dist/", ".env"]);
    expect(result.errors).toEqual([]);
    expect(result.source).toBe(".cursorignore");
  });

  it("should return empty patterns when .cursorignore does not exist", async () => {
    const result = await parser.parseIgnorePatterns(testDir);

    expect(result.patterns).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.source).toBeUndefined();
  });

  it("should handle empty .cursorignore file", async () => {
    await writeFile(join(testDir, ".cursorignore"), "");

    const result = await parser.parseIgnorePatterns(testDir);

    expect(result.patterns).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.source).toBe(".cursorignore");
  });

  it("should filter out comments and empty lines", async () => {
    const cursorignoreContent = `
# Comment
node_modules/

# Another comment

*.log
`;

    await writeFile(join(testDir, ".cursorignore"), cursorignoreContent);

    const result = await parser.parseIgnorePatterns(testDir);

    expect(result.patterns).toEqual(["node_modules/", "*.log"]);
    expect(result.errors).toEqual([]);
  });

  it("should have correct tool name", () => {
    expect(parser.getToolName()).toBe("cursor");
  });

  it("should have correct ignore file name", () => {
    expect(parser.getIgnoreFileName()).toBe(".cursorignore");
  });
});
