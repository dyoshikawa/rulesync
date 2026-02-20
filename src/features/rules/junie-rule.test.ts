import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_OVERVIEW_FILE_NAME,
  RULESYNC_RELATIVE_DIR_PATH,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { JunieRule } from "./junie-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("JunieRule", () => {
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
      const junieRule = new JunieRule({
        relativeDirPath: ".junie",
        relativeFilePath: "guidelines.md",
        fileContent: "# Test Guidelines\n\nThis is a test guideline.",
      });

      expect(junieRule).toBeInstanceOf(JunieRule);
      expect(junieRule.getRelativeDirPath()).toBe(".junie");
      expect(junieRule.getRelativeFilePath()).toBe("guidelines.md");
      expect(junieRule.getFileContent()).toBe("# Test Guidelines\n\nThis is a test guideline.");
    });

    it("should create instance with custom baseDir", () => {
      const junieRule = new JunieRule({
        baseDir: "/custom/path",
        relativeDirPath: ".junie",
        relativeFilePath: "guidelines.md",
        fileContent: "# Custom Guidelines",
      });

      expect(junieRule.getFilePath()).toBe("/custom/path/.junie/guidelines.md");
    });

    it("should create instance for memory files", () => {
      const junieRule = new JunieRule({
        relativeDirPath: ".junie/memories",
        relativeFilePath: "memory-rule.md",
        fileContent: "# Memory Rule\n\nThis is a memory rule.",
      });

      expect(junieRule.getRelativeDirPath()).toBe(".junie/memories");
      expect(junieRule.getRelativeFilePath()).toBe("memory-rule.md");
      expect(junieRule.getFileContent()).toBe("# Memory Rule\n\nThis is a memory rule.");
    });

    it("should validate content by default", () => {
      expect(() => {
        const _instance = new JunieRule({
          relativeDirPath: ".junie",
          relativeFilePath: "guidelines.md",
          fileContent: "", // empty content should be valid since validate always returns success
        });
      }).not.toThrow();
    });

    it("should skip validation when requested", () => {
      expect(() => {
        const _instance = new JunieRule({
          relativeDirPath: ".junie",
          relativeFilePath: "guidelines.md",
          fileContent: "",
          validate: false,
        });
      }).not.toThrow();
    });

    it("should handle root rule parameter", () => {
      const junieRule = new JunieRule({
        relativeDirPath: ".junie",
        relativeFilePath: "guidelines.md",
        fileContent: "# Root Guidelines",
        root: true,
      });

      expect(junieRule.getFileContent()).toBe("# Root Guidelines");
      expect(junieRule.isRoot()).toBe(true);
    });
  });

  describe("fromFile", () => {
    it("should create instance from root guidelines file", async () => {
      // Setup test file - for root, the file should be directly at baseDir/guidelines.md
      const testContent = "# Junie Guidelines\n\nGuidelines from file.";
      await writeFileContent(join(testDir, "guidelines.md"), testContent);

      const junieRule = await JunieRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "guidelines.md",
      });

      expect(junieRule.getRelativeDirPath()).toBe(".junie");
      expect(junieRule.getRelativeFilePath()).toBe("guidelines.md");
      expect(junieRule.getFileContent()).toBe(testContent);
      expect(junieRule.getFilePath()).toBe(join(testDir, ".junie/guidelines.md"));
      expect(junieRule.isRoot()).toBe(true);
    });

    it("should create instance from memory file", async () => {
      // Setup test file
      const memoriesDir = join(testDir, ".junie/memories");
      await ensureDir(memoriesDir);
      const testContent = "# Memory Rule\n\nContent from memory file.";
      await writeFileContent(join(memoriesDir, "memory-test.md"), testContent);

      const junieRule = await JunieRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "memory-test.md",
      });

      expect(junieRule.getRelativeDirPath()).toBe(".junie/memories");
      expect(junieRule.getRelativeFilePath()).toBe("memory-test.md");
      expect(junieRule.getFileContent()).toBe(testContent);
      expect(junieRule.getFilePath()).toBe(join(testDir, ".junie/memories/memory-test.md"));
      expect(junieRule.isRoot()).toBe(false);
    });

    it("should use default baseDir when not provided", async () => {
      // Setup test file in mocked current directory
      const testContent = "# Default BaseDir Test";
      await writeFileContent(join(testDir, "guidelines.md"), testContent);

      const junieRule = await JunieRule.fromFile({
        relativeFilePath: "guidelines.md",
      });

      expect(junieRule.getRelativeDirPath()).toBe(".junie");
      expect(junieRule.getRelativeFilePath()).toBe("guidelines.md");
      expect(junieRule.getFileContent()).toBe(testContent);
    });

    it("should handle validation parameter", async () => {
      const testContent = "# Validation Test";
      await writeFileContent(join(testDir, "guidelines.md"), testContent);

      const junieRuleWithValidation = await JunieRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "guidelines.md",
        validate: true,
      });

      const junieRuleWithoutValidation = await JunieRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "guidelines.md",
        validate: false,
      });

      expect(junieRuleWithValidation.getFileContent()).toBe(testContent);
      expect(junieRuleWithoutValidation.getFileContent()).toBe(testContent);
    });

    it("should throw error when file does not exist", async () => {
      await expect(
        JunieRule.fromFile({
          baseDir: testDir,
          relativeFilePath: "nonexistent.md",
        }),
      ).rejects.toThrow();
    });

    it("should detect root vs non-root files correctly", async () => {
      // Setup root guidelines file and memory files
      const memoriesDir = join(testDir, ".junie/memories");
      await ensureDir(memoriesDir);

      const rootContent = "# Root Guidelines";
      const memoryContent = "# Memory Rule";

      // Root file goes directly in baseDir
      await writeFileContent(join(testDir, "guidelines.md"), rootContent);
      // Memory file goes in .junie/memories
      await writeFileContent(join(memoriesDir, "memory.md"), memoryContent);

      const rootRule = await JunieRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "guidelines.md",
      });

      const memoryRule = await JunieRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "memory.md",
      });

      expect(rootRule.isRoot()).toBe(true);
      expect(rootRule.getRelativeDirPath()).toBe(".junie");
      expect(memoryRule.isRoot()).toBe(false);
      expect(memoryRule.getRelativeDirPath()).toBe(".junie/memories");
    });
  });

  describe("fromRulesyncRule", () => {
    it("should create instance from RulesyncRule for root rule", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "test-rule.md",
        frontmatter: {
          root: true,
          targets: ["*"],
          description: "Test root rule",
          globs: [],
        },
        body: "# Test RulesyncRule\n\nContent from rulesync.",
      });

      const junieRule = JunieRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(junieRule).toBeInstanceOf(JunieRule);
      expect(junieRule.getRelativeDirPath()).toBe(".junie");
      expect(junieRule.getRelativeFilePath()).toBe("guidelines.md");
      expect(junieRule.getFileContent()).toContain("# Test RulesyncRule\n\nContent from rulesync.");
      expect(junieRule.isRoot()).toBe(true);
    });

    it("should create instance from RulesyncRule for non-root rule", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "detail-rule.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "Test detail rule",
          globs: [],
        },
        body: "# Detail RulesyncRule\n\nContent from detail rulesync.",
      });

      const junieRule = JunieRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(junieRule).toBeInstanceOf(JunieRule);
      expect(junieRule.getRelativeDirPath()).toBe(".junie/memories");
      expect(junieRule.getRelativeFilePath()).toBe("detail-rule.md");
      expect(junieRule.getFileContent()).toContain(
        "# Detail RulesyncRule\n\nContent from detail rulesync.",
      );
      expect(junieRule.isRoot()).toBe(false);
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

      const junieRule = JunieRule.fromRulesyncRule({
        baseDir: "/custom/base",
        rulesyncRule,
      });

      expect(junieRule.getFilePath()).toBe("/custom/base/.junie/memories/custom-base.md");
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

      const junieRuleWithValidation = JunieRule.fromRulesyncRule({
        rulesyncRule,
        validate: true,
      });

      const junieRuleWithoutValidation = JunieRule.fromRulesyncRule({
        rulesyncRule,
        validate: false,
      });

      expect(junieRuleWithValidation.getFileContent()).toContain("# Validation Test");
      expect(junieRuleWithoutValidation.getFileContent()).toContain("# Validation Test");
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert JunieRule to RulesyncRule for root rule", () => {
      const junieRule = new JunieRule({
        baseDir: testDir,
        relativeDirPath: ".junie",
        relativeFilePath: "guidelines.md",
        fileContent: "# Convert Test\n\nThis will be converted.",
        root: true,
      });

      const rulesyncRule = junieRule.toRulesyncRule();

      expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
      expect(rulesyncRule.getRelativeDirPath()).toBe(RULESYNC_RULES_RELATIVE_DIR_PATH);
      expect(rulesyncRule.getRelativeFilePath()).toBe(RULESYNC_OVERVIEW_FILE_NAME);
      expect(rulesyncRule.getFileContent()).toContain("# Convert Test\n\nThis will be converted.");
    });

    it("should convert JunieRule to RulesyncRule for memory rule", () => {
      const junieRule = new JunieRule({
        baseDir: testDir,
        relativeDirPath: ".junie/memories",
        relativeFilePath: "memory-convert.md",
        fileContent: "# Memory Convert Test\n\nThis memory will be converted.",
        root: false,
      });

      const rulesyncRule = junieRule.toRulesyncRule();

      expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
      expect(rulesyncRule.getRelativeDirPath()).toBe(RULESYNC_RULES_RELATIVE_DIR_PATH);
      expect(rulesyncRule.getRelativeFilePath()).toBe("memory-convert.md");
      expect(rulesyncRule.getFileContent()).toContain(
        "# Memory Convert Test\n\nThis memory will be converted.",
      );
    });

    it("should preserve metadata in conversion", () => {
      const junieRule = new JunieRule({
        baseDir: "/test/path",
        relativeDirPath: ".junie",
        relativeFilePath: "metadata-test.md",
        fileContent: "# Metadata Test\n\nWith metadata preserved.",
        root: true,
      });

      const rulesyncRule = junieRule.toRulesyncRule();

      expect(rulesyncRule.getFilePath()).toBe(
        join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, RULESYNC_OVERVIEW_FILE_NAME),
      );
      expect(rulesyncRule.getFileContent()).toContain(
        "# Metadata Test\n\nWith metadata preserved.",
      );
    });
  });

  describe("validate", () => {
    it("should always return success", () => {
      const junieRule = new JunieRule({
        relativeDirPath: ".junie",
        relativeFilePath: "guidelines.md",
        fileContent: "# Any content is valid",
      });

      const result = junieRule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return success for empty content", () => {
      const junieRule = new JunieRule({
        relativeDirPath: ".junie/memories",
        relativeFilePath: "empty.md",
        fileContent: "",
      });

      const result = junieRule.validate();

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
        "Special characters: éñ中文🎉",
        "Multi-line\ncontent\nwith\nbreaks",
      ];

      for (const content of contents) {
        const junieRule = new JunieRule({
          relativeDirPath: ".junie",
          relativeFilePath: "guidelines.md",
          fileContent: content,
        });

        const result = junieRule.validate();
        expect(result.success).toBe(true);
        expect(result.error).toBeNull();
      }
    });
  });

  describe("integration tests", () => {
    it("should handle complete workflow from file to rulesync rule", async () => {
      // Create original file
      const originalContent = "# Integration Test\n\nComplete workflow test.";
      await writeFileContent(join(testDir, "guidelines.md"), originalContent);

      // Load from file
      const junieRule = await JunieRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "guidelines.md",
      });

      // Convert to rulesync rule
      const rulesyncRule = junieRule.toRulesyncRule();

      // Verify conversion
      expect(rulesyncRule.getFileContent()).toContain(originalContent);
      expect(rulesyncRule.getRelativeDirPath()).toBe(RULESYNC_RULES_RELATIVE_DIR_PATH);
      expect(rulesyncRule.getRelativeFilePath()).toBe(RULESYNC_OVERVIEW_FILE_NAME);
    });

    it("should handle complete workflow from memory file to rulesync rule", async () => {
      // Create memory file
      const memoriesDir = join(testDir, ".junie/memories");
      await ensureDir(memoriesDir);
      const originalContent = "# Memory Integration Test\n\nMemory workflow test.";
      await writeFileContent(join(memoriesDir, "memory-integration.md"), originalContent);

      // Load from file
      const junieRule = await JunieRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "memory-integration.md",
      });

      // Convert to rulesync rule
      const rulesyncRule = junieRule.toRulesyncRule();

      // Verify conversion
      expect(rulesyncRule.getFileContent()).toContain(originalContent);
      expect(rulesyncRule.getRelativeDirPath()).toBe(RULESYNC_RULES_RELATIVE_DIR_PATH);
      expect(rulesyncRule.getRelativeFilePath()).toBe("memory-integration.md");
    });

    it("should handle roundtrip conversion rulesync -> junie -> rulesync", () => {
      const originalBody = "# Roundtrip Test\n\nContent should remain the same.";

      // Start with rulesync rule (root)
      const originalRulesync = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "roundtrip.md",
        frontmatter: {
          root: true,
          targets: ["*"],
          description: "Roundtrip test",
          globs: [],
        },
        body: originalBody,
      });

      // Convert to junie rule
      const junieRule = JunieRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule: originalRulesync,
      });

      // Convert back to rulesync rule
      const finalRulesync = junieRule.toRulesyncRule();

      // Verify content preservation
      expect(finalRulesync.getFileContent()).toContain(originalBody);
      expect(finalRulesync.getRelativeFilePath()).toBe(RULESYNC_OVERVIEW_FILE_NAME); // Should be overview.md for root
    });

    it("should handle roundtrip conversion rulesync -> junie -> rulesync for detail rule", () => {
      const originalBody = "# Detail Roundtrip Test\n\nDetail content should remain the same.";

      // Start with rulesync rule (non-root)
      const originalRulesync = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "detail-roundtrip.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "Detail roundtrip test",
          globs: [],
        },
        body: originalBody,
      });

      // Convert to junie rule
      const junieRule = JunieRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule: originalRulesync,
      });

      // Convert back to rulesync rule
      const finalRulesync = junieRule.toRulesyncRule();

      // Verify content preservation
      expect(finalRulesync.getFileContent()).toContain(originalBody);
      expect(finalRulesync.getRelativeFilePath()).toBe("detail-roundtrip.md");
    });

    it("should preserve directory structure in file paths", async () => {
      // Test nested directory structure
      const nestedDir = join(testDir, ".junie/memories/nested");
      await ensureDir(nestedDir);
      const content = "# Nested Rule\n\nIn a nested directory.";
      await writeFileContent(join(nestedDir, "nested-rule.md"), content);

      // This should work with the current implementation since fromFile
      // determines path based on the relativeFilePath parameter
      const junieRule = await JunieRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "nested/nested-rule.md",
      });

      expect(junieRule.getRelativeDirPath()).toBe(".junie/memories");
      expect(junieRule.getRelativeFilePath()).toBe("nested/nested-rule.md");
      expect(junieRule.getFileContent()).toBe(content);
    });
  });

  describe("isTargetedByRulesyncRule", () => {
    it("should return true for rules targeting junie", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["junie"],
        },
        body: "Test content",
      });

      expect(JunieRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should return true for rules targeting all tools (*)", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["*"],
        },
        body: "Test content",
      });

      expect(JunieRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should return false for rules not targeting junie", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["cursor", "copilot"],
        },
        body: "Test content",
      });

      expect(JunieRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(false);
    });

    it("should return false for empty targets", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          targets: [],
        },
        body: "Test content",
      });

      expect(JunieRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(false);
    });

    it("should handle mixed targets including junie", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["cursor", "junie", "copilot"],
        },
        body: "Test content",
      });

      expect(JunieRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should handle undefined targets in frontmatter", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {},
        body: "Test content",
      });

      expect(JunieRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("should handle files with special characters in names", () => {
      const junieRule = new JunieRule({
        relativeDirPath: ".junie",
        relativeFilePath: "special-chars@#$.md",
        fileContent: "# Special chars in filename",
      });

      expect(junieRule.getRelativeFilePath()).toBe("special-chars@#$.md");
    });

    it("should handle very long content", () => {
      const longContent = "# Long Content\n\n" + "A".repeat(10000);
      const junieRule = new JunieRule({
        relativeDirPath: ".junie",
        relativeFilePath: "long-content.md",
        fileContent: longContent,
      });

      expect(junieRule.getFileContent()).toBe(longContent);
      expect(junieRule.validate().success).toBe(true);
    });

    it("should handle content with various line endings", () => {
      const contentVariations = [
        "Line 1\nLine 2\nLine 3", // Unix
        "Line 1\r\nLine 2\r\nLine 3", // Windows
        "Line 1\rLine 2\rLine 3", // Old Mac
        "Mixed\nLine\r\nEndings\rHere", // Mixed
      ];

      for (const content of contentVariations) {
        const junieRule = new JunieRule({
          relativeDirPath: ".junie",
          relativeFilePath: "line-endings.md",
          fileContent: content,
        });

        expect(junieRule.validate().success).toBe(true);
        expect(junieRule.getFileContent()).toBe(content);
      }
    });

    it("should handle Unicode content", () => {
      const unicodeContent =
        "# Unicode Test 🚀\n\nEmojis: 😀🎉\nChinese: 你好世界\nArabic: مرحبا بالعالم\nRussian: Привет мир";
      const junieRule = new JunieRule({
        relativeDirPath: ".junie",
        relativeFilePath: "unicode.md",
        fileContent: unicodeContent,
      });

      expect(junieRule.getFileContent()).toBe(unicodeContent);
      expect(junieRule.validate().success).toBe(true);
    });
  });
});
