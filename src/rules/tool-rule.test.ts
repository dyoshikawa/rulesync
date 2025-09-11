import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { type ValidationResult } from "../types/ai-file.js";
import { ensureDir, writeFileContent } from "../utils/file.js";
import { RulesyncRule } from "./rulesync-rule.js";
import {
  ToolRule,
  type ToolRuleFromFileParams,
  type ToolRuleFromRulesyncRuleParams,
} from "./tool-rule.js";

// Create a concrete implementation of ToolRule for testing
class TestToolRule extends ToolRule {
  static async fromFile(params: ToolRuleFromFileParams): Promise<TestToolRule> {
    const { baseDir = ".", relativeFilePath, validate = true } = params;
    const filePath = join(baseDir, ".test/rules", relativeFilePath);
    const { readFileContent } = await import("../utils/file.js");
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

    it("should validate content by default", () => {
      expect(() => {
        new TestToolRule({
          relativeDirPath: ".test/rules",
          relativeFilePath: "test-rule.md",
          fileContent: "Valid content",
        });
      }).not.toThrow();

      expect(() => {
        new TestToolRule({
          relativeDirPath: ".test/rules",
          relativeFilePath: "test-rule.md",
          fileContent: "", // Should fail validation
        });
      }).toThrow("Content cannot be empty");
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
      // Setup test file in current directory
      const rulesDir = join(".", ".test/rules");
      await ensureDir(rulesDir);
      const testContent = "# Default BaseDir Test";
      const testFilePath = join(rulesDir, "default-test.md");
      await writeFileContent(testFilePath, testContent);

      try {
        const toolRule = await TestToolRule.fromFile({
          relativeFilePath: "default-test.md",
        });

        expect(toolRule.getRelativeDirPath()).toBe(".test/rules");
        expect(toolRule.getRelativeFilePath()).toBe("default-test.md");
        expect(toolRule.getFileContent()).toBe(testContent);
      } finally {
        // Cleanup
        await import("node:fs/promises").then((fs) =>
          fs.rm(rulesDir, { recursive: true, force: true }),
        );
      }
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
        relativeDirPath: ".rulesync",
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
        relativeDirPath: ".rulesync",
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
        relativeDirPath: ".rulesync",
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
        relativeDirPath: ".rulesync",
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
        relativeDirPath: ".rulesync",
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
        relativeDirPath: ".rulesync",
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
        relativeDirPath: ".rulesync",
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

  describe("buildToolRuleParamsDefault", () => {
    it("should build params for non-root rule with defaults", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".rulesync",
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
      });

      expect(params).toEqual({
        baseDir: ".",
        relativeDirPath: ".agents/memories",
        relativeFilePath: "test-rule.md",
        fileContent: "# Test Rule",
        validate: true,
        root: false,
        description: "Test rule",
        globs: [],
      });
    });

    it("should build params for root rule with defaults", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".rulesync",
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

      expect(params).toEqual({
        baseDir: ".",
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
        fileContent: "# Root Rule",
        validate: true,
        root: true,
        description: "Root rule",
        globs: ["**/*"],
      });
    });

    it("should handle undefined description and globs", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".rulesync",
        relativeFilePath: "minimal.md",
        frontmatter: {
          root: false,
          targets: ["*"],
        } as any,
        body: "# Minimal",
      });

      const params = (TestToolRule as any).buildToolRuleParamsDefault({
        rulesyncRule,
      });

      expect(params.description).toBeUndefined();
      expect(params.globs).toBeUndefined();
    });

    it("should use custom baseDir", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".rulesync",
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
      });

      expect(params.baseDir).toBe("/custom/path");
    });

    it("should use custom validation setting", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".rulesync",
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
      });

      expect(params.validate).toBe(false);
    });

    it("should use custom rootPath configuration", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".rulesync",
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
        relativeDirPath: ".rulesync",
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
      expect(rulesyncRule.getRelativeDirPath()).toBe(".rulesync/rules");
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
      expect(rulesyncRule.getRelativeDirPath()).toBe(".rulesync/rules");
      expect(rulesyncRule.getRelativeFilePath()).toBe("non-root.md");
      expect(rulesyncRule.getBody()).toBe("# Non-Root Rule");

      const frontmatter = rulesyncRule.getFrontmatter();
      expect(frontmatter.root).toBe(false);
      expect(frontmatter.targets).toEqual(["*"]);
      expect(frontmatter.description).toBe("");
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
      expect(rulesyncRule.getRelativeDirPath()).toBe(".rulesync/rules");
      expect(rulesyncRule.getRelativeFilePath()).toBe("root.md");
      expect(rulesyncRule.getBody()).toBe("# Root Rule");

      const frontmatter = rulesyncRule.getFrontmatter();
      expect(frontmatter.root).toBe(true);
      expect(frontmatter.targets).toEqual(["*"]);
      expect(frontmatter.description).toBe("");
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
      expect(rulesyncRule.getRelativeDirPath()).toBe(".rulesync/rules");
      expect(rulesyncRule.getRelativeFilePath()).toBe("integration.md");
    });

    it("should handle roundtrip conversion rulesync -> tool -> rulesync", () => {
      const originalBody = "# Roundtrip Test\n\nContent should remain the same.";

      // Start with rulesync rule
      const originalRulesync = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".rulesync",
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
        relativeDirPath: ".rulesync",
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
        relativeDirPath: ".rulesync",
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
        relativeDirPath: ".rulesync",
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
        relativeDirPath: ".rulesync",
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
        relativeDirPath: ".rulesync",
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
        relativeDirPath: ".rulesync",
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
        relativeDirPath: ".rulesync",
        relativeFilePath: "test.md",
        frontmatter: {},
        body: "Test content",
      });

      expect(TestToolRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });
  });
});
