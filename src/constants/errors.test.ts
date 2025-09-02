import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, ERROR_MESSAGES } from "./errors.js";

describe("error constants", () => {
  describe("ERROR_MESSAGES", () => {
    it("should have DIRECTORY_NOT_FOUND function", () => {
      const dirPath = "/path/to/rules";
      const result = ERROR_MESSAGES.DIRECTORY_NOT_FOUND(dirPath);

      expect(result).toBe(`Rules directory not found: ${dirPath}`);
      expect(typeof ERROR_MESSAGES.DIRECTORY_NOT_FOUND).toBe("function");
    });

    it("should have NO_MARKDOWN_FILES function", () => {
      const dirPath = "/path/to/empty";
      const result = ERROR_MESSAGES.NO_MARKDOWN_FILES(dirPath);

      expect(result).toBe(`No markdown files found in directory: ${dirPath}`);
      expect(typeof ERROR_MESSAGES.NO_MARKDOWN_FILES).toBe("function");
    });

    it("should have NO_VALID_RULES function", () => {
      const dirPath = "/path/to/invalid";
      const result = ERROR_MESSAGES.NO_VALID_RULES(dirPath);

      expect(result).toBe(`No valid rules found in ${dirPath}`);
      expect(typeof ERROR_MESSAGES.NO_VALID_RULES).toBe("function");
    });

    it("should have FILE_NOT_FOUND function", () => {
      const filePath = "/path/to/missing.md";
      const result = ERROR_MESSAGES.FILE_NOT_FOUND(filePath);

      expect(result).toBe(`File not found: ${filePath}`);
      expect(typeof ERROR_MESSAGES.FILE_NOT_FOUND).toBe("function");
    });

    it("should have UNSUPPORTED_TOOL_TARGET function", () => {
      const target = "unknown-tool";
      const result = ERROR_MESSAGES.UNSUPPORTED_TOOL_TARGET(target);

      expect(result).toBe(`Unsupported tool target: ${target}`);
      expect(typeof ERROR_MESSAGES.UNSUPPORTED_TOOL_TARGET).toBe("function");
    });
  });

  describe("DEFAULT_CONFIG", () => {
    it("should have REQUEST_TIMEOUT constant", () => {
      expect(DEFAULT_CONFIG.REQUEST_TIMEOUT).toBe(30000);
      expect(typeof DEFAULT_CONFIG.REQUEST_TIMEOUT).toBe("number");
    });

    it("should have MAX_PARALLEL_REQUESTS constant", () => {
      expect(DEFAULT_CONFIG.MAX_PARALLEL_REQUESTS).toBe(10);
      expect(typeof DEFAULT_CONFIG.MAX_PARALLEL_REQUESTS).toBe("number");
    });

    it("should have MAX_FILE_SIZE constant", () => {
      expect(DEFAULT_CONFIG.MAX_FILE_SIZE).toBe(1024 * 1024);
      expect(typeof DEFAULT_CONFIG.MAX_FILE_SIZE).toBe("number");
    });

    it("should have reasonable timeout value", () => {
      expect(DEFAULT_CONFIG.REQUEST_TIMEOUT).toBeGreaterThan(0);
      expect(DEFAULT_CONFIG.REQUEST_TIMEOUT).toBeLessThan(120000); // Less than 2 minutes
    });

    it("should have reasonable parallel request limit", () => {
      expect(DEFAULT_CONFIG.MAX_PARALLEL_REQUESTS).toBeGreaterThan(0);
      expect(DEFAULT_CONFIG.MAX_PARALLEL_REQUESTS).toBeLessThan(100);
    });

    it("should have reasonable file size limit", () => {
      expect(DEFAULT_CONFIG.MAX_FILE_SIZE).toBeGreaterThan(1024); // At least 1KB
      expect(DEFAULT_CONFIG.MAX_FILE_SIZE).toBeLessThan(10 * 1024 * 1024); // Less than 10MB
    });
  });

  describe("error message functions with edge cases", () => {
    it("should handle empty paths", () => {
      expect(ERROR_MESSAGES.DIRECTORY_NOT_FOUND("")).toBe("Rules directory not found: ");
      expect(ERROR_MESSAGES.NO_MARKDOWN_FILES("")).toBe("No markdown files found in directory: ");
      expect(ERROR_MESSAGES.NO_VALID_RULES("")).toBe("No valid rules found in ");
      expect(ERROR_MESSAGES.FILE_NOT_FOUND("")).toBe("File not found: ");
      expect(ERROR_MESSAGES.UNSUPPORTED_TOOL_TARGET("")).toBe("Unsupported tool target: ");
    });

    it("should handle special characters in paths", () => {
      const specialPath = "/path/with spaces/special-chars_123/中文";

      expect(ERROR_MESSAGES.DIRECTORY_NOT_FOUND(specialPath)).toContain(specialPath);
      expect(ERROR_MESSAGES.NO_MARKDOWN_FILES(specialPath)).toContain(specialPath);
      expect(ERROR_MESSAGES.NO_VALID_RULES(specialPath)).toContain(specialPath);
      expect(ERROR_MESSAGES.FILE_NOT_FOUND(specialPath)).toContain(specialPath);
      expect(ERROR_MESSAGES.UNSUPPORTED_TOOL_TARGET(specialPath)).toContain(specialPath);
    });

    it("should handle very long paths", () => {
      const longPath = "/very/long/path/" + "directory/".repeat(50);

      const result = ERROR_MESSAGES.DIRECTORY_NOT_FOUND(longPath);
      expect(result).toContain(longPath);
      expect(result.startsWith("Rules directory not found: ")).toBe(true);
    });

    it("should handle paths with newlines", () => {
      const pathWithNewlines = "/path/with\nnewlines/here";

      const result = ERROR_MESSAGES.FILE_NOT_FOUND(pathWithNewlines);
      expect(result).toBe(`File not found: ${pathWithNewlines}`);
    });

    it("should handle null and undefined inputs gracefully", () => {
      // These might be called with invalid inputs in edge cases
      // TypeScript prevents this but JavaScript runtime might encounter it

      const nullPath = ERROR_MESSAGES.DIRECTORY_NOT_FOUND(null as any);
      expect(nullPath).toBe("Rules directory not found: null");

      const undefinedPath = ERROR_MESSAGES.FILE_NOT_FOUND(undefined as any);
      expect(undefinedPath).toBe("File not found: undefined");
    });
  });

  describe("constants immutability", () => {
    it("should be readonly objects", () => {
      // These should be readonly at TypeScript level
      expect(typeof ERROR_MESSAGES).toBe("object");
      expect(typeof DEFAULT_CONFIG).toBe("object");

      // Verify they exist and have expected shape
      expect(Object.keys(ERROR_MESSAGES)).toEqual([
        "DIRECTORY_NOT_FOUND",
        "NO_MARKDOWN_FILES",
        "NO_VALID_RULES",
        "FILE_NOT_FOUND",
        "UNSUPPORTED_TOOL_TARGET",
      ]);

      expect(Object.keys(DEFAULT_CONFIG)).toEqual([
        "REQUEST_TIMEOUT",
        "MAX_PARALLEL_REQUESTS",
        "MAX_FILE_SIZE",
      ]);
    });
  });
});
