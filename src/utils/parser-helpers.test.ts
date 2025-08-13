import { describe, expect, it } from "vitest";
import type { ParsedRule } from "../types/index.js";
import {
  addError,
  addRule,
  addRules,
  createParseResult,
  handleParseError,
  type ParseResult,
  safeReadFile,
} from "./parser-helpers.js";

// Test helper functions moved to outer scope for consistent-function-scoping
const successOperation = async () => "file content";
const failOperation = async () => {
  throw new Error("File not found");
};
const objectOperation = async () => ({ data: "test" });
const nullOperation = async () => null;

describe("parser-helpers", () => {
  describe("createParseResult", () => {
    it("should create empty parse result", () => {
      const result = createParseResult();
      expect(result).toEqual({
        rules: [],
        errors: [],
      });
    });
  });

  describe("addError", () => {
    it("should add error to parse result", () => {
      const result = createParseResult();
      addError(result, "Test error");

      expect(result.errors).toEqual(["Test error"]);
    });

    it("should add multiple errors", () => {
      const result = createParseResult();
      addError(result, "Error 1");
      addError(result, "Error 2");

      expect(result.errors).toEqual(["Error 1", "Error 2"]);
    });
  });

  describe("addRule", () => {
    it("should add rule to existing rules array", () => {
      const result = createParseResult();
      const rule: ParsedRule = {
        frontmatter: {
          root: false,
          targets: ["claudecode"],
          description: "Test rule",
          globs: ["**/*"],
        },
        content: "Test content",
        filename: "test",
        filepath: "/test/path",
      };

      addRule(result, rule);

      expect(result.rules).toEqual([rule]);
    });

    it("should initialize rules array if undefined", () => {
      const result: ParseResult = { errors: [] };
      const rule: ParsedRule = {
        frontmatter: {
          root: false,
          targets: ["claudecode"],
          description: "Test rule",
          globs: ["**/*"],
        },
        content: "Test content",
        filename: "test",
        filepath: "/test/path",
      };

      addRule(result, rule);

      expect(result.rules).toEqual([rule]);
    });
  });

  describe("addRules", () => {
    it("should add multiple rules to existing rules array", () => {
      const result = createParseResult();
      const rules: ParsedRule[] = [
        {
          frontmatter: {
            root: false,
            targets: ["claudecode"],
            description: "Test rule 1",
            globs: ["**/*"],
          },
          content: "Test content 1",
          filename: "test1",
          filepath: "/test/path1",
        },
        {
          frontmatter: {
            root: false,
            targets: ["cursor"],
            description: "Test rule 2",
            globs: ["**/*"],
          },
          content: "Test content 2",
          filename: "test2",
          filepath: "/test/path2",
        },
      ];

      addRules(result, rules);

      expect(result.rules).toEqual(rules);
    });

    it("should initialize rules array if undefined", () => {
      const result: ParseResult = { errors: [] };
      const rules: ParsedRule[] = [
        {
          frontmatter: {
            root: false,
            targets: ["claudecode"],
            description: "Test rule",
            globs: ["**/*"],
          },
          content: "Test content",
          filename: "test",
          filepath: "/test/path",
        },
      ];

      addRules(result, rules);

      expect(result.rules).toEqual(rules);
    });
  });

  describe("handleParseError", () => {
    it("should format error with context", () => {
      const error = new Error("Test error");
      const result = handleParseError(error, "Test context");

      expect(result).toBe("Test context: Test error");
    });

    it("should handle non-Error objects", () => {
      const result = handleParseError("string error", "Test context");

      expect(result).toBe("Test context: string error");
    });
  });

  describe("safeReadFile", () => {
    it("should return success result for successful operation", async () => {
      const result = await safeReadFile(successOperation, "Read file");

      expect(result).toEqual({
        success: true,
        result: "file content",
      });
    });

    it("should return error result for failed operation", async () => {
      const result = await safeReadFile(failOperation, "Read file");

      expect(result).toEqual({
        success: false,
        error: "Read file: File not found",
      });
    });

    it("should handle different return types", async () => {
      const result = await safeReadFile(objectOperation, "Read data");

      expect(result).toEqual({
        success: true,
        result: { data: "test" },
      });
    });

    it("should handle null return values", async () => {
      const result = await safeReadFile(nullOperation, "Read file");

      expect(result).toEqual({
        success: true,
        result: null,
      });
    });
  });
});
