import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_OVERVIEW_FILE_NAME,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { RovodevRule } from "./rovodev-rule.js";
import { RulesyncRule, type RulesyncRuleFrontmatterInput } from "./rulesync-rule.js";

describe("RovodevRule", () => {
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
    it("should return .rovodev/AGENTS.md primary and project-root alternative in project mode", () => {
      const paths = RovodevRule.getSettablePaths();

      expect(paths.root).toEqual({
        relativeDirPath: ".rovodev",
        relativeFilePath: "AGENTS.md",
      });
      expect(paths).toMatchObject({
        alternativeRoots: [{ relativeDirPath: ".", relativeFilePath: "AGENTS.md" }],
        nonRoot: { relativeDirPath: ".rovodev/.rulesync/modular-rules" },
      });
    });

    it("should return only .rovodev/AGENTS.md in global mode", () => {
      const paths = RovodevRule.getSettablePaths({ global: true });

      expect(paths.root).toEqual({
        relativeDirPath: ".rovodev",
        relativeFilePath: "AGENTS.md",
      });
      expect("alternativeRoots" in paths ? paths.alternativeRoots : undefined).toBeUndefined();
    });
  });

  describe("fromFile", () => {
    it("should load .rovodev/AGENTS.md", async () => {
      const content = "# Rovodev AGENTS\n\nHello.";
      await ensureDir(join(testDir, ".rovodev"));
      await writeFileContent(join(testDir, ".rovodev", "AGENTS.md"), content);

      const rule = await RovodevRule.fromFile({
        baseDir: testDir,
        relativeDirPath: ".rovodev",
        relativeFilePath: "AGENTS.md",
      });

      expect(rule).toBeInstanceOf(RovodevRule);
      expect(rule.isRoot()).toBe(true);
      expect(rule.getRelativeDirPath()).toBe(".rovodev");
      expect(rule.getFileContent()).toBe(content);
    });

    it("should load project-root AGENTS.md as alternative path", async () => {
      const content = "# Root AGENTS";
      await writeFileContent(join(testDir, "AGENTS.md"), content);

      const rule = await RovodevRule.fromFile({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
      });

      expect(rule.getRelativeDirPath()).toBe(".");
      expect(rule.getFileContent()).toBe(content);
    });

    it("should reject relativeFilePath other than AGENTS.md", async () => {
      await expect(
        RovodevRule.fromFile({
          baseDir: testDir,
          relativeFilePath: "other.md",
        }),
      ).rejects.toThrow(/Rovodev rules support only AGENTS\.md/);
    });

    it("should reject AGENTS.md outside allowed locations", async () => {
      await ensureDir(join(testDir, "pkg"));
      await writeFileContent(join(testDir, "pkg", "AGENTS.md"), "# x");

      await expect(
        RovodevRule.fromFile({
          baseDir: testDir,
          relativeDirPath: "pkg",
          relativeFilePath: "AGENTS.md",
        }),
      ).rejects.toThrow(/must be at/);
    });

    it("should throw when AGENTS.md is missing", async () => {
      await expect(
        RovodevRule.fromFile({
          baseDir: testDir,
          relativeDirPath: ".rovodev",
          relativeFilePath: "AGENTS.md",
        }),
      ).rejects.toThrow();
    });
  });

  describe("fromRulesyncRule", () => {
    it("should create RovodevRule at .rovodev/AGENTS.md from root RulesyncRule", () => {
      const frontmatter: RulesyncRuleFrontmatterInput = {
        description: "Rovodev overview",
        root: true,
        targets: ["rovodev"],
      };

      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_OVERVIEW_FILE_NAME,
        frontmatter,
        body: "# Overview body",
      });

      const rovodevRule = RovodevRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule,
      });

      expect(rovodevRule).toBeInstanceOf(RovodevRule);
      expect(rovodevRule.isRoot()).toBe(true);
      expect(rovodevRule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(rovodevRule.getRelativeDirPath()).toBe(".rovodev");
      expect(rovodevRule.getFileContent()).toBe("# Overview body");
    });

    it("should use global paths when global is true", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_OVERVIEW_FILE_NAME,
        frontmatter: { root: true, targets: ["rovodev"] },
        body: "x",
      });

      const rovodevRule = RovodevRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule,
        global: true,
      });

      expect(rovodevRule.getRelativeDirPath()).toBe(".rovodev");
      expect(rovodevRule.getRelativeFilePath()).toBe("AGENTS.md");
    });

    it("should throw for non-root RulesyncRule", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "nested.md",
        frontmatter: {
          root: false,
          targets: ["rovodev"],
        },
        body: "# Memory",
      });

      expect(() =>
        RovodevRule.fromRulesyncRule({
          baseDir: testDir,
          rulesyncRule,
        }),
      ).toThrow(
        "Rovodev supports only the root rule for AGENTS.md; non-root rules are not supported.",
      );
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert root RovodevRule at .rovodev to RulesyncRule overview", () => {
      const rovodevRule = new RovodevRule({
        relativeDirPath: ".rovodev",
        relativeFilePath: "AGENTS.md",
        fileContent: "# Root AGENTS",
        root: true,
      });

      const rulesyncRule = rovodevRule.toRulesyncRule();

      expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
      expect(rulesyncRule.getRelativeDirPath()).toBe(RULESYNC_RULES_RELATIVE_DIR_PATH);
      expect(rulesyncRule.getRelativeFilePath()).toBe(RULESYNC_OVERVIEW_FILE_NAME);
      expect(rulesyncRule.getFrontmatter().root).toBe(true);
      expect(rulesyncRule.getBody()).toBe("# Root AGENTS");
    });

    it("should map project-root AGENTS.md mirror to overview", () => {
      const rovodevRule = new RovodevRule({
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
        fileContent: "# Mirror",
        root: true,
      });

      const rulesyncRule = rovodevRule.toRulesyncRule();

      expect(rulesyncRule.getRelativeFilePath()).toBe(RULESYNC_OVERVIEW_FILE_NAME);
      expect(rulesyncRule.getFrontmatter().root).toBe(true);
    });

    it("should map AGENTS.local.md to localRoot rulesync rule", () => {
      const rovodevRule = new RovodevRule({
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.local.md",
        fileContent: "# Local only",
        root: true,
      });

      const rulesyncRule = rovodevRule.toRulesyncRule();

      expect(rulesyncRule.getRelativeFilePath()).toBe("AGENTS.local.md");
      expect(rulesyncRule.getFrontmatter().localRoot).toBe(true);
      expect(rulesyncRule.getFrontmatter().root).toBe(false);
      expect(rulesyncRule.getBody()).toBe("# Local only");
    });
  });

  describe("round-trip", () => {
    it("fromRulesyncRule then toRulesyncRule preserves body and root", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_OVERVIEW_FILE_NAME,
        frontmatter: {
          description: "d",
          root: true,
          targets: ["rovodev"],
        },
        body: "Round-trip content",
      });

      const rovodev = RovodevRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule,
      });

      const back = rovodev.toRulesyncRule();

      expect(back.getBody()).toBe("Round-trip content");
      expect(back.getFrontmatter().root).toBe(true);
    });
  });

  describe("validate", () => {
    it("should always return success", () => {
      const rule = new RovodevRule({
        relativeDirPath: ".rovodev",
        relativeFilePath: "AGENTS.md",
        fileContent: "# x",
        root: true,
      });

      expect(rule.validate()).toEqual({ success: true, error: null });
    });
  });

  describe("forDeletion", () => {
    it("should create minimal instance for deletion", () => {
      const rule = RovodevRule.forDeletion({
        baseDir: testDir,
        relativeDirPath: ".rovodev",
        relativeFilePath: "AGENTS.md",
      });

      expect(rule).toBeInstanceOf(RovodevRule);
      expect(rule.isRoot()).toBe(true);
      expect(rule.getFileContent()).toBe("");
    });
  });

  describe("isTargetedByRulesyncRule", () => {
    it("should return true when targets include rovodev", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "overview.md",
        frontmatter: { targets: ["rovodev"], root: true },
        body: "Test",
      });

      expect(RovodevRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should return true when targets include *", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "overview.md",
        frontmatter: { targets: ["*"], root: true },
        body: "Test",
      });

      expect(RovodevRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should return true for localRoot rule with rovodev target", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "local.md",
        frontmatter: { targets: ["rovodev"], localRoot: true, root: false },
        body: "Local",
      });

      expect(RovodevRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should return false when targets exclude rovodev", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "overview.md",
        frontmatter: { targets: ["junie"], root: true },
        body: "Test",
      });

      expect(RovodevRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(false);
    });

    it("should return false for non-root rules even when targets include rovodev", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "nested.md",
        frontmatter: { targets: ["rovodev"], root: false },
        body: "Test",
      });

      expect(RovodevRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(false);
    });
  });
});
