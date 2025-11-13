import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RULESYNC_OVERVIEW_FILE_NAME,
  RULESYNC_RELATIVE_DIR_PATH,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { OpenCodeRule } from "./opencode-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("OpenCodeRule", () => {
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
      const opencodeRule = new OpenCodeRule({
        relativeDirPath: ".opencode/memories",
        relativeFilePath: "test-memory.md",
        fileContent: "# Test Memory\n\nThis is a test memory.",
      });

      expect(opencodeRule).toBeInstanceOf(OpenCodeRule);
      expect(opencodeRule.getRelativeDirPath()).toBe(".opencode/memories");
      expect(opencodeRule.getRelativeFilePath()).toBe("test-memory.md");
      expect(opencodeRule.getFileContent()).toBe("# Test Memory\n\nThis is a test memory.");
    });

    it("should create instance with custom baseDir", () => {
      const opencodeRule = new OpenCodeRule({
        baseDir: "/custom/path",
        relativeDirPath: ".opencode/memories",
        relativeFilePath: "custom-memory.md",
        fileContent: "# Custom Memory",
      });

      expect(opencodeRule.getFilePath()).toBe("/custom/path/.opencode/memories/custom-memory.md");
    });

    it("should create instance for root AGENTS.md file", () => {
      const opencodeRule = new OpenCodeRule({
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
        fileContent: "# Project Overview\n\nThis is the main OpenCode agent memory.",
        root: true,
      });

      expect(opencodeRule.getRelativeDirPath()).toBe(".");
      expect(opencodeRule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(opencodeRule.getFileContent()).toBe(
        "# Project Overview\n\nThis is the main OpenCode agent memory.",
      );
      expect(opencodeRule.isRoot()).toBe(true);
    });

    it("should validate content by default", () => {
      expect(() => {
        const _instance = new OpenCodeRule({
          relativeDirPath: ".opencode/memories",
          relativeFilePath: "test.md",
          fileContent: "", // empty content should be valid since validate always returns success
        });
      }).not.toThrow();
    });

    it("should skip validation when requested", () => {
      expect(() => {
        const _instance = new OpenCodeRule({
          relativeDirPath: ".opencode/memories",
          relativeFilePath: "test.md",
          fileContent: "",
          validate: false,
        });
      }).not.toThrow();
    });

    it("should handle root rule parameter", () => {
      const opencodeRule = new OpenCodeRule({
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
        fileContent: "# Root Memory",
        root: true,
      });

      expect(opencodeRule.getFileContent()).toBe("# Root Memory");
      expect(opencodeRule.isRoot()).toBe(true);
    });
  });

  describe("fromFile", () => {
    it("should create instance from root AGENTS.md file", async () => {
      // Setup test file - for root, the file should be directly at baseDir/AGENTS.md
      const testContent = "# OpenCode Project\n\nProject overview and agent instructions.";
      await writeFileContent(join(testDir, "AGENTS.md"), testContent);

      const opencodeRule = await OpenCodeRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "AGENTS.md",
      });

      expect(opencodeRule.getRelativeDirPath()).toBe(".");
      expect(opencodeRule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(opencodeRule.getFileContent()).toBe(testContent);
      expect(opencodeRule.getFilePath()).toBe(join(testDir, "AGENTS.md"));
      expect(opencodeRule.isRoot()).toBe(true);
    });

    it("should create instance from memory file", async () => {
      // Setup test file
      const memoriesDir = join(testDir, ".opencode/memories");
      await ensureDir(memoriesDir);
      const testContent = "# Memory Rule\n\nContent from memory file.";
      await writeFileContent(join(memoriesDir, "memory-test.md"), testContent);

      const opencodeRule = await OpenCodeRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "memory-test.md",
      });

      expect(opencodeRule.getRelativeDirPath()).toBe(".opencode/memories");
      expect(opencodeRule.getRelativeFilePath()).toBe("memory-test.md");
      expect(opencodeRule.getFileContent()).toBe(testContent);
      expect(opencodeRule.getFilePath()).toBe(join(testDir, ".opencode/memories/memory-test.md"));
      expect(opencodeRule.isRoot()).toBe(false);
    });

    it("should use default baseDir when not provided", async () => {
      // Setup test file in test directory - process.cwd() is mocked to return testDir
      const testContent = "# Default BaseDir Test";
      await writeFileContent(join(testDir, "AGENTS.md"), testContent);

      const opencodeRule = await OpenCodeRule.fromFile({
        relativeFilePath: "AGENTS.md",
      });

      expect(opencodeRule.getRelativeDirPath()).toBe(".");
      expect(opencodeRule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(opencodeRule.getFileContent()).toBe(testContent);
    });

    it("should handle validation parameter", async () => {
      const testContent = "# Validation Test";
      await writeFileContent(join(testDir, "AGENTS.md"), testContent);

      const opencodeRuleWithValidation = await OpenCodeRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "AGENTS.md",
        validate: true,
      });

      const opencodeRuleWithoutValidation = await OpenCodeRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "AGENTS.md",
        validate: false,
      });

      expect(opencodeRuleWithValidation.getFileContent()).toBe(testContent);
      expect(opencodeRuleWithoutValidation.getFileContent()).toBe(testContent);
    });

    it("should throw error when file does not exist", async () => {
      await expect(
        OpenCodeRule.fromFile({
          baseDir: testDir,
          relativeFilePath: "nonexistent.md",
        }),
      ).rejects.toThrow();
    });

    it("should detect root vs non-root files correctly", async () => {
      // Setup root AGENTS.md file and memory files
      const memoriesDir = join(testDir, ".opencode/memories");
      await ensureDir(memoriesDir);

      const rootContent = "# Root Project Overview";
      const memoryContent = "# Memory Rule";

      // Root file goes directly in baseDir
      await writeFileContent(join(testDir, "AGENTS.md"), rootContent);
      // Memory file goes in .opencode/memories
      await writeFileContent(join(memoriesDir, "memory.md"), memoryContent);

      const rootRule = await OpenCodeRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "AGENTS.md",
      });

      const memoryRule = await OpenCodeRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "memory.md",
      });

      expect(rootRule.isRoot()).toBe(true);
      expect(rootRule.getRelativeDirPath()).toBe(".");
      expect(memoryRule.isRoot()).toBe(false);
      expect(memoryRule.getRelativeDirPath()).toBe(".opencode/memories");
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

      const opencodeRule = OpenCodeRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(opencodeRule).toBeInstanceOf(OpenCodeRule);
      expect(opencodeRule.getRelativeDirPath()).toBe(".");
      expect(opencodeRule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(opencodeRule.getFileContent()).toContain(
        "# Test RulesyncRule\n\nContent from rulesync.",
      );
      expect(opencodeRule.isRoot()).toBe(true);
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

      const opencodeRule = OpenCodeRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(opencodeRule).toBeInstanceOf(OpenCodeRule);
      expect(opencodeRule.getRelativeDirPath()).toBe(".opencode/memories");
      expect(opencodeRule.getRelativeFilePath()).toBe("detail-rule.md");
      expect(opencodeRule.getFileContent()).toContain(
        "# Detail RulesyncRule\n\nContent from detail rulesync.",
      );
      expect(opencodeRule.isRoot()).toBe(false);
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

      const opencodeRule = OpenCodeRule.fromRulesyncRule({
        baseDir: "/custom/base",
        rulesyncRule,
      });

      expect(opencodeRule.getFilePath()).toBe("/custom/base/.opencode/memories/custom-base.md");
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

      const opencodeRuleWithValidation = OpenCodeRule.fromRulesyncRule({
        rulesyncRule,
        validate: true,
      });

      const opencodeRuleWithoutValidation = OpenCodeRule.fromRulesyncRule({
        rulesyncRule,
        validate: false,
      });

      expect(opencodeRuleWithValidation.getFileContent()).toContain("# Validation Test");
      expect(opencodeRuleWithoutValidation.getFileContent()).toContain("# Validation Test");
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert OpenCodeRule to RulesyncRule for root rule", () => {
      const opencodeRule = new OpenCodeRule({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
        fileContent: "# Convert Test\n\nThis will be converted.",
        root: true,
      });

      const rulesyncRule = opencodeRule.toRulesyncRule();

      expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
      expect(rulesyncRule.getRelativeDirPath()).toBe(RULESYNC_RULES_RELATIVE_DIR_PATH);
      expect(rulesyncRule.getRelativeFilePath()).toBe(RULESYNC_OVERVIEW_FILE_NAME);
      expect(rulesyncRule.getFileContent()).toContain("# Convert Test\n\nThis will be converted.");
    });

    it("should convert OpenCodeRule to RulesyncRule for memory rule", () => {
      const opencodeRule = new OpenCodeRule({
        baseDir: testDir,
        relativeDirPath: ".opencode/memories",
        relativeFilePath: "memory-convert.md",
        fileContent: "# Memory Convert Test\n\nThis memory will be converted.",
        root: false,
      });

      const rulesyncRule = opencodeRule.toRulesyncRule();

      expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
      expect(rulesyncRule.getRelativeDirPath()).toBe(RULESYNC_RULES_RELATIVE_DIR_PATH);
      expect(rulesyncRule.getRelativeFilePath()).toBe("memory-convert.md");
      expect(rulesyncRule.getFileContent()).toContain(
        "# Memory Convert Test\n\nThis memory will be converted.",
      );
    });

    it("should preserve metadata in conversion", () => {
      const opencodeRule = new OpenCodeRule({
        baseDir: "/test/path",
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
        fileContent: "# Metadata Test\n\nWith metadata preserved.",
        root: true,
      });

      const rulesyncRule = opencodeRule.toRulesyncRule();

      expect(rulesyncRule.getFilePath()).toBe(
        `${testDir}/${RULESYNC_RULES_RELATIVE_DIR_PATH}/${RULESYNC_OVERVIEW_FILE_NAME}`,
      );
      expect(rulesyncRule.getFileContent()).toContain(
        "# Metadata Test\n\nWith metadata preserved.",
      );
    });
  });

  describe("validate", () => {
    it("should always return success", () => {
      const opencodeRule = new OpenCodeRule({
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
        fileContent: "# Any content is valid",
      });

      const result = opencodeRule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return success for empty content", () => {
      const opencodeRule = new OpenCodeRule({
        relativeDirPath: ".opencode/memories",
        relativeFilePath: "empty.md",
        fileContent: "",
      });

      const result = opencodeRule.validate();

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
        const opencodeRule = new OpenCodeRule({
          relativeDirPath: ".",
          relativeFilePath: "AGENTS.md",
          fileContent: content,
        });

        const result = opencodeRule.validate();
        expect(result.success).toBe(true);
        expect(result.error).toBeNull();
      }
    });
  });

  describe("integration tests", () => {
    it("should handle complete workflow from file to rulesync rule", async () => {
      // Create original file
      const originalContent = "# Integration Test\n\nComplete workflow test.";
      await writeFileContent(join(testDir, "AGENTS.md"), originalContent);

      // Load from file
      const opencodeRule = await OpenCodeRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "AGENTS.md",
      });

      // Convert to rulesync rule
      const rulesyncRule = opencodeRule.toRulesyncRule();

      // Verify conversion
      expect(rulesyncRule.getFileContent()).toContain(originalContent);
      expect(rulesyncRule.getRelativeDirPath()).toBe(RULESYNC_RULES_RELATIVE_DIR_PATH);
      expect(rulesyncRule.getRelativeFilePath()).toBe(RULESYNC_OVERVIEW_FILE_NAME);
    });

    it("should handle complete workflow from memory file to rulesync rule", async () => {
      // Create memory file
      const memoriesDir = join(testDir, ".opencode/memories");
      await ensureDir(memoriesDir);
      const originalContent = "# Memory Integration Test\n\nMemory workflow test.";
      await writeFileContent(join(memoriesDir, "memory-integration.md"), originalContent);

      // Load from file
      const opencodeRule = await OpenCodeRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "memory-integration.md",
      });

      // Convert to rulesync rule
      const rulesyncRule = opencodeRule.toRulesyncRule();

      // Verify conversion
      expect(rulesyncRule.getFileContent()).toContain(originalContent);
      expect(rulesyncRule.getRelativeDirPath()).toBe(RULESYNC_RULES_RELATIVE_DIR_PATH);
      expect(rulesyncRule.getRelativeFilePath()).toBe("memory-integration.md");
    });

    it("should handle roundtrip conversion rulesync -> opencode -> rulesync", () => {
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

      // Convert to opencode rule
      const opencodeRule = OpenCodeRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule: originalRulesync,
      });

      // Convert back to rulesync rule
      const finalRulesync = opencodeRule.toRulesyncRule();

      // Verify content preservation
      expect(finalRulesync.getFileContent()).toContain(originalBody);
      expect(finalRulesync.getRelativeFilePath()).toBe(RULESYNC_OVERVIEW_FILE_NAME); // Should be overview.md for root
    });

    it("should handle roundtrip conversion rulesync -> opencode -> rulesync for detail rule", () => {
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

      // Convert to opencode rule
      const opencodeRule = OpenCodeRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule: originalRulesync,
      });

      // Convert back to rulesync rule
      const finalRulesync = opencodeRule.toRulesyncRule();

      // Verify content preservation
      expect(finalRulesync.getFileContent()).toContain(originalBody);
      expect(finalRulesync.getRelativeFilePath()).toBe("detail-roundtrip.md");
    });

    it("should preserve directory structure in file paths", async () => {
      // Test nested directory structure
      const nestedDir = join(testDir, ".opencode/memories/nested");
      await ensureDir(nestedDir);
      const content = "# Nested Rule\n\nIn a nested directory.";
      await writeFileContent(join(nestedDir, "nested-rule.md"), content);

      // This should work with the current implementation since fromFile
      // determines path based on the relativeFilePath parameter
      const opencodeRule = await OpenCodeRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "nested/nested-rule.md",
      });

      expect(opencodeRule.getRelativeDirPath()).toBe(".opencode/memories");
      expect(opencodeRule.getRelativeFilePath()).toBe("nested/nested-rule.md");
      expect(opencodeRule.getFileContent()).toBe(content);
    });
  });

  describe("edge cases", () => {
    it("should handle files with special characters in names", () => {
      const opencodeRule = new OpenCodeRule({
        relativeDirPath: ".opencode/memories",
        relativeFilePath: "special-chars@#$.md",
        fileContent: "# Special chars in filename",
      });

      expect(opencodeRule.getRelativeFilePath()).toBe("special-chars@#$.md");
    });

    it("should handle very long content", () => {
      const longContent = "# Long Content\n\n" + "A".repeat(10000);
      const opencodeRule = new OpenCodeRule({
        relativeDirPath: ".opencode/memories",
        relativeFilePath: "long-content.md",
        fileContent: longContent,
      });

      expect(opencodeRule.getFileContent()).toBe(longContent);
      expect(opencodeRule.validate().success).toBe(true);
    });

    it("should handle content with various line endings", () => {
      const contentVariations = [
        "Line 1\nLine 2\nLine 3", // Unix
        "Line 1\r\nLine 2\r\nLine 3", // Windows
        "Line 1\rLine 2\rLine 3", // Old Mac
        "Mixed\nLine\r\nEndings\rHere", // Mixed
      ];

      for (const content of contentVariations) {
        const opencodeRule = new OpenCodeRule({
          relativeDirPath: ".opencode/memories",
          relativeFilePath: "line-endings.md",
          fileContent: content,
        });

        expect(opencodeRule.validate().success).toBe(true);
        expect(opencodeRule.getFileContent()).toBe(content);
      }
    });

    it("should handle Unicode content", () => {
      const unicodeContent =
        "# Unicode Test 🚀\n\nEmojis: 😀🎉\nChinese: 你好世界\nArabic: مرحبا بالعالم\nRussian: Привет мир";
      const opencodeRule = new OpenCodeRule({
        relativeDirPath: ".opencode/memories",
        relativeFilePath: "unicode.md",
        fileContent: unicodeContent,
      });

      expect(opencodeRule.getFileContent()).toBe(unicodeContent);
      expect(opencodeRule.validate().success).toBe(true);
    });
  });

  describe("isTargetedByRulesyncRule", () => {
    it("should return true for rules targeting opencode", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["opencode"],
        },
        body: "Test content",
      });

      expect(OpenCodeRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
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

      expect(OpenCodeRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should return false for rules not targeting opencode", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["cursor", "copilot"],
        },
        body: "Test content",
      });

      expect(OpenCodeRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(false);
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

      expect(OpenCodeRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(false);
    });

    it("should handle mixed targets including opencode", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["cursor", "opencode", "copilot"],
        },
        body: "Test content",
      });

      expect(OpenCodeRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should handle undefined targets in frontmatter", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {},
        body: "Test content",
      });

      expect(OpenCodeRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });
  });
});
