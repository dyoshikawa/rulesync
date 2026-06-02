import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_OVERVIEW_FILE_NAME,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { RulesyncRule, type RulesyncRuleFrontmatterInput } from "./rulesync-rule.js";
import { ZedRule } from "./zed-rule.js";

describe("ZedRule", () => {
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
    it("should return .rules as the project root file (no nonRoot)", () => {
      const paths = ZedRule.getSettablePaths();
      expect(paths.root).toEqual({ relativeDirPath: ".", relativeFilePath: ".rules" });
      expect(paths.nonRoot).toBeUndefined();
    });

    it("should return ~/.config/zed/AGENTS.md for global mode", () => {
      const paths = ZedRule.getSettablePaths({ global: true });
      expect(paths.root).toEqual({
        relativeDirPath: join(".config", "zed"),
        relativeFilePath: "AGENTS.md",
      });
    });
  });

  describe("fromFile", () => {
    it("should create ZedRule from the root .rules file", async () => {
      const content = "# Project Rules";
      await writeFileContent(join(testDir, ".rules"), content);

      const rule = await ZedRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: ".rules",
      });

      expect(rule.isRoot()).toBe(true);
      expect(rule.getRelativeFilePath()).toBe(".rules");
      expect(rule.getFileContent()).toBe(content);
    });

    it("should throw for non-root files", async () => {
      await expect(
        ZedRule.fromFile({ outputRoot: testDir, relativeFilePath: "other.md" }),
      ).rejects.toThrow("ZedRule only supports root rules");
    });

    it("should read AGENTS.md in global mode", async () => {
      const content = "# Global Rules";
      await writeFileContent(join(testDir, ".config", "zed", "AGENTS.md"), content);

      const rule = await ZedRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "AGENTS.md",
        global: true,
      });

      expect(rule.isRoot()).toBe(true);
      expect(rule.getFileContent()).toBe(content);
    });
  });

  describe("fromRulesyncRule", () => {
    it("should create ZedRule from a root RulesyncRule", () => {
      const frontmatter: RulesyncRuleFrontmatterInput = {
        description: "Test zed rule",
        root: true,
      };
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".",
        relativeFilePath: ".rules",
        frontmatter,
        body: "# Test Rule",
      });

      const rule = ZedRule.fromRulesyncRule({ outputRoot: testDir, rulesyncRule });
      expect(rule).toBeInstanceOf(ZedRule);
      expect(rule.getRelativeFilePath()).toBe(".rules");
      expect(rule.isRoot()).toBe(true);
    });

    it("should write AGENTS.md in global mode", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".",
        relativeFilePath: ".rules",
        frontmatter: { root: true },
        body: "# Global",
      });

      const rule = ZedRule.fromRulesyncRule({ outputRoot: testDir, rulesyncRule, global: true });
      expect(rule.getRelativeDirPath()).toBe(join(".config", "zed"));
      expect(rule.getRelativeFilePath()).toBe("AGENTS.md");
    });

    it("should throw for non-root RulesyncRule", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".",
        relativeFilePath: "memory.md",
        frontmatter: { root: false },
        body: "# Memory",
      });

      expect(() => ZedRule.fromRulesyncRule({ outputRoot: testDir, rulesyncRule })).toThrow(
        "ZedRule only supports root rules",
      );
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert root ZedRule to RulesyncRule", () => {
      const rule = new ZedRule({
        relativeDirPath: ".",
        relativeFilePath: ".rules",
        fileContent: "# Root Rule",
        root: true,
      });

      const rulesyncRule = rule.toRulesyncRule();
      expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
      expect(rulesyncRule.getRelativeDirPath()).toBe(RULESYNC_RULES_RELATIVE_DIR_PATH);
      expect(rulesyncRule.getRelativeFilePath()).toBe(RULESYNC_OVERVIEW_FILE_NAME);
      expect(rulesyncRule.getFrontmatter().root).toBe(true);
    });
  });

  describe("validate", () => {
    it("should always return success", () => {
      const rule = new ZedRule({
        relativeDirPath: ".",
        relativeFilePath: ".rules",
        fileContent: "# Test",
        root: true,
      });
      expect(rule.validate()).toEqual({ success: true, error: null });
    });
  });

  describe("forDeletion", () => {
    it("should create a minimal root instance for deletion", () => {
      const rule = ZedRule.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".rules",
      });
      expect(rule).toBeInstanceOf(ZedRule);
      expect(rule.isRoot()).toBe(true);
      expect(rule.getFileContent()).toBe("");
    });
  });

  describe("isTargetedByRulesyncRule", () => {
    it("should target root rules for zed and wildcard", () => {
      const zedRoot = new RulesyncRule({
        relativeDirPath: ".",
        relativeFilePath: ".rules",
        frontmatter: { targets: ["zed"], root: true },
        body: "Test",
      });
      const wildcardRoot = new RulesyncRule({
        relativeDirPath: ".",
        relativeFilePath: ".rules",
        frontmatter: { targets: ["*"], root: true },
        body: "Test",
      });
      expect(ZedRule.isTargetedByRulesyncRule(zedRoot)).toBe(true);
      expect(ZedRule.isTargetedByRulesyncRule(wildcardRoot)).toBe(true);
    });

    it("should not target non-root rules", () => {
      const nonRoot = new RulesyncRule({
        relativeDirPath: ".",
        relativeFilePath: "test.md",
        frontmatter: { targets: ["*"], root: false },
        body: "Test",
      });
      expect(ZedRule.isTargetedByRulesyncRule(nonRoot)).toBe(false);
    });
  });
});
