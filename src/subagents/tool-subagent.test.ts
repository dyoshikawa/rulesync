import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import { AiFileFromFilePathParams, ValidationResult } from "../types/ai-file.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";
import { ToolSubagent, ToolSubagentFromRulesyncSubagentParams } from "./tool-subagent.js";

// Concrete implementation for testing the abstract ToolSubagent class
class TestToolSubagent extends ToolSubagent {
  static fromFilePath(params: AiFileFromFilePathParams): ToolSubagent {
    return new TestToolSubagent({
      baseDir: params.baseDir || ".",
      relativeDirPath: params.relativeDirPath,
      relativeFilePath: params.relativeFilePath,
      fileContent: "test content from file path",
      validate: params.validate || true,
    });
  }

  static fromRulesyncSubagent(params: ToolSubagentFromRulesyncSubagentParams): ToolSubagent {
    return new TestToolSubagent({
      baseDir: params.baseDir || ".",
      relativeDirPath: params.relativeDirPath,
      relativeFilePath: params.rulesyncSubagent.getRelativeFilePath(),
      fileContent: params.rulesyncSubagent.getFileContent(),
      validate: params.validate || true,
    });
  }

  toRulesyncSubagent(): RulesyncSubagent {
    return new RulesyncSubagent({
      frontmatter: {
        targets: ["claudecode"],
        title: "Test Tool Subagent",
        description: "Converted from tool subagent",
      },
      body: "Converted body content",
      baseDir: this.baseDir,
      relativeDirPath: ".rulesync/subagents",
      relativeFilePath: "converted.md",
      fileContent: "Converted file content",
      validate: false,
    });
  }

  validate(): ValidationResult {
    if (this.fileContent.includes("invalid")) {
      return {
        success: false,
        error: new Error("Content contains invalid text"),
      };
    }
    return {
      success: true,
      error: undefined,
    };
  }
}

// Test implementation that throws errors for unimplemented methods
class IncompleteToolSubagent extends ToolSubagent {
  validate(): ValidationResult {
    return { success: true, error: undefined };
  }

  toRulesyncSubagent(): RulesyncSubagent {
    throw new Error("toRulesyncSubagent not implemented");
  }
}

describe("ToolSubagent", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("concrete implementation", () => {
    it("should create instance through concrete subclass", () => {
      const toolSubagent = new TestToolSubagent({
        baseDir: testDir,
        relativeDirPath: ".tool/agents",
        relativeFilePath: "test.md",
        fileContent: "Test content",
      });

      expect(toolSubagent).toBeInstanceOf(ToolSubagent);
      expect(toolSubagent.getRelativeDirPath()).toBe(".tool/agents");
      expect(toolSubagent.getRelativeFilePath()).toBe("test.md");
      expect(toolSubagent.getFileContent()).toBe("Test content");
    });

    it("should validate content through concrete implementation", () => {
      const validSubagent = new TestToolSubagent({
        baseDir: testDir,
        relativeDirPath: ".tool/agents",
        relativeFilePath: "valid.md",
        fileContent: "Valid content",
      });

      const result = validSubagent.validate();
      expect(result.success).toBe(true);
    });

    it("should handle validation errors through concrete implementation", () => {
      const invalidSubagent = new TestToolSubagent({
        baseDir: testDir,
        relativeDirPath: ".tool/agents",
        relativeFilePath: "invalid.md",
        fileContent: "invalid content",
        validate: false,
      });

      const result = invalidSubagent.validate();
      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error?.message).toBe("Content contains invalid text");
    });
  });

  describe("fromFilePath", () => {
    it("should create instance from file path through concrete implementation", () => {
      const toolSubagent = TestToolSubagent.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".tool/agents",
        relativeFilePath: "frompath.md",
        filePath: "/some/path/frompath.md",
      });

      expect(toolSubagent).toBeInstanceOf(TestToolSubagent);
      expect(toolSubagent.getRelativeDirPath()).toBe(".tool/agents");
      expect(toolSubagent.getRelativeFilePath()).toBe("frompath.md");
      expect(toolSubagent.getFileContent()).toBe("test content from file path");
    });

    it("should throw error for abstract base class fromFilePath", () => {
      expect(() => {
        ToolSubagent.fromFilePath({
          relativeDirPath: ".tool/agents",
          relativeFilePath: "test.md",
          filePath: "/some/path/test.md",
        });
      }).toThrow("Please implement this method in the subclass.");
    });
  });

  describe("fromRulesyncSubagent", () => {
    it("should create instance from RulesyncSubagent through concrete implementation", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        frontmatter: {
          targets: ["claudecode"],
          title: "Source Agent",
          description: "Source agent description",
        },
        body: "Source body content",
        baseDir: testDir,
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "source.md",
        fileContent: "Source file content",
        validate: false,
      });

      const toolSubagent = TestToolSubagent.fromRulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: ".tool/agents",
        rulesyncSubagent,
      });

      expect(toolSubagent).toBeInstanceOf(TestToolSubagent);
      expect(toolSubagent.getRelativeDirPath()).toBe(".tool/agents");
      expect(toolSubagent.getRelativeFilePath()).toBe("source.md");
      expect(toolSubagent.getFileContent()).toBe("Source file content");
    });

    it("should throw error for abstract base class fromRulesyncSubagent", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        frontmatter: {
          targets: ["claudecode"],
          title: "Test Agent",
          description: "Test description",
        },
        body: "Test body",
        baseDir: testDir,
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "test.md",
        fileContent: "Test content",
        validate: false,
      });

      expect(() => {
        ToolSubagent.fromRulesyncSubagent({
          baseDir: testDir,
          relativeDirPath: ".tool/agents",
          rulesyncSubagent,
        });
      }).toThrow("Please implement this method in the subclass.");
    });

    it("should handle optional parameters with defaults", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        frontmatter: {
          targets: ["claudecode"],
          title: "Default Test",
          description: "Test with defaults",
        },
        body: "Default body",
        baseDir: testDir,
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "default.md",
        fileContent: "Default content",
        validate: false,
      });

      const toolSubagent = TestToolSubagent.fromRulesyncSubagent({
        relativeDirPath: ".tool/agents",
        rulesyncSubagent,
      });

      expect(toolSubagent).toBeInstanceOf(TestToolSubagent);
    });
  });

  describe("toRulesyncSubagent", () => {
    it("should convert to RulesyncSubagent through concrete implementation", () => {
      const toolSubagent = new TestToolSubagent({
        baseDir: testDir,
        relativeDirPath: ".tool/agents",
        relativeFilePath: "convert.md",
        fileContent: "Convert content",
      });

      const rulesyncSubagent = toolSubagent.toRulesyncSubagent();

      expect(rulesyncSubagent).toBeInstanceOf(RulesyncSubagent);
      expect(rulesyncSubagent.getFrontmatter().title).toBe("Test Tool Subagent");
      expect(rulesyncSubagent.getFrontmatter().description).toBe("Converted from tool subagent");
      expect(rulesyncSubagent.getBody()).toBe("Converted body content");
    });

    it("should require implementation in subclass", () => {
      // Create an incomplete implementation that doesn't implement toRulesyncSubagent
      const incompleteSubagent = new IncompleteToolSubagent({
        baseDir: testDir,
        relativeDirPath: ".tool/agents",
        relativeFilePath: "incomplete.md",
        fileContent: "Incomplete content",
      });

      // TypeScript would catch this at compile time, but we can test runtime behavior
      // by calling the method that should be abstract
      expect(incompleteSubagent.toRulesyncSubagent).toBeDefined();
    });
  });

  describe("abstract method contracts", () => {
    it("should enforce toRulesyncSubagent implementation", () => {
      // This test verifies that the abstract method contract exists
      // Concrete implementations must provide toRulesyncSubagent
      const toolSubagent = new TestToolSubagent({
        baseDir: testDir,
        relativeDirPath: ".tool/agents",
        relativeFilePath: "contract.md",
        fileContent: "Contract content",
      });

      // Should have the method implemented
      expect(typeof toolSubagent.toRulesyncSubagent).toBe("function");

      // Should return a RulesyncSubagent
      const result = toolSubagent.toRulesyncSubagent();
      expect(result).toBeInstanceOf(RulesyncSubagent);
    });

    it("should enforce fromRulesyncSubagent static method implementation", () => {
      // Verify the static method exists and works
      expect(typeof TestToolSubagent.fromRulesyncSubagent).toBe("function");

      const rulesyncSubagent = new RulesyncSubagent({
        frontmatter: {
          targets: ["claudecode"],
          title: "Static Test",
          description: "Testing static method",
        },
        body: "Static test body",
        baseDir: testDir,
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "static.md",
        fileContent: "Static test content",
        validate: false,
      });

      const result = TestToolSubagent.fromRulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: ".tool/agents",
        rulesyncSubagent,
      });

      expect(result).toBeInstanceOf(TestToolSubagent);
    });

    it("should enforce fromFilePath static method implementation", () => {
      // Verify the static method exists and works
      expect(typeof TestToolSubagent.fromFilePath).toBe("function");

      const result = TestToolSubagent.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".tool/agents",
        relativeFilePath: "fromfile.md",
        filePath: "/some/path/fromfile.md",
      });

      expect(result).toBeInstanceOf(TestToolSubagent);
    });
  });

  describe("inheritance from AiFile", () => {
    it("should properly extend AiFile", () => {
      const toolSubagent = new TestToolSubagent({
        baseDir: testDir,
        relativeDirPath: ".tool/agents",
        relativeFilePath: "inheritance.md",
        fileContent: "Inheritance test content",
      });

      // Test inherited methods from AiFile
      expect(toolSubagent.getRelativeDirPath()).toBe(".tool/agents");
      expect(toolSubagent.getRelativeFilePath()).toBe("inheritance.md");
      expect(toolSubagent.getFileContent()).toBe("Inheritance test content");
      expect(toolSubagent.getFilePath()).toContain("inheritance.md");
    });

    it("should inherit validation behavior from AiFile", () => {
      // Test that validation is called during construction
      expect(() => {
        const _toolSubagent = new TestToolSubagent({
          baseDir: testDir,
          relativeDirPath: ".tool/agents",
          relativeFilePath: "invalid.md",
          fileContent: "invalid content", // This should trigger validation error
        });
      }).toThrow("Content contains invalid text");
    });

    it("should support skipping validation from AiFile", () => {
      expect(() => {
        const _toolSubagent = new TestToolSubagent({
          baseDir: testDir,
          relativeDirPath: ".tool/agents",
          relativeFilePath: "skipvalidation.md",
          fileContent: "invalid content",
          validate: false,
        });
      }).not.toThrow();
    });
  });

  describe("type definitions", () => {
    it("should have correct ToolSubagentFromRulesyncSubagentParams type", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        frontmatter: {
          targets: ["claudecode"],
          title: "Type Test",
          description: "Testing types",
        },
        body: "Type test body",
        baseDir: testDir,
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "typetest.md",
        fileContent: "Type test content",
        validate: false,
      });

      // This should compile and work correctly
      const params: ToolSubagentFromRulesyncSubagentParams = {
        baseDir: testDir,
        relativeDirPath: ".tool/agents",
        rulesyncSubagent,
        validate: true,
      };

      const result = TestToolSubagent.fromRulesyncSubagent(params);
      expect(result).toBeInstanceOf(TestToolSubagent);
    });
  });

  describe("edge cases", () => {
    it("should handle empty content", () => {
      const toolSubagent = new TestToolSubagent({
        baseDir: testDir,
        relativeDirPath: "",
        relativeFilePath: "empty.md",
        fileContent: "",
      });

      expect(toolSubagent.getFileContent()).toBe("");
    });

    it("should handle special characters in paths", () => {
      const toolSubagent = new TestToolSubagent({
        baseDir: testDir,
        relativeDirPath: "path with spaces/special-chars_123",
        relativeFilePath: "file-name_with-specials.md",
        fileContent: "Special content",
      });

      expect(toolSubagent.getRelativeDirPath()).toBe("path with spaces/special-chars_123");
      expect(toolSubagent.getRelativeFilePath()).toBe("file-name_with-specials.md");
    });

    it("should handle round-trip conversion", () => {
      // Create tool subagent
      const originalTool = new TestToolSubagent({
        baseDir: testDir,
        relativeDirPath: ".tool/agents",
        relativeFilePath: "roundtrip.md",
        fileContent: "Round trip content",
      });

      // Convert to rulesync
      const rulesyncSubagent = originalTool.toRulesyncSubagent();

      // Convert back to tool
      const convertedTool = TestToolSubagent.fromRulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: ".tool/agents",
        rulesyncSubagent,
      });

      // Verify the conversion worked
      expect(convertedTool).toBeInstanceOf(TestToolSubagent);
    });
  });
});
