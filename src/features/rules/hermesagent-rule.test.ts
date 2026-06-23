import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { HermesagentRule } from "./hermesagent-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("HermesagentRule", () => {
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
    it("should create a HermesagentRule with valid parameters", () => {
      const rule = new HermesagentRule({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".hermes.md",
        fileContent: "# Test\n\nSome content.",
      });

      expect(rule.getFileContent()).toBe("# Test\n\nSome content.");
    });

    it("should create a HermesagentRule with root flag", () => {
      const rule = new HermesagentRule({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".hermes.md",
        fileContent: "# Root Agent\n\nRoot configuration.",
        root: true,
      });

      expect(rule.getFileContent()).toBe("# Root Agent\n\nRoot configuration.");
      expect(rule.isRoot()).toBe(true);
    });

    it("should default root to false when not specified", () => {
      const rule = new HermesagentRule({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".hermes.md",
        fileContent: "Content",
      });

      expect(rule.getFileContent()).toBe("Content");
      expect(rule.isRoot()).toBe(false);
    });
  });

  describe("getSettablePaths", () => {
    it("should return the project-root .hermes.md path", () => {
      const paths = HermesagentRule.getSettablePaths();
      expect(paths.root.relativeDirPath).toBe(".");
      expect(paths.root.relativeFilePath).toBe(".hermes.md");
    });

    it("should not expose a nonRoot path (Hermes reads only .hermes.md)", () => {
      const paths = HermesagentRule.getSettablePaths();
      expect(paths.nonRoot).toBeUndefined();
    });
  });

  describe("fromFile", () => {
    it("should create HermesagentRule from the root .hermes.md file", async () => {
      const content = "# Root Agent Configuration";
      await writeFileContent(join(testDir, ".hermes.md"), content);

      const rule = await HermesagentRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: ".hermes.md",
      });

      expect(rule.getFileContent()).toBe(content);
      expect(rule.getRelativeDirPath()).toBe(".");
      expect(rule.getRelativeFilePath()).toBe(".hermes.md");
      expect(rule.isRoot()).toBe(true);
    });

    it("should read the root .hermes.md even when given a non-root relativeFilePath", async () => {
      const content = "# Single Source of Truth";
      await writeFileContent(join(testDir, ".hermes.md"), content);

      const rule = await HermesagentRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "some-topic.md",
      });

      expect(rule.getFileContent()).toBe(content);
      expect(rule.getRelativeDirPath()).toBe(".");
      expect(rule.getRelativeFilePath()).toBe(".hermes.md");
      expect(rule.isRoot()).toBe(true);
    });
  });

  describe("fromRulesyncRule", () => {
    it("should route a non-root RulesyncRule to the single root .hermes.md", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "test.md",
        frontmatter: { targets: ["hermesagent"] },
        body: "# Agent Config\n\nContent.",
      });

      const rule = HermesagentRule.fromRulesyncRule({ outputRoot: testDir, rulesyncRule });

      expect(rule.getFileContent()).toBe("# Agent Config\n\nContent.");
      // Non-root rules are folded into the root `.hermes.md`; Hermes has no
      // non-root rule directory.
      expect(rule.getRelativeDirPath()).toBe(".");
      expect(rule.getRelativeFilePath()).toBe(".hermes.md");
      expect(rule.isRoot()).toBe(false);
    });

    it("should create a root HermesagentRule from a root RulesyncRule", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "root.md",
        frontmatter: { root: true, targets: ["hermesagent"] },
        body: "# Root Content",
      });

      const rule = HermesagentRule.fromRulesyncRule({ outputRoot: testDir, rulesyncRule });

      expect(rule.getFileContent()).toBe("# Root Content");
      expect(rule.getRelativeDirPath()).toBe(".");
      expect(rule.getRelativeFilePath()).toBe(".hermes.md");
      expect(rule.isRoot()).toBe(true);
    });
  });

  describe("forDeletion", () => {
    it("should create a placeholder root rule for deletion", () => {
      const rule = HermesagentRule.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".hermes.md",
      });

      expect(rule.getRelativeDirPath()).toBe(".");
      expect(rule.getRelativeFilePath()).toBe(".hermes.md");
      expect(rule.isRoot()).toBe(true);
      expect(rule.getFileContent()).toBe("");
    });

    it("should not treat an unrelated file as a root rule", () => {
      const rule = HermesagentRule.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "other.md",
      });

      expect(rule.isRoot()).toBe(false);
    });
  });

  describe("isTargetedByRulesyncRule", () => {
    it("should return true when target is hermesagent", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "test.md",
        frontmatter: { targets: ["hermesagent"] },
        body: "Content",
      });

      expect(HermesagentRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should return true when target is wildcard", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "test.md",
        frontmatter: { targets: ["*"] },
        body: "Content",
      });

      expect(HermesagentRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should return false when target is a different tool", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "test.md",
        frontmatter: { targets: ["claudecode"] },
        body: "Content",
      });

      expect(HermesagentRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(false);
    });
  });

  describe("validate", () => {
    it("should always return success", () => {
      const rule = new HermesagentRule({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".hermes.md",
        fileContent: "Content",
      });

      expect(rule.validate()).toEqual({ success: true, error: null });
    });
  });
});
