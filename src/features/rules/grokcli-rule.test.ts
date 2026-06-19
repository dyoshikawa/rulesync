import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { GrokcliRule } from "./grokcli-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("GrokcliRule", () => {
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
    it("should create a GrokcliRule with valid parameters", () => {
      const rule = new GrokcliRule({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
        fileContent: "# Test\n\nSome content.",
      });

      expect(rule.getFileContent()).toBe("# Test\n\nSome content.");
    });

    it("should create a GrokcliRule with root flag", () => {
      const rule = new GrokcliRule({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
        fileContent: "# Root Agent\n\nRoot configuration.",
        root: true,
      });

      expect(rule.getFileContent()).toBe("# Root Agent\n\nRoot configuration.");
    });

    it("should default root to false when not specified", () => {
      const rule = new GrokcliRule({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
        fileContent: "Content",
      });

      expect(rule.getFileContent()).toBe("Content");
    });
  });

  describe("getSettablePaths", () => {
    it("should return the project-root AGENTS.md path", () => {
      const paths = GrokcliRule.getSettablePaths();
      expect(paths.root.relativeDirPath).toBe(".");
      expect(paths.root.relativeFilePath).toBe("AGENTS.md");
    });

    it("should not expose a nonRoot path (.grok/memories/ is not read by Grok)", () => {
      const paths = GrokcliRule.getSettablePaths();
      expect(paths.nonRoot).toBeUndefined();
    });

    it("should return the user-level ~/.grok/AGENTS.md path for global mode", () => {
      const paths = GrokcliRule.getSettablePaths({ global: true });
      expect(paths.root.relativeDirPath).toBe(".grok");
      expect(paths.root.relativeFilePath).toBe("AGENTS.md");
    });
  });

  describe("fromFile", () => {
    it("should create GrokcliRule from the root AGENTS.md file", async () => {
      const content = "# Root Agent Configuration";
      await writeFileContent(join(testDir, "AGENTS.md"), content);

      const rule = await GrokcliRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "AGENTS.md",
      });

      expect(rule.getFileContent()).toBe(content);
      expect(rule.getRelativeDirPath()).toBe(".");
      expect(rule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(rule.isRoot()).toBe(true);
    });

    it("should read the root AGENTS.md even when given a non-root relativeFilePath", async () => {
      const content = "# Single Source of Truth";
      await writeFileContent(join(testDir, "AGENTS.md"), content);

      const rule = await GrokcliRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "some-topic.md",
      });

      expect(rule.getFileContent()).toBe(content);
      expect(rule.getRelativeDirPath()).toBe(".");
      expect(rule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(rule.isRoot()).toBe(true);
    });
  });

  describe("fromRulesyncRule", () => {
    it("should route a non-root RulesyncRule to the single root AGENTS.md", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "test.md",
        frontmatter: { targets: ["grokcli"] },
        body: "# Agent Config\n\nContent.",
      });

      const rule = GrokcliRule.fromRulesyncRule({ outputRoot: testDir, rulesyncRule });

      expect(rule.getFileContent()).toBe("# Agent Config\n\nContent.");
      // Non-root rules are folded into the root `AGENTS.md`; they are never
      // written to a `.grok/memories/` directory (Grok does not read it).
      expect(rule.getRelativeDirPath()).toBe(".");
      expect(rule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(rule.isRoot()).toBe(false);
    });

    it("should create a root GrokcliRule from a root RulesyncRule", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "root.md",
        frontmatter: { root: true, targets: ["grokcli"] },
        body: "# Root Content",
      });

      const rule = GrokcliRule.fromRulesyncRule({ outputRoot: testDir, rulesyncRule });

      expect(rule.getFileContent()).toBe("# Root Content");
      expect(rule.getRelativeDirPath()).toBe(".");
      expect(rule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(rule.isRoot()).toBe(true);
    });

    it("should route to the global ~/.grok/AGENTS.md in global mode", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "root.md",
        frontmatter: { root: true, targets: ["grokcli"] },
        body: "# Global Content",
      });

      const rule = GrokcliRule.fromRulesyncRule({
        outputRoot: testDir,
        rulesyncRule,
        global: true,
      });

      expect(rule.getRelativeDirPath()).toBe(".grok");
      expect(rule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(rule.isRoot()).toBe(true);
    });
  });

  describe("forDeletion", () => {
    it("should create a placeholder root rule for deletion", () => {
      const rule = GrokcliRule.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
      });

      expect(rule.getRelativeDirPath()).toBe(".");
      expect(rule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(rule.isRoot()).toBe(true);
      expect(rule.getFileContent()).toBe("");
    });

    it("should treat the global .grok/AGENTS.md as a root rule", () => {
      const rule = GrokcliRule.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".grok",
        relativeFilePath: "AGENTS.md",
      });

      expect(rule.isRoot()).toBe(true);
    });
  });

  describe("isTargetedByRulesyncRule", () => {
    it("should return true when target is grokcli", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "test.md",
        frontmatter: { targets: ["grokcli"] },
        body: "Content",
      });

      expect(GrokcliRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should return true when target is wildcard", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "test.md",
        frontmatter: { targets: ["*"] },
        body: "Content",
      });

      expect(GrokcliRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should return false when target is a different tool", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "test.md",
        frontmatter: { targets: ["claudecode"] },
        body: "Content",
      });

      expect(GrokcliRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(false);
    });
  });

  describe("validate", () => {
    it("should always return success", () => {
      const rule = new GrokcliRule({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
        fileContent: "Content",
      });

      expect(rule.validate()).toEqual({ success: true, error: null });
    });
  });
});
