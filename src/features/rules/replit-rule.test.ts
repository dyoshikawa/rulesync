import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_OVERVIEW_FILE_NAME,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { ReplitRule } from "./replit-rule.js";
import { RulesyncRule, type RulesyncRuleFrontmatterInput } from "./rulesync-rule.js";

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

  describe("getSettablePaths", () => {
    it("should return root path only (no nonRoot)", () => {
      const paths = ReplitRule.getSettablePaths();

      expect(paths.root).toEqual({
        relativeDirPath: ".",
        relativeFilePath: "replit.md",
      });
      expect(paths.nonRoot).toBeUndefined();
    });
  });

  describe("fromFile", () => {
    it("should create ReplitRule from root replit.md file", async () => {
      const replitContent = "# Main Replit File";
      await writeFileContent(join(testDir, "replit.md"), replitContent);

      const replitRule = await ReplitRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "replit.md",
      });

      expect(replitRule.isRoot()).toBe(true);
      expect(replitRule.getRelativeFilePath()).toBe("replit.md");
      expect(replitRule.getFileContent()).toBe(replitContent);
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
    it("should create ReplitRule from root RulesyncRule", () => {
      const frontmatter: RulesyncRuleFrontmatterInput = {
        description: "Test replit rule",
        root: true,
      };

      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".",
        relativeFilePath: "replit.md",
        frontmatter,
        body: "# Test Rule",
      });

      const replitRule = ReplitRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule,
      });

      expect(replitRule).toBeInstanceOf(ReplitRule);
      expect(replitRule.getRelativeFilePath()).toBe("replit.md");
      expect(replitRule.isRoot()).toBe(true);
    });

    it("should throw error for non-root RulesyncRule", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".replit/memories",
        relativeFilePath: "memory.md",
        frontmatter: { root: false },
        body: "# Memory",
      });

      expect(() =>
        ReplitRule.fromRulesyncRule({
          baseDir: testDir,
          rulesyncRule,
        }),
      ).toThrow("ReplitRule only supports root rules");
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert root ReplitRule to RulesyncRule", () => {
      const replitRule = new ReplitRule({
        relativeDirPath: ".",
        relativeFilePath: "replit.md",
        fileContent: "# Root Rule",
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
    it("should always return success", () => {
      const replitRule = new ReplitRule({
        relativeDirPath: ".",
        relativeFilePath: "replit.md",
        fileContent: "# Test",
        root: true,
      });

      expect(replitRule.validate()).toEqual({ success: true, error: null });
    });
  });

  describe("forDeletion", () => {
    it("should create minimal instance for deletion", () => {
      const replitRule = ReplitRule.forDeletion({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "replit.md",
      });

      expect(replitRule).toBeInstanceOf(ReplitRule);
      expect(replitRule.isRoot()).toBe(true);
      expect(replitRule.getFileContent()).toBe("");
    });
  });

  describe("isTargetedByRulesyncRule", () => {
    it("should return true for root rules targeting replit", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "replit.md",
        frontmatter: { targets: ["replit"], root: true },
        body: "Test",
      });

      expect(ReplitRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should return true for root rules targeting all (*)", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "replit.md",
        frontmatter: { targets: ["*"], root: true },
        body: "Test",
      });

      expect(ReplitRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should return false for non-root rules", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "test.md",
        frontmatter: { targets: ["replit"], root: false },
        body: "Test",
      });

      expect(ReplitRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(false);
    });
  });
});
