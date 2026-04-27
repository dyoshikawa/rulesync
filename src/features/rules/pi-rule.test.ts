import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { PiRule } from "./pi-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("PiRule", () => {
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
    it("should return project paths by default", () => {
      const paths = PiRule.getSettablePaths();

      expect(paths.root).toEqual({
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
      });
      expect(paths.nonRoot).toEqual({
        relativeDirPath: join(".agents", "memories"),
      });
    });

    it("should return global paths when global is true", () => {
      const paths = PiRule.getSettablePaths({ global: true });

      expect(paths.root).toEqual({
        relativeDirPath: join(".pi", "agent"),
        relativeFilePath: "AGENTS.md",
      });
      expect("nonRoot" in paths).toBe(false);
    });

    it("should honor excludeToolDir for global paths", () => {
      const paths = PiRule.getSettablePaths({ global: true, excludeToolDir: true });

      expect(paths.root).toEqual({
        relativeDirPath: "agent",
        relativeFilePath: "AGENTS.md",
      });
    });

    it("should honor excludeToolDir for project non-root paths", () => {
      const paths = PiRule.getSettablePaths({ excludeToolDir: true });

      expect(paths.nonRoot).toEqual({
        relativeDirPath: "memories",
      });
    });
  });

  describe("fromFile", () => {
    it("should load the root AGENTS.md file", async () => {
      const content = "# Root Pi Agent\n\nContent.";
      await writeFileContent(join(testDir, "AGENTS.md"), content);

      const rule = await PiRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "AGENTS.md",
      });

      expect(rule.getFileContent()).toBe(content);
      expect(rule.isRoot()).toBe(true);
      expect(rule.getRelativeDirPath()).toBe(".");
      expect(rule.getRelativeFilePath()).toBe("AGENTS.md");
    });

    it("should load a non-root memories file", async () => {
      const memoriesDir = join(testDir, ".agents", "memories");
      await ensureDir(memoriesDir);
      const content = "# Memory\nBody.";
      await writeFileContent(join(memoriesDir, "memory.md"), content);

      const rule = await PiRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "memory.md",
      });

      expect(rule.getFileContent()).toBe(content);
      expect(rule.isRoot()).toBe(false);
      expect(rule.getRelativeDirPath()).toBe(join(".agents", "memories"));
      expect(rule.getRelativeFilePath()).toBe("memory.md");
    });

    it("should load root AGENTS.md in global mode", async () => {
      const globalDir = join(testDir, ".pi", "agent");
      await ensureDir(globalDir);
      const content = "# Global Pi Agent";
      await writeFileContent(join(globalDir, "AGENTS.md"), content);

      const rule = await PiRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "AGENTS.md",
        global: true,
      });

      expect(rule.getFileContent()).toBe(content);
      expect(rule.isRoot()).toBe(true);
      expect(rule.getRelativeDirPath()).toBe(join(".pi", "agent"));
    });

    it("should throw when asked for non-root file in global mode", async () => {
      await expect(
        PiRule.fromFile({
          outputRoot: testDir,
          relativeFilePath: "memory.md",
          global: true,
        }),
      ).rejects.toThrow(/global mode/i);
    });
  });

  describe("fromRulesyncRule", () => {
    it("should produce a root rule from a root rulesync rule", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "overview.md",
        frontmatter: {
          root: true,
          targets: ["pi"],
        },
        body: "# Root\nBody.",
      });

      const rule = PiRule.fromRulesyncRule({
        outputRoot: testDir,
        rulesyncRule,
      });

      expect(rule.isRoot()).toBe(true);
      expect(rule.getRelativeDirPath()).toBe(".");
      expect(rule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(rule.getFileContent()).toContain("# Root");
    });

    it("should produce a non-root rule under .agents/memories", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "memory.md",
        frontmatter: {
          root: false,
          targets: ["pi"],
        },
        body: "# Memory\nBody.",
      });

      const rule = PiRule.fromRulesyncRule({
        outputRoot: testDir,
        rulesyncRule,
      });

      expect(rule.isRoot()).toBe(false);
      expect(rule.getRelativeDirPath()).toBe(join(".agents", "memories"));
      expect(rule.getRelativeFilePath()).toBe("memory.md");
    });

    it("should throw for non-root rule in global mode", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "memory.md",
        frontmatter: {
          root: false,
          targets: ["pi"],
        },
        body: "# Memory\nBody.",
      });

      expect(() =>
        PiRule.fromRulesyncRule({
          outputRoot: testDir,
          rulesyncRule,
          global: true,
        }),
      ).toThrow(/global mode/i);
    });

    it("should use global root paths when global is true", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "overview.md",
        frontmatter: {
          root: true,
          targets: ["pi"],
        },
        body: "# Global\nBody.",
      });

      const rule = PiRule.fromRulesyncRule({
        outputRoot: testDir,
        rulesyncRule,
        global: true,
      });

      expect(rule.isRoot()).toBe(true);
      expect(rule.getRelativeDirPath()).toBe(join(".pi", "agent"));
      expect(rule.getRelativeFilePath()).toBe("AGENTS.md");
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert a root rule", () => {
      const rule = new PiRule({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
        fileContent: "# Root\nBody.",
        root: true,
      });

      const rulesyncRule = rule.toRulesyncRule();

      expect(rulesyncRule.getBody()).toBe("# Root\nBody.");
      expect(rulesyncRule.getFrontmatter().root).toBe(true);
    });

    it("should convert a non-root rule", () => {
      const rule = new PiRule({
        outputRoot: testDir,
        relativeDirPath: join(".agents", "memories"),
        relativeFilePath: "memory.md",
        fileContent: "# Memory\nBody.",
        root: false,
      });

      const rulesyncRule = rule.toRulesyncRule();

      expect(rulesyncRule.getBody()).toBe("# Memory\nBody.");
      expect(rulesyncRule.getFrontmatter().root).toBe(false);
    });
  });

  describe("validate", () => {
    it("should always succeed", () => {
      const rule = new PiRule({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
        fileContent: "",
        root: true,
      });

      const result = rule.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });

  describe("forDeletion", () => {
    it("should create a root deletion stub when path matches root", () => {
      const rule = PiRule.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
      });

      expect(rule.isRoot()).toBe(true);
      expect(rule.getFileContent()).toBe("");
    });

    it("should create a non-root deletion stub when path does not match root", () => {
      const rule = PiRule.forDeletion({
        outputRoot: testDir,
        relativeDirPath: join(".agents", "memories"),
        relativeFilePath: "memory.md",
      });

      expect(rule.isRoot()).toBe(false);
      expect(rule.getFileContent()).toBe("");
    });
  });

  describe("isTargetedByRulesyncRule", () => {
    it("should return true for pi target", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "test.md",
        frontmatter: { targets: ["pi"] },
        body: "Body",
      });

      expect(PiRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should return true for wildcard targets", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "test.md",
        frontmatter: { targets: ["*"] },
        body: "Body",
      });

      expect(PiRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should return false for non-pi targets", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "test.md",
        frontmatter: { targets: ["cursor"] },
        body: "Body",
      });

      expect(PiRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(false);
    });
  });
});
