import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RULES_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { KimiRule } from "./kimi-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";
import { ToolRule } from "./tool-rule.js";

describe("KimiRule", () => {
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
    it("should return .kimi-code/AGENTS.md with ./AGENTS.md alternative for project scope", () => {
      const paths = KimiRule.getSettablePaths();
      expect(paths.root).toEqual({ relativeDirPath: ".kimi-code", relativeFilePath: "AGENTS.md" });
      expect(paths.alternativeRoots).toEqual([
        { relativeDirPath: ".", relativeFilePath: "AGENTS.md" },
      ]);
      expect(paths.nonRoot).toBeUndefined();
    });

    it("should return ~/.agents/AGENTS.md for global scope with no alternatives", () => {
      const paths = KimiRule.getSettablePaths({ global: true });
      expect(paths.root).toEqual({ relativeDirPath: ".agents", relativeFilePath: "AGENTS.md" });
      expect(paths.alternativeRoots).toBeUndefined();
    });
  });

  describe("fromRulesyncRule", () => {
    it("should emit a root rule to .kimi-code/AGENTS.md", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "overview.md",
        frontmatter: { root: true, targets: ["*"], globs: ["**/*"] },
        body: "Root memory body",
      });

      const kimiRule = KimiRule.fromRulesyncRule({ outputRoot: testDir, rulesyncRule });

      expect(kimiRule).toBeInstanceOf(KimiRule);
      expect(kimiRule.isRoot()).toBe(true);
      expect(kimiRule.getRelativeDirPath()).toBe(".kimi-code");
      expect(kimiRule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(kimiRule.getFileContent()).toBe("Root memory body");
    });

    it("should fold a non-root rule onto the same root AGENTS.md path", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "topic.md",
        frontmatter: { root: false, targets: ["*"], globs: [] },
        body: "Topic body",
      });

      const kimiRule = KimiRule.fromRulesyncRule({ outputRoot: testDir, rulesyncRule });

      expect(kimiRule.isRoot()).toBe(false);
      expect(kimiRule.getRelativeDirPath()).toBe(".kimi-code");
      expect(kimiRule.getRelativeFilePath()).toBe("AGENTS.md");
    });

    it("should emit to ~/.agents/AGENTS.md in global mode", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "overview.md",
        frontmatter: { root: true, targets: ["*"], globs: ["**/*"] },
        body: "Global memory body",
      });

      const kimiRule = KimiRule.fromRulesyncRule({
        outputRoot: testDir,
        rulesyncRule,
        global: true,
      });

      expect(kimiRule.getRelativeDirPath()).toBe(".agents");
      expect(kimiRule.getRelativeFilePath()).toBe("AGENTS.md");
    });
  });

  describe("fromFile", () => {
    it("should load AGENTS.md from .kimi-code", async () => {
      const filePath = join(testDir, ".kimi-code", "AGENTS.md");
      await ensureDir(join(testDir, ".kimi-code"));
      await writeFileContent(filePath, "File memory body");

      const kimiRule = await KimiRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "AGENTS.md",
        relativeDirPath: ".kimi-code",
      });

      expect(kimiRule.isRoot()).toBe(true);
      expect(kimiRule.getFileContent()).toBe("File memory body");
      expect(kimiRule.getRelativeDirPath()).toBe(".kimi-code");
    });

    it("should load AGENTS.md from the project root alternative", async () => {
      const filePath = join(testDir, "AGENTS.md");
      await writeFileContent(filePath, "Root-level memory body");

      const kimiRule = await KimiRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "AGENTS.md",
        relativeDirPath: ".",
      });

      expect(kimiRule.getRelativeDirPath()).toBe(".");
      expect(kimiRule.getFileContent()).toBe("Root-level memory body");
    });

    it("should throw for a non-AGENTS.md file", async () => {
      await expect(
        KimiRule.fromFile({
          outputRoot: testDir,
          relativeFilePath: "OTHER.md",
          relativeDirPath: ".kimi-code",
        }),
      ).rejects.toThrow("Kimi rules support only AGENTS.md");
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert a root rule back to rulesync", () => {
      const kimiRule = new KimiRule({
        outputRoot: testDir,
        relativeDirPath: ".kimi-code",
        relativeFilePath: "AGENTS.md",
        fileContent: "Memory body",
        root: true,
      });

      const rulesyncRule = kimiRule.toRulesyncRule();
      expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
      expect(rulesyncRule.getFrontmatter().root).toBe(true);
      expect(rulesyncRule.getBody()).toBe("Memory body");
    });
  });

  describe("forDeletion", () => {
    it("should create a deletable root instance for AGENTS.md", () => {
      const kimiRule = KimiRule.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".kimi-code",
        relativeFilePath: "AGENTS.md",
      });

      expect(kimiRule).toBeInstanceOf(KimiRule);
      expect(kimiRule.isRoot()).toBe(true);
      expect(kimiRule.isDeletable()).toBe(true);
    });
  });

  describe("isTargetedByRulesyncRule", () => {
    it("should target when targets includes kimi", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "r.md",
        frontmatter: { root: false, targets: ["kimi"], globs: [] },
        body: "Body",
      });
      expect(KimiRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should target when targets includes *", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "r.md",
        frontmatter: { root: false, targets: ["*"], globs: [] },
        body: "Body",
      });
      expect(KimiRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should not target when targets excludes kimi", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "r.md",
        frontmatter: { root: false, targets: ["cursor"], globs: [] },
        body: "Body",
      });
      expect(KimiRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(false);
    });
  });

  describe("inheritance", () => {
    it("should be an instance of ToolRule", () => {
      const kimiRule = new KimiRule({
        outputRoot: testDir,
        relativeDirPath: ".kimi-code",
        relativeFilePath: "AGENTS.md",
        fileContent: "Body",
        root: true,
      });
      expect(kimiRule).toBeInstanceOf(ToolRule);
    });
  });
});
