import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../utils/file.js";
import { RooRule } from "./roo-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("RooRule", () => {
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
      const rooRule = new RooRule({
        relativeDirPath: ".roo/rules",
        relativeFilePath: "test-rule.md",
        fileContent: "# Test Rule\n\nThis is a test rule.",
      });

      expect(rooRule).toBeInstanceOf(RooRule);
      expect(rooRule.getRelativeDirPath()).toBe(".roo/rules");
      expect(rooRule.getRelativeFilePath()).toBe("test-rule.md");
      expect(rooRule.getFileContent()).toBe("# Test Rule\n\nThis is a test rule.");
    });

    it("should create instance with custom baseDir", () => {
      const rooRule = new RooRule({
        baseDir: "/custom/path",
        relativeDirPath: ".roo/rules",
        relativeFilePath: "test-rule.md",
        fileContent: "# Custom Rule",
      });

      expect(rooRule.getFilePath()).toBe("/custom/path/.roo/rules/test-rule.md");
    });

    it("should validate content by default", () => {
      expect(() => {
        const _instance = new RooRule({
          relativeDirPath: ".roo/rules",
          relativeFilePath: "test-rule.md",
          fileContent: "", // empty content should be valid since validate always returns success
        });
      }).not.toThrow();
    });

    it("should skip validation when requested", () => {
      expect(() => {
        const _instance = new RooRule({
          relativeDirPath: ".roo/rules",
          relativeFilePath: "test-rule.md",
          fileContent: "",
          validate: false,
        });
      }).not.toThrow();
    });

    it("should handle root rule parameter", () => {
      const rooRule = new RooRule({
        relativeDirPath: ".roo/rules",
        relativeFilePath: "test-rule.md",
        fileContent: "# Root Rule",
        root: true,
      });

      expect(rooRule.getFileContent()).toBe("# Root Rule");
    });
  });

  describe("fromFile", () => {
    it("should create instance from existing file", async () => {
      // Setup test file
      const rulesDir = join(testDir, ".roo/rules");
      await ensureDir(rulesDir);
      const testContent = "# Test Rule from File\n\nContent from file.";
      await writeFileContent(join(rulesDir, "test.md"), testContent);

      const rooRule = await RooRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "test.md",
      });

      expect(rooRule.getRelativeDirPath()).toBe(".roo/rules");
      expect(rooRule.getRelativeFilePath()).toBe("test.md");
      expect(rooRule.getFileContent()).toBe(testContent);
      expect(rooRule.getFilePath()).toBe(join(testDir, ".roo/rules/test.md"));
    });

    it("should use default baseDir when not provided", async () => {
      // Setup test file using testDir
      const rulesDir = join(testDir, ".roo/rules");
      await ensureDir(rulesDir);
      const testContent = "# Default BaseDir Test";
      const testFilePath = join(rulesDir, "default-test.md");
      await writeFileContent(testFilePath, testContent);

      // Mock process.cwd() to return testDir
      const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(testDir);

      try {
        const rooRule = await RooRule.fromFile({
          relativeFilePath: "default-test.md",
        });

        expect(rooRule.getRelativeDirPath()).toBe(".roo/rules");
        expect(rooRule.getRelativeFilePath()).toBe("default-test.md");
        expect(rooRule.getFileContent()).toBe(testContent);
        expect(rooRule.getFilePath()).toBe(join(testDir, ".roo/rules/default-test.md"));
      } finally {
        cwdSpy.mockRestore();
      }
    });

    it("should handle validation parameter", async () => {
      const rulesDir = join(testDir, ".roo/rules");
      await ensureDir(rulesDir);
      const testContent = "# Validation Test";
      await writeFileContent(join(rulesDir, "validation-test.md"), testContent);

      const rooRuleWithValidation = await RooRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "validation-test.md",
        validate: true,
      });

      const rooRuleWithoutValidation = await RooRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "validation-test.md",
        validate: false,
      });

      expect(rooRuleWithValidation.getFileContent()).toBe(testContent);
      expect(rooRuleWithoutValidation.getFileContent()).toBe(testContent);
    });

    it("should throw error when file does not exist", async () => {
      await expect(
        RooRule.fromFile({
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

      const rooRule = RooRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(rooRule).toBeInstanceOf(RooRule);
      expect(rooRule.getRelativeDirPath()).toBe(".roo/rules");
      expect(rooRule.getRelativeFilePath()).toBe("test-rule.md");
      expect(rooRule.getFileContent()).toContain("# Test RulesyncRule\n\nContent from rulesync.");
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

      const rooRule = RooRule.fromRulesyncRule({
        baseDir: "/custom/base",
        rulesyncRule,
      });

      expect(rooRule.getFilePath()).toBe("/custom/base/.roo/rules/custom-base.md");
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

      const rooRuleWithValidation = RooRule.fromRulesyncRule({
        rulesyncRule,
        validate: true,
      });

      const rooRuleWithoutValidation = RooRule.fromRulesyncRule({
        rulesyncRule,
        validate: false,
      });

      expect(rooRuleWithValidation.getFileContent()).toContain("# Validation Test");
      expect(rooRuleWithoutValidation.getFileContent()).toContain("# Validation Test");
    });
  });

  describe("extractModeFromPath", () => {
    it("should extract mode from directory pattern", () => {
      expect(RooRule.extractModeFromPath(".roo/rules-dev/test.md")).toBe("dev");
      expect(RooRule.extractModeFromPath(".roo/rules-production/config.md")).toBe("production");
      expect(RooRule.extractModeFromPath(".roo/rules-test-env/rule.md")).toBe("test-env");
      expect(RooRule.extractModeFromPath("project/.roo/rules-staging/rules.md")).toBe("staging");
    });

    it("should extract mode from roorules single-file pattern", () => {
      expect(RooRule.extractModeFromPath(".roorules-dev")).toBe("dev");
      expect(RooRule.extractModeFromPath(".roorules-production")).toBe("production");
      expect(RooRule.extractModeFromPath(".roorules-test-env")).toBe("test-env");
      expect(RooRule.extractModeFromPath("project/.roorules-staging")).toBe("staging");
    });

    it("should extract mode from clinerules single-file pattern", () => {
      expect(RooRule.extractModeFromPath(".clinerules-dev")).toBe("dev");
      expect(RooRule.extractModeFromPath(".clinerules-production")).toBe("production");
      expect(RooRule.extractModeFromPath(".clinerules-test-env")).toBe("test-env");
      expect(RooRule.extractModeFromPath("project/.clinerules-staging")).toBe("staging");
    });

    it("should return undefined for non-mode-specific paths", () => {
      expect(RooRule.extractModeFromPath(".roo/rules/test.md")).toBeUndefined();
      expect(RooRule.extractModeFromPath(".roorules")).toBeUndefined();
      expect(RooRule.extractModeFromPath(".clinerules")).toBeUndefined();
      expect(RooRule.extractModeFromPath("regular-file.md")).toBeUndefined();
      expect(RooRule.extractModeFromPath(".roo/other-dir/test.md")).toBeUndefined();
    });

    it("should handle edge cases", () => {
      expect(RooRule.extractModeFromPath("")).toBeUndefined();
      expect(RooRule.extractModeFromPath(".roo/rules-/test.md")).toBeUndefined();
      expect(RooRule.extractModeFromPath(".roorules-")).toBeUndefined();
      expect(RooRule.extractModeFromPath(".clinerules-")).toBeUndefined();
    });

    it("should handle complex mode names", () => {
      expect(RooRule.extractModeFromPath(".roo/rules-multi-word-mode/test.md")).toBe(
        "multi-word-mode",
      );
      expect(RooRule.extractModeFromPath(".roorules-mode123")).toBe("mode123");
      expect(RooRule.extractModeFromPath(".clinerules-mode-with-numbers-123")).toBe(
        "mode-with-numbers-123",
      );
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert RooRule to RulesyncRule", () => {
      const rooRule = new RooRule({
        baseDir: testDir,
        relativeDirPath: ".roo/rules",
        relativeFilePath: "convert-test.md",
        fileContent: "# Convert Test\n\nThis will be converted.",
      });

      const rulesyncRule = rooRule.toRulesyncRule();

      expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
      expect(rulesyncRule.getRelativeDirPath()).toBe(".rulesync/rules");
      expect(rulesyncRule.getRelativeFilePath()).toBe("convert-test.md");
      expect(rulesyncRule.getFileContent()).toContain("# Convert Test\n\nThis will be converted.");
    });

    it("should preserve metadata in conversion", () => {
      const rooRule = new RooRule({
        baseDir: "/test/path",
        relativeDirPath: ".roo/rules",
        relativeFilePath: "metadata-test.md",
        fileContent: "---\ntitle: Test Rule\n---\n# Metadata Test",
        root: true,
      });

      const rulesyncRule = rooRule.toRulesyncRule();

      expect(rulesyncRule.getFilePath()).toBe(".rulesync/rules/metadata-test.md");
      expect(rulesyncRule.getFileContent()).toContain("# Metadata Test");
    });
  });

  describe("validate", () => {
    it("should always return success", () => {
      const rooRule = new RooRule({
        relativeDirPath: ".roo/rules",
        relativeFilePath: "validation-test.md",
        fileContent: "# Any content is valid",
      });

      const result = rooRule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return success for empty content", () => {
      const rooRule = new RooRule({
        relativeDirPath: ".roo/rules",
        relativeFilePath: "empty.md",
        fileContent: "",
      });

      const result = rooRule.validate();

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
        const rooRule = new RooRule({
          relativeDirPath: ".roo/rules",
          relativeFilePath: "test.md",
          fileContent: content,
        });

        const result = rooRule.validate();
        expect(result.success).toBe(true);
        expect(result.error).toBeNull();
      }
    });
  });

  describe("getSettablePaths", () => {
    it("should return correct paths for nonRoot", () => {
      const paths = RooRule.getSettablePaths();

      expect(paths.nonRoot).toEqual({
        relativeDirPath: ".roo/rules",
      });
    });

    it("should have consistent paths structure", () => {
      const paths = RooRule.getSettablePaths();

      expect(paths).toHaveProperty("nonRoot");
      expect(paths.nonRoot).toHaveProperty("relativeDirPath");
    });
  });

  describe("isTargetedByRulesyncRule", () => {
    it("should return true for rules targeting roo", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["roo"],
        },
        body: "Test content",
      });

      expect(RooRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
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

      expect(RooRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should return false for rules not targeting roo", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["cursor", "copilot"],
        },
        body: "Test content",
      });

      expect(RooRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(false);
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

      expect(RooRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(false);
    });

    it("should handle mixed targets including roo", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["cursor", "roo", "copilot"],
        },
        body: "Test content",
      });

      expect(RooRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should handle undefined targets in frontmatter", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "test.md",
        frontmatter: {},
        body: "Test content",
      });

      expect(RooRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });
  });

  describe("integration tests", () => {
    it("should handle complete workflow from file to rulesync rule", async () => {
      // Create original file
      const rulesDir = join(testDir, ".roo/rules");
      await ensureDir(rulesDir);
      const originalContent = "# Integration Test\n\nComplete workflow test.";
      await writeFileContent(join(rulesDir, "integration.md"), originalContent);

      // Load from file
      const rooRule = await RooRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "integration.md",
      });

      // Convert to rulesync rule
      const rulesyncRule = rooRule.toRulesyncRule();

      // Verify conversion
      expect(rulesyncRule.getFileContent()).toContain(originalContent);
      expect(rulesyncRule.getRelativeDirPath()).toBe(".rulesync/rules");
      expect(rulesyncRule.getRelativeFilePath()).toBe("integration.md");
    });

    it("should handle roundtrip conversion rulesync -> roo -> rulesync", () => {
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

      // Convert to roo rule
      const rooRule = RooRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule: originalRulesync,
      });

      // Convert back to rulesync rule
      const finalRulesync = rooRule.toRulesyncRule();

      // Verify content preservation
      expect(finalRulesync.getFileContent()).toContain(originalBody);
      expect(finalRulesync.getRelativeFilePath()).toBe("roundtrip.md");
    });
  });
});
