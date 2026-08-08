import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import type { RulesyncTargets } from "../../types/tool-targets.js";
import { writeFileContent } from "../../utils/file.js";
import { MusecodeRule } from "./musecode-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("MusecodeRule", () => {
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
      const paths = MusecodeRule.getSettablePaths();
      expect(paths.root.relativeDirPath).toBe(".");
      expect(paths.root.relativeFilePath).toBe("AGENTS.md");
      expect(paths.nonRoot).toBeUndefined();
    });

    it("should ignore the global flag (Muse Code global rules path is undocumented)", () => {
      const paths = MusecodeRule.getSettablePaths({ global: true });
      expect(paths.root.relativeDirPath).toBe(".");
      expect(paths.root.relativeFilePath).toBe("AGENTS.md");
    });
  });

  describe("fromFile", () => {
    it("should load root rule from AGENTS.md file", async () => {
      const content = "# Muse Code Instructions\n\nUse TypeScript.";
      await writeFileContent(join(testDir, "AGENTS.md"), content);

      const rule = await MusecodeRule.fromFile({
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

      const rule = await MusecodeRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "error-handling.md",
      });

      expect(rule.getFileContent()).toBe(content);
      expect(rule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(rule.isRoot()).toBe(true);
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

      const rule = MusecodeRule.fromRulesyncRule({ outputRoot: testDir, rulesyncRule });

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

      const rule = MusecodeRule.fromRulesyncRule({ outputRoot: testDir, rulesyncRule });

      expect(rule.getRelativeDirPath()).toBe(".");
      expect(rule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(rule.isRoot()).toBe(false);
    });
  });

  describe("toRulesyncRule", () => {
    it("should round-trip the body back to a rulesync rule", async () => {
      const content = "# Muse Code Rule";
      await writeFileContent(join(testDir, "AGENTS.md"), content);

      const rule = await MusecodeRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "AGENTS.md",
      });
      const rulesyncRule = rule.toRulesyncRule();

      expect(rulesyncRule.getBody()).toBe(content);
    });
  });

  describe("forDeletion", () => {
    it("should mark the project-root AGENTS.md as root", () => {
      const rule = MusecodeRule.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
      });

      expect(rule.isRoot()).toBe(true);
    });

    it("should not mark other files as root", () => {
      const rule = MusecodeRule.forDeletion({
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

    it("should return true for rules targeting musecode", () => {
      expect(MusecodeRule.isTargetedByRulesyncRule(buildRule(["musecode"]))).toBe(true);
    });

    it("should return true for rules targeting all tools (*)", () => {
      expect(MusecodeRule.isTargetedByRulesyncRule(buildRule(["*"]))).toBe(true);
    });

    it("should return false for rules not targeting musecode", () => {
      expect(MusecodeRule.isTargetedByRulesyncRule(buildRule(["cursor", "copilot"]))).toBe(false);
    });
  });
});
