import { describe, expect, it } from "vitest";
import { ValidationResult } from "../types/ai-file.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";
import {
  ToolSubagent,
  ToolSubagentFromFileParams,
  ToolSubagentFromRulesyncSubagentParams,
} from "./tool-subagent.js";

// Test implementation of ToolSubagent for testing abstract class behavior
class TestToolSubagent extends ToolSubagent {
  static async fromFile(_params: ToolSubagentFromFileParams): Promise<TestToolSubagent> {
    return new TestToolSubagent({
      baseDir: _params.baseDir || ".",
      relativeDirPath: ".test",
      relativeFilePath: _params.relativeFilePath,
      fileContent: "test tool subagent content",
    });
  }

  static fromRulesyncSubagent(params: ToolSubagentFromRulesyncSubagentParams): TestToolSubagent {
    const { rulesyncSubagent, ...rest } = params;
    const frontmatter = rulesyncSubagent.getFrontmatter();
    const body = rulesyncSubagent.getBody();

    return new TestToolSubagent({
      ...rest,
      baseDir: rest.baseDir || ".",
      relativeDirPath: ".test",
      relativeFilePath: "test-tool.md",
      fileContent: `---\nname: ${frontmatter.name}\ndescription: ${frontmatter.description}\n---\n${body}`,
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
      error: null,
    };
  }

  toRulesyncSubagent(): RulesyncSubagent {
    return new RulesyncSubagent({
      baseDir: this.baseDir,
      relativeDirPath: ".rulesync/subagents",
      relativeFilePath: "converted.md",
      fileContent: this.fileContent,
      frontmatter: {
        name: "test-subagent",
        description: "Test subagent description",
        targets: ["*"],
      },
      body: "Converted content from tool subagent",
      validate: false,
    });
  }
}

describe("ToolSubagent", () => {
  describe("abstract class characteristics", () => {
    it("should be abstract (cannot be instantiated directly)", () => {
      const toolSubagent = new TestToolSubagent({
        relativeDirPath: ".test",
        relativeFilePath: "test.md",
        fileContent: "test content",
      });

      expect(toolSubagent).toBeInstanceOf(TestToolSubagent);
      expect(toolSubagent).toBeInstanceOf(ToolSubagent);
    });

    it("should throw error when calling fromFile on base class", async () => {
      await expect(
        ToolSubagent.fromFile({
          relativeFilePath: "test.md",
        }),
      ).rejects.toThrow("Please implement this method in the subclass.");
    });

    it("should throw error when calling fromRulesyncSubagent on base class", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        baseDir: ".",
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "test.md",
        fileContent: "---\nname: test\ndescription: test desc\ntargets: [all]\n---\ntest body",
        frontmatter: {
          name: "test",
          description: "test desc",
          targets: ["*"],
        },
        body: "test body",
        validate: false,
      });

      expect(() => {
        ToolSubagent.fromRulesyncSubagent({
          rulesyncSubagent,
          baseDir: ".",
          relativeDirPath: ".test",
        });
      }).toThrow("Please implement this method in the subclass.");
    });
  });

  describe("inheritance from ToolFile", () => {
    it("should inherit all ToolFile and AiFile functionality", () => {
      const toolSubagent = new TestToolSubagent({
        relativeDirPath: ".test",
        relativeFilePath: "test.md",
        fileContent: "test content",
      });

      // Should have all AiFile methods
      expect(toolSubagent.getRelativeDirPath()).toBe(".test");
      expect(toolSubagent.getRelativeFilePath()).toBe("test.md");
      expect(toolSubagent.getFileContent()).toBe("test content");
      expect(typeof toolSubagent.getFilePath).toBe("function");
      expect(typeof toolSubagent.validate).toBe("function");
      expect(typeof toolSubagent.toRulesyncSubagent).toBe("function");
    });

    it("should support validation", () => {
      const validToolSubagent = new TestToolSubagent({
        relativeDirPath: ".test",
        relativeFilePath: "valid.md",
        fileContent: "valid content",
      });

      const result = validToolSubagent.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });

    it("should support validation errors", () => {
      expect(() => {
        const _instance = new TestToolSubagent({
          relativeDirPath: ".test",
          relativeFilePath: "invalid.md",
          fileContent: "invalid content",
        });
      }).toThrow("Content contains invalid text");
    });

    it("should support skipping validation", () => {
      expect(() => {
        const _instance = new TestToolSubagent({
          relativeDirPath: ".test",
          relativeFilePath: "invalid.md",
          fileContent: "invalid content",
          validate: false,
        });
      }).not.toThrow();
    });
  });

  describe("concrete implementation functionality", () => {
    it("should work with fromFile static method", async () => {
      const toolSubagent = await TestToolSubagent.fromFile({
        baseDir: "/test",
        relativeFilePath: "config.md",
      });

      expect(toolSubagent).toBeInstanceOf(TestToolSubagent);
      expect(toolSubagent).toBeInstanceOf(ToolSubagent);
      expect(toolSubagent.getRelativeDirPath()).toBe(".test");
      expect(toolSubagent.getRelativeFilePath()).toBe("config.md");
      expect(toolSubagent.getFileContent()).toBe("test tool subagent content");
    });

    it("should work with fromRulesyncSubagent static method", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        baseDir: ".",
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "source.md",
        fileContent:
          "---\nname: source-agent\ndescription: Source agent description\ntargets: [all]\n---\nsource content",
        frontmatter: {
          name: "source-agent",
          description: "Source agent description",
          targets: ["*"],
        },
        body: "source content",
        validate: false,
      });

      const toolSubagent = TestToolSubagent.fromRulesyncSubagent({
        rulesyncSubagent,
        baseDir: "/test",
        relativeDirPath: ".test",
      });

      expect(toolSubagent).toBeInstanceOf(TestToolSubagent);
      expect(toolSubagent).toBeInstanceOf(ToolSubagent);
      expect(toolSubagent.getRelativeDirPath()).toBe(".test");
      expect(toolSubagent.getRelativeFilePath()).toBe("test-tool.md");
      expect(toolSubagent.getFileContent()).toContain("name: source-agent");
      expect(toolSubagent.getFileContent()).toContain("description: Source agent description");
      expect(toolSubagent.getFileContent()).toContain("source content");
    });

    it("should convert back to RulesyncSubagent", () => {
      const toolSubagent = new TestToolSubagent({
        relativeDirPath: ".test",
        relativeFilePath: "convert.md",
        fileContent: "content to convert",
      });

      const rulesyncSubagent = toolSubagent.toRulesyncSubagent();

      expect(rulesyncSubagent).toBeInstanceOf(RulesyncSubagent);
      expect(rulesyncSubagent.getFrontmatter().name).toBe("test-subagent");
      expect(rulesyncSubagent.getFrontmatter().description).toBe("Test subagent description");
      expect(rulesyncSubagent.getFrontmatter().targets).toEqual(["*"]);
      expect(rulesyncSubagent.getBody()).toBe("Converted content from tool subagent");
    });
  });

  describe("polymorphism", () => {
    it("should support polymorphic usage", () => {
      const toolSubagent: ToolSubagent = new TestToolSubagent({
        relativeDirPath: ".test",
        relativeFilePath: "poly.md",
        fileContent: "polymorphic content",
      });

      expect(toolSubagent.getRelativeDirPath()).toBe(".test");
      expect(toolSubagent.getRelativeFilePath()).toBe("poly.md");
      expect(toolSubagent.getFileContent()).toBe("polymorphic content");

      // Should be able to call abstract methods
      const rulesyncSubagent = toolSubagent.toRulesyncSubagent();
      expect(rulesyncSubagent).toBeInstanceOf(RulesyncSubagent);
    });

    it("should maintain type safety through inheritance", () => {
      const testSubagent = new TestToolSubagent({
        relativeDirPath: ".test",
        relativeFilePath: "typed.md",
        fileContent: "typed content",
      });

      // Should be both ToolSubagent and ToolFile
      expect(testSubagent).toBeInstanceOf(TestToolSubagent);
      expect(testSubagent).toBeInstanceOf(ToolSubagent);

      // Type assertions should work
      const toolSubagent: ToolSubagent = testSubagent;
      expect(toolSubagent.getFileContent()).toBe("typed content");

      const rulesyncSubagent = toolSubagent.toRulesyncSubagent();
      expect(rulesyncSubagent.getFrontmatter().name).toBe("test-subagent");
    });
  });

  describe("type definitions", () => {
    it("should have correct ToolSubagentFromFileParams type", () => {
      const params: ToolSubagentFromFileParams = {
        relativeFilePath: "test.md",
        baseDir: ".",
        validate: true,
      };

      expect(params.relativeFilePath).toBe("test.md");
      expect(params.baseDir).toBe(".");
      expect(params.validate).toBe(true);
    });

    it("should have correct ToolSubagentFromRulesyncSubagentParams type", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        baseDir: ".",
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "test.md",
        fileContent: "---\nname: test\ndescription: test desc\ntargets: [all]\n---\ntest body",
        frontmatter: {
          name: "test",
          description: "test desc",
          targets: ["*"],
        },
        body: "test body",
        validate: false,
      });

      const params: ToolSubagentFromRulesyncSubagentParams = {
        rulesyncSubagent,
        baseDir: ".",
        relativeDirPath: ".test",
        validate: true,
      };

      expect(params.rulesyncSubagent).toBe(rulesyncSubagent);
      expect(params.baseDir).toBe(".");
      expect(params.validate).toBe(true);
    });
  });
});
