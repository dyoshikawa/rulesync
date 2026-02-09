import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RULES_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { FactorydroidRule } from "./factorydroid-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("FactorydroidRule", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  const validRuleContent = `---
root: true
targets: ["factorydroid"]
description: "Test Factorydroid Rule"
globs: ["**/*"]
---

# Test Rule

This is a test factorydroid rule.`;

  beforeEach(async () => {
    const testSetup = await setupTestDirectory();
    testDir = testSetup.testDir;
    cleanup = testSetup.cleanup;
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  describe("getSettablePaths", () => {
    it("should return correct paths for factorydroid rules", () => {
      const paths = FactorydroidRule.getSettablePaths();
      expect(paths).toEqual({
        root: {
          relativeDirPath: ".factory",
          relativeFilePath: "AGENTS.md",
        },
        nonRoot: {
          relativeDirPath: ".factory/memories",
        },
      });
    });

    it("should return same paths for global mode", () => {
      const paths = FactorydroidRule.getSettablePaths({ global: true });
      expect(paths).toEqual({
        root: {
          relativeDirPath: ".factory",
          relativeFilePath: "AGENTS.md",
        },
        nonRoot: {
          relativeDirPath: ".factory/memories",
        },
      });
    });
  });

  describe("constructor", () => {
    it("should create root rule instance", () => {
      const rule = new FactorydroidRule({
        baseDir: testDir,
        relativeDirPath: ".factory",
        relativeFilePath: "AGENTS.md",
        fileContent: validRuleContent,
        validate: true,
        root: true,
      });

      expect(rule).toBeInstanceOf(FactorydroidRule);
      expect(rule.isRoot()).toBe(true);
    });

    it("should create non-root rule instance", () => {
      const rule = new FactorydroidRule({
        baseDir: testDir,
        relativeDirPath: ".factory/memories",
        relativeFilePath: "memory-1.md",
        fileContent: validRuleContent,
        validate: true,
        root: false,
      });

      expect(rule).toBeInstanceOf(FactorydroidRule);
      expect(rule.isRoot()).toBe(false);
    });
  });

  describe("fromRulesyncRule", () => {
    it("should create root FactorydroidRule from RulesyncRule", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "AGENTS.md",
        frontmatter: {
          root: true,
          targets: ["factorydroid"],
          description: "Test Factorydroid Rule",
          globs: ["**/*"],
        },
        body: "# Test Rule\n\nThis is a test factorydroid rule.",
        validate: true,
      });

      const factorydroidRule = FactorydroidRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule,
        validate: true,
      });

      expect(factorydroidRule).toBeInstanceOf(FactorydroidRule);
      expect(factorydroidRule.isRoot()).toBe(true);
      expect(factorydroidRule.getRelativeFilePath()).toBe("AGENTS.md");
    });

    it("should create non-root FactorydroidRule from RulesyncRule", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "memory-1.md",
        frontmatter: {
          root: false,
          targets: ["factorydroid"],
          description: "Test memory rule",
          globs: ["**/*"],
        },
        body: "# Memory Rule\n\nThis is a test memory rule.",
        validate: true,
      });

      const factorydroidRule = FactorydroidRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule,
        validate: true,
      });

      expect(factorydroidRule).toBeInstanceOf(FactorydroidRule);
      expect(factorydroidRule.isRoot()).toBe(false);
      expect(factorydroidRule.getRelativeFilePath()).toBe("memory-1.md");
    });
  });

  describe("fromFile", () => {
    it("should load root rule from file", async () => {
      const rootFile = join(testDir, ".factory", "AGENTS.md");

      await writeFileContent(rootFile, validRuleContent);

      const rule = await FactorydroidRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "AGENTS.md",
        validate: true,
      });

      expect(rule).toBeInstanceOf(FactorydroidRule);
      expect(rule.isRoot()).toBe(true);
      expect(rule.getFileContent()).toBe(validRuleContent);
    });

    it("should load non-root rule from file", async () => {
      const memoryFile = join(testDir, ".factory", "memories", "memory-1.md");

      await writeFileContent(memoryFile, validRuleContent);

      const rule = await FactorydroidRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "memory-1.md",
        validate: true,
      });

      expect(rule).toBeInstanceOf(FactorydroidRule);
      expect(rule.isRoot()).toBe(false);
      expect(rule.getFileContent()).toBe(validRuleContent);
    });

    it("should throw error when file does not exist", async () => {
      await expect(
        FactorydroidRule.fromFile({
          baseDir: testDir,
          relativeFilePath: "AGENTS.md",
          validate: true,
        }),
      ).rejects.toThrow();
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert to RulesyncRule", () => {
      const rule = new FactorydroidRule({
        baseDir: testDir,
        relativeDirPath: ".factory",
        relativeFilePath: "AGENTS.md",
        fileContent: validRuleContent,
        validate: true,
        root: true,
      });

      const rulesyncRule = rule.toRulesyncRule();

      expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
      expect(rulesyncRule.getFileContent()).toContain("# Test Rule");
      expect(rulesyncRule.getFileContent()).toContain("This is a test factorydroid rule.");
    });
  });

  describe("validate", () => {
    it("should return success for any content", () => {
      const rule = new FactorydroidRule({
        baseDir: testDir,
        relativeDirPath: ".factory",
        relativeFilePath: "AGENTS.md",
        fileContent: "Any content",
        validate: false,
        root: true,
      });

      const result = rule.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });

  describe("isTargetedByRulesyncRule", () => {
    it("should return true for rulesync rule with wildcard target", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "AGENTS.md",
        frontmatter: {
          targets: ["*"],
        },
        body: "content",
      });

      const result = FactorydroidRule.isTargetedByRulesyncRule(rulesyncRule);
      expect(result).toBe(true);
    });

    it("should return true for rulesync rule with factorydroid target", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "AGENTS.md",
        frontmatter: {
          targets: ["factorydroid"],
        },
        body: "content",
      });

      const result = FactorydroidRule.isTargetedByRulesyncRule(rulesyncRule);
      expect(result).toBe(true);
    });

    it("should return false for rulesync rule with different target", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "AGENTS.md",
        frontmatter: {
          targets: ["cursor"],
        },
        body: "content",
      });

      const result = FactorydroidRule.isTargetedByRulesyncRule(rulesyncRule);
      expect(result).toBe(false);
    });
  });

  describe("forDeletion", () => {
    it("should create deletion marker for root rule", () => {
      const rule = FactorydroidRule.forDeletion({
        baseDir: testDir,
        relativeDirPath: ".factory",
        relativeFilePath: "AGENTS.md",
      });

      expect(rule).toBeInstanceOf(FactorydroidRule);
      expect(rule.isRoot()).toBe(true);
    });

    it("should create deletion marker for non-root rule", () => {
      const rule = FactorydroidRule.forDeletion({
        baseDir: testDir,
        relativeDirPath: ".factory/memories",
        relativeFilePath: "memory-1.md",
      });

      expect(rule).toBeInstanceOf(FactorydroidRule);
      expect(rule.isRoot()).toBe(false);
    });
  });
});
