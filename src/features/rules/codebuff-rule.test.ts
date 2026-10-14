import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_OVERVIEW_FILE_NAME,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { CodebuffRule } from "./codebuff-rule.js";
import { RulesProcessor } from "./rules-processor.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("CodebuffRule", () => {
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
    it("should return the home-directory ~/.AGENTS.md as the only path", () => {
      const paths = CodebuffRule.getSettablePaths({ global: true });
      expect(paths.root).toEqual({ relativeDirPath: ".", relativeFilePath: ".AGENTS.md" });
      expect(paths.nonRoot).toBeUndefined();
    });
  });

  describe("RulesProcessor scope", () => {
    it("should be a global-only rules target", () => {
      expect(RulesProcessor.getToolTargets({ global: true })).toContain("codebuff");
      expect(RulesProcessor.getToolTargets()).not.toContain("codebuff");
    });
  });

  describe("fromFile", () => {
    it("should read ~/.AGENTS.md as the root rule", async () => {
      await writeFileContent(join(testDir, ".AGENTS.md"), "# Global Rules");

      const rule = await CodebuffRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: ".AGENTS.md",
        global: true,
      });

      expect(rule.isRoot()).toBe(true);
      expect(rule.getRelativeDirPath()).toBe(".");
      expect(rule.getRelativeFilePath()).toBe(".AGENTS.md");
      expect(rule.getFileContent()).toBe("# Global Rules");
    });

    it("should throw for any other file", async () => {
      await expect(
        CodebuffRule.fromFile({ outputRoot: testDir, relativeFilePath: "other.md", global: true }),
      ).rejects.toThrow("CodebuffRule only supports the root rule");
    });
  });

  describe("fromRulesyncRule", () => {
    it("should write a root rule to ~/.AGENTS.md", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_OVERVIEW_FILE_NAME,
        frontmatter: { root: true, targets: ["codebuff"] },
        body: "# Global",
      });

      const rule = CodebuffRule.fromRulesyncRule({
        outputRoot: testDir,
        rulesyncRule,
        global: true,
      });

      expect(rule).toBeInstanceOf(CodebuffRule);
      expect(rule.isRoot()).toBe(true);
      expect(rule.getRelativeDirPath()).toBe(".");
      expect(rule.getRelativeFilePath()).toBe(".AGENTS.md");
      expect(rule.getFileContent()).toBe("# Global");
    });

    it("should route a non-root rule to the same file so it can be folded", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "detail.md",
        frontmatter: { root: false, targets: ["codebuff"] },
        body: "# Detail",
      });

      const rule = CodebuffRule.fromRulesyncRule({
        outputRoot: testDir,
        rulesyncRule,
        global: true,
      });

      expect(rule.isRoot()).toBe(false);
      expect(rule.getRelativeFilePath()).toBe(".AGENTS.md");
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert the root rule to the rulesync overview", () => {
      const rule = new CodebuffRule({
        relativeDirPath: ".",
        relativeFilePath: ".AGENTS.md",
        fileContent: "# Root Rule",
        root: true,
      });

      const rulesyncRule = rule.toRulesyncRule();
      expect(rulesyncRule.getRelativeDirPath()).toBe(RULESYNC_RULES_RELATIVE_DIR_PATH);
      expect(rulesyncRule.getRelativeFilePath()).toBe(RULESYNC_OVERVIEW_FILE_NAME);
      expect(rulesyncRule.getFrontmatter().root).toBe(true);
    });
  });

  describe("forDeletion", () => {
    it("should create an empty root instance for ~/.AGENTS.md", () => {
      const rule = CodebuffRule.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".AGENTS.md",
      });
      expect(rule.isRoot()).toBe(true);
      expect(rule.getFileContent()).toBe("");
    });
  });

  describe("isTargetedByRulesyncRule", () => {
    it("should target codebuff and wildcard rules", () => {
      const codebuffRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "a.md",
        frontmatter: { targets: ["codebuff"], root: true },
        body: "Test",
      });
      const otherRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "b.md",
        frontmatter: { targets: ["claudecode"], root: true },
        body: "Test",
      });
      expect(CodebuffRule.isTargetedByRulesyncRule(codebuffRule)).toBe(true);
      expect(CodebuffRule.isTargetedByRulesyncRule(otherRule)).toBe(false);
    });
  });
});
