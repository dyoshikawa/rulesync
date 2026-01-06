import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_RELATIVE_DIR_PATH,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { ClaudecodeRule } from "./claudecode-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("ClaudecodeRule (Modular Rules)", () => {
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
        relativeDirPath: ".claude/rules",
        relativeFilePath: "test-rule.md",
        frontmatter: {},
        body: "# Test Rule\n\nThis is a test rule.",
      });

      expect(claudecodeRule).toBeInstanceOf(ClaudecodeRule);
      expect(claudecodeRule.getRelativeDirPath()).toBe(".claude/rules");
      expect(claudecodeRule.getRelativeFilePath()).toBe("test-rule.md");
      expect(claudecodeRule.getBody()).toBe("# Test Rule\n\nThis is a test rule.");
    });

    it("should create instance with paths frontmatter", () => {
      const claudecodeRule = new ClaudecodeRule({
        relativeDirPath: ".claude/rules",
        relativeFilePath: "typescript-rules.md",
        frontmatter: { paths: "src/**/*.ts" },
        body: "# TypeScript Rules\n\nRules for TypeScript files.",
      });

      expect(claudecodeRule.getFrontmatter().paths).toBe("src/**/*.ts");
      expect(claudecodeRule.getFileContent()).toContain("paths: src/**/*.ts");
    });

    it("should create instance for root .claude/CLAUDE.md file", () => {
      const claudecodeRule = new ClaudecodeRule({
        relativeDirPath: ".claude",
        relativeFilePath: "CLAUDE.md",
        frontmatter: {},
        body: "# Project Overview\n\nThis is the main Claude Code memory.",
        root: true,
      });

      expect(claudecodeRule.getRelativeDirPath()).toBe(".claude");
      expect(claudecodeRule.getRelativeFilePath()).toBe("CLAUDE.md");
      expect(claudecodeRule.getFileContent()).toBe(
        "# Project Overview\n\nThis is the main Claude Code memory.",
      );
      expect(claudecodeRule.isRoot()).toBe(true);
    });

    it("should not include frontmatter for root file", () => {
      const claudecodeRule = new ClaudecodeRule({
        relativeDirPath: ".claude",
        relativeFilePath: "CLAUDE.md",
        frontmatter: { paths: "**/*" }, // This should be ignored for root
        body: "# Root Content",
        root: true,
      });

      // Root file should not have frontmatter in content
      expect(claudecodeRule.getFileContent()).toBe("# Root Content");
      expect(claudecodeRule.getFileContent()).not.toContain("---");
    });

    it("should not include frontmatter when paths is undefined", () => {
      const claudecodeRule = new ClaudecodeRule({
        relativeDirPath: ".claude/rules",
        relativeFilePath: "general.md",
        frontmatter: {},
        body: "# General Rules",
        root: false,
      });

      // Non-root without paths should not have frontmatter
      expect(claudecodeRule.getFileContent()).toBe("# General Rules");
      expect(claudecodeRule.getFileContent()).not.toContain("---");
    });
  });

  describe("getSettablePaths", () => {
    it("should return modular rules paths for project mode", () => {
      const paths = ClaudecodeRule.getSettablePaths();

      expect(paths.root).toEqual({
        relativeDirPath: ".claude",
        relativeFilePath: "CLAUDE.md",
      });
      expect(paths.nonRoot).toEqual({
        relativeDirPath: ".claude/rules",
      });
    });

    it("should return global paths for global mode", () => {
      const paths = ClaudecodeRule.getSettablePaths({ global: true });

      expect(paths.root).toEqual({
        relativeDirPath: ".claude",
        relativeFilePath: "CLAUDE.md",
      });
      expect(paths).not.toHaveProperty("nonRoot");
    });
  });

  describe("fromFile", () => {
    it("should create instance from root .claude/CLAUDE.md file", async () => {
      const claudeDir = join(testDir, ".claude");
      await ensureDir(claudeDir);
      const testContent = "# Claude Code Project\n\nProject overview and instructions.";
      await writeFileContent(join(claudeDir, "CLAUDE.md"), testContent);

      const claudecodeRule = await ClaudecodeRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "CLAUDE.md",
      });

      expect(claudecodeRule.getRelativeDirPath()).toBe(".claude");
      expect(claudecodeRule.getRelativeFilePath()).toBe("CLAUDE.md");
      expect(claudecodeRule.getBody()).toBe(testContent);
      expect(claudecodeRule.getFilePath()).toBe(join(testDir, ".claude/CLAUDE.md"));
      expect(claudecodeRule.isRoot()).toBe(true);
    });

    it("should create instance from rules file with paths frontmatter", async () => {
      const rulesDir = join(testDir, ".claude/rules");
      await ensureDir(rulesDir);
      const testContent = `---
paths: src/**/*.ts
---

# TypeScript Rules

Rules for TypeScript files.`;
      await writeFileContent(join(rulesDir, "typescript.md"), testContent);

      const claudecodeRule = await ClaudecodeRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "typescript.md",
      });

      expect(claudecodeRule.getRelativeDirPath()).toBe(".claude/rules");
      expect(claudecodeRule.getRelativeFilePath()).toBe("typescript.md");
      expect(claudecodeRule.getFrontmatter().paths).toBe("src/**/*.ts");
      expect(claudecodeRule.getBody()).toBe("# TypeScript Rules\n\nRules for TypeScript files.");
      expect(claudecodeRule.isRoot()).toBe(false);
    });

    it("should create instance from rules file without frontmatter", async () => {
      const rulesDir = join(testDir, ".claude/rules");
      await ensureDir(rulesDir);
      const testContent = "# General Rules\n\nApplies to all files.";
      await writeFileContent(join(rulesDir, "general.md"), testContent);

      const claudecodeRule = await ClaudecodeRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "general.md",
      });

      expect(claudecodeRule.getFrontmatter().paths).toBeUndefined();
      expect(claudecodeRule.getBody()).toBe(testContent);
    });

    it("should throw error when file does not exist", async () => {
      await expect(
        ClaudecodeRule.fromFile({
          baseDir: testDir,
          relativeFilePath: "nonexistent.md",
        }),
      ).rejects.toThrow();
    });
  });

  describe("fromRulesyncRule", () => {
    it("should create instance from RulesyncRule for root rule", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "overview.md",
        frontmatter: {
          root: true,
          targets: ["*"],
          description: "Test root rule",
          globs: ["**/*"],
        },
        body: "# Test RulesyncRule\n\nContent from rulesync.",
      });

      const claudecodeRule = ClaudecodeRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(claudecodeRule).toBeInstanceOf(ClaudecodeRule);
      expect(claudecodeRule.getRelativeDirPath()).toBe(".claude");
      expect(claudecodeRule.getRelativeFilePath()).toBe("CLAUDE.md");
      expect(claudecodeRule.getBody()).toBe("# Test RulesyncRule\n\nContent from rulesync.");
      expect(claudecodeRule.isRoot()).toBe(true);
    });

    it("should create instance from RulesyncRule for non-root rule with globs", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "typescript-rules.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "TypeScript rules",
          globs: ["src/**/*.ts", "tests/**/*.ts"],
        },
        body: "# TypeScript Rules\n\nContent for TS files.",
      });

      const claudecodeRule = ClaudecodeRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(claudecodeRule).toBeInstanceOf(ClaudecodeRule);
      expect(claudecodeRule.getRelativeDirPath()).toBe(".claude/rules");
      expect(claudecodeRule.getRelativeFilePath()).toBe("typescript-rules.md");
      expect(claudecodeRule.getFrontmatter().paths).toBe("src/**/*.ts, tests/**/*.ts");
      expect(claudecodeRule.isRoot()).toBe(false);
    });

    it("should use claudecode.paths over globs when both are specified", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "custom-paths.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          globs: ["src/**/*.ts"],
          claudecode: { paths: "custom/**/*.{ts,tsx}" },
        },
        body: "# Custom Paths Rule",
      });

      const claudecodeRule = ClaudecodeRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(claudecodeRule.getFrontmatter().paths).toBe("custom/**/*.{ts,tsx}");
    });

    it("should not set paths for root rule", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "root.md",
        frontmatter: {
          root: true,
          targets: ["*"],
          globs: ["**/*"],
        },
        body: "# Root Rule",
      });

      const claudecodeRule = ClaudecodeRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(claudecodeRule.getFrontmatter().paths).toBeUndefined();
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert ClaudecodeRule to RulesyncRule for root rule", () => {
      const claudecodeRule = new ClaudecodeRule({
        baseDir: testDir,
        relativeDirPath: ".claude",
        relativeFilePath: "CLAUDE.md",
        frontmatter: {},
        body: "# Convert Test\n\nThis will be converted.",
        root: true,
      });

      const rulesyncRule = claudecodeRule.toRulesyncRule();

      expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
      expect(rulesyncRule.getRelativeDirPath()).toBe(RULESYNC_RULES_RELATIVE_DIR_PATH);
      expect(rulesyncRule.getRelativeFilePath()).toBe("CLAUDE.md");
      expect(rulesyncRule.getBody()).toBe("# Convert Test\n\nThis will be converted.");
      expect(rulesyncRule.getFrontmatter().root).toBe(true);
      expect(rulesyncRule.getFrontmatter().globs).toEqual(["**/*"]);
    });

    it("should convert ClaudecodeRule to RulesyncRule for non-root rule with paths", () => {
      const claudecodeRule = new ClaudecodeRule({
        baseDir: testDir,
        relativeDirPath: ".claude/rules",
        relativeFilePath: "typescript.md",
        frontmatter: { paths: "src/**/*.ts, tests/**/*.ts" },
        body: "# TypeScript Convert Test",
        root: false,
      });

      const rulesyncRule = claudecodeRule.toRulesyncRule();

      expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
      expect(rulesyncRule.getRelativeDirPath()).toBe(RULESYNC_RULES_RELATIVE_DIR_PATH);
      expect(rulesyncRule.getRelativeFilePath()).toBe("typescript.md");
      expect(rulesyncRule.getFrontmatter().root).toBe(false);
      expect(rulesyncRule.getFrontmatter().globs).toEqual(["src/**/*.ts", "tests/**/*.ts"]);
      expect(rulesyncRule.getFrontmatter().claudecode?.paths).toBe("src/**/*.ts, tests/**/*.ts");
    });
  });

  describe("validate", () => {
    it("should always return success for valid frontmatter", () => {
      const claudecodeRule = new ClaudecodeRule({
        relativeDirPath: ".claude",
        relativeFilePath: "CLAUDE.md",
        frontmatter: {},
        body: "# Any content is valid",
      });

      const result = claudecodeRule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return success for valid paths frontmatter", () => {
      const claudecodeRule = new ClaudecodeRule({
        relativeDirPath: ".claude/rules",
        relativeFilePath: "test.md",
        frontmatter: { paths: "src/**/*.ts" },
        body: "# Test content",
      });

      const result = claudecodeRule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });

  describe("isTargetedByRulesyncRule", () => {
    it("should return true for rules targeting claudecode", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
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
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
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
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["cursor", "copilot"],
        },
        body: "Test content",
      });

      expect(ClaudecodeRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(false);
    });

    it("should return false for rules targeting only claudecode-legacy (not modular)", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["claudecode-legacy"],
        },
        body: "Test content",
      });

      expect(ClaudecodeRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(false);
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
      expect(claudecodeRule.getBody()).toBe(testContent);
      expect(claudecodeRule.getFilePath()).toBe(join(testDir, ".claude/CLAUDE.md"));
      expect(claudecodeRule.isRoot()).toBe(true);
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

      const claudecodeRule = ClaudecodeRule.fromRulesyncRule({
        rulesyncRule,
        global: true,
      });

      expect(claudecodeRule.getRelativeDirPath()).toBe(".claude");
      expect(claudecodeRule.getRelativeFilePath()).toBe("CLAUDE.md");
      expect(claudecodeRule.isRoot()).toBe(true);
    });
  });

  describe("integration tests", () => {
    it("should handle complete workflow from rulesync -> claudecode -> rulesync", () => {
      const originalBody = "# Roundtrip Test\n\nContent should remain the same.";

      const originalRulesync = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "roundtrip.md",
        frontmatter: {
          root: true,
          targets: ["*"],
          description: "Roundtrip test",
          globs: ["**/*"],
        },
        body: originalBody,
      });

      const claudecodeRule = ClaudecodeRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule: originalRulesync,
      });

      const finalRulesync = claudecodeRule.toRulesyncRule();

      expect(finalRulesync.getBody()).toBe(originalBody);
    });

    it("should preserve paths through roundtrip conversion", () => {
      const originalBody = "# TypeScript Rules";
      const originalPaths = "src/**/*.ts, tests/**/*.ts";

      const originalRulesync = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "typescript.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          claudecode: { paths: originalPaths },
        },
        body: originalBody,
      });

      const claudecodeRule = ClaudecodeRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule: originalRulesync,
      });

      const finalRulesync = claudecodeRule.toRulesyncRule();

      expect(finalRulesync.getBody()).toBe(originalBody);
      expect(finalRulesync.getFrontmatter().claudecode?.paths).toBe(originalPaths);
    });
  });

  describe("edge cases", () => {
    it("should handle multiple comma-separated paths", () => {
      const claudecodeRule = new ClaudecodeRule({
        relativeDirPath: ".claude/rules",
        relativeFilePath: "multi-path.md",
        frontmatter: { paths: "src/**/*.ts, tests/**/*.ts, scripts/**/*.js" },
        body: "# Multi-path Rule",
      });

      const rulesyncRule = claudecodeRule.toRulesyncRule();

      expect(rulesyncRule.getFrontmatter().globs).toEqual([
        "src/**/*.ts",
        "tests/**/*.ts",
        "scripts/**/*.js",
      ]);
    });

    it("should handle brace expansion syntax in paths", () => {
      const claudecodeRule = new ClaudecodeRule({
        relativeDirPath: ".claude/rules",
        relativeFilePath: "brace.md",
        frontmatter: { paths: "src/**/*.{ts,tsx}" },
        body: "# Brace Expansion Rule",
      });

      // YAML quotes paths containing special characters like braces
      expect(claudecodeRule.getFileContent()).toContain("paths:");
      expect(claudecodeRule.getFileContent()).toContain("src/**/*.{ts,tsx}");
    });
  });
});
