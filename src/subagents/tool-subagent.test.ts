import { describe, expect, it } from "vitest";
import { AiFileFromFilePathParams, ValidationResult } from "../types/ai-file.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";
import { ToolSubagent, ToolSubagentFromRulesyncSubagentParams } from "./tool-subagent.js";

// Test implementation of ToolSubagent
class TestToolSubagent extends ToolSubagent {
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

  static async fromFilePath(_params: AiFileFromFilePathParams): Promise<TestToolSubagent> {
    return new TestToolSubagent({
      baseDir: _params.baseDir || ".",
      relativeDirPath: _params.relativeDirPath,
      relativeFilePath: _params.relativeFilePath,
      fileContent: "test subagent content from file path",
    });
  }

  static fromRulesyncSubagent(params: ToolSubagentFromRulesyncSubagentParams): TestToolSubagent {
    return new TestToolSubagent({
      baseDir: params.baseDir || ".",
      relativeDirPath: params.relativeDirPath || ".",
      relativeFilePath: "test-subagent.md",
      fileContent: params.rulesyncSubagent.getFileContent(),
    });
  }

  toRulesyncSubagent(): RulesyncSubagent {
    return new RulesyncSubagent({
      baseDir: ".",
      relativeDirPath: ".rulesync/subagents",
      relativeFilePath: "test-subagent.md",
      fileContent: this.fileContent,
      frontmatter: {
        targets: ["cursor"],
        name: "Test Subagent",
        description: "Test subagent",
      },
      body: "Test body",
    });
  }
}

describe("ToolSubagent", () => {
  describe("inheritance from ToolFile", () => {
    it("should inherit ToolFile functionality", () => {
      const subagent = new TestToolSubagent({
        relativeDirPath: ".tool/subagents",
        relativeFilePath: "test.md",
        fileContent: "Subagent content",
      });

      // Should have all ToolFile methods
      expect(subagent.getRelativeDirPath()).toBe(".tool/subagents");
      expect(subagent.getRelativeFilePath()).toBe("test.md");
      expect(subagent.getFileContent()).toBe("Subagent content");
      expect(typeof subagent.getFilePath).toBe("function");
      expect(typeof subagent.validate).toBe("function");
    });

    it("should support validation like ToolFile", () => {
      const subagent = new TestToolSubagent({
        relativeDirPath: ".tool/subagents",
        relativeFilePath: "valid.md",
        fileContent: "valid subagent content",
      });

      const result = subagent.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("should throw validation errors during construction", () => {
      expect(() => {
        const _instance = new TestToolSubagent({
          relativeDirPath: ".tool/subagents",
          relativeFilePath: "invalid.md",
          fileContent: "invalid subagent content",
        });
      }).toThrow("Content contains invalid text");
    });

    it("should skip validation when validate=false", () => {
      expect(() => {
        const _instance = new TestToolSubagent({
          relativeDirPath: ".tool/subagents",
          relativeFilePath: "invalid.md",
          fileContent: "invalid subagent content",
          validate: false,
        });
      }).not.toThrow();
    });
  });

  describe("abstract class methods", () => {
    it("should throw error for abstract fromFilePath", async () => {
      await expect(
        ToolSubagent.fromFilePath({
          relativeDirPath: ".",
          relativeFilePath: "test.md",
          filePath: "/path/test.md",
        }),
      ).rejects.toThrow("Please implement this method in the subclass.");
    });

    it("should throw error for abstract fromRulesyncSubagent", () => {
      const mockRulesyncSubagent = {
        getFileContent: () => "test content",
        getRelativeDirPath: () => ".rulesync/subagents",
        getRelativeFilePath: () => "test.md",
      };

      expect(() => {
        ToolSubagent.fromRulesyncSubagent({
          relativeDirPath: ".tool/subagents",
          rulesyncSubagent: mockRulesyncSubagent as any,
        });
      }).toThrow("Please implement this method in the subclass.");
    });
  });

  describe("concrete implementation functionality", () => {
    it("should work with concrete fromFilePath implementation", async () => {
      const subagent = await TestToolSubagent.fromFilePath({
        baseDir: "/test",
        relativeDirPath: ".tool/subagents",
        relativeFilePath: "agent.md",
        filePath: "/test/.tool/subagents/agent.md",
      });

      expect(subagent).toBeInstanceOf(TestToolSubagent);
      expect(subagent).toBeInstanceOf(ToolSubagent);
      expect(subagent.getRelativeDirPath()).toBe(".tool/subagents");
      expect(subagent.getRelativeFilePath()).toBe("agent.md");
      expect(subagent.getFileContent()).toBe("test subagent content from file path");
    });

    it("should work with concrete fromRulesyncSubagent implementation", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "source.md",
        fileContent: "# Source Subagent\nThis is a source subagent.",
        frontmatter: {
          targets: ["cursor"],
          name: "Source Subagent",
          description: "This is a source subagent",
        },
        body: "# Source Subagent\nThis is a source subagent.",
      });

      const subagent = TestToolSubagent.fromRulesyncSubagent({
        baseDir: "/test",
        relativeDirPath: ".tool/subagents",
        rulesyncSubagent,
      });

      expect(subagent).toBeInstanceOf(TestToolSubagent);
      expect(subagent.getFileContent()).toBe("# Source Subagent\nThis is a source subagent.");
      expect(subagent.getRelativeFilePath()).toBe("test-subagent.md");
      expect(subagent.getRelativeDirPath()).toBe(".tool/subagents");
    });

    it("should work with toRulesyncSubagent method", () => {
      const subagent = new TestToolSubagent({
        relativeDirPath: ".tool/subagents",
        relativeFilePath: "test.md",
        fileContent: "# Test Subagent\nTest content",
      });

      const rulesyncSubagent = subagent.toRulesyncSubagent();

      expect(rulesyncSubagent).toBeInstanceOf(RulesyncSubagent);
      expect(rulesyncSubagent.getFileContent()).toBe("# Test Subagent\nTest content");
      expect(rulesyncSubagent.getRelativeDirPath()).toBe(".rulesync/subagents");
      expect(rulesyncSubagent.getRelativeFilePath()).toBe("test-subagent.md");
    });
  });

  describe("polymorphism and type safety", () => {
    it("should support polymorphic usage", () => {
      const subagent: ToolSubagent = new TestToolSubagent({
        relativeDirPath: ".tool/subagents",
        relativeFilePath: "poly.md",
        fileContent: "polymorphic subagent content",
      });

      expect(subagent.getRelativeDirPath()).toBe(".tool/subagents");
      expect(subagent.getRelativeFilePath()).toBe("poly.md");
      expect(subagent.getFileContent()).toBe("polymorphic subagent content");
      expect(typeof subagent.toRulesyncSubagent).toBe("function");
    });

    it("should maintain type relationships", () => {
      const subagent = new TestToolSubagent({
        relativeDirPath: ".tool/subagents",
        relativeFilePath: "typed.md",
        fileContent: "typed subagent content",
      });

      // Should be both ToolSubagent and ToolFile
      expect(subagent).toBeInstanceOf(TestToolSubagent);
      expect(subagent).toBeInstanceOf(ToolSubagent);
    });
  });

  describe("parameter type validation", () => {
    it("should accept ToolSubagentFromRulesyncSubagentParams", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "param-test.md",
        fileContent: "parameter test content",
        frontmatter: {
          targets: ["cursor"],
          name: "Param Test",
          description: "Parameter test",
        },
        body: "parameter test content",
      });

      const params: ToolSubagentFromRulesyncSubagentParams = {
        baseDir: "/test",
        relativeDirPath: ".tool/subagents",
        rulesyncSubagent,
      };

      const subagent = TestToolSubagent.fromRulesyncSubagent(params);
      expect(subagent.getFileContent()).toBe("parameter test content");
    });

    it("should handle optional parameters", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "minimal.md",
        fileContent: "minimal content",
        frontmatter: {
          targets: ["cursor"],
          name: "Minimal",
          description: "Minimal test",
        },
        body: "minimal content",
      });

      const params: ToolSubagentFromRulesyncSubagentParams = {
        relativeDirPath: ".tool/subagents",
        rulesyncSubagent,
      };

      const subagent = TestToolSubagent.fromRulesyncSubagent(params);
      expect(subagent.getFileContent()).toBe("minimal content");
    });
  });
});
