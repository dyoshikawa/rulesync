import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { ClaudecodeRule } from "./claudecode-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("ClaudecodeRule", () => {
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
      const claudecodeRule = new ClaudecodeRule({
        relativeDirPath: ".claude/memories",
        relativeFilePath: "test-memory.md",
        fileContent: "# Test Memory\n\nThis is a test memory.",
      });

      expect(claudecodeRule).toBeInstanceOf(ClaudecodeRule);
      expect(claudecodeRule.getRelativeDirPath()).toBe(".claude/memories");
      expect(claudecodeRule.getRelativeFilePath()).toBe("test-memory.md");
      expect(claudecodeRule.getFileContent()).toBe("# Test Memory\n\nThis is a test memory.");
    });

    it("should create instance with custom baseDir", () => {
      const claudecodeRule = new ClaudecodeRule({
        baseDir: "/custom/path",
        relativeDirPath: ".claude/memories",
        relativeFilePath: "custom-memory.md",
        fileContent: "# Custom Memory",
      });

      expect(claudecodeRule.getFilePath()).toBe("/custom/path/.claude/memories/custom-memory.md");
    });

    it("should create instance for root CLAUDE.md file", () => {
      const claudecodeRule = new ClaudecodeRule({
        relativeDirPath: ".",
        relativeFilePath: "CLAUDE.md",
        fileContent: "# Project Overview\n\nThis is the main Claude Code memory.",
        root: true,
      });

      expect(claudecodeRule.getRelativeDirPath()).toBe(".");
      expect(claudecodeRule.getRelativeFilePath()).toBe("CLAUDE.md");
      expect(claudecodeRule.getFileContent()).toBe(
        "# Project Overview\n\nThis is the main Claude Code memory.",
      );
      expect(claudecodeRule.isRoot()).toBe(true);
    });

    it("should validate content by default", () => {
      expect(() => {
        const _instance = new ClaudecodeRule({
          relativeDirPath: ".claude/memories",
          relativeFilePath: "test.md",
          fileContent: "", // empty content should be valid since validate always returns success
        });
      }).not.toThrow();
    });

    it("should skip validation when requested", () => {
      expect(() => {
        const _instance = new ClaudecodeRule({
          relativeDirPath: ".claude/memories",
          relativeFilePath: "test.md",
          fileContent: "",
          validate: false,
        });
      }).not.toThrow();
    });

    it("should handle root rule parameter", () => {
      const claudecodeRule = new ClaudecodeRule({
        relativeDirPath: ".",
        relativeFilePath: "CLAUDE.md",
        fileContent: "# Root Memory",
        root: true,
      });

      expect(claudecodeRule.getFileContent()).toBe("# Root Memory");
      expect(claudecodeRule.isRoot()).toBe(true);
    });
  });

  describe("fromFile", () => {
    it("should create instance from root CLAUDE.md file", async () => {
      // Setup test file - for root, the file should be directly at baseDir/CLAUDE.md
      const testContent = "# Claude Code Project\n\nProject overview and instructions.";
      await writeFileContent(join(testDir, "CLAUDE.md"), testContent);

      const claudecodeRule = await ClaudecodeRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "CLAUDE.md",
      });

      expect(claudecodeRule.getRelativeDirPath()).toBe(".");
      expect(claudecodeRule.getRelativeFilePath()).toBe("CLAUDE.md");
      expect(claudecodeRule.getFileContent()).toBe(testContent);
      expect(claudecodeRule.getFilePath()).toBe(join(testDir, "CLAUDE.md"));
      expect(claudecodeRule.isRoot()).toBe(true);
    });

    it("should create instance from memory file", async () => {
      // Setup test file
      const memoriesDir = join(testDir, ".claude/memories");
      await ensureDir(memoriesDir);
      const testContent = "# Memory Rule\n\nContent from memory file.";
      await writeFileContent(join(memoriesDir, "memory-test.md"), testContent);

      const claudecodeRule = await ClaudecodeRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "memory-test.md",
      });

      expect(claudecodeRule.getRelativeDirPath()).toBe(".claude/memories");
      expect(claudecodeRule.getRelativeFilePath()).toBe("memory-test.md");
      expect(claudecodeRule.getFileContent()).toBe(testContent);
      expect(claudecodeRule.getFilePath()).toBe(join(testDir, ".claude/memories/memory-test.md"));
      expect(claudecodeRule.isRoot()).toBe(false);
    });

    it("should use default baseDir when not provided", async () => {
      // Setup test file in test directory - for root CLAUDE.md, it should be at baseDir/CLAUDE.md
      const testContent = "# Default BaseDir Test";
      await writeFileContent(join(testDir, "CLAUDE.md"), testContent);

      const claudecodeRule = await ClaudecodeRule.fromFile({
        relativeFilePath: "CLAUDE.md",
      });

      expect(claudecodeRule.getRelativeDirPath()).toBe(".");
      expect(claudecodeRule.getRelativeFilePath()).toBe("CLAUDE.md");
      expect(claudecodeRule.getFileContent()).toBe(testContent);
    });

    it("should handle validation parameter", async () => {
      const testContent = "# Validation Test";
      await writeFileContent(join(testDir, "CLAUDE.md"), testContent);

      const claudecodeRuleWithValidation = await ClaudecodeRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "CLAUDE.md",
        validate: true,
      });

      const claudecodeRuleWithoutValidation = await ClaudecodeRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "CLAUDE.md",
        validate: false,
      });

      expect(claudecodeRuleWithValidation.getFileContent()).toBe(testContent);
      expect(claudecodeRuleWithoutValidation.getFileContent()).toBe(testContent);
    });

    it("should throw error when file does not exist", async () => {
      await expect(
        ClaudecodeRule.fromFile({
          baseDir: testDir,
          relativeFilePath: "nonexistent.md",
        }),
      ).rejects.toThrow();
    });

    it("should detect root vs non-root files correctly", async () => {
      // Setup root CLAUDE.md file and memory files
      const memoriesDir = join(testDir, ".claude/memories");
      await ensureDir(memoriesDir);

      const rootContent = "# Root Project Overview";
      const memoryContent = "# Memory Rule";

      // Root file goes directly in baseDir
      await writeFileContent(join(testDir, "CLAUDE.md"), rootContent);
      // Memory file goes in .claude/memories
      await writeFileContent(join(memoriesDir, "memory.md"), memoryContent);

      const rootRule = await ClaudecodeRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "CLAUDE.md",
      });

      const memoryRule = await ClaudecodeRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "memory.md",
      });

      expect(rootRule.isRoot()).toBe(true);
      expect(rootRule.getRelativeDirPath()).toBe(".");
      expect(memoryRule.isRoot()).toBe(false);
      expect(memoryRule.getRelativeDirPath()).toBe(".claude/memories");
    });
  });

  describe("fromRulesyncRule", () => {
    it("should create instance from RulesyncRule for root rule", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".rulesync",
        relativeFilePath: "test-rule.md",
        frontmatter: {
          root: true,
          targets: ["*"],
          description: "Test root rule",
          globs: [],
        },
        body: "# Test RulesyncRule\n\nContent from rulesync.",
      });

      const claudecodeRule = ClaudecodeRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(claudecodeRule).toBeInstanceOf(ClaudecodeRule);
      expect(claudecodeRule.getRelativeDirPath()).toBe(".");
      expect(claudecodeRule.getRelativeFilePath()).toBe("CLAUDE.md");
      expect(claudecodeRule.getFileContent()).toContain(
        "# Test RulesyncRule\n\nContent from rulesync.",
      );
      expect(claudecodeRule.isRoot()).toBe(true);
    });

    it("should create instance from RulesyncRule for non-root rule", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".rulesync",
        relativeFilePath: "detail-rule.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "Test detail rule",
          globs: [],
        },
        body: "# Detail RulesyncRule\n\nContent from detail rulesync.",
      });

      const claudecodeRule = ClaudecodeRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(claudecodeRule).toBeInstanceOf(ClaudecodeRule);
      expect(claudecodeRule.getRelativeDirPath()).toBe(".claude/memories");
      expect(claudecodeRule.getRelativeFilePath()).toBe("detail-rule.md");
      expect(claudecodeRule.getFileContent()).toContain(
        "# Detail RulesyncRule\n\nContent from detail rulesync.",
      );
      expect(claudecodeRule.isRoot()).toBe(false);
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

      const claudecodeRule = ClaudecodeRule.fromRulesyncRule({
        baseDir: "/custom/base",
        rulesyncRule,
      });

      expect(claudecodeRule.getFilePath()).toBe("/custom/base/.claude/memories/custom-base.md");
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

      const claudecodeRuleWithValidation = ClaudecodeRule.fromRulesyncRule({
        rulesyncRule,
        validate: true,
      });

      const claudecodeRuleWithoutValidation = ClaudecodeRule.fromRulesyncRule({
        rulesyncRule,
        validate: false,
      });

      expect(claudecodeRuleWithValidation.getFileContent()).toContain("# Validation Test");
      expect(claudecodeRuleWithoutValidation.getFileContent()).toContain("# Validation Test");
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert ClaudecodeRule to RulesyncRule for root rule", () => {
      const claudecodeRule = new ClaudecodeRule({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "CLAUDE.md",
        fileContent: "# Convert Test\n\nThis will be converted.",
        root: true,
      });

      const rulesyncRule = claudecodeRule.toRulesyncRule();

      expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
      expect(rulesyncRule.getRelativeDirPath()).toBe(".rulesync/rules");
      expect(rulesyncRule.getRelativeFilePath()).toBe("CLAUDE.md");
      expect(rulesyncRule.getFileContent()).toContain("# Convert Test\n\nThis will be converted.");
    });

    it("should convert ClaudecodeRule to RulesyncRule for memory rule", () => {
      const claudecodeRule = new ClaudecodeRule({
        baseDir: testDir,
        relativeDirPath: ".claude/memories",
        relativeFilePath: "memory-convert.md",
        fileContent: "# Memory Convert Test\n\nThis memory will be converted.",
        root: false,
      });

      const rulesyncRule = claudecodeRule.toRulesyncRule();

      expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
      expect(rulesyncRule.getRelativeDirPath()).toBe(".rulesync/rules");
      expect(rulesyncRule.getRelativeFilePath()).toBe("memory-convert.md");
      expect(rulesyncRule.getFileContent()).toContain(
        "# Memory Convert Test\n\nThis memory will be converted.",
      );
    });

    it("should preserve metadata in conversion", () => {
      const claudecodeRule = new ClaudecodeRule({
        baseDir: "/test/path",
        relativeDirPath: ".",
        relativeFilePath: "CLAUDE.md",
        fileContent: "# Metadata Test\n\nWith metadata preserved.",
        root: true,
      });

      const rulesyncRule = claudecodeRule.toRulesyncRule();

      expect(rulesyncRule.getFilePath()).toBe(".rulesync/rules/CLAUDE.md");
      expect(rulesyncRule.getFileContent()).toContain(
        "# Metadata Test\n\nWith metadata preserved.",
      );
    });
  });

  describe("validate", () => {
    it("should always return success", () => {
      const claudecodeRule = new ClaudecodeRule({
        relativeDirPath: ".",
        relativeFilePath: "CLAUDE.md",
        fileContent: "# Any content is valid",
      });

      const result = claudecodeRule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return success for empty content", () => {
      const claudecodeRule = new ClaudecodeRule({
        relativeDirPath: ".claude/memories",
        relativeFilePath: "empty.md",
        fileContent: "",
      });

      const result = claudecodeRule.validate();

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
        const claudecodeRule = new ClaudecodeRule({
          relativeDirPath: ".",
          relativeFilePath: "CLAUDE.md",
          fileContent: content,
        });

        const result = claudecodeRule.validate();
        expect(result.success).toBe(true);
        expect(result.error).toBeNull();
      }
    });
  });

  describe("integration tests", () => {
    it("should handle complete workflow from file to rulesync rule", async () => {
      // Create original file
      const originalContent = "# Integration Test\n\nComplete workflow test.";
      await writeFileContent(join(testDir, "CLAUDE.md"), originalContent);

      // Load from file
      const claudecodeRule = await ClaudecodeRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "CLAUDE.md",
      });

      // Convert to rulesync rule
      const rulesyncRule = claudecodeRule.toRulesyncRule();

      // Verify conversion
      expect(rulesyncRule.getFileContent()).toContain(originalContent);
      expect(rulesyncRule.getRelativeDirPath()).toBe(".rulesync/rules");
      expect(rulesyncRule.getRelativeFilePath()).toBe("CLAUDE.md");
    });

    it("should handle complete workflow from memory file to rulesync rule", async () => {
      // Create memory file
      const memoriesDir = join(testDir, ".claude/memories");
      await ensureDir(memoriesDir);
      const originalContent = "# Memory Integration Test\n\nMemory workflow test.";
      await writeFileContent(join(memoriesDir, "memory-integration.md"), originalContent);

      // Load from file
      const claudecodeRule = await ClaudecodeRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "memory-integration.md",
      });

      // Convert to rulesync rule
      const rulesyncRule = claudecodeRule.toRulesyncRule();

      // Verify conversion
      expect(rulesyncRule.getFileContent()).toContain(originalContent);
      expect(rulesyncRule.getRelativeDirPath()).toBe(".rulesync/rules");
      expect(rulesyncRule.getRelativeFilePath()).toBe("memory-integration.md");
    });

    it("should handle roundtrip conversion rulesync -> claudecode -> rulesync", () => {
      const originalBody = "# Roundtrip Test\n\nContent should remain the same.";

      // Start with rulesync rule (root)
      const originalRulesync = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "roundtrip.md",
        frontmatter: {
          root: true,
          targets: ["*"],
          description: "Roundtrip test",
          globs: [],
        },
        body: originalBody,
      });

      // Convert to claudecode rule
      const claudecodeRule = ClaudecodeRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule: originalRulesync,
      });

      // Convert back to rulesync rule
      const finalRulesync = claudecodeRule.toRulesyncRule();

      // Verify content preservation
      expect(finalRulesync.getFileContent()).toContain(originalBody);
      expect(finalRulesync.getRelativeFilePath()).toBe("CLAUDE.md"); // Should be CLAUDE.md for root
    });

    it("should handle roundtrip conversion rulesync -> claudecode -> rulesync for detail rule", () => {
      const originalBody = "# Detail Roundtrip Test\n\nDetail content should remain the same.";

      // Start with rulesync rule (non-root)
      const originalRulesync = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "detail-roundtrip.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "Detail roundtrip test",
          globs: [],
        },
        body: originalBody,
      });

      // Convert to claudecode rule
      const claudecodeRule = ClaudecodeRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule: originalRulesync,
      });

      // Convert back to rulesync rule
      const finalRulesync = claudecodeRule.toRulesyncRule();

      // Verify content preservation
      expect(finalRulesync.getFileContent()).toContain(originalBody);
      expect(finalRulesync.getRelativeFilePath()).toBe("detail-roundtrip.md");
    });

    it("should preserve directory structure in file paths", async () => {
      // Test nested directory structure
      const nestedDir = join(testDir, ".claude/memories/nested");
      await ensureDir(nestedDir);
      const content = "# Nested Rule\n\nIn a nested directory.";
      await writeFileContent(join(nestedDir, "nested-rule.md"), content);

      // This should work with the current implementation since fromFile
      // determines path based on the relativeFilePath parameter
      const claudecodeRule = await ClaudecodeRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "nested/nested-rule.md",
      });

      expect(claudecodeRule.getRelativeDirPath()).toBe(".claude/memories");
      expect(claudecodeRule.getRelativeFilePath()).toBe("nested/nested-rule.md");
      expect(claudecodeRule.getFileContent()).toBe(content);
    });
  });

  describe("getSettablePaths with global flag", () => {
    it("should return global-specific paths", () => {
      const paths = ClaudecodeRule.getSettablePaths({ global: true });

      expect(paths).toHaveProperty("root");
      expect(paths.root).toEqual({
        relativeDirPath: ".claude",
        relativeFilePath: "CLAUDE.md",
      });
      expect(paths).not.toHaveProperty("nonRoot");
    });

    it("should have different paths than regular getSettablePaths", () => {
      const globalPaths = ClaudecodeRule.getSettablePaths({ global: true });
      const regularPaths = ClaudecodeRule.getSettablePaths();

      expect(globalPaths.root.relativeDirPath).not.toBe(regularPaths.root.relativeDirPath);
      expect(globalPaths.root.relativeFilePath).toBe(regularPaths.root.relativeFilePath);
    });
  });

  describe("fromFile with global flag", () => {
    it("should load root file from .claude/CLAUDE.md when global=true", async () => {
      const globalDir = join(testDir, ".claude");
      await ensureDir(globalDir);
      const testContent = "# Global Claude Code\n\nGlobal user configuration.";
      await writeFileContent(join(globalDir, "CLAUDE.md"), testContent);

      const claudecodeRule = await ClaudecodeRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "CLAUDE.md",
        global: true,
      });

      expect(claudecodeRule.getRelativeDirPath()).toBe(".claude");
      expect(claudecodeRule.getRelativeFilePath()).toBe("CLAUDE.md");
      expect(claudecodeRule.getFileContent()).toBe(testContent);
      expect(claudecodeRule.getFilePath()).toBe(join(testDir, ".claude/CLAUDE.md"));
      expect(claudecodeRule.isRoot()).toBe(true);
    });

    it("should use global paths when global=true", async () => {
      const globalDir = join(testDir, ".claude");
      await ensureDir(globalDir);
      const testContent = "# Global Mode Test";
      await writeFileContent(join(globalDir, "CLAUDE.md"), testContent);

      const claudecodeRule = await ClaudecodeRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "CLAUDE.md",
        global: true,
      });

      const globalPaths = ClaudecodeRule.getSettablePaths({ global: true });
      expect(claudecodeRule.getRelativeDirPath()).toBe(globalPaths.root.relativeDirPath);
      expect(claudecodeRule.getRelativeFilePath()).toBe(globalPaths.root.relativeFilePath);
    });

    it("should use regular paths when global=false", async () => {
      const testContent = "# Non-Global Mode Test";
      await writeFileContent(join(testDir, "CLAUDE.md"), testContent);

      const claudecodeRule = await ClaudecodeRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "CLAUDE.md",
        global: false,
      });

      expect(claudecodeRule.getRelativeDirPath()).toBe(".");
      expect(claudecodeRule.getRelativeFilePath()).toBe("CLAUDE.md");
    });
  });

  describe("fromRulesyncRule with global flag", () => {
    it("should use global paths when global=true for root rule", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "test-rule.md",
        frontmatter: {
          root: true,
          targets: ["*"],
          description: "Test root rule",
          globs: [],
        },
        body: "# Global Test RulesyncRule\n\nContent from rulesync.",
      });

      const claudecodeRule = ClaudecodeRule.fromRulesyncRule({
        rulesyncRule,
        global: true,
      });

      expect(claudecodeRule.getRelativeDirPath()).toBe(".claude");
      expect(claudecodeRule.getRelativeFilePath()).toBe("CLAUDE.md");
      expect(claudecodeRule.isRoot()).toBe(true);
    });

    it("should use regular paths when global=false for root rule", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "test-rule.md",
        frontmatter: {
          root: true,
          targets: ["*"],
          description: "Test root rule",
          globs: [],
        },
        body: "# Regular Test RulesyncRule\n\nContent from rulesync.",
      });

      const claudecodeRule = ClaudecodeRule.fromRulesyncRule({
        rulesyncRule,
        global: false,
      });

      expect(claudecodeRule.getRelativeDirPath()).toBe(".");
      expect(claudecodeRule.getRelativeFilePath()).toBe("CLAUDE.md");
      expect(claudecodeRule.isRoot()).toBe(true);
    });

    it("should default to regular paths when global is not specified", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "test-rule.md",
        frontmatter: {
          root: true,
          targets: ["*"],
          description: "Test root rule",
          globs: [],
        },
        body: "# Default Test RulesyncRule\n\nContent from rulesync.",
      });

      const claudecodeRule = ClaudecodeRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(claudecodeRule.getRelativeDirPath()).toBe(".");
      expect(claudecodeRule.getRelativeFilePath()).toBe("CLAUDE.md");
    });
  });

  describe("isTargetedByRulesyncRule", () => {
    it("should return true for rules targeting claudecode", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["claudecode"],
        },
        body: "Test content",
      });

      expect(ClaudecodeRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should return true for rules targeting all tools (*)", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["*"],
        },
        body: "Test content",
      });

      expect(ClaudecodeRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should return false for rules not targeting claudecode", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["cursor", "copilot"],
        },
        body: "Test content",
      });

      expect(ClaudecodeRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(false);
    });

    it("should return false for empty targets", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "test.md",
        frontmatter: {
          targets: [],
        },
        body: "Test content",
      });

      expect(ClaudecodeRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(false);
    });

    it("should handle mixed targets including claudecode", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["cursor", "claudecode", "copilot"],
        },
        body: "Test content",
      });

      expect(ClaudecodeRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should handle undefined targets in frontmatter", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "test.md",
        frontmatter: {},
        body: "Test content",
      });

      expect(ClaudecodeRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("should handle files with special characters in names", () => {
      const claudecodeRule = new ClaudecodeRule({
        relativeDirPath: ".claude/memories",
        relativeFilePath: "special-chars@#$.md",
        fileContent: "# Special chars in filename",
      });

      expect(claudecodeRule.getRelativeFilePath()).toBe("special-chars@#$.md");
    });

    it("should handle very long content", () => {
      const longContent = "# Long Content\n\n" + "A".repeat(10000);
      const claudecodeRule = new ClaudecodeRule({
        relativeDirPath: ".claude/memories",
        relativeFilePath: "long-content.md",
        fileContent: longContent,
      });

      expect(claudecodeRule.getFileContent()).toBe(longContent);
      expect(claudecodeRule.validate().success).toBe(true);
    });

    it("should handle content with various line endings", () => {
      const contentVariations = [
        "Line 1\nLine 2\nLine 3", // Unix
        "Line 1\r\nLine 2\r\nLine 3", // Windows
        "Line 1\rLine 2\rLine 3", // Old Mac
        "Mixed\nLine\r\nEndings\rHere", // Mixed
      ];

      for (const content of contentVariations) {
        const claudecodeRule = new ClaudecodeRule({
          relativeDirPath: ".claude/memories",
          relativeFilePath: "line-endings.md",
          fileContent: content,
        });

        expect(claudecodeRule.validate().success).toBe(true);
        expect(claudecodeRule.getFileContent()).toBe(content);
      }
    });

    it("should handle Unicode content", () => {
      const unicodeContent =
        "# Unicode Test 🚀\n\nEmojis: 😀🎉\nChinese: 你好世界\nArabic: مرحبا بالعالم\nRussian: Привет мир";
      const claudecodeRule = new ClaudecodeRule({
        relativeDirPath: ".claude/memories",
        relativeFilePath: "unicode.md",
        fileContent: unicodeContent,
      });

      expect(claudecodeRule.getFileContent()).toBe(unicodeContent);
      expect(claudecodeRule.validate().success).toBe(true);
    });
  });
});
