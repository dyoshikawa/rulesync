import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_OVERVIEW_FILE_NAME,
  RULESYNC_RELATIVE_DIR_PATH,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { type ValidationResult } from "../../types/ai-file.js";
import { ensureDir, readFileContent, writeFileContent } from "../../utils/file.js";
import { RulesyncRule } from "./rulesync-rule.js";
import {
  ToolRule,
  type ToolRuleFromFileParams,
  type ToolRuleFromRulesyncRuleParams,
  buildToolPath,
} from "./tool-rule.js";

// Create a concrete implementation of ToolRule for testing
class TestToolRule extends ToolRule {
  static async fromFile(params: ToolRuleFromFileParams): Promise<TestToolRule> {
    const { baseDir = process.cwd(), relativeFilePath, validate = true } = params;
    const filePath = join(baseDir, ".test/rules", relativeFilePath);
    const fileContent = await readFileContent(filePath);

    return new TestToolRule({
      baseDir,
      relativeDirPath: ".test/rules",
      relativeFilePath,
      fileContent,
      validate,
    });
  }

  static fromRulesyncRule(params: ToolRuleFromRulesyncRuleParams): TestToolRule {
    const toolRuleParams = this.buildToolRuleParamsDefault({
      ...params,
      rootPath: { relativeDirPath: ".", relativeFilePath: "TEST_AGENTS.md" },
      nonRootPath: { relativeDirPath: ".test/memories" },
    });

    return new TestToolRule(toolRuleParams);
  }

  toRulesyncRule(): RulesyncRule {
    return this.toRulesyncRuleDefault();
  }

  validate(): ValidationResult {
    // Simple validation for testing
    if (this.getFileContent().trim() === "") {
      return { success: false, error: new Error("Content cannot be empty") };
    }
    return { success: true, error: null };
  }

  static isTargetedByRulesyncRule(rulesyncRule: RulesyncRule): boolean {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "claudecode", // Using claudecode as test target
    });
  }
}

describe("ToolRule", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("constructor", () => {
    it("should create instance with default parameters", () => {
      const toolRule = new TestToolRule({
        relativeDirPath: ".test/rules",
        relativeFilePath: "test-rule.md",
        fileContent: "# Test Rule\n\nThis is a test rule.",
      });

      expect(toolRule).toBeInstanceOf(TestToolRule);
      expect(toolRule).toBeInstanceOf(ToolRule);
      expect(toolRule.getRelativeDirPath()).toBe(".test/rules");
      expect(toolRule.getRelativeFilePath()).toBe("test-rule.md");
      expect(toolRule.getFileContent()).toBe("# Test Rule\n\nThis is a test rule.");
      expect(toolRule.isRoot()).toBe(false);
      expect(toolRule.getDescription()).toBeUndefined();
      expect(toolRule.getGlobs()).toBeUndefined();
    });

    it("should create instance with description", () => {
      const toolRule = new TestToolRule({
        relativeDirPath: ".test/rules",
        relativeFilePath: "test-rule.md",
        fileContent: "# Test Rule",
        description: "This is a test description",
      });

      expect(toolRule.getDescription()).toBe("This is a test description");
    });

    it("should create instance with globs", () => {
      const toolRule = new TestToolRule({
        relativeDirPath: ".test/rules",
        relativeFilePath: "test-rule.md",
        fileContent: "# Test Rule",
        globs: ["**/*.ts", "**/*.js"],
      });

      expect(toolRule.getGlobs()).toEqual(["**/*.ts", "**/*.js"]);
    });

    it("should create instance with both description and globs", () => {
      const toolRule = new TestToolRule({
        relativeDirPath: ".test/rules",
        relativeFilePath: "test-rule.md",
        fileContent: "# Test Rule",
        description: "Test description",
        globs: ["src/**/*"],
      });

      expect(toolRule.getDescription()).toBe("Test description");
      expect(toolRule.getGlobs()).toEqual(["src/**/*"]);
    });

    it("should create instance with custom baseDir", () => {
      const toolRule = new TestToolRule({
        baseDir: "/custom/path",
        relativeDirPath: ".test/rules",
        relativeFilePath: "test-rule.md",
        fileContent: "# Custom Rule",
      });

      expect(toolRule.getFilePath()).toBe("/custom/path/.test/rules/test-rule.md");
      expect(toolRule.isRoot()).toBe(false);
    });

    it("should handle root parameter as false by default", () => {
      const toolRule = new TestToolRule({
        relativeDirPath: ".test/rules",
        relativeFilePath: "test-rule.md",
        fileContent: "# Test Rule",
      });

      expect(toolRule.isRoot()).toBe(false);
    });

    it("should handle root parameter as true", () => {
      const toolRule = new TestToolRule({
        relativeDirPath: ".test/rules",
        relativeFilePath: "test-rule.md",
        fileContent: "# Root Rule",
        root: true,
      });

      expect(toolRule.isRoot()).toBe(true);
    });

    it("should handle root parameter as false explicitly", () => {
      const toolRule = new TestToolRule({
        relativeDirPath: ".test/rules",
        relativeFilePath: "test-rule.md",
        fileContent: "# Non-Root Rule",
        root: false,
      });

      expect(toolRule.isRoot()).toBe(false);
    });

    it("should skip validation when requested", () => {
      expect(() => {
        new TestToolRule({
          relativeDirPath: ".test/rules",
          relativeFilePath: "test-rule.md",
          fileContent: "", // Would normally fail validation
          validate: false,
        });
      }).not.toThrow();
    });
  });

  describe("static fromFile method", () => {
    it("should throw error when not implemented in base class", async () => {
      await expect(
        ToolRule.fromFile({
          baseDir: testDir,
          relativeFilePath: "test.md",
        }),
      ).rejects.toThrow("Please implement this method in the subclass.");
    });

    it("should work when implemented in subclass", async () => {
      // Setup test file
      const rulesDir = join(testDir, ".test/rules");
      await ensureDir(rulesDir);
      const testContent = "# Test Rule from File\n\nContent from file.";
      await writeFileContent(join(rulesDir, "test.md"), testContent);

      const toolRule = await TestToolRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "test.md",
      });

      expect(toolRule).toBeInstanceOf(TestToolRule);
      expect(toolRule.getRelativeDirPath()).toBe(".test/rules");
      expect(toolRule.getRelativeFilePath()).toBe("test.md");
      expect(toolRule.getFileContent()).toBe(testContent);
      expect(toolRule.getFilePath()).toBe(join(testDir, ".test/rules/test.md"));
    });

    it("should use default baseDir when not provided", async () => {
      // Setup test file in test directory (process.cwd() is mocked to return testDir)
      const rulesDir = join(testDir, ".test/rules");
      await ensureDir(rulesDir);
      const testContent = "# Default BaseDir Test";
      const testFilePath = join(rulesDir, "default-test.md");
      await writeFileContent(testFilePath, testContent);

      const toolRule = await TestToolRule.fromFile({
        relativeFilePath: "default-test.md",
      });

      expect(toolRule.getRelativeDirPath()).toBe(".test/rules");
      expect(toolRule.getRelativeFilePath()).toBe("default-test.md");
      expect(toolRule.getFileContent()).toBe(testContent);
      expect(toolRule.getFilePath()).toBe(join(testDir, ".test/rules/default-test.md"));
    });

    it("should handle validation parameter", async () => {
      const rulesDir = join(testDir, ".test/rules");
      await ensureDir(rulesDir);
      const testContent = "# Validation Test";
      await writeFileContent(join(rulesDir, "validation-test.md"), testContent);

      const toolRuleWithValidation = await TestToolRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "validation-test.md",
        validate: true,
      });

      const toolRuleWithoutValidation = await TestToolRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "validation-test.md",
        validate: false,
      });

      expect(toolRuleWithValidation.getFileContent()).toBe(testContent);
      expect(toolRuleWithoutValidation.getFileContent()).toBe(testContent);
    });

    it("should throw error when file does not exist", async () => {
      await expect(
        TestToolRule.fromFile({
          baseDir: testDir,
          relativeFilePath: "nonexistent.md",
        }),
      ).rejects.toThrow();
    });
  });

  describe("static fromRulesyncRule method", () => {
    it("should throw error when not implemented in base class", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "test-rule.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "Test rule",
          globs: [],
        },
        body: "# Test RulesyncRule",
      });

      expect(() => {
        ToolRule.fromRulesyncRule({ rulesyncRule });
      }).toThrow("Please implement this method in the subclass.");
    });

    it("should create instance from RulesyncRule with non-root rule", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "test-rule.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "Test rule",
          globs: [],
        },
        body: "# Test RulesyncRule\n\nContent from rulesync.",
      });

      const toolRule = TestToolRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(toolRule).toBeInstanceOf(TestToolRule);
      expect(toolRule.getRelativeDirPath()).toBe(".test/memories");
      expect(toolRule.getRelativeFilePath()).toBe("test-rule.md");
      expect(toolRule.getFileContent()).toBe("# Test RulesyncRule\n\nContent from rulesync.");
      expect(toolRule.isRoot()).toBe(false);
      expect(toolRule.getDescription()).toBe("Test rule");
      expect(toolRule.getGlobs()).toEqual([]);
    });

    it("should create instance from RulesyncRule with root rule", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "root-rule.md",
        frontmatter: {
          root: true,
          targets: ["*"],
          description: "Root rule",
          globs: ["**/*"],
        },
        body: "# Root RulesyncRule\n\nThis is a root rule.",
      });

      const toolRule = TestToolRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(toolRule).toBeInstanceOf(TestToolRule);
      expect(toolRule.getRelativeDirPath()).toBe(".");
      expect(toolRule.getRelativeFilePath()).toBe("TEST_AGENTS.md");
      expect(toolRule.getFileContent()).toBe("# Root RulesyncRule\n\nThis is a root rule.");
      expect(toolRule.isRoot()).toBe(true);
      expect(toolRule.getDescription()).toBe("Root rule");
      expect(toolRule.getGlobs()).toEqual(["**/*"]);
    });

    it("should handle undefined description and globs in frontmatter", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "minimal-rule.md",
        frontmatter: {
          root: false,
          targets: ["*"],
        } as any,
        body: "# Minimal Rule",
      });

      const toolRule = TestToolRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(toolRule.getDescription()).toBeUndefined();
      expect(toolRule.getGlobs()).toBeUndefined();
    });

    it("should use custom baseDir", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "custom-base.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "",
          globs: [],
        },
        body: "# Custom Base Directory",
      });

      const toolRule = TestToolRule.fromRulesyncRule({
        baseDir: "/custom/base",
        rulesyncRule,
      });

      expect(toolRule.getFilePath()).toBe("/custom/base/.test/memories/custom-base.md");
      expect(toolRule.isRoot()).toBe(false);
    });

    it("should handle validation parameter", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "validation.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "",
          globs: [],
        },
        body: "# Validation Test",
      });

      const toolRuleWithValidation = TestToolRule.fromRulesyncRule({
        rulesyncRule,
        validate: true,
      });

      const toolRuleWithoutValidation = TestToolRule.fromRulesyncRule({
        rulesyncRule,
        validate: false,
      });

      expect(toolRuleWithValidation.getFileContent()).toBe("# Validation Test");
      expect(toolRuleWithoutValidation.getFileContent()).toBe("# Validation Test");
    });

    it("should handle undefined root frontmatter as false", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "no-root-frontmatter.md",
        frontmatter: {
          targets: ["*"],
          description: "",
          globs: [],
        } as any, // root is undefined
        body: "# No Root Frontmatter",
      });

      const toolRule = TestToolRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(toolRule.isRoot()).toBe(false);
      expect(toolRule.getRelativeDirPath()).toBe(".test/memories");
    });
  });

  describe("buildToolRuleParamsAgentsmd", () => {
    it("should build params for non-root rule with subprojectPath", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "test-rule.md",
        frontmatter: {
          root: false,
          targets: ["agentsmd"],
          description: "Test rule",
          globs: [],
          agentsmd: {
            subprojectPath: "packages/my-app",
          },
        },
        body: "# Test Rule",
      });

      const params = (TestToolRule as any).buildToolRuleParamsAgentsmd({
        rulesyncRule,
      });

      expect(params.relativeDirPath).toBe("packages/my-app");
      expect(params.relativeFilePath).toBe("AGENTS.md");
      expect(params.fileContent).toBe("# Test Rule");
      expect(params.validate).toBe(true);
      expect(params.root).toBe(false);
      expect(params.description).toBe("Test rule");
      expect(params.globs).toEqual([]);
    });

    it("should build params for non-root rule without subprojectPath", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "test-rule.md",
        frontmatter: {
          root: false,
          targets: ["agentsmd"],
          description: "Test rule",
          globs: [],
        },
        body: "# Test Rule",
      });

      const params = (TestToolRule as any).buildToolRuleParamsAgentsmd({
        rulesyncRule,
      });

      expect(params.relativeDirPath).toBe(".agents/memories");
      expect(params.relativeFilePath).toBe("test-rule.md");
      expect(params.fileContent).toBe("# Test Rule");
      expect(params.validate).toBe(true);
      expect(params.root).toBe(false);
      expect(params.description).toBe("Test rule");
      expect(params.globs).toEqual([]);
    });

    it("should build params for root rule (ignoring subprojectPath)", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "root-rule.md",
        frontmatter: {
          root: true,
          targets: ["agentsmd"],
          description: "Root rule",
          globs: ["**/*"],
          agentsmd: {
            subprojectPath: "packages/my-app", // Should be ignored for root rules
          },
        },
        body: "# Root Rule",
      });

      const params = (TestToolRule as any).buildToolRuleParamsAgentsmd({
        rulesyncRule,
      });

      expect(params.relativeDirPath).toBe(".");
      expect(params.relativeFilePath).toBe("AGENTS.md");
      expect(params.fileContent).toBe("# Root Rule");
      expect(params.validate).toBe(true);
      expect(params.root).toBe(true);
      expect(params.description).toBe("Root rule");
      expect(params.globs).toEqual(["**/*"]);
    });

    it("should handle empty subprojectPath", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "test-rule.md",
        frontmatter: {
          root: false,
          targets: ["agentsmd"],
          description: "Test rule",
          globs: [],
          agentsmd: {
            subprojectPath: "",
          },
        },
        body: "# Test Rule",
      });

      const params = (TestToolRule as any).buildToolRuleParamsAgentsmd({
        rulesyncRule,
      });

      expect(params.relativeDirPath).toBe(".agents/memories");
      expect(params.relativeFilePath).toBe("test-rule.md");
      expect(params.fileContent).toBe("# Test Rule");
      expect(params.validate).toBe(true);
      expect(params.root).toBe(false);
      expect(params.description).toBe("Test rule");
      expect(params.globs).toEqual([]);
    });

    it("should handle undefined agentsmd field", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "test-rule.md",
        frontmatter: {
          root: false,
          targets: ["agentsmd"],
          description: "Test rule",
          globs: [],
        },
        body: "# Test Rule",
      });

      const params = (TestToolRule as any).buildToolRuleParamsAgentsmd({
        rulesyncRule,
      });

      expect(params.relativeDirPath).toBe(".agents/memories");
      expect(params.relativeFilePath).toBe("test-rule.md");
      expect(params.fileContent).toBe("# Test Rule");
      expect(params.validate).toBe(true);
      expect(params.root).toBe(false);
      expect(params.description).toBe("Test rule");
      expect(params.globs).toEqual([]);
    });

    it("should use custom baseDir", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "custom.md",
        frontmatter: {
          root: false,
          targets: ["agentsmd"],
          description: "",
          globs: [],
          agentsmd: {
            subprojectPath: "subdir",
          },
        },
        body: "# Custom",
      });

      const params = (TestToolRule as any).buildToolRuleParamsAgentsmd({
        baseDir: "/custom/path",
        rulesyncRule,
      });

      expect(params.baseDir).toBe("/custom/path");
      expect(params.relativeDirPath).toBe("subdir");
    });

    it("should use custom validation setting", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "no-validate.md",
        frontmatter: {
          root: false,
          targets: ["agentsmd"],
          description: "",
          globs: [],
          agentsmd: {
            subprojectPath: "test",
          },
        },
        body: "# No Validation",
      });

      const params = (TestToolRule as any).buildToolRuleParamsAgentsmd({
        rulesyncRule,
        validate: false,
      });

      expect(params.validate).toBe(false);
    });

    it("should handle complex nested subprojectPath", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "nested.md",
        frontmatter: {
          root: false,
          targets: ["agentsmd"],
          description: "Nested rule",
          globs: ["**/*.ts"],
          agentsmd: {
            subprojectPath: "packages/apps/my-app/src",
          },
        },
        body: "# Nested Rule",
      });

      const params = (TestToolRule as any).buildToolRuleParamsAgentsmd({
        rulesyncRule,
      });

      expect(params.relativeDirPath).toBe("packages/apps/my-app/src");
      expect(params.relativeFilePath).toBe("AGENTS.md");
    });
  });

  describe("buildToolRuleParamsDefault", () => {
    it("should build params for non-root rule with defaults", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "test-rule.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "Test rule",
          globs: [],
        },
        body: "# Test Rule",
      });

      const params = (TestToolRule as any).buildToolRuleParamsDefault({
        rulesyncRule,
        nonRootPath: { relativeDirPath: ".agents/memories" },
      });

      expect(params.relativeDirPath).toBe(".agents/memories");
      expect(params.relativeFilePath).toBe("test-rule.md");
      expect(params.fileContent).toBe("# Test Rule");
      expect(params.validate).toBe(true);
      expect(params.root).toBe(false);
      expect(params.description).toBe("Test rule");
      expect(params.globs).toEqual([]);
    });

    it("should build params for root rule with defaults", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "root-rule.md",
        frontmatter: {
          root: true,
          targets: ["*"],
          description: "Root rule",
          globs: ["**/*"],
        },
        body: "# Root Rule",
      });

      const params = (TestToolRule as any).buildToolRuleParamsDefault({
        rulesyncRule,
      });

      expect(params.relativeDirPath).toBe(".");
      expect(params.relativeFilePath).toBe("AGENTS.md");
      expect(params.fileContent).toBe("# Root Rule");
      expect(params.validate).toBe(true);
      expect(params.root).toBe(true);
      expect(params.description).toBe("Root rule");
      expect(params.globs).toEqual(["**/*"]);
    });

    it("should handle undefined description and globs", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "minimal.md",
        frontmatter: {
          root: false,
          targets: ["*"],
        } as any,
        body: "# Minimal",
      });

      const params = (TestToolRule as any).buildToolRuleParamsDefault({
        rulesyncRule,
        nonRootPath: { relativeDirPath: ".agents/memories" },
      });

      expect(params.description).toBeUndefined();
      expect(params.globs).toBeUndefined();
    });

    it("should use custom baseDir", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "custom.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "",
          globs: [],
        },
        body: "# Custom",
      });

      const params = (TestToolRule as any).buildToolRuleParamsDefault({
        baseDir: "/custom/path",
        rulesyncRule,
        nonRootPath: { relativeDirPath: ".agents/memories" },
      });

      expect(params.baseDir).toBe("/custom/path");
    });

    it("should use custom validation setting", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "no-validate.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "",
          globs: [],
        },
        body: "# No Validation",
      });

      const params = (TestToolRule as any).buildToolRuleParamsDefault({
        rulesyncRule,
        validate: false,
        nonRootPath: { relativeDirPath: ".agents/memories" },
      });

      expect(params.validate).toBe(false);
    });

    it("should use custom rootPath configuration", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "custom-root.md",
        frontmatter: {
          root: true,
          targets: ["*"],
          description: "",
          globs: ["**/*"],
        },
        body: "# Custom Root",
      });

      const params = (TestToolRule as any).buildToolRuleParamsDefault({
        rulesyncRule,
        rootPath: { relativeDirPath: "custom/root", relativeFilePath: "CUSTOM.md" },
      });

      expect(params.relativeDirPath).toBe("custom/root");
      expect(params.relativeFilePath).toBe("CUSTOM.md");
    });

    it("should use custom nonRootPath configuration", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "custom-non-root.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "",
          globs: [],
        },
        body: "# Custom Non-Root",
      });

      const params = (TestToolRule as any).buildToolRuleParamsDefault({
        rulesyncRule,
        nonRootPath: { relativeDirPath: "custom/memories" },
      });

      expect(params.relativeDirPath).toBe("custom/memories");
      expect(params.relativeFilePath).toBe("custom-non-root.md");
    });
  });

  describe("isRoot", () => {
    it("should return false for non-root rule", () => {
      const toolRule = new TestToolRule({
        relativeDirPath: ".test/rules",
        relativeFilePath: "test-rule.md",
        fileContent: "# Non-Root Rule",
        root: false,
      });

      expect(toolRule.isRoot()).toBe(false);
    });

    it("should return true for root rule", () => {
      const toolRule = new TestToolRule({
        relativeDirPath: ".test/rules",
        relativeFilePath: "test-rule.md",
        fileContent: "# Root Rule",
        root: true,
      });

      expect(toolRule.isRoot()).toBe(true);
    });

    it("should return false by default when root is not specified", () => {
      const toolRule = new TestToolRule({
        relativeDirPath: ".test/rules",
        relativeFilePath: "test-rule.md",
        fileContent: "# Default Rule",
      });

      expect(toolRule.isRoot()).toBe(false);
    });
  });

  describe("abstract toRulesyncRule method", () => {
    it("should be implemented in concrete subclass", () => {
      const toolRule = new TestToolRule({
        baseDir: testDir,
        relativeDirPath: ".test/rules",
        relativeFilePath: "convert-test.md",
        fileContent: "# Convert Test\n\nThis will be converted.",
      });

      const rulesyncRule = toolRule.toRulesyncRule();

      expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
      expect(rulesyncRule.getRelativeDirPath()).toBe(RULESYNC_RULES_RELATIVE_DIR_PATH);
      expect(rulesyncRule.getRelativeFilePath()).toBe("convert-test.md");
      expect(rulesyncRule.getBody()).toBe("# Convert Test\n\nThis will be converted.");
    });
  });

  describe("toRulesyncRuleDefault", () => {
    it("should create RulesyncRule with default frontmatter for non-root rule", () => {
      const toolRule = new TestToolRule({
        baseDir: testDir,
        relativeDirPath: ".test/rules",
        relativeFilePath: "non-root.md",
        fileContent: "# Non-Root Rule",
        root: false,
      });

      const rulesyncRule = (toolRule as any).toRulesyncRuleDefault();

      expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
      expect(rulesyncRule.getBaseDir()).toBe(testDir);
      expect(rulesyncRule.getRelativeDirPath()).toBe(RULESYNC_RULES_RELATIVE_DIR_PATH);
      expect(rulesyncRule.getRelativeFilePath()).toBe("non-root.md");
      expect(rulesyncRule.getBody()).toBe("# Non-Root Rule");

      const frontmatter = rulesyncRule.getFrontmatter();
      expect(frontmatter.root).toBe(false);
      expect(frontmatter.targets).toEqual(["*"]);
      expect(frontmatter.description).toBeUndefined();
      expect(frontmatter.globs).toEqual([]);
    });

    it("should create RulesyncRule with description and globs", () => {
      const toolRule = new TestToolRule({
        baseDir: testDir,
        relativeDirPath: ".test/rules",
        relativeFilePath: "with-metadata.md",
        fileContent: "# Rule with metadata",
        root: false,
        description: "Test description",
        globs: ["**/*.ts"],
      });

      const rulesyncRule = (toolRule as any).toRulesyncRuleDefault();

      const frontmatter = rulesyncRule.getFrontmatter();
      expect(frontmatter.description).toBe("Test description");
      expect(frontmatter.globs).toEqual(["**/*.ts"]);
    });

    it("should create RulesyncRule with default frontmatter for root rule", () => {
      const toolRule = new TestToolRule({
        baseDir: testDir,
        relativeDirPath: ".test/rules",
        relativeFilePath: "root.md",
        fileContent: "# Root Rule",
        root: true,
      });

      const rulesyncRule = (toolRule as any).toRulesyncRuleDefault();

      expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
      expect(rulesyncRule.getBaseDir()).toBe(testDir);
      expect(rulesyncRule.getRelativeDirPath()).toBe(RULESYNC_RULES_RELATIVE_DIR_PATH);
      expect(rulesyncRule.getRelativeFilePath()).toBe(RULESYNC_OVERVIEW_FILE_NAME);
      expect(rulesyncRule.getBody()).toBe("# Root Rule");

      const frontmatter = rulesyncRule.getFrontmatter();
      expect(frontmatter.root).toBe(true);
      expect(frontmatter.targets).toEqual(["*"]);
      expect(frontmatter.description).toBeUndefined();
      expect(frontmatter.globs).toEqual(["**/*"]);
    });
  });

  describe("integration tests", () => {
    it("should handle complete workflow from file to rulesync rule", async () => {
      // Create original file
      const rulesDir = join(testDir, ".test/rules");
      await ensureDir(rulesDir);
      const originalContent = "# Integration Test\n\nComplete workflow test.";
      await writeFileContent(join(rulesDir, "integration.md"), originalContent);

      // Load from file
      const toolRule = await TestToolRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "integration.md",
      });

      // Convert to rulesync rule
      const rulesyncRule = toolRule.toRulesyncRule();

      // Verify conversion
      expect(rulesyncRule.getBody()).toBe(originalContent);
      expect(rulesyncRule.getRelativeDirPath()).toBe(RULESYNC_RULES_RELATIVE_DIR_PATH);
      expect(rulesyncRule.getRelativeFilePath()).toBe("integration.md");
    });

    it("should handle roundtrip conversion rulesync -> tool -> rulesync", () => {
      const originalBody = "# Roundtrip Test\n\nContent should remain the same.";

      // Start with rulesync rule
      const originalRulesync = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "roundtrip.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "",
          globs: [],
        },
        body: originalBody,
      });

      // Convert to tool rule
      const toolRule = TestToolRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule: originalRulesync,
      });

      // Convert back to rulesync rule
      const finalRulesync = toolRule.toRulesyncRule();

      // Verify content preservation
      expect(finalRulesync.getBody()).toBe(originalBody);
      expect(finalRulesync.getRelativeFilePath()).toBe("roundtrip.md");
    });

    it("should preserve root status through roundtrip conversion", () => {
      const originalBody = "# Root Roundtrip Test";

      // Start with root rulesync rule
      const originalRulesync = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "root-roundtrip.md",
        frontmatter: {
          root: true,
          targets: ["*"],
          description: "",
          globs: ["**/*"],
        },
        body: originalBody,
      });

      // Convert to tool rule
      const toolRule = TestToolRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule: originalRulesync,
      });

      expect(toolRule.isRoot()).toBe(true);

      // Convert back to rulesync rule
      const finalRulesync = toolRule.toRulesyncRule();

      // Verify root status preservation
      expect(finalRulesync.getFrontmatter().root).toBe(true);
      expect(finalRulesync.getFrontmatter().globs).toEqual(["**/*"]);
    });
  });

  describe("isTargetedByRulesyncRule", () => {
    it("should return true for rules targeting claudecode", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["claudecode"],
        },
        body: "Test content",
      });

      expect(TestToolRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should return true for rules targeting all tools (*)", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["*"],
        },
        body: "Test content",
      });

      expect(TestToolRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should return false for rules not targeting claudecode", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["cursor", "copilot"],
        },
        body: "Test content",
      });

      expect(TestToolRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(false);
    });

    it("should return false for empty targets", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          targets: [],
        },
        body: "Test content",
      });

      expect(TestToolRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(false);
    });

    it("should handle mixed targets including claudecode", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["cursor", "claudecode", "copilot"],
        },
        body: "Test content",
      });

      expect(TestToolRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should handle undefined targets in frontmatter", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {},
        body: "Test content",
      });

      expect(TestToolRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });
  });
});

describe("buildToolPath", () => {
  it("should join toolDir and subDir when excludeToolDir is undefined", () => {
    expect(buildToolPath(".claude", "rules")).toBe(join(".claude", "rules"));
  });

  it("should join toolDir and subDir when excludeToolDir is false", () => {
    expect(buildToolPath(".claude", "rules", false)).toBe(join(".claude", "rules"));
  });

  it("should return only subDir when excludeToolDir is true", () => {
    expect(buildToolPath(".claude", "rules", true)).toBe("rules");
  });

  it("should handle subDir of '.' correctly", () => {
    expect(buildToolPath(".claude", ".", true)).toBe(".");
    expect(buildToolPath(".claude", ".", false)).toBe(join(".claude", "."));
  });
});
