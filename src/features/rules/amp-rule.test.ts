import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RULES_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { AmpRule } from "./amp-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("AmpRule", () => {
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
    it("returns project root AGENTS.md and .agents/memories non-root paths", () => {
      const paths = AmpRule.getSettablePaths();
      expect(paths.root.relativeDirPath).toBe(".");
      expect(paths.root.relativeFilePath).toBe("AGENTS.md");
      expect(paths.nonRoot?.relativeDirPath).toBe(join(".agents", "memories"));
    });

    it("returns the global ~/.config/amp/AGENTS.md root path with no non-root", () => {
      const paths = AmpRule.getSettablePaths({ global: true });
      expect(paths.root.relativeDirPath).toBe(join(".config", "amp"));
      expect(paths.root.relativeFilePath).toBe("AGENTS.md");
      expect("nonRoot" in paths ? paths.nonRoot : undefined).toBeUndefined();
    });
  });

  describe("fromFile", () => {
    it("loads the root AGENTS.md file", async () => {
      const content = "# Amp\n\nProject instructions.";
      await writeFileContent(join(testDir, "AGENTS.md"), content);

      const rule = await AmpRule.fromFile({ outputRoot: testDir, relativeFilePath: "AGENTS.md" });

      expect(rule.getFileContent()).toBe(content);
      expect(rule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(rule.getRelativeDirPath()).toBe(".");
      expect(rule.isRoot()).toBe(true);
    });

    it("loads a non-root rule from .agents/memories", async () => {
      const memoriesDir = join(testDir, ".agents", "memories");
      await ensureDir(memoriesDir);
      const content = "# Memory\n\nDetail.";
      await writeFileContent(join(memoriesDir, "detail.md"), content);

      const rule = await AmpRule.fromFile({ outputRoot: testDir, relativeFilePath: "detail.md" });

      expect(rule.getFileContent()).toBe(content);
      expect(rule.getRelativeFilePath()).toBe("detail.md");
      expect(rule.getRelativeDirPath()).toBe(join(".agents", "memories"));
      expect(rule.isRoot()).toBe(false);
    });

    it("loads the global root file from .config/amp/AGENTS.md", async () => {
      const globalDir = join(testDir, ".config", "amp");
      await ensureDir(globalDir);
      const content = "# Global Amp";
      await writeFileContent(join(globalDir, "AGENTS.md"), content);

      const rule = await AmpRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "AGENTS.md",
        global: true,
      });

      expect(rule.getFileContent()).toBe(content);
      expect(rule.getRelativeDirPath()).toBe(join(".config", "amp"));
      expect(rule.isRoot()).toBe(true);
    });
  });

  describe("fromRulesyncRule", () => {
    it("generates the root AGENTS.md at the project root", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "overview.md",
        frontmatter: { root: true, targets: ["*"], description: "Root", globs: ["**/*"] },
        body: "# Root",
      });

      const rule = AmpRule.fromRulesyncRule({ outputRoot: testDir, rulesyncRule });

      expect(rule.getRelativeDirPath()).toBe(".");
      expect(rule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(rule.isRoot()).toBe(true);
      expect(rule.getGlobs()).toEqual(["**/*"]);
    });

    it("generates a non-root rule under .agents/memories with globs preserved", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "ts.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "TS rule",
          globs: ["src/**/*.ts"],
        },
        body: "# TS",
      });

      const rule = AmpRule.fromRulesyncRule({ outputRoot: testDir, rulesyncRule });

      expect(rule.getRelativeDirPath()).toBe(join(".agents", "memories"));
      expect(rule.getRelativeFilePath()).toBe("ts.md");
      expect(rule.isRoot()).toBe(false);
      expect(rule.getGlobs()).toEqual(["src/**/*.ts"]);
    });

    it("uses the global root path when global=true", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "overview.md",
        frontmatter: { root: true, targets: ["*"], description: "Root", globs: [] },
        body: "# Root",
      });

      const rule = AmpRule.fromRulesyncRule({ outputRoot: testDir, rulesyncRule, global: true });

      expect(rule.getRelativeDirPath()).toBe(join(".config", "amp"));
      expect(rule.getRelativeFilePath()).toBe("AGENTS.md");
    });
  });

  describe("toRulesyncRule round-trip", () => {
    it("preserves globs from a non-root rule", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "ts.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "TS rule",
          globs: ["src/**/*.ts"],
        },
        body: "# TS",
      });

      const rule = AmpRule.fromRulesyncRule({ outputRoot: testDir, rulesyncRule });
      const roundTripped = rule.toRulesyncRule();

      expect(roundTripped.getFrontmatter().globs).toEqual(["src/**/*.ts"]);
      expect(roundTripped.getBody()).toBe("# TS");
    });
  });

  describe("forDeletion", () => {
    it("marks the root AGENTS.md as a root rule for deletion", () => {
      const rule = AmpRule.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
      });
      expect(rule.isRoot()).toBe(true);
      expect(rule.getFileContent()).toBe("");
    });

    it("marks a non-root memory file as a non-root rule for deletion", () => {
      const rule = AmpRule.forDeletion({
        outputRoot: testDir,
        relativeDirPath: join(".agents", "memories"),
        relativeFilePath: "detail.md",
      });
      expect(rule.isRoot()).toBe(false);
    });
  });

  describe("isTargetedByRulesyncRule", () => {
    it("targets rules with the wildcard target", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "overview.md",
        frontmatter: { root: true, targets: ["*"], description: "", globs: [] },
        body: "x",
      });
      expect(AmpRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("targets rules that explicitly list amp", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "overview.md",
        frontmatter: { root: true, targets: ["amp"], description: "", globs: [] },
        body: "x",
      });
      expect(AmpRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("does not target rules that exclude amp", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "overview.md",
        frontmatter: { root: true, targets: ["codexcli"], description: "", globs: [] },
        body: "x",
      });
      expect(AmpRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(false);
    });
  });

  describe("validate", () => {
    it("always succeeds", () => {
      const rule = new AmpRule({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
        fileContent: "",
        root: true,
      });
      expect(rule.validate().success).toBe(true);
    });
  });
});
