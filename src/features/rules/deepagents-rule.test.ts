import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { DeepagentsRule } from "./deepagents-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("DeepagentsRule", () => {
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
    it("should create a DeepagentsRule with valid parameters", () => {
      const rule = new DeepagentsRule({
        outputRoot: testDir,
        relativeDirPath: ".deepagents/memories",
        relativeFilePath: "test.md",
        fileContent: "# Test\n\nSome content.",
      });

      expect(rule.getFileContent()).toBe("# Test\n\nSome content.");
    });

    it("should create a DeepagentsRule with root flag", () => {
      const rule = new DeepagentsRule({
        outputRoot: testDir,
        relativeDirPath: ".deepagents",
        relativeFilePath: "AGENTS.md",
        fileContent: "# Root Agent\n\nRoot configuration.",
        root: true,
      });

      expect(rule.getFileContent()).toBe("# Root Agent\n\nRoot configuration.");
    });

    it("should default root to false when not specified", () => {
      const rule = new DeepagentsRule({
        outputRoot: testDir,
        relativeDirPath: ".deepagents/memories",
        relativeFilePath: "test.md",
        fileContent: "Content",
      });

      expect(rule.getFileContent()).toBe("Content");
    });
  });

  describe("getSettablePaths", () => {
    it("should return correct root path", () => {
      const paths = DeepagentsRule.getSettablePaths();
      expect(paths.root.relativeDirPath).toBe(".deepagents");
      expect(paths.root.relativeFilePath).toBe("AGENTS.md");
    });

    it("should return correct nonRoot path", () => {
      const paths = DeepagentsRule.getSettablePaths();
      expect(paths.nonRoot.relativeDirPath).toBe(".deepagents/memories");
    });
  });

  describe("fromFile", () => {
    it("should create DeepagentsRule from root AGENTS.md file", async () => {
      const deepagentsDir = join(testDir, ".deepagents");
      await ensureDir(deepagentsDir);
      const content = "# Root Agent Configuration";
      await writeFileContent(join(deepagentsDir, "AGENTS.md"), content);

      const rule = await DeepagentsRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "AGENTS.md",
      });

      expect(rule.getFileContent()).toBe(content);
      expect(rule.getRelativeDirPath()).toBe(".deepagents");
      expect(rule.getRelativeFilePath()).toBe("AGENTS.md");
    });

    it("should create DeepagentsRule from memory file", async () => {
      const memoriesDir = join(testDir, ".deepagents", "memories");
      await ensureDir(memoriesDir);
      const content = "# Memory Configuration";
      await writeFileContent(join(memoriesDir, "memory.md"), content);

      const rule = await DeepagentsRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "memory.md",
      });

      expect(rule.getFileContent()).toBe(content);
      expect(rule.getRelativeDirPath()).toBe(".deepagents/memories");
    });
  });

  describe("fromRulesyncRule", () => {
    it("should create DeepagentsRule from RulesyncRule (non-root)", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "test.md",
        frontmatter: { targets: ["deepagents"] },
        body: "# Agent Config\n\nContent.",
      });

      const rule = DeepagentsRule.fromRulesyncRule({ outputRoot: testDir, rulesyncRule });

      expect(rule.getFileContent()).toBe("# Agent Config\n\nContent.");
      expect(rule.getRelativeDirPath()).toBe(".deepagents/memories");
      expect(rule.getRelativeFilePath()).toBe("test.md");
    });

    it("should create root DeepagentsRule from root RulesyncRule", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "root.md",
        frontmatter: { root: true, targets: ["deepagents"] },
        body: "# Root Content",
      });

      const rule = DeepagentsRule.fromRulesyncRule({ outputRoot: testDir, rulesyncRule });

      expect(rule.getFileContent()).toBe("# Root Content");
      expect(rule.getRelativeDirPath()).toBe(".deepagents");
      expect(rule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(rule.isRoot()).toBe(true);
    });
  });

  describe("forDeletion", () => {
    it("should create a placeholder root rule for deletion", () => {
      const rule = DeepagentsRule.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".deepagents",
        relativeFilePath: "AGENTS.md",
      });

      expect(rule.getRelativeDirPath()).toBe(".deepagents");
      expect(rule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(rule.isRoot()).toBe(true);
      expect(rule.getFileContent()).toBe("");
    });
  });

  describe("isTargetedByRulesyncRule", () => {
    it("should return true when target is deepagents", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "test.md",
        frontmatter: { targets: ["deepagents"] },
        body: "Content",
      });

      expect(DeepagentsRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should return true when target is wildcard", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "test.md",
        frontmatter: { targets: ["*"] },
        body: "Content",
      });

      expect(DeepagentsRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should return false when target is different tool", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "test.md",
        frontmatter: { targets: ["claudecode"] },
        body: "Content",
      });

      expect(DeepagentsRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(false);
    });
  });

  describe("validate", () => {
    it("should always return success", () => {
      const rule = new DeepagentsRule({
        outputRoot: testDir,
        relativeDirPath: ".deepagents/memories",
        relativeFilePath: "test.md",
        fileContent: "Content",
      });

      expect(rule.validate()).toEqual({ success: true, error: null });
    });
  });
});
