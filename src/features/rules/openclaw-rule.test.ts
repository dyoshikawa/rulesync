import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import type { RulesyncTargets } from "../../types/tool-targets.js";
import { writeFileContent } from "../../utils/file.js";
import { OpenclawRule } from "./openclaw-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("OpenclawRule", () => {
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
    it("should return the project-root AGENTS.md for project scope", () => {
      const paths = OpenclawRule.getSettablePaths();
      expect(paths.root.relativeDirPath).toBe(".");
      expect(paths.root.relativeFilePath).toBe("AGENTS.md");
      expect(paths.nonRoot).toBeUndefined();
    });

    it("should return the agent-workspace AGENTS.md for global scope", () => {
      const paths = OpenclawRule.getSettablePaths({ global: true });
      expect(paths.root.relativeDirPath).toBe(join(".openclaw", "workspace"));
      expect(paths.root.relativeFilePath).toBe("AGENTS.md");
    });
  });

  describe("fromFile", () => {
    it("should load the root rule from AGENTS.md", async () => {
      const content = "# OpenClaw Instructions\n\nUse TypeScript.";
      await writeFileContent(join(testDir, "AGENTS.md"), content);

      const rule = await OpenclawRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "AGENTS.md",
      });

      expect(rule.getFileContent()).toBe(content);
      expect(rule.getRelativeDirPath()).toBe(".");
      expect(rule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(rule.isRoot()).toBe(true);
    });

    it("should read the root AGENTS.md even when given a non-root relativeFilePath", async () => {
      const content = "# Root Configuration";
      await writeFileContent(join(testDir, "AGENTS.md"), content);

      const rule = await OpenclawRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "error-handling.md",
      });

      expect(rule.getFileContent()).toBe(content);
      expect(rule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(rule.isRoot()).toBe(true);
    });

    it("should read the global AGENTS.md from .openclaw/workspace/", async () => {
      const content = "# Global OpenClaw Instructions";
      await writeFileContent(join(testDir, ".openclaw", "workspace", "AGENTS.md"), content);

      const rule = await OpenclawRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "AGENTS.md",
        global: true,
      });

      expect(rule.getFileContent()).toBe(content);
      expect(rule.getRelativeDirPath()).toBe(join(".openclaw", "workspace"));
    });
  });

  describe("fromRulesyncRule", () => {
    it("should write a root rule to the project-root AGENTS.md", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "root.md",
        frontmatter: { root: true, targets: ["*"], description: "Root rule", globs: [] },
        body: "Root rule body content",
        validate: false,
      });

      const rule = OpenclawRule.fromRulesyncRule({ outputRoot: testDir, rulesyncRule });

      expect(rule.getRelativeDirPath()).toBe(".");
      expect(rule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(rule.getFileContent()).toBe("Root rule body content");
      expect(rule.isRoot()).toBe(true);
    });

    it("should keep non-root rules targeted at the root file (folded by the processor)", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "topic.md",
        frontmatter: { root: false, targets: ["*"], description: "Topic rule", globs: [] },
        body: "Topic rule body content",
        validate: false,
      });

      const rule = OpenclawRule.fromRulesyncRule({ outputRoot: testDir, rulesyncRule });

      expect(rule.getRelativeDirPath()).toBe(".");
      expect(rule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(rule.isRoot()).toBe(false);
    });

    it("should write to .openclaw/workspace/AGENTS.md in global mode", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "root.md",
        frontmatter: { root: true, targets: ["*"], description: "Root rule", globs: [] },
        body: "Global body",
        validate: false,
      });

      const rule = OpenclawRule.fromRulesyncRule({
        outputRoot: testDir,
        rulesyncRule,
        global: true,
      });

      expect(rule.getRelativeDirPath()).toBe(join(".openclaw", "workspace"));
      expect(rule.getRelativeFilePath()).toBe("AGENTS.md");
    });
  });

  describe("toRulesyncRule", () => {
    it("should round-trip the body back to a rulesync rule", async () => {
      const content = "# OpenClaw Rule";
      await writeFileContent(join(testDir, "AGENTS.md"), content);

      const rule = await OpenclawRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "AGENTS.md",
      });

      expect(rule.toRulesyncRule().getBody()).toBe(content);
    });
  });

  describe("validate", () => {
    it("should always succeed", () => {
      const rule = new OpenclawRule({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
        fileContent: "",
      });

      expect(rule.validate()).toEqual({ success: true, error: null });
    });
  });

  describe("forDeletion", () => {
    it("should mark the project-root AGENTS.md as root", () => {
      const rule = OpenclawRule.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
      });

      expect(rule.isRoot()).toBe(true);
    });

    it("should mark the global .openclaw/workspace/AGENTS.md as root", () => {
      const rule = OpenclawRule.forDeletion({
        outputRoot: testDir,
        relativeDirPath: join(".openclaw", "workspace"),
        relativeFilePath: "AGENTS.md",
      });

      expect(rule.isRoot()).toBe(true);
    });

    it("should not mark an AGENTS.md directly under .openclaw/ as root", () => {
      const rule = OpenclawRule.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".openclaw",
        relativeFilePath: "AGENTS.md",
      });

      expect(rule.isRoot()).toBe(false);
    });

    it("should not mark other files as root", () => {
      const rule = OpenclawRule.forDeletion({
        outputRoot: testDir,
        relativeDirPath: "docs",
        relativeFilePath: "AGENTS.md",
      });

      expect(rule.isRoot()).toBe(false);
    });
  });

  describe("isTargetedByRulesyncRule", () => {
    const buildRule = (targets: RulesyncTargets): RulesyncRule =>
      new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        frontmatter: { targets },
        body: "Test content",
        validate: false,
      });

    it("should return true for rules targeting openclaw", () => {
      expect(OpenclawRule.isTargetedByRulesyncRule(buildRule(["openclaw"]))).toBe(true);
    });

    it("should return true for rules targeting all tools (*)", () => {
      expect(OpenclawRule.isTargetedByRulesyncRule(buildRule(["*"]))).toBe(true);
    });

    it("should return false for rules not targeting openclaw", () => {
      expect(OpenclawRule.isTargetedByRulesyncRule(buildRule(["cursor", "copilot"]))).toBe(false);
    });
  });
});
