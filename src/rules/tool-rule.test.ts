import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import {
  AiFile,
  AiFileFromFilePathParams,
  AiFileParams,
  ValidationResult,
} from "../types/ai-file.js";
import type { RuleFrontmatter } from "../types/rules.js";
import { RulesyncRule } from "./rulesync-rule.js";
import { ToolRule, ToolRuleFromRulesyncRuleParams } from "./tool-rule.js";

// Test implementation class for testing abstract methods
class TestToolRule extends ToolRule {
  private readonly body: string;
  private readonly frontmatter: RuleFrontmatter;

  constructor(params: AiFileParams & { body: string; frontmatter: RuleFrontmatter }) {
    super(params);
    this.body = params.body;
    this.frontmatter = params.frontmatter;
  }

  static async fromFilePath(params: AiFileFromFilePathParams): Promise<TestToolRule> {
    const fileContent =
      '---\nroot: true\ntargets: ["*"]\ndescription: "Test rule"\nglobs: ["**/*.ts"]\n---\n\nTest rule content';
    const frontmatter: RuleFrontmatter = {
      root: true,
      targets: ["*"],
      description: "Test rule",
      globs: ["**/*.ts"],
    };

    return new TestToolRule({
      baseDir: params.baseDir || ".",
      relativeDirPath: params.relativeDirPath,
      relativeFilePath: params.relativeFilePath,
      fileContent,
      body: "Test rule content",
      frontmatter,
      validate: params.validate ?? true,
    });
  }

  static fromRulesyncRule(params: ToolRuleFromRulesyncRuleParams): TestToolRule {
    const { rulesyncRule, ...rest } = params;
    return new TestToolRule({
      ...rest,
      fileContent: rulesyncRule.getFileContent(),
      relativeFilePath: rulesyncRule.getRelativeFilePath(),
      body: rulesyncRule.getBody(),
      frontmatter: rulesyncRule.getFrontmatter(),
    });
  }

  toRulesyncRule(): RulesyncRule {
    return new RulesyncRule({
      baseDir: this.getBaseDir(),
      relativeDirPath: this.getRelativeDirPath(),
      relativeFilePath: this.getRelativeFilePath(),
      frontmatter: this.frontmatter,
      body: this.body,
      fileContent: this.getFileContent(),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }
}

describe("ToolRule", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("abstract class behavior", () => {
    it("should throw error when calling fromFilePath on abstract class", async () => {
      const params: AiFileFromFilePathParams = {
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        filePath: join(testDir, "rules", "test.md"),
      };

      await expect(ToolRule.fromFilePath(params)).rejects.toThrow(
        "Please implement this method in the subclass.",
      );
    });

    it("should throw error when calling fromRulesyncRule on abstract class", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        frontmatter: {
          root: true,
          targets: ["*"],
          description: "Test rule",
          globs: ["**/*.ts"],
        },
        body: "Test content",
        fileContent: "---\nroot: true\n---\nTest content",
      });

      const params: ToolRuleFromRulesyncRuleParams = {
        baseDir: testDir,
        relativeDirPath: "rules",
        rulesyncRule,
      };

      expect(() => ToolRule.fromRulesyncRule(params)).toThrow(
        "Please implement this method in the subclass.",
      );
    });
  });

  describe("concrete implementation", () => {
    it("should create instance from file path", async () => {
      const params: AiFileFromFilePathParams = {
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        filePath: join(testDir, "rules", "test.md"),
      };

      const rule = await TestToolRule.fromFilePath(params);

      expect(rule).toBeInstanceOf(TestToolRule);
      expect(rule).toBeInstanceOf(ToolRule);
      expect(rule).toBeInstanceOf(AiFile);
      expect(rule.getRelativeFilePath()).toBe("test.md");
      expect(rule.getRelativeDirPath()).toBe("rules");
    });

    it("should create instance from RulesyncRule", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        frontmatter: {
          root: true,
          targets: ["*"],
          description: "Test rule",
          globs: ["**/*.ts"],
        },
        body: "Test content",
        fileContent: "---\nroot: true\n---\nTest content",
      });

      const params: ToolRuleFromRulesyncRuleParams = {
        baseDir: testDir,
        relativeDirPath: "rules",
        rulesyncRule,
      };

      const rule = TestToolRule.fromRulesyncRule(params);

      expect(rule).toBeInstanceOf(TestToolRule);
      expect(rule).toBeInstanceOf(ToolRule);
      expect(rule.getRelativeFilePath()).toBe("test.md");
    });

    it("should convert back to RulesyncRule", async () => {
      const originalRulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        frontmatter: {
          root: true,
          targets: ["*"],
          description: "Test rule",
          globs: ["**/*.ts"],
        },
        body: "Test content",
        fileContent: "---\nroot: true\n---\nTest content",
      });

      const params: ToolRuleFromRulesyncRuleParams = {
        baseDir: testDir,
        relativeDirPath: "rules",
        rulesyncRule: originalRulesyncRule,
      };

      const toolRule = TestToolRule.fromRulesyncRule(params);
      const convertedRulesyncRule = toolRule.toRulesyncRule();

      expect(convertedRulesyncRule).toBeInstanceOf(RulesyncRule);
      expect(convertedRulesyncRule.getRelativeFilePath()).toBe(
        originalRulesyncRule.getRelativeFilePath(),
      );
      expect(convertedRulesyncRule.getFrontmatter()).toEqual(originalRulesyncRule.getFrontmatter());
      expect(convertedRulesyncRule.getBody()).toBe(originalRulesyncRule.getBody());
    });

    it("should validate successfully", () => {
      const rule = new TestToolRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        fileContent: "test content",
        body: "Test content",
        frontmatter: {
          root: true,
          targets: ["*"],
          description: "Test rule",
          globs: ["**/*.ts"],
        },
      });

      const result = rule.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });
  });

  describe("inheritance from AiFile", () => {
    it("should inherit AiFile methods", () => {
      const rule = new TestToolRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        fileContent: "test content",
        body: "Test content",
        frontmatter: {
          root: true,
          targets: ["*"],
          description: "Test rule",
          globs: ["**/*.ts"],
        },
      });

      expect(rule.getRelativeDirPath()).toBe("rules");
      expect(rule.getRelativeFilePath()).toBe("test.md");
      expect(rule.getFilePath()).toBe(join(testDir, "rules", "test.md"));
      expect(rule.getFileContent()).toBe("test content");
    });
  });
});
