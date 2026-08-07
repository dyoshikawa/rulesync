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
    it("should return a root-only project path (non-root folds into root)", () => {
      const paths = PiRule.getSettablePaths();

      expect(paths.root).toEqual({
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
      });
      expect(paths.nonRoot).toBeUndefined();
    });

    it("should return global paths when global is true", () => {
      const paths = PiRule.getSettablePaths({ global: true });

      expect(paths.root).toEqual({
        relativeDirPath: join(".pi", "agent"),
        relativeFilePath: "AGENTS.md",
      });
      expect(paths.nonRoot).toBeUndefined();
    });

    it("should honor excludeToolDir for global paths", () => {
      const paths = PiRule.getSettablePaths({ global: true, excludeToolDir: true });

      expect(paths.root).toEqual({
        relativeDirPath: "agent",
        relativeFilePath: "AGENTS.md",
      });
    });

    it("should expose the append system-prompt path (project)", () => {
      const paths = PiRule.getSettablePaths();

      expect(paths.appendSystemPrompt).toEqual({
        relativeDirPath: ".pi",
        relativeFilePath: "APPEND_SYSTEM.md",
      });
    });

    it("should expose the append system-prompt path (global)", () => {
      const paths = PiRule.getSettablePaths({ global: true });

      expect(paths.appendSystemPrompt).toEqual({
        relativeDirPath: join(".pi", "agent"),
        relativeFilePath: "APPEND_SYSTEM.md",
      });
    });
  });

  describe("getExtraFixedFiles", () => {
    it("should enumerate the append system-prompt and override context files (project)", () => {
      expect(PiRule.getExtraFixedFiles()).toEqual([
        { relativeDirPath: ".pi", relativeFilePath: "APPEND_SYSTEM.md" },
        { relativeDirPath: ".", relativeFilePath: "AGENTS.override.md" },
      ]);
    });

    it("should enumerate the append system-prompt and override context files (global)", () => {
      expect(PiRule.getExtraFixedFiles({ global: true })).toEqual([
        { relativeDirPath: join(".pi", "agent"), relativeFilePath: "APPEND_SYSTEM.md" },
        { relativeDirPath: join(".pi", "agent"), relativeFilePath: "AGENTS.override.md" },
      ]);
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

    it("should always read the root AGENTS.md regardless of the requested file", async () => {
      const content = "# Root Pi Agent\n\nContent.";
      await writeFileContent(join(testDir, "AGENTS.md"), content);

      const rule = await PiRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "memory.md",
      });

      expect(rule.getFileContent()).toBe(content);
      expect(rule.isRoot()).toBe(true);
      expect(rule.getRelativeDirPath()).toBe(".");
      expect(rule.getRelativeFilePath()).toBe("AGENTS.md");
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

    it("should read the global root AGENTS.md regardless of the requested file", async () => {
      const globalDir = join(testDir, ".pi", "agent");
      await ensureDir(globalDir);
      const content = "# Global Pi Agent";
      await writeFileContent(join(globalDir, "AGENTS.md"), content);

      const rule = await PiRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "memory.md",
        global: true,
      });

      expect(rule.getFileContent()).toBe(content);
      expect(rule.isRoot()).toBe(true);
      expect(rule.getRelativeDirPath()).toBe(join(".pi", "agent"));
    });

    it("should load the APPEND_SYSTEM.md file (project)", async () => {
      const piDir = join(testDir, ".pi");
      await ensureDir(piDir);
      const content = "# System addendum\n\nBe concise.";
      await writeFileContent(join(piDir, "APPEND_SYSTEM.md"), content);

      const rule = await PiRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "APPEND_SYSTEM.md",
      });

      expect(rule.getFileContent()).toBe(content);
      expect(rule.isRoot()).toBe(false);
      expect(rule.getRelativeDirPath()).toBe(".pi");
      expect(rule.getRelativeFilePath()).toBe("APPEND_SYSTEM.md");
    });

    it("should load the APPEND_SYSTEM.md file (global)", async () => {
      const globalDir = join(testDir, ".pi", "agent");
      await ensureDir(globalDir);
      const content = "# Global system addendum";
      await writeFileContent(join(globalDir, "APPEND_SYSTEM.md"), content);

      const rule = await PiRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "APPEND_SYSTEM.md",
        global: true,
      });

      expect(rule.getFileContent()).toBe(content);
      expect(rule.isRoot()).toBe(false);
      expect(rule.getRelativeDirPath()).toBe(join(".pi", "agent"));
      expect(rule.getRelativeFilePath()).toBe("APPEND_SYSTEM.md");
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

    it("should write a non-root rule to the root AGENTS.md (folded)", () => {
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

      // Non-root rules share the root path so the RulesProcessor folds their
      // bodies into the single AGENTS.md.
      expect(rule.isRoot()).toBe(false);
      expect(rule.getRelativeDirPath()).toBe(".");
      expect(rule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(rule.getFileContent()).toBe("# Memory\nBody.");
    });

    it("should write a non-root rule to the global root path (folded)", () => {
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
        global: true,
      });

      expect(rule.getRelativeDirPath()).toBe(join(".pi", "agent"));
      expect(rule.getRelativeFilePath()).toBe("AGENTS.md");
    });

    it("should route an opted-in rule to APPEND_SYSTEM.md (project)", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "style.md",
        frontmatter: {
          targets: ["pi"],
          pi: { systemPrompt: "append" },
        },
        body: "# Style\nBe concise.",
      });

      const rule = PiRule.fromRulesyncRule({
        outputRoot: testDir,
        rulesyncRule,
      });

      expect(rule.isRoot()).toBe(false);
      expect(rule.getRelativeDirPath()).toBe(".pi");
      expect(rule.getRelativeFilePath()).toBe("APPEND_SYSTEM.md");
      expect(rule.getFileContent()).toBe("# Style\nBe concise.");
    });

    it("should route an opted-in rule to APPEND_SYSTEM.md (global)", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "style.md",
        frontmatter: {
          targets: ["pi"],
          pi: { systemPrompt: "append" },
        },
        body: "# Style\nBe concise.",
      });

      const rule = PiRule.fromRulesyncRule({
        outputRoot: testDir,
        rulesyncRule,
        global: true,
      });

      expect(rule.isRoot()).toBe(false);
      expect(rule.getRelativeDirPath()).toBe(join(".pi", "agent"));
      expect(rule.getRelativeFilePath()).toBe("APPEND_SYSTEM.md");
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

    it("should convert an APPEND_SYSTEM.md instance back to a pi.systemPrompt frontmatter", () => {
      const rule = new PiRule({
        outputRoot: testDir,
        relativeDirPath: ".pi",
        relativeFilePath: "APPEND_SYSTEM.md",
        fileContent: "# Style\nBe concise.",
        root: false,
        appendSystemPrompt: true,
      });

      const rulesyncRule = rule.toRulesyncRule();

      expect(rulesyncRule.getBody()).toBe("# Style\nBe concise.");
      expect(rulesyncRule.getFrontmatter().root).toBe(false);
      expect(rulesyncRule.getFrontmatter().targets).toEqual(["pi"]);
      expect(rulesyncRule.getFrontmatter().pi).toEqual({ systemPrompt: "append" });
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

    it("should create a deletable non-root stub for APPEND_SYSTEM.md", () => {
      const rule = PiRule.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".pi",
        relativeFilePath: "APPEND_SYSTEM.md",
      });

      expect(rule.isRoot()).toBe(false);
      expect(rule.isDeletable()).toBe(true);
      expect(rule.getFileContent()).toBe("");
    });
  });

  describe("pi.contextFile: override", () => {
    it("emits the root rule as AGENTS.override.md", () => {
      const rule = PiRule.fromRulesyncRule({
        outputRoot: testDir,
        rulesyncRule: new RulesyncRule({
          relativeDirPath: ".rulesync/rules",
          relativeFilePath: "overview.md",
          frontmatter: { root: true, targets: ["pi"], pi: { contextFile: "override" } },
          body: "Root body.",
        }),
      });

      expect(rule.getRelativeDirPath()).toBe(".");
      expect(rule.getRelativeFilePath()).toBe("AGENTS.override.md");
      expect(rule.isRoot()).toBe(true);
    });

    it("emits the global root rule as AGENTS.override.md", () => {
      const rule = PiRule.fromRulesyncRule({
        outputRoot: testDir,
        global: true,
        rulesyncRule: new RulesyncRule({
          relativeDirPath: ".rulesync/rules",
          relativeFilePath: "overview.md",
          frontmatter: { root: true, targets: ["pi"], pi: { contextFile: "override" } },
          body: "Root body.",
        }),
      });

      expect(rule.getRelativeDirPath()).toBe(join(".pi", "agent"));
      expect(rule.getRelativeFilePath()).toBe("AGENTS.override.md");
    });

    it("imports AGENTS.override.md back as the root rule carrying the flag", async () => {
      const content = "# Override";
      await writeFileContent(join(testDir, "AGENTS.override.md"), content);

      const rule = await PiRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "AGENTS.override.md",
      });

      expect(rule.isRoot()).toBe(true);
      expect(rule.getFileContent()).toBe(content);
      const rulesyncRule = rule.toRulesyncRule();
      expect(rulesyncRule.getFrontmatter()).toMatchObject({
        root: true,
        targets: ["pi"],
        pi: { contextFile: "override" },
      });
      expect(rulesyncRule.getBody()).toBe(content);
    });

    it("never deletes the shared project-root AGENTS.md", () => {
      const rule = PiRule.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
      });
      expect(rule.isDeletable()).toBe(false);
    });

    it("still deletes the pi-exclusive files", () => {
      const globalRoot = PiRule.forDeletion({
        outputRoot: testDir,
        relativeDirPath: join(".pi", "agent"),
        relativeFilePath: "AGENTS.md",
        global: true,
      });
      const override = PiRule.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.override.md",
      });
      expect(globalRoot.isDeletable()).toBe(true);
      expect(override.isDeletable()).toBe(true);
    });

    it("treats both context-file names as deletable root files", () => {
      for (const relativeFilePath of ["AGENTS.md", "AGENTS.override.md"]) {
        const rule = PiRule.forDeletion({
          outputRoot: testDir,
          relativeDirPath: ".",
          relativeFilePath,
        });
        expect(rule.isRoot()).toBe(true);
        expect(rule.getRelativeFilePath()).toBe(relativeFilePath);
      }
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
