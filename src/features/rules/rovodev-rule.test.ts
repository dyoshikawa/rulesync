import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_OVERVIEW_FILE_NAME,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
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
    it("should return root AGENTS.md only (no nonRoot)", () => {
      const paths = RovodevRule.getSettablePaths();

      expect(paths.root).toEqual({
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
      });
      expect(paths.nonRoot).toBeUndefined();
      expect(paths.alternativeRoots).toBeUndefined();
    });
  });

  describe("fromFile", () => {
    it("should load repo-root AGENTS.md when relativeFilePath is AGENTS.md", async () => {
      const content = "# Rovodev AGENTS\n\nHello.";
      await writeFileContent(join(testDir, "AGENTS.md"), content);

      const rule = await RovodevRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "AGENTS.md",
      });

      expect(rule).toBeInstanceOf(RovodevRule);
      expect(rule.isRoot()).toBe(true);
      expect(rule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(rule.getRelativeDirPath()).toBe(".");
      expect(rule.getFileContent()).toBe(content);
    });

    it("should reject relativeFilePath other than AGENTS.md", async () => {
      await expect(
        RovodevRule.fromFile({
          baseDir: testDir,
          relativeFilePath: "other.md",
        }),
      ).rejects.toThrow("Rovodev rules support only AGENTS.md at repo root, got: other.md");
    });

    it("should reject nested paths even if basename is AGENTS.md", async () => {
      await expect(
        RovodevRule.fromFile({
          baseDir: testDir,
          relativeFilePath: "pkg/AGENTS.md",
        }),
      ).rejects.toThrow(/Rovodev rules support only AGENTS\.md at repo root/);
    });

    it("should throw when AGENTS.md is missing", async () => {
      await expect(
        RovodevRule.fromFile({
          baseDir: testDir,
          relativeFilePath: "AGENTS.md",
        }),
      ).rejects.toThrow();
    });
  });

  describe("fromRulesyncRule", () => {
    it("should create RovodevRule from root RulesyncRule", () => {
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
      expect(rovodevRule.getRelativeDirPath()).toBe(".");
      expect(rovodevRule.getFileContent()).toBe("# Overview body");
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
        "Rovodev supports only the root rule (AGENTS.md); non-root rules are not supported.",
      );
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert root RovodevRule to RulesyncRule", () => {
      const rovodevRule = new RovodevRule({
        relativeDirPath: ".",
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
        relativeDirPath: ".",
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
        relativeDirPath: ".",
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
