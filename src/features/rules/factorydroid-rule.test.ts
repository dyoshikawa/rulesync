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
          relativeDirPath: ".",
          relativeFilePath: "AGENTS.md",
        },
        nonRoot: {
          relativeDirPath: ".factory/rules",
        },
        design: {
          relativeDirPath: ".",
          relativeFilePath: "DESIGN.md",
        },
      });
    });

    it("should return global paths for global mode", () => {
      const paths = FactorydroidRule.getSettablePaths({ global: true });
      expect(paths).toEqual({
        root: {
          relativeDirPath: ".factory",
          relativeFilePath: "AGENTS.md",
        },
      });
    });
  });

  describe("getExtraFixedFiles", () => {
    it("should include the design-guidelines file for project scope", () => {
      const files = FactorydroidRule.getExtraFixedFiles();
      expect(files).toEqual([
        {
          relativeDirPath: ".",
          relativeFilePath: "DESIGN.md",
        },
      ]);
    });

    it("should return no extra files for global scope", () => {
      const files = FactorydroidRule.getExtraFixedFiles({ global: true });
      expect(files).toEqual([]);
    });
  });

  describe("constructor", () => {
    it("should create root rule instance", () => {
      const rule = new FactorydroidRule({
        outputRoot: testDir,
        relativeDirPath: ".",
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
        outputRoot: testDir,
        relativeDirPath: ".factory/rules",
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
        outputRoot: testDir,
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
        outputRoot: testDir,
        rulesyncRule,
        validate: true,
      });

      expect(factorydroidRule).toBeInstanceOf(FactorydroidRule);
      expect(factorydroidRule.isRoot()).toBe(true);
      expect(factorydroidRule.getRelativeFilePath()).toBe("AGENTS.md");
    });

    it("should create non-root FactorydroidRule from RulesyncRule", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
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
        outputRoot: testDir,
        rulesyncRule,
        validate: true,
      });

      expect(factorydroidRule).toBeInstanceOf(FactorydroidRule);
      expect(factorydroidRule.isRoot()).toBe(false);
      expect(factorydroidRule.getRelativeFilePath()).toBe("memory-1.md");
    });

    it("should route a rule with factorydroid.channel: design to DESIGN.md", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "design-system.md",
        frontmatter: {
          root: false,
          targets: ["factorydroid"],
          description: "Test design rule",
          globs: ["**/*"],
          factorydroid: { channel: "design" },
        },
        body: "# Design Guidelines\n\nUse the shared design tokens.",
        validate: true,
      });

      const factorydroidRule = FactorydroidRule.fromRulesyncRule({
        outputRoot: testDir,
        rulesyncRule,
        validate: true,
      });

      expect(factorydroidRule).toBeInstanceOf(FactorydroidRule);
      expect(factorydroidRule.isRoot()).toBe(false);
      expect(factorydroidRule.getRelativeDirPath()).toBe(".");
      expect(factorydroidRule.getRelativeFilePath()).toBe("DESIGN.md");
      expect(factorydroidRule.getFileContent()).toBe(
        "# Design Guidelines\n\nUse the shared design tokens.",
      );
      expect(factorydroidRule.isExcludedFromRootReferences()).toBe(true);
    });

    it("should not route a root rule to DESIGN.md even with factorydroid.channel: design", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "AGENTS.md",
        frontmatter: {
          root: true,
          targets: ["factorydroid"],
          description: "Test root rule",
          globs: ["**/*"],
          factorydroid: { channel: "design" },
        },
        body: "# Root Rule",
        validate: true,
      });

      const factorydroidRule = FactorydroidRule.fromRulesyncRule({
        outputRoot: testDir,
        rulesyncRule,
        validate: true,
      });

      expect(factorydroidRule.isRoot()).toBe(true);
      expect(factorydroidRule.getRelativeFilePath()).toBe("AGENTS.md");
    });

    it("should not route to DESIGN.md in global mode, since Factory Droid documents no global design-guidelines file", () => {
      // The design routing is guarded by `!global`, so a non-root rule with
      // `factorydroid.channel: design` falls through to the ordinary
      // AGENTS.md-family handling in global mode instead of being routed to a
      // design file that Factory Droid does not support globally.
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "design-system.md",
        frontmatter: {
          root: false,
          targets: ["factorydroid"],
          description: "Test design rule",
          globs: ["**/*"],
          factorydroid: { channel: "design" },
        },
        body: "# Design Guidelines",
        validate: true,
      });

      const factorydroidRule = FactorydroidRule.fromRulesyncRule({
        outputRoot: testDir,
        rulesyncRule,
        validate: true,
        global: true,
      });

      expect(factorydroidRule.getRelativeFilePath()).toBe("design-system.md");
      expect(factorydroidRule.getRelativeDirPath()).not.toBe(".");
      expect(factorydroidRule.isExcludedFromRootReferences()).toBe(false);
    });
  });

  describe("fromFile", () => {
    it("should load root rule from file", async () => {
      const rootFile = join(testDir, "AGENTS.md");

      await writeFileContent(rootFile, validRuleContent);

      const rule = await FactorydroidRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "AGENTS.md",
        validate: true,
      });

      expect(rule).toBeInstanceOf(FactorydroidRule);
      expect(rule.isRoot()).toBe(true);
      expect(rule.getFileContent()).toBe(validRuleContent);
    });

    it("should load non-root rule from file", async () => {
      const memoryFile = join(testDir, ".factory", "rules", "memory-1.md");

      await writeFileContent(memoryFile, validRuleContent);

      const rule = await FactorydroidRule.fromFile({
        outputRoot: testDir,
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
          outputRoot: testDir,
          relativeFilePath: "AGENTS.md",
          validate: true,
        }),
      ).rejects.toThrow();
    });

    it("should load the design-guidelines file and mark it as excluded from root references", async () => {
      const designFile = join(testDir, "DESIGN.md");
      const designContent = "# Design Guidelines\n\nUse the shared design tokens.";

      await writeFileContent(designFile, designContent);

      const rule = await FactorydroidRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "DESIGN.md",
        validate: true,
      });

      expect(rule).toBeInstanceOf(FactorydroidRule);
      expect(rule.isRoot()).toBe(false);
      expect(rule.getRelativeDirPath()).toBe(".");
      expect(rule.getFileContent()).toBe(designContent);
      expect(rule.isExcludedFromRootReferences()).toBe(true);
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert to RulesyncRule", () => {
      const rule = new FactorydroidRule({
        outputRoot: testDir,
        relativeDirPath: ".",
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

    it("should round-trip a design-guidelines instance back to factorydroid.channel: design", async () => {
      await writeFileContent(join(testDir, "DESIGN.md"), "# Design Guidelines");

      const rule = await FactorydroidRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "DESIGN.md",
        validate: true,
      });

      const rulesyncRule = rule.toRulesyncRule();

      expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
      expect(rulesyncRule.getFrontmatter().root).toBe(false);
      expect(rulesyncRule.getFrontmatter().factorydroid).toEqual({ channel: "design" });
    });
  });

  describe("validate", () => {
    it("should return success for any content", () => {
      const rule = new FactorydroidRule({
        outputRoot: testDir,
        relativeDirPath: ".",
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
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
      });

      expect(rule).toBeInstanceOf(FactorydroidRule);
      expect(rule.isRoot()).toBe(true);
    });

    it("should create deletion marker for non-root rule", () => {
      const rule = FactorydroidRule.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".factory/rules",
        relativeFilePath: "memory-1.md",
      });

      expect(rule).toBeInstanceOf(FactorydroidRule);
      expect(rule.isRoot()).toBe(false);
    });

    it("should mark the design-guidelines file as a non-root, excluded-from-references deletion target", () => {
      const rule = FactorydroidRule.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "DESIGN.md",
      });

      expect(rule).toBeInstanceOf(FactorydroidRule);
      expect(rule.isRoot()).toBe(false);
      expect(rule.isExcludedFromRootReferences()).toBe(true);
    });
  });
});
