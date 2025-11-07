import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../utils/file.js";
import { AmazonQCliRule } from "./amazonqcli-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("AmazonQCliRule", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should create instance with default parameters", () => {
      const amazonQCliRule = new AmazonQCliRule({
        relativeDirPath: ".amazonq/rules",
        relativeFilePath: "test-rule.md",
        fileContent: "# Test Rule\n\nThis is a test rule.",
      });

      expect(amazonQCliRule).toBeInstanceOf(AmazonQCliRule);
      expect(amazonQCliRule.getRelativeDirPath()).toBe(".amazonq/rules");
      expect(amazonQCliRule.getRelativeFilePath()).toBe("test-rule.md");
      expect(amazonQCliRule.getFileContent()).toBe("# Test Rule\n\nThis is a test rule.");
    });

    it("should create instance with custom baseDir", () => {
      const amazonQCliRule = new AmazonQCliRule({
        baseDir: "/custom/path",
        relativeDirPath: ".amazonq/rules",
        relativeFilePath: "test-rule.md",
        fileContent: "# Custom Rule",
      });

      expect(amazonQCliRule.getFilePath()).toBe("/custom/path/.amazonq/rules/test-rule.md");
    });

    it("should validate content by default", () => {
      expect(() => {
        const _instance = new AmazonQCliRule({
          relativeDirPath: ".amazonq/rules",
          relativeFilePath: "test-rule.md",
          fileContent: "", // empty content should be valid since validate always returns success
        });
      }).not.toThrow();
    });

    it("should skip validation when requested", () => {
      expect(() => {
        const _instance = new AmazonQCliRule({
          relativeDirPath: ".amazonq/rules",
          relativeFilePath: "test-rule.md",
          fileContent: "",
          validate: false,
        });
      }).not.toThrow();
    });

    it("should handle root rule parameter", () => {
      const amazonQCliRule = new AmazonQCliRule({
        relativeDirPath: ".amazonq/rules",
        relativeFilePath: "test-rule.md",
        fileContent: "# Root Rule",
        root: true,
      });

      expect(amazonQCliRule.getFileContent()).toBe("# Root Rule");
    });
  });

  describe("fromFile", () => {
    it("should create instance from existing file", async () => {
      // Setup test file
      const rulesDir = join(testDir, ".amazonq/rules");
      await ensureDir(rulesDir);
      const testContent = "# Test Rule from File\n\nContent from file.";
      await writeFileContent(join(rulesDir, "test.md"), testContent);

      const amazonQCliRule = await AmazonQCliRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "test.md",
      });

      expect(amazonQCliRule.getRelativeDirPath()).toBe(".amazonq/rules");
      expect(amazonQCliRule.getRelativeFilePath()).toBe("test.md");
      expect(amazonQCliRule.getFileContent()).toBe(testContent);
      expect(amazonQCliRule.getFilePath()).toBe(join(testDir, ".amazonq/rules/test.md"));
    });

    it("should use default baseDir when not provided", async () => {
      // Setup test file in test directory (process.cwd() is mocked to return testDir)
      const rulesDir = join(testDir, ".amazonq/rules");
      await ensureDir(rulesDir);
      const testContent = "# Default BaseDir Test";
      const testFilePath = join(rulesDir, "default-test.md");
      await writeFileContent(testFilePath, testContent);

      const amazonQCliRule = await AmazonQCliRule.fromFile({
        relativeFilePath: "default-test.md",
      });

      expect(amazonQCliRule.getRelativeDirPath()).toBe(".amazonq/rules");
      expect(amazonQCliRule.getRelativeFilePath()).toBe("default-test.md");
      expect(amazonQCliRule.getFileContent()).toBe(testContent);
      expect(amazonQCliRule.getFilePath()).toBe(join(testDir, ".amazonq/rules/default-test.md"));
    });

    it("should handle validation parameter", async () => {
      const rulesDir = join(testDir, ".amazonq/rules");
      await ensureDir(rulesDir);
      const testContent = "# Validation Test";
      await writeFileContent(join(rulesDir, "validation-test.md"), testContent);

      const amazonQCliRuleWithValidation = await AmazonQCliRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "validation-test.md",
        validate: true,
      });

      const amazonQCliRuleWithoutValidation = await AmazonQCliRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "validation-test.md",
        validate: false,
      });

      expect(amazonQCliRuleWithValidation.getFileContent()).toBe(testContent);
      expect(amazonQCliRuleWithoutValidation.getFileContent()).toBe(testContent);
    });

    it("should throw error when file does not exist", async () => {
      await expect(
        AmazonQCliRule.fromFile({
          baseDir: testDir,
          relativeFilePath: "nonexistent.md",
        }),
      ).rejects.toThrow();
    });
  });

  describe("fromRulesyncRule", () => {
    it("should create instance from RulesyncRule", () => {
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

      const amazonQCliRule = AmazonQCliRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(amazonQCliRule).toBeInstanceOf(AmazonQCliRule);
      expect(amazonQCliRule.getRelativeDirPath()).toBe(".amazonq/rules");
      expect(amazonQCliRule.getRelativeFilePath()).toBe("test-rule.md");
      expect(amazonQCliRule.getFileContent()).toContain(
        "# Test RulesyncRule\n\nContent from rulesync.",
      );
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

      const amazonQCliRule = AmazonQCliRule.fromRulesyncRule({
        baseDir: "/custom/base",
        rulesyncRule,
      });

      expect(amazonQCliRule.getFilePath()).toBe("/custom/base/.amazonq/rules/custom-base.md");
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

      const amazonQCliRuleWithValidation = AmazonQCliRule.fromRulesyncRule({
        rulesyncRule,
        validate: true,
      });

      const amazonQCliRuleWithoutValidation = AmazonQCliRule.fromRulesyncRule({
        rulesyncRule,
        validate: false,
      });

      expect(amazonQCliRuleWithValidation.getFileContent()).toContain("# Validation Test");
      expect(amazonQCliRuleWithoutValidation.getFileContent()).toContain("# Validation Test");
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert AmazonQCliRule to RulesyncRule", () => {
      const amazonQCliRule = new AmazonQCliRule({
        baseDir: testDir,
        relativeDirPath: ".amazonq/rules",
        relativeFilePath: "convert-test.md",
        fileContent: "# Convert Test\n\nThis will be converted.",
      });

      const rulesyncRule = amazonQCliRule.toRulesyncRule();

      expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
      expect(rulesyncRule.getRelativeDirPath()).toBe(".rulesync/rules");
      expect(rulesyncRule.getRelativeFilePath()).toBe("convert-test.md");
      expect(rulesyncRule.getFileContent()).toContain("# Convert Test\n\nThis will be converted.");
    });

    it("should preserve metadata in conversion", () => {
      const amazonQCliRule = new AmazonQCliRule({
        baseDir: "/test/path",
        relativeDirPath: ".amazonq/rules",
        relativeFilePath: "metadata-test.md",
        fileContent: "---\ntitle: Test Rule\n---\n# Metadata Test",
        root: true,
      });

      const rulesyncRule = amazonQCliRule.toRulesyncRule();

      expect(rulesyncRule.getFilePath()).toBe(".rulesync/rules/metadata-test.md");
      expect(rulesyncRule.getFileContent()).toContain("# Metadata Test");
    });
  });

  describe("validate", () => {
    it("should always return success", () => {
      const amazonQCliRule = new AmazonQCliRule({
        relativeDirPath: ".amazonq/rules",
        relativeFilePath: "validation-test.md",
        fileContent: "# Any content is valid",
      });

      const result = amazonQCliRule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return success for empty content", () => {
      const amazonQCliRule = new AmazonQCliRule({
        relativeDirPath: ".amazonq/rules",
        relativeFilePath: "empty.md",
        fileContent: "",
      });

      const result = amazonQCliRule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return success for any content format", () => {
      const contents = [
        "# Markdown content",
        "Plain text content",
        "---\nfrontmatter: true\n---\nContent with frontmatter",
        "/* Code comments */",
        "Invalid markdown ### ###",
      ];

      for (const content of contents) {
        const amazonQCliRule = new AmazonQCliRule({
          relativeDirPath: ".amazonq/rules",
          relativeFilePath: "test.md",
          fileContent: content,
        });

        const result = amazonQCliRule.validate();
        expect(result.success).toBe(true);
        expect(result.error).toBeNull();
      }
    });
  });

  describe("integration tests", () => {
    it("should handle complete workflow from file to rulesync rule", async () => {
      // Create original file
      const rulesDir = join(testDir, ".amazonq/rules");
      await ensureDir(rulesDir);
      const originalContent = "# Integration Test\n\nComplete workflow test.";
      await writeFileContent(join(rulesDir, "integration.md"), originalContent);

      // Load from file
      const amazonQCliRule = await AmazonQCliRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "integration.md",
      });

      // Convert to rulesync rule
      const rulesyncRule = amazonQCliRule.toRulesyncRule();

      // Verify conversion
      expect(rulesyncRule.getFileContent()).toContain(originalContent);
      expect(rulesyncRule.getRelativeDirPath()).toBe(".rulesync/rules");
      expect(rulesyncRule.getRelativeFilePath()).toBe("integration.md");
    });

    it("should handle roundtrip conversion rulesync -> amazonq -> rulesync", () => {
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

      // Convert to amazonq rule
      const amazonQCliRule = AmazonQCliRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule: originalRulesync,
      });

      // Convert back to rulesync rule
      const finalRulesync = amazonQCliRule.toRulesyncRule();

      // Verify content preservation
      expect(finalRulesync.getFileContent()).toContain(originalBody);
      expect(finalRulesync.getRelativeFilePath()).toBe("roundtrip.md");
    });
  });

  describe("getSettablePaths", () => {
    it("should return correct paths for nonRoot", () => {
      const paths = AmazonQCliRule.getSettablePaths();

      expect(paths.nonRoot).toEqual({
        relativeDirPath: ".amazonq/rules",
      });
    });

    it("should have consistent paths structure", () => {
      const paths = AmazonQCliRule.getSettablePaths();

      expect(paths).toHaveProperty("nonRoot");
      expect(paths.nonRoot).toHaveProperty("relativeDirPath");
    });
  });

  describe("isTargetedByRulesyncRule", () => {
    it("should return true for rules targeting amazonqcli", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["amazonqcli"],
        },
        body: "Test content",
      });

      expect(AmazonQCliRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
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

      expect(AmazonQCliRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should return false for rules not targeting amazonqcli", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["cursor", "copilot"],
        },
        body: "Test content",
      });

      expect(AmazonQCliRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(false);
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

      expect(AmazonQCliRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(false);
    });

    it("should handle mixed targets including amazonqcli", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["cursor", "amazonqcli", "copilot"],
        },
        body: "Test content",
      });

      expect(AmazonQCliRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should handle undefined targets in frontmatter", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "test.md",
        frontmatter: {},
        body: "Test content",
      });

      expect(AmazonQCliRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });
  });
});
