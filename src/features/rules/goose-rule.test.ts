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
        relativeDirPath: ".",
        relativeFilePath: ".goosehints",
        fileContent: "# Test Goose Rule\n\nThis is a test goose rule.",
      };

      const gooseRule = new GooseRule(params);

      expect(gooseRule).toBeInstanceOf(GooseRule);
      expect(gooseRule.getRelativeDirPath()).toBe(".");
      expect(gooseRule.getRelativeFilePath()).toBe(".goosehints");
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

    it("should default root to false when not provided", () => {
      const params: GooseRuleParams = {
        relativeDirPath: ".",
        relativeFilePath: ".goosehints",
        fileContent: "# Test\n\nContent",
      };

      const gooseRule = new GooseRule(params);

      expect(gooseRule.isRoot()).toBe(false);
    });

    it("should create a GooseRule with custom outputRoot", () => {
      const params: GooseRuleParams = {
        outputRoot: "/custom/path",
        relativeDirPath: ".",
        relativeFilePath: ".goosehints",
        fileContent: "# Custom Rule",
      };

      const gooseRule = new GooseRule(params);

      expect(gooseRule.getFilePath()).toBe("/custom/path/.goosehints");
    });

    it("should pass all parameters to parent ToolRule", () => {
      const params: GooseRuleParams = {
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".goosehints",
        fileContent: "# Test Content",
        validate: false,
        root: true,
      };

      const gooseRule = new GooseRule(params);

      expect(gooseRule.getOutputRoot()).toBe(testDir);
      expect(gooseRule.getRelativeDirPath()).toBe(".");
      expect(gooseRule.getRelativeFilePath()).toBe(".goosehints");
      expect(gooseRule.getFileContent()).toBe("# Test Content");
      expect(gooseRule.isRoot()).toBe(true);
    });
  });

  describe("fromFile", () => {
    it("should create GooseRule from root .goosehints file", async () => {
      const gooseContent = "# Main Goose Hints\n\nAlways use TypeScript for new projects.";
      await writeFileContent(join(testDir, ".goosehints"), gooseContent);

      const gooseRule = await GooseRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: ".goosehints",
      });

      expect(gooseRule.isRoot()).toBe(true);
      expect(gooseRule.getRelativeDirPath()).toBe(".");
      expect(gooseRule.getRelativeFilePath()).toBe(".goosehints");
      expect(gooseRule.getFileContent()).toBe(gooseContent);
      expect(gooseRule.getFilePath()).toBe(join(testDir, ".goosehints"));
    });

    it("should always read the root .goosehints regardless of the requested file", async () => {
      const gooseContent = "# Root Goose Hints";
      await writeFileContent(join(testDir, ".goosehints"), gooseContent);

      const gooseRule = await GooseRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "memory.md",
      });

      expect(gooseRule.isRoot()).toBe(true);
      expect(gooseRule.getRelativeDirPath()).toBe(".");
      expect(gooseRule.getRelativeFilePath()).toBe(".goosehints");
      expect(gooseRule.getFileContent()).toBe(gooseContent);
    });

    it("should use default outputRoot (process.cwd()) when not provided", async () => {
      const gooseContent = "# Default Test";
      await writeFileContent(join(testDir, ".goosehints"), gooseContent);

      const gooseRule = await GooseRule.fromFile({
        relativeFilePath: ".goosehints",
      });

      expect(gooseRule.getOutputRoot()).toBe(testDir);
      expect(gooseRule.isRoot()).toBe(true);
    });

    it("should handle validation parameter", async () => {
      const gooseContent = "# Validation Test";
      await writeFileContent(join(testDir, ".goosehints"), gooseContent);

      const gooseRule = await GooseRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: ".goosehints",
        validate: false,
      });

      expect(gooseRule).toBeInstanceOf(GooseRule);
    });

    it("should throw error when root file does not exist", async () => {
      await expect(
        GooseRule.fromFile({
          outputRoot: testDir,
          relativeFilePath: ".goosehints",
        }),
      ).rejects.toThrow();
    });

    it("should create GooseRule from global .goosehints file", async () => {
      const gooseContent = "# Global Goose Hints";
      await writeFileContent(join(testDir, ".config", "goose", ".goosehints"), gooseContent);

      const gooseRule = await GooseRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: ".goosehints",
        global: true,
      });

      expect(gooseRule.isRoot()).toBe(true);
      expect(gooseRule.getRelativeDirPath()).toBe(join(".config", "goose"));
      expect(gooseRule.getRelativeFilePath()).toBe(".goosehints");
    });

    it("should read the global root .goosehints regardless of the requested file", async () => {
      const globalDir = join(testDir, ".config", "goose");
      await ensureDir(globalDir);
      const gooseContent = "# Global Goose Hints";
      await writeFileContent(join(globalDir, ".goosehints"), gooseContent);

      const gooseRule = await GooseRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "memory.md",
        global: true,
      });

      expect(gooseRule.isRoot()).toBe(true);
      expect(gooseRule.getRelativeDirPath()).toBe(join(".config", "goose"));
      expect(gooseRule.getFileContent()).toBe(gooseContent);
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
        outputRoot: testDir,
        rulesyncRule,
      });

      expect(gooseRule).toBeInstanceOf(GooseRule);
      expect(gooseRule.getOutputRoot()).toBe(testDir);
      expect(gooseRule.getRelativeDirPath()).toBe(".");
      expect(gooseRule.getRelativeFilePath()).toBe(".goosehints");
      expect(gooseRule.isRoot()).toBe(true);
    });

    it("should write a non-root rule to the root .goosehints (folded)", () => {
      const frontmatter: RulesyncRuleFrontmatterInput = {
        description: "Test memory rule",
      };

      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "memory.md",
        frontmatter,
        body: "# Memory Rule\n\nMemory content",
      });

      const gooseRule = GooseRule.fromRulesyncRule({
        outputRoot: testDir,
        rulesyncRule,
      });

      // Non-root rules share the root path so the RulesProcessor folds their
      // bodies into the single .goosehints.
      expect(gooseRule).toBeInstanceOf(GooseRule);
      expect(gooseRule.getOutputRoot()).toBe(testDir);
      expect(gooseRule.getRelativeDirPath()).toBe(".");
      expect(gooseRule.getRelativeFilePath()).toBe(".goosehints");
      expect(gooseRule.isRoot()).toBe(false);
      expect(gooseRule.getFileContent()).toBe("# Memory Rule\n\nMemory content");
    });

    it("should use default outputRoot (process.cwd()) when not provided", () => {
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

      expect(gooseRule.getOutputRoot()).toBe(testDir);
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
        outputRoot: testDir,
        rulesyncRule,
        global: true,
      });

      expect(gooseRule).toBeInstanceOf(GooseRule);
      expect(gooseRule.isRoot()).toBe(true);
      expect(gooseRule.getRelativeDirPath()).toBe(join(".config", "goose"));
      expect(gooseRule.getRelativeFilePath()).toBe(".goosehints");
    });

    it("should write a non-root rule to the global root path (folded)", () => {
      const frontmatter: RulesyncRuleFrontmatterInput = {
        description: "Global memory rule",
      };

      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "memory.md",
        frontmatter,
        body: "# Memory",
      });

      const gooseRule = GooseRule.fromRulesyncRule({
        outputRoot: testDir,
        rulesyncRule,
        global: true,
      });

      expect(gooseRule.getRelativeDirPath()).toBe(join(".config", "goose"));
      expect(gooseRule.getRelativeFilePath()).toBe(".goosehints");
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert non-root GooseRule to RulesyncRule", () => {
      const gooseRule = new GooseRule({
        relativeDirPath: ".",
        relativeFilePath: ".goosehints",
        fileContent: "# Test Rule\n\nTest content",
      });

      const rulesyncRule = gooseRule.toRulesyncRule();

      expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
      expect(rulesyncRule.getRelativeDirPath()).toBe(RULESYNC_RULES_RELATIVE_DIR_PATH);
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
        relativeDirPath: ".",
        relativeFilePath: ".goosehints",
        fileContent: "# Test",
      });

      const result = gooseRule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });

    it("should return success true even with empty content", () => {
      const gooseRule = new GooseRule({
        relativeDirPath: ".",
        relativeFilePath: ".goosehints",
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

  describe("getSettablePaths", () => {
    it("should return a root-only project path (non-root folds into root)", () => {
      const paths = GooseRule.getSettablePaths();

      expect(paths.root).toEqual({
        relativeDirPath: ".",
        relativeFilePath: ".goosehints",
      });

      expect(paths.nonRoot).toBeUndefined();
    });

    it("should return correct paths for global mode", () => {
      const paths = GooseRule.getSettablePaths({ global: true });

      expect(paths.root).toEqual({
        relativeDirPath: join(".config", "goose"),
        relativeFilePath: ".goosehints",
      });

      expect(paths.nonRoot).toBeUndefined();
    });
  });

  describe("forDeletion", () => {
    it("should create a GooseRule for deletion of root file", () => {
      const gooseRule = GooseRule.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".goosehints",
      });

      expect(gooseRule).toBeInstanceOf(GooseRule);
      expect(gooseRule.isRoot()).toBe(true);
      expect(gooseRule.getFileContent()).toBe("");
    });

    it("should create a non-root deletion stub when path does not match root", () => {
      const gooseRule = GooseRule.forDeletion({
        outputRoot: testDir,
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
        outputRoot: testDir,
        relativeDirPath: ".rulesync/rules",
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
        outputRoot: testDir,
        relativeDirPath: ".rulesync/rules",
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
        outputRoot: testDir,
        relativeDirPath: ".rulesync/rules",
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
        outputRoot: testDir,
        relativeDirPath: ".rulesync/rules",
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
        outputRoot: testDir,
        relativeDirPath: ".rulesync/rules",
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
        outputRoot: testDir,
        relativeDirPath: ".rulesync/rules",
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
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".goosehints",
        fileContent: "# Integration Test",
      });

      expect(gooseRule.getOutputRoot()).toBe(testDir);
      expect(gooseRule.getRelativeDirPath()).toBe(".");
      expect(gooseRule.getRelativeFilePath()).toBe(".goosehints");
      expect(gooseRule.getFileContent()).toBe("# Integration Test");
      expect(gooseRule.getFilePath()).toBe(join(testDir, ".goosehints"));
    });
  });
});
