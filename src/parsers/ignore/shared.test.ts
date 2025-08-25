import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../../test-utils/index.js";
import {
  extractClaudeCodeIgnorePatterns,
  normalizeIgnorePatterns,
  parseIgnoreContent,
  parseIgnoreFile,
  validateIgnorePattern,
} from "./shared.js";

describe("shared ignore utilities", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("parseIgnoreFile", () => {
    it("should parse ignore file correctly", async () => {
      const content = `
# Comment
node_modules/
*.log
dist/
`;

      await writeFile(join(testDir, ".testignore"), content);

      const result = await parseIgnoreFile(".testignore", testDir);

      expect(result.patterns).toEqual(["node_modules/", "*.log", "dist/"]);
      expect(result.errors).toEqual([]);
      expect(result.source).toBe(".testignore");
    });

    it("should return empty result for non-existent file", async () => {
      const result = await parseIgnoreFile(".nonexistent", testDir);

      expect(result.patterns).toEqual([]);
      expect(result.errors).toEqual([]);
      expect(result.source).toBeUndefined();
    });
  });

  describe("parseIgnoreContent", () => {
    it("should parse content correctly", () => {
      const content = `
# Comment
node_modules/
*.log

# Another comment
dist/
`;

      const patterns = parseIgnoreContent(content);

      expect(patterns).toEqual(["node_modules/", "*.log", "dist/"]);
    });

    it("should handle empty content", () => {
      const patterns = parseIgnoreContent("");
      expect(patterns).toEqual([]);
    });
  });

  describe("validateIgnorePattern", () => {
    it("should validate patterns correctly", () => {
      expect(validateIgnorePattern("node_modules/")).toBe(true);
      expect(validateIgnorePattern("*.log")).toBe(true);
      expect(validateIgnorePattern("")).toBe(false);
      expect(validateIgnorePattern("   ")).toBe(false);
      expect(validateIgnorePattern("#comment")).toBe(false);
    });
  });

  describe("normalizeIgnorePatterns", () => {
    it("should normalize patterns correctly", () => {
      const patterns = [
        "node_modules/",
        "  *.log  ",
        "",
        "# comment",
        "dist/",
        "node_modules/", // duplicate
        "   ", // empty after trim
      ];

      const normalized = normalizeIgnorePatterns(patterns);

      expect(normalized).toEqual(["node_modules/", "*.log", "dist/"]);
    });
  });

  describe("extractClaudeCodeIgnorePatterns", () => {
    it("should extract patterns from Claude Code settings", () => {
      const settings = {
        permissions: {
          deny: [
            "Read(node_modules/**)",
            "Read(.env)",
            "Read(secrets/*)",
            "Write(src/**)", // Should be ignored
          ],
        },
      };

      const patterns = extractClaudeCodeIgnorePatterns(settings);

      expect(patterns).toEqual(["node_modules/**", ".env", "secrets/*"]);
    });

    it("should return undefined for invalid settings", () => {
      expect(extractClaudeCodeIgnorePatterns(null)).toBeUndefined();
      expect(extractClaudeCodeIgnorePatterns({})).toBeUndefined();
      expect(extractClaudeCodeIgnorePatterns({ permissions: null })).toBeUndefined();
      expect(extractClaudeCodeIgnorePatterns({ permissions: { deny: "invalid" } })).toBeUndefined();
    });
  });
});
