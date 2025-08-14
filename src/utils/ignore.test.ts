import { beforeEach, describe, expect, it, vi } from "vitest";
import { fileExists, readFileContent } from "./file.js";
import {
  clearIgnoreCache,
  filterIgnoredFiles,
  isFileIgnored,
  loadIgnorePatterns,
  parseIgnoreFile,
} from "./ignore.js";

vi.mock("./file.js", () => ({
  fileExists: vi.fn(),
  readFileContent: vi.fn(),
}));

describe("ignore utilities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearIgnoreCache();
  });

  describe("parseIgnoreFile", () => {
    it("should parse ignore patterns correctly", () => {
      const content = `
# This is a comment
*.test.md
temp/
!important.test.md

# Another comment
**/*.tmp
`;
      const patterns = parseIgnoreFile(content);
      expect(patterns).toEqual(["*.test.md", "temp/", "!important.test.md", "**/*.tmp"]);
    });

    it("should handle empty content", () => {
      const patterns = parseIgnoreFile("");
      expect(patterns).toEqual([]);
    });

    it("should handle content with only comments", () => {
      const content = `
# Only comments
# Another comment
`;
      const patterns = parseIgnoreFile(content);
      expect(patterns).toEqual([]);
    });
  });

  describe("isFileIgnored", () => {
    it("should match files against patterns", () => {
      const patterns = ["*.test.md", "temp/**/*", "!important.test.md"];

      expect(isFileIgnored("file.test.md", patterns)).toBe(true);
      expect(isFileIgnored("temp/file.md", patterns)).toBe(true);
      expect(isFileIgnored("regular.md", patterns)).toBe(false);
    });

    it("should return false for empty patterns", () => {
      expect(isFileIgnored("any-file.md", [])).toBe(false);
    });
  });

  describe("filterIgnoredFiles", () => {
    it("should filter out ignored files", () => {
      const files = ["rules/rule1.md", "rules/rule2.test.md", "temp/rule3.md", "rules/rule4.md"];
      const patterns = ["**/*.test.md", "temp/**/*"];

      const filtered = filterIgnoredFiles(files, patterns);
      expect(filtered).toEqual(["rules/rule1.md", "rules/rule4.md"]);
    });

    it("should return all files for empty patterns", () => {
      const files = ["file1.md", "file2.md"];
      const filtered = filterIgnoredFiles(files, []);
      expect(filtered).toEqual(files);
    });
  });

  describe("loadIgnorePatterns", () => {
    it("should load patterns from .rulesyncignore file", async () => {
      vi.mocked(fileExists).mockResolvedValue(true);
      vi.mocked(readFileContent).mockResolvedValue("*.test.md\ntemp/");

      const patterns = await loadIgnorePatterns();
      expect(patterns.patterns).toEqual(["*.test.md", "temp/"]);
    });

    it("should return empty patterns if file doesn't exist", async () => {
      vi.mocked(fileExists).mockResolvedValue(false);

      const patterns = await loadIgnorePatterns();
      expect(patterns.patterns).toEqual([]);
    });

    it("should cache loaded patterns", async () => {
      vi.mocked(fileExists).mockResolvedValue(true);
      vi.mocked(readFileContent).mockResolvedValue("*.test.md");

      const patterns1 = await loadIgnorePatterns();
      const patterns2 = await loadIgnorePatterns();

      expect(patterns1).toBe(patterns2);
      expect(vi.mocked(readFileContent)).toHaveBeenCalledTimes(1);
    });

    it("should handle read errors gracefully", async () => {
      vi.mocked(fileExists).mockResolvedValue(true);
      vi.mocked(readFileContent).mockRejectedValue(new Error("Read error"));

      const { logger } = await import("./logger.js");
      const loggerSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      const patterns = await loadIgnorePatterns();

      expect(patterns.patterns).toEqual([]);
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to read .rulesyncignore"),
      );

      loggerSpy.mockRestore();
    });
  });
});
