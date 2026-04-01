import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_OVERVIEW_FILE_NAME,
  RULESYNC_RELATIVE_DIR_PATH,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { KiloRule } from "./kilo-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("KiloRule", () => {
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
      const kiloRule = new KiloRule({
        relativeDirPath: ".kilo/rules",
        relativeFilePath: "test-memory.md",
        fileContent: "# Test Memory\n\nThis is a test memory.",
      });

      expect(kiloRule).toBeInstanceOf(KiloRule);
      expect(kiloRule.getRelativeDirPath()).toBe(".kilo/rules");
      expect(kiloRule.getRelativeFilePath()).toBe("test-memory.md");
      expect(kiloRule.getFileContent()).toBe("# Test Memory\n\nThis is a test memory.");
    });

    it("should create instance with custom baseDir", () => {
      const kiloRule = new KiloRule({
        baseDir: "/custom/path",
        relativeDirPath: ".kilo/rules",
        relativeFilePath: "custom-memory.md",
        fileContent: "# Custom Memory",
      });

      expect(kiloRule.getFilePath()).toBe("/custom/path/.kilo/rules/custom-memory.md");
    });

    it("should create instance for root AGENTS.md file", () => {
      const kiloRule = new KiloRule({
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
        fileContent: "# Project Overview\n\nThis is the main Kilo agent memory.",
        root: true,
      });

      expect(kiloRule.getRelativeDirPath()).toBe(".");
      expect(kiloRule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(kiloRule.getFileContent()).toBe(
        "# Project Overview\n\nThis is the main Kilo agent memory.",
      );
      expect(kiloRule.isRoot()).toBe(true);
    });

    it("should validate content by default", () => {
      expect(() => {
        const _instance = new KiloRule({
          relativeDirPath: ".kilo/rules",
          relativeFilePath: "test.md",
          fileContent: "", // empty content should be valid since validate always returns success
        });
      }).not.toThrow();
    });

    it("should skip validation when requested", () => {
      expect(() => {
        const _instance = new KiloRule({
          relativeDirPath: ".kilo/rules",
          relativeFilePath: "test.md",
          fileContent: "",
          validate: false,
        });
      }).not.toThrow();
    });

    it("should handle root rule parameter", () => {
      const kiloRule = new KiloRule({
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
        fileContent: "# Root Memory",
        root: true,
      });

      expect(kiloRule.getFileContent()).toBe("# Root Memory");
      expect(kiloRule.isRoot()).toBe(true);
    });
  });

  describe("fromFile", () => {
    it("should create instance from root AGENTS.md file", async () => {
      // Setup test file - for root, the file should be directly at baseDir/AGENTS.md
      const testContent = "# Kilo Project\n\nProject overview and agent instructions.";
      await writeFileContent(join(testDir, "AGENTS.md"), testContent);

      const kiloRule = await KiloRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "AGENTS.md",
      });

      expect(kiloRule.getRelativeDirPath()).toBe(".");
      expect(kiloRule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(kiloRule.getFileContent()).toBe(testContent);
      expect(kiloRule.getFilePath()).toBe(join(testDir, "AGENTS.md"));
      expect(kiloRule.isRoot()).toBe(true);
    });

    it("should create instance from memory file", async () => {
      // Setup test file
      const memoriesDir = join(testDir, ".kilo/rules");
      await ensureDir(memoriesDir);
      const testContent = "# Memory Rule\n\nContent from memory file.";
      await writeFileContent(join(memoriesDir, "memory-test.md"), testContent);

      const kiloRule = await KiloRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "memory-test.md",
      });

      expect(kiloRule.getRelativeDirPath()).toBe(".kilo/rules");
      expect(kiloRule.getRelativeFilePath()).toBe("memory-test.md");
      expect(kiloRule.getFileContent()).toBe(testContent);
      expect(kiloRule.getFilePath()).toBe(join(testDir, ".kilo/rules/memory-test.md"));
      expect(kiloRule.isRoot()).toBe(false);
    });

    it("should use default baseDir when not provided", async () => {
      // Setup test file in test directory - process.cwd() is mocked to return testDir
      const testContent = "# Default BaseDir Test";
      await writeFileContent(join(testDir, "AGENTS.md"), testContent);

      const kiloRule = await KiloRule.fromFile({
        relativeFilePath: "AGENTS.md",
      });

      expect(kiloRule.getRelativeDirPath()).toBe(".");
      expect(kiloRule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(kiloRule.getFileContent()).toBe(testContent);
    });

    it("should handle validation parameter", async () => {
      const testContent = "# Validation Test";
      await writeFileContent(join(testDir, "AGENTS.md"), testContent);

      const kiloRuleWithValidation = await KiloRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "AGENTS.md",
        validate: true,
      });

      const kiloRuleWithoutValidation = await KiloRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "AGENTS.md",
        validate: false,
      });

      expect(kiloRuleWithValidation.getFileContent()).toBe(testContent);
      expect(kiloRuleWithoutValidation.getFileContent()).toBe(testContent);
    });

    it("should throw error when file does not exist", async () => {
      await expect(
        KiloRule.fromFile({
          baseDir: testDir,
          relativeFilePath: "nonexistent.md",
        }),
      ).rejects.toThrow();
    });

    it("should detect root vs non-root files correctly", async () => {
      // Setup root AGENTS.md file and memory files
      const memoriesDir = join(testDir, ".kilo/rules");
      await ensureDir(memoriesDir);

      const rootContent = "# Root Project Overview";
      const memoryContent = "# Memory Rule";

      // Root file goes directly in baseDir
      await writeFileContent(join(testDir, "AGENTS.md"), rootContent);
      // Memory file goes in .kilo/rules
      await writeFileContent(join(memoriesDir, "memory.md"), memoryContent);

      const rootRule = await KiloRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "AGENTS.md",
      });

      const memoryRule = await KiloRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "memory.md",
      });

      expect(rootRule.isRoot()).toBe(true);
      expect(rootRule.getRelativeDirPath()).toBe(".");
      expect(memoryRule.isRoot()).toBe(false);
      expect(memoryRule.getRelativeDirPath()).toBe(".kilo/rules");
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

      const kiloRule = KiloRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(kiloRule).toBeInstanceOf(KiloRule);
      expect(kiloRule.getRelativeDirPath()).toBe(".");
      expect(kiloRule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(kiloRule.getFileContent()).toContain("# Test RulesyncRule\n\nContent from rulesync.");
      expect(kiloRule.isRoot()).toBe(true);
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

      const kiloRule = KiloRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(kiloRule).toBeInstanceOf(KiloRule);
      expect(kiloRule.getRelativeDirPath()).toBe(".kilo/rules");
      expect(kiloRule.getRelativeFilePath()).toBe("detail-rule.md");
      expect(kiloRule.getFileContent()).toContain(
        "# Detail RulesyncRule\n\nContent from detail rulesync.",
      );
      expect(kiloRule.isRoot()).toBe(false);
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

      const kiloRule = KiloRule.fromRulesyncRule({
        baseDir: "/custom/base",
        rulesyncRule,
      });

      expect(kiloRule.getFilePath()).toBe("/custom/base/.kilo/rules/custom-base.md");
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

      const kiloRuleWithValidation = KiloRule.fromRulesyncRule({
        rulesyncRule,
        validate: true,
      });

      const kiloRuleWithoutValidation = KiloRule.fromRulesyncRule({
        rulesyncRule,
        validate: false,
      });

      expect(kiloRuleWithValidation.getFileContent()).toContain("# Validation Test");
      expect(kiloRuleWithoutValidation.getFileContent()).toContain("# Validation Test");
    });

    it("should handle subprojectPath from agentsmd field", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          root: false,
          targets: ["kilo"],
          agentsmd: {
            subprojectPath: "packages/my-app",
          },
        },
        body: "# Subproject Kilo\n\nContent for subproject.",
      });

      const kiloRule = KiloRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule,
      });

      expect(kiloRule.getFileContent()).toBe("# Subproject Kilo\n\nContent for subproject.");
      expect(kiloRule.getRelativeDirPath()).toBe("packages/my-app");
      expect(kiloRule.getRelativeFilePath()).toBe("AGENTS.md");
    });

    it("should ignore subprojectPath for root rules", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          root: true,
          targets: ["kilo"],
          agentsmd: {
            subprojectPath: "packages/my-app", // Should be ignored
          },
        },
        body: "# Root Kilo\n\nRoot content.",
      });

      const kiloRule = KiloRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule,
      });

      expect(kiloRule.getFileContent()).toBe("# Root Kilo\n\nRoot content.");
      expect(kiloRule.getRelativeDirPath()).toBe(".");
      expect(kiloRule.getRelativeFilePath()).toBe("AGENTS.md");
    });

    it("should handle empty subprojectPath", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          root: false,
          targets: ["kilo"],
          agentsmd: {
            subprojectPath: "",
          },
        },
        body: "# Empty Subproject Kilo\n\nContent.",
      });

      const kiloRule = KiloRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule,
      });

      expect(kiloRule.getFileContent()).toBe("# Empty Subproject Kilo\n\nContent.");
      expect(kiloRule.getRelativeDirPath()).toBe(".kilo/rules");
      expect(kiloRule.getRelativeFilePath()).toBe("test.md");
    });

    it("should handle complex nested subprojectPath", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "nested.md",
        frontmatter: {
          root: false,
          targets: ["kilo"],
          agentsmd: {
            subprojectPath: "packages/apps/my-app/src",
          },
        },
        body: "# Nested Subproject Kilo\n\nDeeply nested content.",
      });

      const kiloRule = KiloRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule,
      });

      expect(kiloRule.getFileContent()).toBe("# Nested Subproject Kilo\n\nDeeply nested content.");
      expect(kiloRule.getRelativeDirPath()).toBe("packages/apps/my-app/src");
      expect(kiloRule.getRelativeFilePath()).toBe("AGENTS.md");
    });

    it("should handle undefined agentsmd field", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          root: false,
          targets: ["kilo"],
        },
        body: "# No agentsmd\n\nContent without agentsmd.",
      });

      const kiloRule = KiloRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule,
      });

      expect(kiloRule.getFileContent()).toBe("# No agentsmd\n\nContent without agentsmd.");
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert KiloRule to RulesyncRule for root rule", () => {
      const kiloRule = new KiloRule({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
        fileContent: "# Convert Test\n\nThis will be converted.",
        root: true,
      });

      const rulesyncRule = kiloRule.toRulesyncRule();

      expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
      expect(rulesyncRule.getRelativeDirPath()).toBe(RULESYNC_RULES_RELATIVE_DIR_PATH);
      expect(rulesyncRule.getRelativeFilePath()).toBe(RULESYNC_OVERVIEW_FILE_NAME);
      expect(rulesyncRule.getFileContent()).toContain("# Convert Test\n\nThis will be converted.");
    });

    it("should convert KiloRule to RulesyncRule for memory rule", () => {
      const kiloRule = new KiloRule({
        baseDir: testDir,
        relativeDirPath: ".kilo/rules",
        relativeFilePath: "memory-convert.md",
        fileContent: "# Memory Convert Test\n\nThis memory will be converted.",
        root: false,
      });

      const rulesyncRule = kiloRule.toRulesyncRule();

      expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
      expect(rulesyncRule.getRelativeDirPath()).toBe(RULESYNC_RULES_RELATIVE_DIR_PATH);
      expect(rulesyncRule.getRelativeFilePath()).toBe("memory-convert.md");
      expect(rulesyncRule.getFileContent()).toContain(
        "# Memory Convert Test\n\nThis memory will be converted.",
      );
    });

    it("should preserve metadata in conversion", () => {
      const kiloRule = new KiloRule({
        baseDir: "/test/path",
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
        fileContent: "# Metadata Test\n\nWith metadata preserved.",
        root: true,
      });

      const rulesyncRule = kiloRule.toRulesyncRule();

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
      const kiloRule = new KiloRule({
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
        fileContent: "# Any content is valid",
      });

      const result = kiloRule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return success for empty content", () => {
      const kiloRule = new KiloRule({
        relativeDirPath: ".kilo/rules",
        relativeFilePath: "empty.md",
        fileContent: "",
      });

      const result = kiloRule.validate();

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
        const kiloRule = new KiloRule({
          relativeDirPath: ".",
          relativeFilePath: "AGENTS.md",
          fileContent: content,
        });

        const result = kiloRule.validate();
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
      const kiloRule = await KiloRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "AGENTS.md",
      });

      // Convert to rulesync rule
      const rulesyncRule = kiloRule.toRulesyncRule();

      // Verify conversion
      expect(rulesyncRule.getFileContent()).toContain(originalContent);
      expect(rulesyncRule.getRelativeDirPath()).toBe(RULESYNC_RULES_RELATIVE_DIR_PATH);
      expect(rulesyncRule.getRelativeFilePath()).toBe(RULESYNC_OVERVIEW_FILE_NAME);
    });

    it("should handle complete workflow from memory file to rulesync rule", async () => {
      // Create memory file
      const memoriesDir = join(testDir, ".kilo/rules");
      await ensureDir(memoriesDir);
      const originalContent = "# Memory Integration Test\n\nMemory workflow test.";
      await writeFileContent(join(memoriesDir, "memory-integration.md"), originalContent);

      // Load from file
      const kiloRule = await KiloRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "memory-integration.md",
      });

      // Convert to rulesync rule
      const rulesyncRule = kiloRule.toRulesyncRule();

      // Verify conversion
      expect(rulesyncRule.getFileContent()).toContain(originalContent);
      expect(rulesyncRule.getRelativeDirPath()).toBe(RULESYNC_RULES_RELATIVE_DIR_PATH);
      expect(rulesyncRule.getRelativeFilePath()).toBe("memory-integration.md");
    });

    it("should handle roundtrip conversion rulesync -> kilo -> rulesync", () => {
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

      // Convert to kilo rule
      const kiloRule = KiloRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule: originalRulesync,
      });

      // Convert back to rulesync rule
      const finalRulesync = kiloRule.toRulesyncRule();

      // Verify content preservation
      expect(finalRulesync.getFileContent()).toContain(originalBody);
      expect(finalRulesync.getRelativeFilePath()).toBe(RULESYNC_OVERVIEW_FILE_NAME); // Should be overview.md for root
    });

    it("should handle roundtrip conversion rulesync -> kilo -> rulesync for detail rule", () => {
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

      // Convert to kilo rule
      const kiloRule = KiloRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule: originalRulesync,
      });

      // Convert back to rulesync rule
      const finalRulesync = kiloRule.toRulesyncRule();

      // Verify content preservation
      expect(finalRulesync.getFileContent()).toContain(originalBody);
      expect(finalRulesync.getRelativeFilePath()).toBe("detail-roundtrip.md");
    });

    it("should preserve directory structure in file paths", async () => {
      // Test nested directory structure
      const nestedDir = join(testDir, ".kilo/rules/nested");
      await ensureDir(nestedDir);
      const content = "# Nested Rule\n\nIn a nested directory.";
      await writeFileContent(join(nestedDir, "nested-rule.md"), content);

      // This should work with the current implementation since fromFile
      // determines path based on the relativeFilePath parameter
      const kiloRule = await KiloRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "nested/nested-rule.md",
      });

      expect(kiloRule.getRelativeDirPath()).toBe(".kilo/rules");
      expect(kiloRule.getRelativeFilePath()).toBe("nested/nested-rule.md");
      expect(kiloRule.getFileContent()).toBe(content);
    });
  });

  describe("edge cases", () => {
    it("should handle files with special characters in names", () => {
      const kiloRule = new KiloRule({
        relativeDirPath: ".kilo/rules",
        relativeFilePath: "special-chars@#$.md",
        fileContent: "# Special chars in filename",
      });

      expect(kiloRule.getRelativeFilePath()).toBe("special-chars@#$.md");
    });

    it("should handle very long content", () => {
      const longContent = "# Long Content\n\n" + "A".repeat(10000);
      const kiloRule = new KiloRule({
        relativeDirPath: ".kilo/rules",
        relativeFilePath: "long-content.md",
        fileContent: longContent,
      });

      expect(kiloRule.getFileContent()).toBe(longContent);
      expect(kiloRule.validate().success).toBe(true);
    });

    it("should handle content with various line endings", () => {
      const contentVariations = [
        "Line 1\nLine 2\nLine 3", // Unix
        "Line 1\r\nLine 2\r\nLine 3", // Windows
        "Line 1\rLine 2\rLine 3", // Old Mac
        "Mixed\nLine\r\nEndings\rHere", // Mixed
      ];

      for (const content of contentVariations) {
        const kiloRule = new KiloRule({
          relativeDirPath: ".kilo/rules",
          relativeFilePath: "line-endings.md",
          fileContent: content,
        });

        expect(kiloRule.validate().success).toBe(true);
        expect(kiloRule.getFileContent()).toBe(content);
      }
    });

    it("should handle Unicode content", () => {
      const unicodeContent =
        "# Unicode Test 🚀\n\nEmojis: 😀🎉\nChinese: 你好世界\nArabic: مرحبا بالعالم\nRussian: Привет мир";
      const kiloRule = new KiloRule({
        relativeDirPath: ".kilo/rules",
        relativeFilePath: "unicode.md",
        fileContent: unicodeContent,
      });

      expect(kiloRule.getFileContent()).toBe(unicodeContent);
      expect(kiloRule.validate().success).toBe(true);
    });
  });

  describe("getSettablePaths", () => {
    it("should return correct paths for root and nonRoot", () => {
      const paths = KiloRule.getSettablePaths();

      expect(paths.root).toEqual({
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
      });

      expect(paths.nonRoot).toEqual({
        relativeDirPath: ".kilo/rules",
      });
    });

    it("should have consistent paths structure", () => {
      const paths = KiloRule.getSettablePaths();

      expect(paths).toHaveProperty("root");
      expect(paths).toHaveProperty("nonRoot");
      expect(paths.root).toHaveProperty("relativeDirPath");
      expect(paths.root).toHaveProperty("relativeFilePath");
      expect(paths.nonRoot).toHaveProperty("relativeDirPath");
    });
  });

  describe("getSettablePaths with global flag", () => {
    it("should return global-specific paths", () => {
      const paths = KiloRule.getSettablePaths({ global: true });

      expect(paths).toHaveProperty("root");
      expect(paths.root).toEqual({
        relativeDirPath: ".config/kilo",
        relativeFilePath: "AGENTS.md",
      });
      expect(paths).not.toHaveProperty("nonRoot");
    });

    it("should have different paths than regular getSettablePaths", () => {
      const globalPaths = KiloRule.getSettablePaths({ global: true });
      const regularPaths = KiloRule.getSettablePaths();

      expect(globalPaths.root.relativeDirPath).not.toBe(regularPaths.root.relativeDirPath);
      expect(globalPaths.root.relativeFilePath).toBe(regularPaths.root.relativeFilePath);
    });
  });

  describe("fromFile with global flag", () => {
    it("should load root file from .config/kilo/AGENTS.md when global=true", async () => {
      const globalDir = join(testDir, ".config/kilo");
      await ensureDir(globalDir);
      const testContent = "# Global Kilo\n\nGlobal user configuration.";
      await writeFileContent(join(globalDir, "AGENTS.md"), testContent);

      const kiloRule = await KiloRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "AGENTS.md",
        global: true,
      });

      expect(kiloRule.getRelativeDirPath()).toBe(".config/kilo");
      expect(kiloRule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(kiloRule.getFileContent()).toBe(testContent);
      expect(kiloRule.getFilePath()).toBe(join(testDir, ".config/kilo/AGENTS.md"));
    });

    it("should use global paths when global=true", async () => {
      const globalDir = join(testDir, ".config/kilo");
      await ensureDir(globalDir);
      const testContent = "# Global Mode Test";
      await writeFileContent(join(globalDir, "AGENTS.md"), testContent);

      const kiloRule = await KiloRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "AGENTS.md",
        global: true,
      });

      const globalPaths = KiloRule.getSettablePaths({ global: true });
      expect(kiloRule.getRelativeDirPath()).toBe(globalPaths.root.relativeDirPath);
      expect(kiloRule.getRelativeFilePath()).toBe(globalPaths.root.relativeFilePath);
    });

    it("should use regular paths when global=false", async () => {
      const testContent = "# Non-Global Mode Test";
      await writeFileContent(join(testDir, "AGENTS.md"), testContent);

      const kiloRule = await KiloRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "AGENTS.md",
        global: false,
      });

      expect(kiloRule.getRelativeDirPath()).toBe(".");
      expect(kiloRule.getRelativeFilePath()).toBe("AGENTS.md");
    });
  });

  describe("fromRulesyncRule with global flag", () => {
    it("should use global paths when global=true for root rule", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: `${RULESYNC_RELATIVE_DIR_PATH}/rules`,
        relativeFilePath: "test-rule.md",
        frontmatter: {
          root: true,
          targets: ["*"],
          description: "Test root rule",
          globs: [],
        },
        body: "# Global Test RulesyncRule\n\nContent from rulesync.",
      });

      const kiloRule = KiloRule.fromRulesyncRule({
        rulesyncRule,
        global: true,
      });

      expect(kiloRule.getRelativeDirPath()).toBe(".config/kilo");
      expect(kiloRule.getRelativeFilePath()).toBe("AGENTS.md");
    });

    it("should use regular paths when global=false for root rule", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: `${RULESYNC_RELATIVE_DIR_PATH}/rules`,
        relativeFilePath: "test-rule.md",
        frontmatter: {
          root: true,
          targets: ["*"],
          description: "Test root rule",
          globs: [],
        },
        body: "# Regular Test RulesyncRule\n\nContent from rulesync.",
      });

      const kiloRule = KiloRule.fromRulesyncRule({
        rulesyncRule,
        global: false,
      });

      expect(kiloRule.getRelativeDirPath()).toBe(".");
      expect(kiloRule.getRelativeFilePath()).toBe("AGENTS.md");
    });
  });

  describe("isTargetedByRulesyncRule", () => {
    it("should return true for rules targeting kilo", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["kilo"],
        },
        body: "Test content",
      });

      expect(KiloRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
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

      expect(KiloRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should return false for rules not targeting kilo", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["cursor", "copilot"],
        },
        body: "Test content",
      });

      expect(KiloRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(false);
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

      expect(KiloRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(false);
    });

    it("should handle mixed targets including kilo", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["cursor", "kilo", "copilot"],
        },
        body: "Test content",
      });

      expect(KiloRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should handle undefined targets in frontmatter", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {},
        body: "Test content",
      });

      expect(KiloRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });
  });
});
