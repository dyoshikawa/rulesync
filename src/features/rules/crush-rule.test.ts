import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_OVERVIEW_FILE_NAME,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { CrushRule, type CrushRuleParams } from "./crush-rule.js";
import { RulesyncRule, type RulesyncRuleFrontmatterInput } from "./rulesync-rule.js";

describe("CrushRule", () => {
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
    it("should create a CrushRule with basic parameters", () => {
      const params: CrushRuleParams = {
        relativeDirPath: ".crush",
        relativeFilePath: "test-rule.md",
        fileContent: "# Test Crush Rule\n\nThis is a test crush rule.",
      };

      const crushRule = new CrushRule(params);

      expect(crushRule).toBeInstanceOf(CrushRule);
      expect(crushRule.getRelativeDirPath()).toBe(".crush");
      expect(crushRule.getRelativeFilePath()).toBe("test-rule.md");
      expect(crushRule.getFileContent()).toBe("# Test Crush Rule\n\nThis is a test crush rule.");
      expect(crushRule.isRoot()).toBe(false);
    });

    it("should create a CrushRule with root parameter set to true", () => {
      const params: CrushRuleParams = {
        relativeDirPath: ".",
        relativeFilePath: "CRUSH.md",
        fileContent: "# Root Crush Rule\n\nThis is a root crush rule.",
        root: true,
      };

      const crushRule = new CrushRule(params);

      expect(crushRule.isRoot()).toBe(true);
      expect(crushRule.getRelativeFilePath()).toBe("CRUSH.md");
    });

    it("should default root to false when not provided", () => {
      const params: CrushRuleParams = {
        relativeDirPath: ".",
        relativeFilePath: "CRUSH.md",
        fileContent: "# Test\n\nContent",
      };

      const crushRule = new CrushRule(params);

      expect(crushRule.isRoot()).toBe(false);
    });

    it("should create a CrushRule with custom outputRoot", () => {
      const params: CrushRuleParams = {
        outputRoot: "/custom/path",
        relativeDirPath: ".",
        relativeFilePath: "CRUSH.md",
        fileContent: "# Custom Rule",
      };

      const crushRule = new CrushRule(params);

      expect(crushRule.getFilePath()).toBe("/custom/path/CRUSH.md");
    });
  });

  describe("fromFile", () => {
    it("should create CrushRule from root CRUSH.md file", async () => {
      const crushContent = "# Main Crush File\n\nThis is the main crush configuration.";
      await writeFileContent(join(testDir, "CRUSH.md"), crushContent);

      const crushRule = await CrushRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "CRUSH.md",
      });

      expect(crushRule.isRoot()).toBe(true);
      expect(crushRule.getRelativeDirPath()).toBe(".");
      expect(crushRule.getRelativeFilePath()).toBe("CRUSH.md");
      expect(crushRule.getFileContent()).toBe(crushContent);
      expect(crushRule.getFilePath()).toBe(join(testDir, "CRUSH.md"));
    });

    it("should read the global rules file from .config/crush/CRUSH.md in global mode", async () => {
      const globalContent = "# Global Crush Rules";
      await writeFileContent(join(testDir, ".config", "crush", "CRUSH.md"), globalContent);

      const crushRule = await CrushRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "CRUSH.md",
        global: true,
      });

      expect(crushRule.isRoot()).toBe(true);
      expect(crushRule.getRelativeDirPath()).toBe(join(".config", "crush"));
      expect(crushRule.getRelativeFilePath()).toBe("CRUSH.md");
      expect(crushRule.getFileContent()).toBe(globalContent);
    });

    it("should always read the root CRUSH.md, ignoring the requested relativeFilePath", async () => {
      const rootContent = "# Root\n\nCrush reads only this file.";
      await writeFileContent(join(testDir, "CRUSH.md"), rootContent);

      const crushRule = await CrushRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "some-memory.md",
      });

      expect(crushRule.isRoot()).toBe(true);
      expect(crushRule.getRelativeDirPath()).toBe(".");
      expect(crushRule.getRelativeFilePath()).toBe("CRUSH.md");
      expect(crushRule.getFileContent()).toBe(rootContent);
      expect(crushRule.getFilePath()).toBe(join(testDir, "CRUSH.md"));
    });

    it("should use default outputRoot (process.cwd()) when not provided", async () => {
      const crushContent = "# Default Test";
      await writeFileContent(join(testDir, "CRUSH.md"), crushContent);

      const crushRule = await CrushRule.fromFile({
        relativeFilePath: "CRUSH.md",
      });

      expect(crushRule.getOutputRoot()).toBe(testDir);
      expect(crushRule.isRoot()).toBe(true);
    });

    it("should throw error when file does not exist", async () => {
      await expect(
        CrushRule.fromFile({
          outputRoot: testDir,
          relativeFilePath: "nonexistent.md",
        }),
      ).rejects.toThrow();
    });
  });

  describe("fromRulesyncRule", () => {
    it("should create CrushRule from RulesyncRule for root file", () => {
      const frontmatter: RulesyncRuleFrontmatterInput = {
        description: "Test crush rule",
        root: true,
      };

      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".",
        relativeFilePath: "CRUSH.md",
        frontmatter,
        body: "# Test Rule\n\nContent",
      });

      const crushRule = CrushRule.fromRulesyncRule({
        outputRoot: testDir,
        rulesyncRule,
      });

      expect(crushRule).toBeInstanceOf(CrushRule);
      expect(crushRule.getOutputRoot()).toBe(testDir);
      expect(crushRule.getRelativeDirPath()).toBe(".");
      expect(crushRule.getRelativeFilePath()).toBe("CRUSH.md");
      expect(crushRule.isRoot()).toBe(true);
    });

    it("should target the root CRUSH.md for a non-root rule (folded later by the processor)", () => {
      const frontmatter: RulesyncRuleFrontmatterInput = {
        description: "Test memory rule",
      };

      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "memory.md",
        frontmatter,
        body: "# Memory Rule\n\nMemory content",
      });

      const crushRule = CrushRule.fromRulesyncRule({
        outputRoot: testDir,
        rulesyncRule,
      });

      expect(crushRule).toBeInstanceOf(CrushRule);
      expect(crushRule.getOutputRoot()).toBe(testDir);
      // Non-root rules resolve to the single root CRUSH.md; the RulesProcessor
      // folds their bodies into the root rule before writing.
      expect(crushRule.getRelativeDirPath()).toBe(".");
      expect(crushRule.getRelativeFilePath()).toBe("CRUSH.md");
      expect(crushRule.isRoot()).toBe(false);
      expect(crushRule.getFileContent()).toBe("# Memory Rule\n\nMemory content");
    });

    it("should use default outputRoot (process.cwd()) when not provided", () => {
      const frontmatter: RulesyncRuleFrontmatterInput = {
        description: "Default test",
        root: true,
      };

      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".",
        relativeFilePath: "CRUSH.md",
        frontmatter,
        body: "# Default",
      });

      const crushRule = CrushRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(crushRule.getOutputRoot()).toBe(testDir);
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert CrushRule to RulesyncRule", () => {
      const crushRule = new CrushRule({
        relativeDirPath: ".crush",
        relativeFilePath: "test.md",
        fileContent: "# Test Rule\n\nTest content",
      });

      const rulesyncRule = crushRule.toRulesyncRule();

      expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
      expect(rulesyncRule.getRelativeDirPath()).toBe(RULESYNC_RULES_RELATIVE_DIR_PATH);
      expect(rulesyncRule.getRelativeFilePath()).toBe("test.md");
      expect(rulesyncRule.getBody()).toBe("# Test Rule\n\nTest content");
    });

    it("should convert root CrushRule to RulesyncRule", () => {
      const crushRule = new CrushRule({
        relativeDirPath: ".",
        relativeFilePath: "CRUSH.md",
        fileContent: "# Root Rule\n\nRoot content",
        root: true,
      });

      const rulesyncRule = crushRule.toRulesyncRule();

      expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
      expect(rulesyncRule.getRelativeDirPath()).toBe(RULESYNC_RULES_RELATIVE_DIR_PATH);
      expect(rulesyncRule.getRelativeFilePath()).toBe(RULESYNC_OVERVIEW_FILE_NAME);
      expect(rulesyncRule.getFrontmatter().root).toBe(true);
    });
  });

  describe("validate", () => {
    it("should always return success true", () => {
      const crushRule = new CrushRule({
        relativeDirPath: ".crush",
        relativeFilePath: "test.md",
        fileContent: "# Test",
      });

      const result = crushRule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });

    it("should return success true even with empty content", () => {
      const crushRule = new CrushRule({
        relativeDirPath: ".crush",
        relativeFilePath: "empty.md",
        fileContent: "",
      });

      const result = crushRule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });
  });

  describe("getSettablePaths", () => {
    it("should return only the root path (no non-root location)", () => {
      const paths = CrushRule.getSettablePaths();

      expect(paths.root).toEqual({
        relativeDirPath: ".",
        relativeFilePath: "CRUSH.md",
      });

      // Crush has no modular non-root instructions directory.
      expect(paths.nonRoot).toBeUndefined();
    });

    it("should return the .config/crush/CRUSH.md root path in global mode", () => {
      const paths = CrushRule.getSettablePaths({ global: true });

      expect(paths.root).toEqual({
        relativeDirPath: join(".config", "crush"),
        relativeFilePath: "CRUSH.md",
      });
      expect(paths.nonRoot).toBeUndefined();
    });
  });

  describe("forDeletion", () => {
    it("should mark the root file as root", () => {
      const crushRule = CrushRule.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "CRUSH.md",
      });

      expect(crushRule.isRoot()).toBe(true);
      expect(crushRule.getFileContent()).toBe("");
    });

    it("should mark the global root file as root", () => {
      const crushRule = CrushRule.forDeletion({
        outputRoot: testDir,
        relativeDirPath: join(".config", "crush"),
        relativeFilePath: "CRUSH.md",
        global: true,
      });

      expect(crushRule.isRoot()).toBe(true);
    });
  });

  describe("isTargetedByRulesyncRule", () => {
    it("should return true for rules targeting crush", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["crush"],
        },
        body: "Test content",
      });

      expect(CrushRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
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

      expect(CrushRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should return false for rules not targeting crush", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["cursor", "copilot"],
        },
        body: "Test content",
      });

      expect(CrushRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(false);
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

      expect(CrushRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(false);
    });
  });

  describe("integration with ToolRule", () => {
    it("should inherit all ToolRule functionality", () => {
      const crushRule = new CrushRule({
        outputRoot: testDir,
        relativeDirPath: ".crush",
        relativeFilePath: "integration.md",
        fileContent: "# Integration Test",
      });

      expect(crushRule.getOutputRoot()).toBe(testDir);
      expect(crushRule.getRelativeDirPath()).toBe(".crush");
      expect(crushRule.getRelativeFilePath()).toBe("integration.md");
      expect(crushRule.getFileContent()).toBe("# Integration Test");
      expect(crushRule.getFilePath()).toBe(join(testDir, ".crush/integration.md"));
    });
  });
});
