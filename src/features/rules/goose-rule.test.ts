import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_OVERVIEW_FILE_NAME,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { GooseRule, type GooseRuleParams } from "./goose-rule.js";
import { RulesyncRule, type RulesyncRuleFrontmatterInput } from "./rulesync-rule.js";

describe("GooseRule", () => {
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
    it("should create a GooseRule with basic parameters", () => {
      const params: GooseRuleParams = {
        relativeDirPath: ".goose",
        relativeFilePath: "test-rule.md",
        fileContent: "# Test Goose Rule\n\nThis is a test goose rule.",
      };

      const gooseRule = new GooseRule(params);

      expect(gooseRule).toBeInstanceOf(GooseRule);
      expect(gooseRule.getRelativeDirPath()).toBe(".goose");
      expect(gooseRule.getRelativeFilePath()).toBe("test-rule.md");
      expect(gooseRule.getFileContent()).toBe("# Test Goose Rule\n\nThis is a test goose rule.");
      expect(gooseRule.isRoot()).toBe(false);
    });

    it("should create a GooseRule with root parameter set to true", () => {
      const params: GooseRuleParams = {
        relativeDirPath: ".",
        relativeFilePath: ".goosehints",
        fileContent: "# Root Goose Rule\n\nThis is the root goose hints file.",
        root: true,
      };

      const gooseRule = new GooseRule(params);

      expect(gooseRule.isRoot()).toBe(true);
      expect(gooseRule.getRelativeFilePath()).toBe(".goosehints");
    });

    it("should create a GooseRule with root parameter set to false", () => {
      const params: GooseRuleParams = {
        relativeDirPath: ".goose/memories",
        relativeFilePath: "memory.md",
        fileContent: "# Memory Rule\n\nThis is a memory rule.",
        root: false,
      };

      const gooseRule = new GooseRule(params);

      expect(gooseRule.isRoot()).toBe(false);
    });

    it("should default root to false when not provided", () => {
      const params: GooseRuleParams = {
        relativeDirPath: ".goose",
        relativeFilePath: "test.md",
        fileContent: "# Test\n\nContent",
      };

      const gooseRule = new GooseRule(params);

      expect(gooseRule.isRoot()).toBe(false);
    });

    it("should create a GooseRule with custom baseDir", () => {
      const params: GooseRuleParams = {
        baseDir: "/custom/path",
        relativeDirPath: ".goose",
        relativeFilePath: "custom.md",
        fileContent: "# Custom Rule",
      };

      const gooseRule = new GooseRule(params);

      expect(gooseRule.getFilePath()).toBe("/custom/path/.goose/custom.md");
    });

    it("should pass all parameters to parent ToolRule", () => {
      const params: GooseRuleParams = {
        baseDir: testDir,
        relativeDirPath: ".goose/memories",
        relativeFilePath: "test.md",
        fileContent: "# Test Content",
        validate: false,
        root: true,
      };

      const gooseRule = new GooseRule(params);

      expect(gooseRule.getBaseDir()).toBe(testDir);
      expect(gooseRule.getRelativeDirPath()).toBe(".goose/memories");
      expect(gooseRule.getRelativeFilePath()).toBe("test.md");
      expect(gooseRule.getFileContent()).toBe("# Test Content");
      expect(gooseRule.isRoot()).toBe(true);
    });
  });

  describe("fromFile", () => {
    it("should create GooseRule from root .goosehints file", async () => {
      const gooseContent = "# Main Goose Hints\n\nAlways use TypeScript for new projects.";
      await writeFileContent(join(testDir, ".goosehints"), gooseContent);

      const gooseRule = await GooseRule.fromFile({
        baseDir: testDir,
        relativeFilePath: ".goosehints",
      });

      expect(gooseRule.isRoot()).toBe(true);
      expect(gooseRule.getRelativeDirPath()).toBe(".");
      expect(gooseRule.getRelativeFilePath()).toBe(".goosehints");
      expect(gooseRule.getFileContent()).toBe(gooseContent);
      expect(gooseRule.getFilePath()).toBe(join(testDir, ".goosehints"));
    });

    it("should create GooseRule from memory file in .goose/memories", async () => {
      const memoryContent = "# Memory File\n\nThis is a memory file.";
      const memoriesDir = join(testDir, ".goose/memories");
      await ensureDir(memoriesDir);
      await writeFileContent(join(memoriesDir, "test-memory.md"), memoryContent);

      const gooseRule = await GooseRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "test-memory.md",
      });

      expect(gooseRule.isRoot()).toBe(false);
      expect(gooseRule.getRelativeDirPath()).toBe(".goose/memories");
      expect(gooseRule.getRelativeFilePath()).toBe("test-memory.md");
      expect(gooseRule.getFileContent()).toBe(memoryContent);
      expect(gooseRule.getFilePath()).toBe(join(testDir, ".goose/memories/test-memory.md"));
    });

    it("should use default baseDir (process.cwd()) when not provided", async () => {
      const gooseContent = "# Default Test";
      await writeFileContent(join(testDir, ".goosehints"), gooseContent);

      const gooseRule = await GooseRule.fromFile({
        relativeFilePath: ".goosehints",
      });

      expect(gooseRule.getBaseDir()).toBe(testDir);
      expect(gooseRule.isRoot()).toBe(true);
    });

    it("should handle validation parameter", async () => {
      const gooseContent = "# Validation Test";
      await writeFileContent(join(testDir, ".goosehints"), gooseContent);

      const gooseRule = await GooseRule.fromFile({
        baseDir: testDir,
        relativeFilePath: ".goosehints",
        validate: false,
      });

      expect(gooseRule).toBeInstanceOf(GooseRule);
    });

    it("should throw error when file does not exist", async () => {
      await expect(
        GooseRule.fromFile({
          baseDir: testDir,
          relativeFilePath: "nonexistent.md",
        }),
      ).rejects.toThrow();
    });

    it("should create GooseRule from global .goosehints file", async () => {
      const gooseContent = "# Global Goose Hints";
      await writeFileContent(join(testDir, ".goosehints"), gooseContent);

      const gooseRule = await GooseRule.fromFile({
        baseDir: testDir,
        relativeFilePath: ".goosehints",
        global: true,
      });

      expect(gooseRule.isRoot()).toBe(true);
      expect(gooseRule.getRelativeFilePath()).toBe(".goosehints");
    });
  });

  describe("fromRulesyncRule", () => {
    it("should create GooseRule from RulesyncRule for root file", () => {
      const frontmatter: RulesyncRuleFrontmatterInput = {
        description: "Test goose rule",
        root: true,
      };

      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".",
        relativeFilePath: ".goosehints",
        frontmatter,
        body: "# Test Rule\n\nContent",
      });

      const gooseRule = GooseRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule,
      });

      expect(gooseRule).toBeInstanceOf(GooseRule);
      expect(gooseRule.getBaseDir()).toBe(testDir);
      expect(gooseRule.getRelativeDirPath()).toBe(".");
      expect(gooseRule.getRelativeFilePath()).toBe(".goosehints");
      expect(gooseRule.isRoot()).toBe(true);
    });

    it("should create GooseRule from RulesyncRule for memory file", () => {
      const frontmatter: RulesyncRuleFrontmatterInput = {
        description: "Test memory rule",
      };

      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".goose/memories",
        relativeFilePath: "memory.md",
        frontmatter,
        body: "# Memory Rule\n\nMemory content",
      });

      const gooseRule = GooseRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule,
      });

      expect(gooseRule).toBeInstanceOf(GooseRule);
      expect(gooseRule.getBaseDir()).toBe(testDir);
      expect(gooseRule.getRelativeDirPath()).toBe(".goose/memories");
      expect(gooseRule.getRelativeFilePath()).toBe("memory.md");
      expect(gooseRule.isRoot()).toBe(false);
    });

    it("should use default baseDir (process.cwd()) when not provided", () => {
      const frontmatter: RulesyncRuleFrontmatterInput = {
        description: "Default test",
        root: true,
      };

      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".",
        relativeFilePath: ".goosehints",
        frontmatter,
        body: "# Default",
      });

      const gooseRule = GooseRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(gooseRule.getBaseDir()).toBe(testDir);
    });

    it("should handle validation parameter", () => {
      const frontmatter: RulesyncRuleFrontmatterInput = {
        description: "Validation test",
        root: true,
      };

      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".",
        relativeFilePath: ".goosehints",
        frontmatter,
        body: "# Validation",
      });

      const gooseRule = GooseRule.fromRulesyncRule({
        rulesyncRule,
        validate: false,
      });

      expect(gooseRule).toBeInstanceOf(GooseRule);
    });

    it("should create GooseRule from RulesyncRule in global mode", () => {
      const frontmatter: RulesyncRuleFrontmatterInput = {
        description: "Global goose rule",
        root: true,
      };

      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".",
        relativeFilePath: ".goosehints",
        frontmatter,
        body: "# Global Rule",
      });

      const gooseRule = GooseRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule,
        global: true,
      });

      expect(gooseRule).toBeInstanceOf(GooseRule);
      expect(gooseRule.isRoot()).toBe(true);
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert GooseRule to RulesyncRule", () => {
      const gooseRule = new GooseRule({
        relativeDirPath: ".goose/memories",
        relativeFilePath: "test.md",
        fileContent: "# Test Rule\n\nTest content",
      });

      const rulesyncRule = gooseRule.toRulesyncRule();

      expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
      expect(rulesyncRule.getRelativeDirPath()).toBe(RULESYNC_RULES_RELATIVE_DIR_PATH);
      expect(rulesyncRule.getRelativeFilePath()).toBe("test.md");
      expect(rulesyncRule.getBody()).toBe("# Test Rule\n\nTest content");
    });

    it("should convert root GooseRule to RulesyncRule", () => {
      const gooseRule = new GooseRule({
        relativeDirPath: ".",
        relativeFilePath: ".goosehints",
        fileContent: "# Root Rule\n\nRoot content",
        root: true,
      });

      const rulesyncRule = gooseRule.toRulesyncRule();

      expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
      expect(rulesyncRule.getRelativeDirPath()).toBe(RULESYNC_RULES_RELATIVE_DIR_PATH);
      expect(rulesyncRule.getRelativeFilePath()).toBe(RULESYNC_OVERVIEW_FILE_NAME);
      expect(rulesyncRule.getFrontmatter().root).toBe(true);
    });
  });

  describe("validate", () => {
    it("should always return success true", () => {
      const gooseRule = new GooseRule({
        relativeDirPath: ".goose",
        relativeFilePath: "test.md",
        fileContent: "# Test",
      });

      const result = gooseRule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });

    it("should return success true even with empty content", () => {
      const gooseRule = new GooseRule({
        relativeDirPath: ".goose",
        relativeFilePath: "empty.md",
        fileContent: "",
      });

      const result = gooseRule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });

    it("should return success true for root file", () => {
      const gooseRule = new GooseRule({
        relativeDirPath: ".",
        relativeFilePath: ".goosehints",
        fileContent: "# Root Content",
        root: true,
      });

      const result = gooseRule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });
  });

  describe("file path handling", () => {
    it("should correctly identify .goosehints as root file in fromFile", async () => {
      const content = "# Root File";
      await writeFileContent(join(testDir, ".goosehints"), content);

      const gooseRule = await GooseRule.fromFile({
        baseDir: testDir,
        relativeFilePath: ".goosehints",
      });

      expect(gooseRule.isRoot()).toBe(true);
      expect(gooseRule.getRelativeDirPath()).toBe(".");
    });

    it("should correctly handle non-root files in fromFile", async () => {
      const content = "# Memory File";
      const memoriesDir = join(testDir, ".goose/memories");
      await ensureDir(memoriesDir);
      await writeFileContent(join(memoriesDir, "memory.md"), content);

      const gooseRule = await GooseRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "memory.md",
      });

      expect(gooseRule.isRoot()).toBe(false);
      expect(gooseRule.getRelativeDirPath()).toBe(".goose/memories");
    });
  });

  describe("getSettablePaths", () => {
    it("should return correct paths for root and nonRoot", () => {
      const paths = GooseRule.getSettablePaths();

      expect(paths.root).toEqual({
        relativeDirPath: ".",
        relativeFilePath: ".goosehints",
      });

      expect(paths.nonRoot).toEqual({
        relativeDirPath: ".goose/memories",
      });
    });

    it("should return correct paths for global mode", () => {
      const paths = GooseRule.getSettablePaths({ global: true });

      expect(paths.root).toEqual({
        relativeDirPath: ".",
        relativeFilePath: ".goosehints",
      });

      expect(paths.nonRoot).toBeUndefined();
    });

    it("should have consistent paths structure", () => {
      const paths = GooseRule.getSettablePaths();

      expect(paths).toHaveProperty("root");
      expect(paths).toHaveProperty("nonRoot");
      expect(paths.root).toHaveProperty("relativeDirPath");
      expect(paths.root).toHaveProperty("relativeFilePath");
      expect(paths.nonRoot).toHaveProperty("relativeDirPath");
    });
  });

  describe("forDeletion", () => {
    it("should create a GooseRule for deletion of root file", () => {
      const gooseRule = GooseRule.forDeletion({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".goosehints",
      });

      expect(gooseRule).toBeInstanceOf(GooseRule);
      expect(gooseRule.isRoot()).toBe(true);
      expect(gooseRule.getFileContent()).toBe("");
    });

    it("should create a GooseRule for deletion of non-root file", () => {
      const gooseRule = GooseRule.forDeletion({
        baseDir: testDir,
        relativeDirPath: ".goose/memories",
        relativeFilePath: "memory.md",
      });

      expect(gooseRule).toBeInstanceOf(GooseRule);
      expect(gooseRule.isRoot()).toBe(false);
      expect(gooseRule.getFileContent()).toBe("");
    });
  });

  describe("isTargetedByRulesyncRule", () => {
    it("should return true for rules targeting goose", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".goose/memories",
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["goose"],
        },
        body: "Test content",
      });

      expect(GooseRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should return true for rules targeting all tools (*)", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".goose/memories",
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["*"],
        },
        body: "Test content",
      });

      expect(GooseRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should return false for rules not targeting goose", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".goose/memories",
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["cursor", "copilot"],
        },
        body: "Test content",
      });

      expect(GooseRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(false);
    });

    it("should return false for empty targets", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".goose/memories",
        relativeFilePath: "test.md",
        frontmatter: {
          targets: [],
        },
        body: "Test content",
      });

      expect(GooseRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(false);
    });

    it("should handle mixed targets including goose", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".goose/memories",
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["cursor", "goose", "copilot"],
        },
        body: "Test content",
      });

      expect(GooseRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should handle undefined targets in frontmatter", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".goose/memories",
        relativeFilePath: "test.md",
        frontmatter: {},
        body: "Test content",
      });

      expect(GooseRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });
  });

  describe("integration with ToolRule", () => {
    it("should inherit all ToolRule functionality", () => {
      const gooseRule = new GooseRule({
        baseDir: testDir,
        relativeDirPath: ".goose",
        relativeFilePath: "integration.md",
        fileContent: "# Integration Test",
      });

      expect(gooseRule.getBaseDir()).toBe(testDir);
      expect(gooseRule.getRelativeDirPath()).toBe(".goose");
      expect(gooseRule.getRelativeFilePath()).toBe("integration.md");
      expect(gooseRule.getFileContent()).toBe("# Integration Test");
      expect(gooseRule.getFilePath()).toBe(join(testDir, ".goose/integration.md"));
    });
  });
});
