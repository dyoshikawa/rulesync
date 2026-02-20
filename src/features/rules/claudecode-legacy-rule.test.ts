import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_OVERVIEW_FILE_NAME,
  RULESYNC_RELATIVE_DIR_PATH,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { ClaudecodeLegacyRule } from "./claudecode-legacy-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("ClaudecodeLegacyRule", () => {
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
      const claudecodeLegacyRule = new ClaudecodeLegacyRule({
        relativeDirPath: ".claude/memories",
        relativeFilePath: "test-memory.md",
        fileContent: "# Test Memory\n\nThis is a test memory.",
      });

      expect(claudecodeLegacyRule).toBeInstanceOf(ClaudecodeLegacyRule);
      expect(claudecodeLegacyRule.getRelativeDirPath()).toBe(".claude/memories");
      expect(claudecodeLegacyRule.getRelativeFilePath()).toBe("test-memory.md");
      expect(claudecodeLegacyRule.getFileContent()).toBe("# Test Memory\n\nThis is a test memory.");
    });

    it("should create instance with custom baseDir", () => {
      const claudecodeLegacyRule = new ClaudecodeLegacyRule({
        baseDir: "/custom/path",
        relativeDirPath: ".claude/memories",
        relativeFilePath: "custom-memory.md",
        fileContent: "# Custom Memory",
      });

      expect(claudecodeLegacyRule.getFilePath()).toBe(
        "/custom/path/.claude/memories/custom-memory.md",
      );
    });

    it("should create instance for root CLAUDE.md file", () => {
      const claudecodeLegacyRule = new ClaudecodeLegacyRule({
        relativeDirPath: ".",
        relativeFilePath: "CLAUDE.md",
        fileContent: "# Project Overview\n\nThis is the main Claude Code memory.",
        root: true,
      });

      expect(claudecodeLegacyRule.getRelativeDirPath()).toBe(".");
      expect(claudecodeLegacyRule.getRelativeFilePath()).toBe("CLAUDE.md");
      expect(claudecodeLegacyRule.getFileContent()).toBe(
        "# Project Overview\n\nThis is the main Claude Code memory.",
      );
      expect(claudecodeLegacyRule.isRoot()).toBe(true);
    });

    it("should handle root rule parameter", () => {
      const claudecodeLegacyRule = new ClaudecodeLegacyRule({
        relativeDirPath: ".",
        relativeFilePath: "CLAUDE.md",
        fileContent: "# Root Memory",
        root: true,
      });

      expect(claudecodeLegacyRule.getFileContent()).toBe("# Root Memory");
      expect(claudecodeLegacyRule.isRoot()).toBe(true);
    });
  });

  describe("fromFile", () => {
    it("should create instance from root CLAUDE.md file", async () => {
      // Setup test file - for root, the file should be directly at baseDir/CLAUDE.md
      const testContent = "# Claude Code Project\n\nProject overview and instructions.";
      await writeFileContent(join(testDir, "CLAUDE.md"), testContent);

      const claudecodeLegacyRule = await ClaudecodeLegacyRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "CLAUDE.md",
      });

      expect(claudecodeLegacyRule.getRelativeDirPath()).toBe(".");
      expect(claudecodeLegacyRule.getRelativeFilePath()).toBe("CLAUDE.md");
      expect(claudecodeLegacyRule.getFileContent()).toBe(testContent);
      expect(claudecodeLegacyRule.getFilePath()).toBe(join(testDir, "CLAUDE.md"));
      expect(claudecodeLegacyRule.isRoot()).toBe(true);
    });

    it("should create instance from memory file", async () => {
      // Setup test file
      const memoriesDir = join(testDir, ".claude/memories");
      await ensureDir(memoriesDir);
      const testContent = "# Memory Rule\n\nContent from memory file.";
      await writeFileContent(join(memoriesDir, "memory-test.md"), testContent);

      const claudecodeLegacyRule = await ClaudecodeLegacyRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "memory-test.md",
      });

      expect(claudecodeLegacyRule.getRelativeDirPath()).toBe(".claude/memories");
      expect(claudecodeLegacyRule.getRelativeFilePath()).toBe("memory-test.md");
      expect(claudecodeLegacyRule.getFileContent()).toBe(testContent);
      expect(claudecodeLegacyRule.getFilePath()).toBe(
        join(testDir, ".claude/memories/memory-test.md"),
      );
      expect(claudecodeLegacyRule.isRoot()).toBe(false);
    });

    it("should use default baseDir when not provided", async () => {
      // Setup test file in test directory - for root CLAUDE.md, it should be at baseDir/CLAUDE.md
      const testContent = "# Default BaseDir Test";
      await writeFileContent(join(testDir, "CLAUDE.md"), testContent);

      const claudecodeLegacyRule = await ClaudecodeLegacyRule.fromFile({
        relativeFilePath: "CLAUDE.md",
      });

      expect(claudecodeLegacyRule.getRelativeDirPath()).toBe(".");
      expect(claudecodeLegacyRule.getRelativeFilePath()).toBe("CLAUDE.md");
      expect(claudecodeLegacyRule.getFileContent()).toBe(testContent);
    });

    it("should throw error when file does not exist", async () => {
      await expect(
        ClaudecodeLegacyRule.fromFile({
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

      const rootRule = await ClaudecodeLegacyRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "CLAUDE.md",
      });

      const memoryRule = await ClaudecodeLegacyRule.fromFile({
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

      const claudecodeLegacyRule = ClaudecodeLegacyRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(claudecodeLegacyRule).toBeInstanceOf(ClaudecodeLegacyRule);
      expect(claudecodeLegacyRule.getRelativeDirPath()).toBe(".");
      expect(claudecodeLegacyRule.getRelativeFilePath()).toBe("CLAUDE.md");
      expect(claudecodeLegacyRule.getFileContent()).toContain(
        "# Test RulesyncRule\n\nContent from rulesync.",
      );
      expect(claudecodeLegacyRule.isRoot()).toBe(true);
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

      const claudecodeLegacyRule = ClaudecodeLegacyRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(claudecodeLegacyRule).toBeInstanceOf(ClaudecodeLegacyRule);
      expect(claudecodeLegacyRule.getRelativeDirPath()).toBe(".claude/memories");
      expect(claudecodeLegacyRule.getRelativeFilePath()).toBe("detail-rule.md");
      expect(claudecodeLegacyRule.getFileContent()).toContain(
        "# Detail RulesyncRule\n\nContent from detail rulesync.",
      );
      expect(claudecodeLegacyRule.isRoot()).toBe(false);
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

      const claudecodeLegacyRule = ClaudecodeLegacyRule.fromRulesyncRule({
        baseDir: "/custom/base",
        rulesyncRule,
      });

      expect(claudecodeLegacyRule.getFilePath()).toBe(
        "/custom/base/.claude/memories/custom-base.md",
      );
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert ClaudecodeLegacyRule to RulesyncRule for root rule", () => {
      const claudecodeLegacyRule = new ClaudecodeLegacyRule({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "CLAUDE.md",
        fileContent: "# Convert Test\n\nThis will be converted.",
        root: true,
      });

      const rulesyncRule = claudecodeLegacyRule.toRulesyncRule();

      expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
      expect(rulesyncRule.getRelativeDirPath()).toBe(RULESYNC_RULES_RELATIVE_DIR_PATH);
      expect(rulesyncRule.getRelativeFilePath()).toBe(RULESYNC_OVERVIEW_FILE_NAME);
      expect(rulesyncRule.getFileContent()).toContain("# Convert Test\n\nThis will be converted.");
    });

    it("should convert ClaudecodeLegacyRule to RulesyncRule for memory rule", () => {
      const claudecodeLegacyRule = new ClaudecodeLegacyRule({
        baseDir: testDir,
        relativeDirPath: ".claude/memories",
        relativeFilePath: "memory-convert.md",
        fileContent: "# Memory Convert Test\n\nThis memory will be converted.",
        root: false,
      });

      const rulesyncRule = claudecodeLegacyRule.toRulesyncRule();

      expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
      expect(rulesyncRule.getRelativeDirPath()).toBe(RULESYNC_RULES_RELATIVE_DIR_PATH);
      expect(rulesyncRule.getRelativeFilePath()).toBe("memory-convert.md");
      expect(rulesyncRule.getFileContent()).toContain(
        "# Memory Convert Test\n\nThis memory will be converted.",
      );
    });
  });

  describe("validate", () => {
    it("should always return success", () => {
      const claudecodeLegacyRule = new ClaudecodeLegacyRule({
        relativeDirPath: ".",
        relativeFilePath: "CLAUDE.md",
        fileContent: "# Any content is valid",
      });

      const result = claudecodeLegacyRule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });

  describe("getSettablePaths with global flag", () => {
    it("should return global-specific paths", () => {
      const paths = ClaudecodeLegacyRule.getSettablePaths({ global: true });

      expect(paths).toHaveProperty("root");
      expect(paths.root).toEqual({
        relativeDirPath: ".claude",
        relativeFilePath: "CLAUDE.md",
      });
      expect(paths).not.toHaveProperty("nonRoot");
    });

    it("should have different paths than regular getSettablePaths", () => {
      const globalPaths = ClaudecodeLegacyRule.getSettablePaths({ global: true });
      const regularPaths = ClaudecodeLegacyRule.getSettablePaths();

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

      const claudecodeLegacyRule = await ClaudecodeLegacyRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "CLAUDE.md",
        global: true,
      });

      expect(claudecodeLegacyRule.getRelativeDirPath()).toBe(".claude");
      expect(claudecodeLegacyRule.getRelativeFilePath()).toBe("CLAUDE.md");
      expect(claudecodeLegacyRule.getFileContent()).toBe(testContent);
      expect(claudecodeLegacyRule.getFilePath()).toBe(join(testDir, ".claude/CLAUDE.md"));
      expect(claudecodeLegacyRule.isRoot()).toBe(true);
    });
  });

  describe("fromRulesyncRule with global flag", () => {
    it("should use global paths when global=true for root rule", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "test-rule.md",
        frontmatter: {
          root: true,
          targets: ["*"],
          description: "Test root rule",
          globs: [],
        },
        body: "# Global Test RulesyncRule\n\nContent from rulesync.",
      });

      const claudecodeLegacyRule = ClaudecodeLegacyRule.fromRulesyncRule({
        rulesyncRule,
        global: true,
      });

      expect(claudecodeLegacyRule.getRelativeDirPath()).toBe(".claude");
      expect(claudecodeLegacyRule.getRelativeFilePath()).toBe("CLAUDE.md");
      expect(claudecodeLegacyRule.isRoot()).toBe(true);
    });

    it("should use regular paths when global=false for root rule", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "test-rule.md",
        frontmatter: {
          root: true,
          targets: ["*"],
          description: "Test root rule",
          globs: [],
        },
        body: "# Regular Test RulesyncRule\n\nContent from rulesync.",
      });

      const claudecodeLegacyRule = ClaudecodeLegacyRule.fromRulesyncRule({
        rulesyncRule,
        global: false,
      });

      expect(claudecodeLegacyRule.getRelativeDirPath()).toBe(".");
      expect(claudecodeLegacyRule.getRelativeFilePath()).toBe("CLAUDE.md");
      expect(claudecodeLegacyRule.isRoot()).toBe(true);
    });
  });

  describe("isTargetedByRulesyncRule", () => {
    it("should return true for rules targeting claudecode-legacy", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["claudecode-legacy"],
        },
        body: "Test content",
      });

      expect(ClaudecodeLegacyRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
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

      expect(ClaudecodeLegacyRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should return false for rules not targeting claudecode-legacy", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["cursor", "copilot"],
        },
        body: "Test content",
      });

      expect(ClaudecodeLegacyRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(false);
    });

    it("should return false for rules targeting only claudecode (not legacy)", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["claudecode"],
        },
        body: "Test content",
      });

      expect(ClaudecodeLegacyRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(false);
    });
  });
});
