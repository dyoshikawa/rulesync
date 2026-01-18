import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_OVERVIEW_FILE_NAME,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { ReplitRule } from "./replit-rule.js";
import { RulesyncRule, type RulesyncRuleFrontmatter } from "./rulesync-rule.js";

describe("ReplitRule", () => {
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
    it("should create a ReplitRule with basic parameters", () => {
      const replitRule = new ReplitRule({
        relativeDirPath: ".",
        relativeFilePath: "replit.md",
        fileContent: "# Test Replit Rule\n\nThis is a test replit rule.",
        root: true,
      });

      expect(replitRule).toBeInstanceOf(ReplitRule);
      expect(replitRule.getRelativeDirPath()).toBe(".");
      expect(replitRule.getRelativeFilePath()).toBe("replit.md");
      expect(replitRule.getFileContent()).toBe("# Test Replit Rule\n\nThis is a test replit rule.");
      expect(replitRule.isRoot()).toBe(true);
    });

    it("should create a ReplitRule with root parameter set to true", () => {
      const replitRule = new ReplitRule({
        relativeDirPath: ".",
        relativeFilePath: "replit.md",
        fileContent: "# Root Replit Rule\n\nThis is a root replit rule.",
        root: true,
      });

      expect(replitRule.isRoot()).toBe(true);
      expect(replitRule.getRelativeFilePath()).toBe("replit.md");
    });

    it("should default root to false when not provided", () => {
      const replitRule = new ReplitRule({
        relativeDirPath: ".",
        relativeFilePath: "replit.md",
        fileContent: "# Test\n\nContent",
      });

      expect(replitRule.isRoot()).toBe(false);
    });

    it("should create a ReplitRule with custom baseDir", () => {
      const replitRule = new ReplitRule({
        baseDir: "/custom/path",
        relativeDirPath: ".",
        relativeFilePath: "replit.md",
        fileContent: "# Custom Rule",
        root: true,
      });

      expect(replitRule.getFilePath()).toBe("/custom/path/replit.md");
    });
  });

  describe("getSettablePaths", () => {
    it("should return correct paths for root only", () => {
      const paths = ReplitRule.getSettablePaths();

      expect(paths.root).toEqual({
        relativeDirPath: ".",
        relativeFilePath: "replit.md",
      });

      expect(paths.nonRoot).toBeUndefined();
    });

    it("should have consistent paths structure", () => {
      const paths = ReplitRule.getSettablePaths();

      expect(paths).toHaveProperty("root");
      expect(paths.root).toHaveProperty("relativeDirPath");
      expect(paths.root).toHaveProperty("relativeFilePath");
    });
  });

  describe("fromFile", () => {
    it("should create ReplitRule from root replit.md file", async () => {
      const replitContent = "# Main Replit File\n\nThis is the main replit configuration.";
      await writeFileContent(join(testDir, "replit.md"), replitContent);

      const replitRule = await ReplitRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "replit.md",
      });

      expect(replitRule.isRoot()).toBe(true);
      expect(replitRule.getRelativeDirPath()).toBe(".");
      expect(replitRule.getRelativeFilePath()).toBe("replit.md");
      expect(replitRule.getFileContent()).toBe(replitContent);
      expect(replitRule.getFilePath()).toBe(join(testDir, "replit.md"));
    });

    it("should use default baseDir (process.cwd()) when not provided", async () => {
      const replitContent = "# Default Test";
      await writeFileContent(join(testDir, "replit.md"), replitContent);

      const replitRule = await ReplitRule.fromFile({
        relativeFilePath: "replit.md",
      });

      expect(replitRule.getBaseDir()).toBe(testDir);
      expect(replitRule.isRoot()).toBe(true);
    });

    it("should handle validation parameter", async () => {
      const replitContent = "# Validation Test";
      await writeFileContent(join(testDir, "replit.md"), replitContent);

      const replitRule = await ReplitRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "replit.md",
        validate: false,
      });

      expect(replitRule).toBeInstanceOf(ReplitRule);
    });

    it("should throw error when file does not exist", async () => {
      await expect(
        ReplitRule.fromFile({
          baseDir: testDir,
          relativeFilePath: "replit.md",
        }),
      ).rejects.toThrow();
    });

    it("should throw error for non-root files", async () => {
      await expect(
        ReplitRule.fromFile({
          baseDir: testDir,
          relativeFilePath: "other.md",
        }),
      ).rejects.toThrow("ReplitRule only supports root rules");
    });
  });

  describe("fromRulesyncRule", () => {
    it("should create ReplitRule from RulesyncRule for root file", () => {
      const frontmatter: RulesyncRuleFrontmatter = {
        description: "Test replit rule",
        root: true,
      };

      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".",
        relativeFilePath: "replit.md",
        frontmatter,
        body: "# Test Rule\n\nContent",
      });

      const replitRule = ReplitRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule,
      });

      expect(replitRule).toBeInstanceOf(ReplitRule);
      expect(replitRule.getBaseDir()).toBe(testDir);
      expect(replitRule.getRelativeDirPath()).toBe(".");
      expect(replitRule.getRelativeFilePath()).toBe("replit.md");
      expect(replitRule.isRoot()).toBe(true);
    });

    it("should throw error for non-root RulesyncRule", () => {
      const frontmatter: RulesyncRuleFrontmatter = {
        description: "Test non-root rule",
        root: false,
      };

      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".replit/memories",
        relativeFilePath: "memory.md",
        frontmatter,
        body: "# Memory Rule\n\nMemory content",
      });

      expect(() =>
        ReplitRule.fromRulesyncRule({
          baseDir: testDir,
          rulesyncRule,
        }),
      ).toThrow("ReplitRule only supports root rules");
    });

    it("should use default baseDir (process.cwd()) when not provided", () => {
      const frontmatter: RulesyncRuleFrontmatter = {
        description: "Default test",
        root: true,
      };

      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".",
        relativeFilePath: "replit.md",
        frontmatter,
        body: "# Default",
      });

      const replitRule = ReplitRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(replitRule.getBaseDir()).toBe(testDir);
    });

    it("should handle validation parameter", () => {
      const frontmatter: RulesyncRuleFrontmatter = {
        description: "Validation test",
        root: true,
      };

      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".",
        relativeFilePath: "replit.md",
        frontmatter,
        body: "# Validation",
      });

      const replitRule = ReplitRule.fromRulesyncRule({
        rulesyncRule,
        validate: false,
      });

      expect(replitRule).toBeInstanceOf(ReplitRule);
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert root ReplitRule to RulesyncRule", () => {
      const replitRule = new ReplitRule({
        relativeDirPath: ".",
        relativeFilePath: "replit.md",
        fileContent: "# Root Rule\n\nRoot content",
        root: true,
      });

      const rulesyncRule = replitRule.toRulesyncRule();

      expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
      expect(rulesyncRule.getRelativeDirPath()).toBe(RULESYNC_RULES_RELATIVE_DIR_PATH);
      expect(rulesyncRule.getRelativeFilePath()).toBe(RULESYNC_OVERVIEW_FILE_NAME);
      expect(rulesyncRule.getFrontmatter().root).toBe(true);
    });
  });

  describe("validate", () => {
    it("should always return success true", () => {
      const replitRule = new ReplitRule({
        relativeDirPath: ".",
        relativeFilePath: "replit.md",
        fileContent: "# Test",
        root: true,
      });

      const result = replitRule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });

    it("should return success true even with empty content", () => {
      const replitRule = new ReplitRule({
        relativeDirPath: ".",
        relativeFilePath: "replit.md",
        fileContent: "",
        root: true,
      });

      const result = replitRule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });
  });

  describe("forDeletion", () => {
    it("should create a minimal instance for deletion", () => {
      const replitRule = ReplitRule.forDeletion({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "replit.md",
      });

      expect(replitRule).toBeInstanceOf(ReplitRule);
      expect(replitRule.getRelativeDirPath()).toBe(".");
      expect(replitRule.getRelativeFilePath()).toBe("replit.md");
      expect(replitRule.isRoot()).toBe(true);
      expect(replitRule.getFileContent()).toBe("");
    });

    it("should use default baseDir when not provided", () => {
      const replitRule = ReplitRule.forDeletion({
        relativeDirPath: ".",
        relativeFilePath: "replit.md",
      });

      expect(replitRule.getBaseDir()).toBe(testDir);
    });
  });

  describe("isTargetedByRulesyncRule", () => {
    it("should return true for root rules targeting replit", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "replit.md",
        frontmatter: {
          targets: ["replit"],
          root: true,
        },
        body: "Test content",
      });

      expect(ReplitRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should return true for root rules targeting all tools (*)", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "replit.md",
        frontmatter: {
          targets: ["*"],
          root: true,
        },
        body: "Test content",
      });

      expect(ReplitRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should return false for non-root rules", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".replit/memories",
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["replit"],
          root: false,
        },
        body: "Test content",
      });

      expect(ReplitRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(false);
    });

    it("should return false for root rules not targeting replit", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["cursor", "copilot"],
          root: true,
        },
        body: "Test content",
      });

      expect(ReplitRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(false);
    });

    it("should return false for rules without root set (defaults to false)", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["replit"],
        },
        body: "Test content",
      });

      expect(ReplitRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(false);
    });

    it("should handle mixed targets including replit for root rules", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "replit.md",
        frontmatter: {
          targets: ["cursor", "replit", "copilot"],
          root: true,
        },
        body: "Test content",
      });

      expect(ReplitRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });
  });

  describe("integration with ToolRule", () => {
    it("should inherit all ToolRule functionality", () => {
      const replitRule = new ReplitRule({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "replit.md",
        fileContent: "# Integration Test",
        root: true,
      });

      expect(replitRule.getBaseDir()).toBe(testDir);
      expect(replitRule.getRelativeDirPath()).toBe(".");
      expect(replitRule.getRelativeFilePath()).toBe("replit.md");
      expect(replitRule.getFileContent()).toBe("# Integration Test");
      expect(replitRule.getFilePath()).toBe(join(testDir, "replit.md"));
    });
  });
});
