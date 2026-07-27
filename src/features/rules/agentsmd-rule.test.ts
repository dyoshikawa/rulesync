import { rm, symlink } from "node:fs/promises";
import { basename, join, relative } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, findFilesByGlobs, toPosixPath, writeFileContent } from "../../utils/file.js";
import { AgentsMdRule } from "./agentsmd-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("AgentsMdRule", () => {
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
    it("should create an AgentsMdRule with valid parameters", () => {
      const rule = new AgentsMdRule({
        outputRoot: testDir,
        relativeDirPath: ".agents/memories",
        relativeFilePath: "test.md",
        fileContent: "# Test Agent\n\nThis is a test agent configuration.",
      });

      expect(rule.getFileContent()).toBe("# Test Agent\n\nThis is a test agent configuration.");
    });

    it("should create an AgentsMdRule with root flag", () => {
      const rule = new AgentsMdRule({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
        fileContent: "# Root Agent\n\nThis is a root agent configuration.",
        root: true,
      });

      expect(rule.getFileContent()).toBe("# Root Agent\n\nThis is a root agent configuration.");
    });

    it("should default root to false when not specified", () => {
      const rule = new AgentsMdRule({
        outputRoot: testDir,
        relativeDirPath: ".agents/memories",
        relativeFilePath: "test.md",
        fileContent: "# Test Agent\n\nContent",
      });

      expect(rule.getFileContent()).toBe("# Test Agent\n\nContent");
    });
  });

  describe("fromFile", () => {
    it("should create AgentsMdRule from root AGENTS.md file", async () => {
      const content = "# Root Agent Configuration\n\nThis is the main agent file.";
      await writeFileContent(join(testDir, "AGENTS.md"), content);

      const rule = await AgentsMdRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "AGENTS.md",
      });

      expect(rule.getFileContent()).toBe(content);
    });

    it("should create AgentsMdRule from memory file in .agents/memories", async () => {
      const memoriesDir = join(testDir, ".agents", "memories");
      await ensureDir(memoriesDir);

      const content = "# Memory Agent\n\nThis is a memory agent configuration.";
      await writeFileContent(join(memoriesDir, "memory.md"), content);

      const rule = await AgentsMdRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "memory.md",
      });

      expect(rule.getFileContent()).toBe(content);
    });

    it("should handle validation parameter", async () => {
      const content = "# Test Agent\n\nContent";
      await writeFileContent(join(testDir, "AGENTS.md"), content);

      const rule = await AgentsMdRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "AGENTS.md",
        validate: false,
      });

      expect(rule.getFileContent()).toBe(content);
    });

    it("should determine root status from file path", async () => {
      // Test root file
      const rootContent = "# Root Agent";
      await writeFileContent(join(testDir, "AGENTS.md"), rootContent);

      const rootRule = await AgentsMdRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "AGENTS.md",
      });

      expect(rootRule.getFileContent()).toBe(rootContent);

      // Test memory file
      const memoriesDir = join(testDir, ".agents", "memories");
      await ensureDir(memoriesDir);
      const memoryContent = "# Memory Agent";
      await writeFileContent(join(memoriesDir, "memory.md"), memoryContent);

      const memoryRule = await AgentsMdRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "memory.md",
      });

      expect(memoryRule.getFileContent()).toBe(memoryContent);
    });
  });

  describe("fromRulesyncRule", () => {
    it("should create AgentsMdRule from RulesyncRule", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: ".agents/memories",
        relativeFilePath: "test.md",
        frontmatter: {},
        body: "# Test Agent\n\nAgent configuration content.",
      });

      const rule = AgentsMdRule.fromRulesyncRule({
        outputRoot: testDir,
        rulesyncRule,
      });

      expect(rule.getFileContent()).toBe("# Test Agent\n\nAgent configuration content.");
    });

    it("should handle validation parameter", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: ".agents/memories",
        relativeFilePath: "test.md",
        frontmatter: {},
        body: "# Test Agent\n\nContent",
      });

      const rule = AgentsMdRule.fromRulesyncRule({
        outputRoot: testDir,
        rulesyncRule,
        validate: false,
      });

      expect(rule.getFileContent()).toBe("# Test Agent\n\nContent");
    });

    it("should handle subprojectPath from agentsmd field", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          root: false,
          targets: ["agentsmd"],
          agentsmd: {
            subprojectPath: "packages/my-app",
          },
        },
        body: "# Subproject Agent\n\nContent for subproject.",
      });

      const rule = AgentsMdRule.fromRulesyncRule({
        outputRoot: testDir,
        rulesyncRule,
      });

      expect(rule.getFileContent()).toBe("# Subproject Agent\n\nContent for subproject.");
      expect(rule.getRelativeDirPath()).toBe("packages/my-app");
      expect(rule.getRelativeFilePath()).toBe("AGENTS.md");
    });

    it("should ignore subprojectPath for root rules", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          root: true,
          targets: ["agentsmd"],
          agentsmd: {
            subprojectPath: "packages/my-app", // Should be ignored
          },
        },
        body: "# Root Agent\n\nRoot content.",
      });

      const rule = AgentsMdRule.fromRulesyncRule({
        outputRoot: testDir,
        rulesyncRule,
      });

      expect(rule.getFileContent()).toBe("# Root Agent\n\nRoot content.");
      expect(rule.getRelativeDirPath()).toBe(".");
      expect(rule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(rule.isRoot()).toBe(true);
    });

    it("should handle empty subprojectPath", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          root: false,
          targets: ["agentsmd"],
          agentsmd: {
            subprojectPath: "",
          },
        },
        body: "# Empty Subproject\n\nContent.",
      });

      const rule = AgentsMdRule.fromRulesyncRule({
        outputRoot: testDir,
        rulesyncRule,
      });

      expect(rule.getFileContent()).toBe("# Empty Subproject\n\nContent.");
      expect(rule.getRelativeDirPath()).toBe(".agents/memories");
      expect(rule.getRelativeFilePath()).toBe("test.md");
    });

    it("should handle complex nested subprojectPath", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "nested.md",
        frontmatter: {
          root: false,
          targets: ["agentsmd"],
          agentsmd: {
            subprojectPath: "packages/apps/my-app/src",
          },
        },
        body: "# Nested Subproject\n\nDeeply nested content.",
      });

      const rule = AgentsMdRule.fromRulesyncRule({
        outputRoot: testDir,
        rulesyncRule,
      });

      expect(rule.getFileContent()).toBe("# Nested Subproject\n\nDeeply nested content.");
      expect(rule.getRelativeDirPath()).toBe("packages/apps/my-app/src");
      expect(rule.getRelativeFilePath()).toBe("AGENTS.md");
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert AgentsMdRule to RulesyncRule", () => {
      const rule = new AgentsMdRule({
        outputRoot: testDir,
        relativeDirPath: ".agents/memories",
        relativeFilePath: "test.md",
        fileContent: "# Test Agent\n\nAgent configuration.",
      });

      const rulesyncRule = rule.toRulesyncRule();

      expect(rulesyncRule.getBody()).toBe("# Test Agent\n\nAgent configuration.");
      expect(rulesyncRule.getFrontmatter()).toEqual({
        root: false,
        targets: ["*"],
        description: undefined,
        globs: [],
      });
    });

    it("should handle root agent file conversion", () => {
      const rule = new AgentsMdRule({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
        fileContent: "# Root Agent\n\nRoot configuration.",
        root: true,
      });

      const rulesyncRule = rule.toRulesyncRule();

      expect(rulesyncRule.getBody()).toBe("# Root Agent\n\nRoot configuration.");
      expect(rulesyncRule.getFrontmatter()).toEqual({
        root: true,
        targets: ["*"],
        description: undefined,
        globs: ["**/*"],
      });
    });
  });

  describe("nested AGENTS.md files", () => {
    it("should match only nested subproject files, against a real tree", async () => {
      // Asserting on the returned patterns alone would not catch a pattern that
      // silently matches nothing, so run them against actual files.
      for (const relativePath of [
        "AGENTS.md",
        join("packages", "api", "AGENTS.md"),
        join("packages", "api", "src", "AGENTS.md"),
        join("node_modules", "dep", "AGENTS.md"),
        join("vendor", "lib", "AGENTS.md"),
        join("dist", "AGENTS.md"),
        join(".agents", "AGENTS.md"),
        join(".agents", "memories", "AGENTS.md"),
      ]) {
        await writeFileContent(join(testDir, relativePath), "# rule");
      }

      const patterns = AgentsMdRule.getNestedFilePatterns({ outputRoot: testDir });
      const matched = await findFilesByGlobs(patterns.include, {
        type: "file",
        followSymbolicLinks: false,
        ignore: patterns.ignore,
      });

      expect(
        matched.map((filePath) => toPosixPath(relative(testDir, filePath))).toSorted(),
      ).toEqual(["packages/api/AGENTS.md", "packages/api/src/AGENTS.md"]);
    });

    it("should not follow symlinks out of the project", async () => {
      // A repository can commit a symlink, so following one would copy a file
      // from outside the project into version-controlled `.rulesync/rules/`.
      const outsideDir = join(testDir, "..", `outside-${basename(testDir)}`);
      await ensureDir(outsideDir);
      await writeFileContent(join(outsideDir, "secret.md"), "SECRET");
      await ensureDir(join(testDir, "docs"));
      await symlink(join(outsideDir, "secret.md"), join(testDir, "docs", "AGENTS.md"));
      await symlink(outsideDir, join(testDir, "linked"));

      const patterns = AgentsMdRule.getNestedFilePatterns({ outputRoot: testDir });
      const matched = await findFilesByGlobs(patterns.include, {
        type: "file",
        followSymbolicLinks: false,
        ignore: patterns.ignore,
      });

      expect(matched).toEqual([]);
      await rm(outsideDir, { recursive: true, force: true });
    });

    it("should import a nested AGENTS.md as a non-root rule scoped to its directory", async () => {
      const subprojectDir = join(testDir, "packages", "api");
      await ensureDir(subprojectDir);
      await writeFileContent(join(subprojectDir, "AGENTS.md"), "# API\n\nAPI instructions.");

      const rule = await AgentsMdRule.fromFile({
        outputRoot: testDir,
        relativeDirPath: join("packages", "api"),
        relativeFilePath: "AGENTS.md",
      });

      expect(rule.isRoot()).toBe(false);
      expect(rule.getSubprojectPath()).toBe("packages/api");
      expect(rule.getFileContent()).toBe("# API\n\nAPI instructions.");
    });

    it("should round-trip the subproject scope through the rulesync rule", async () => {
      const subprojectDir = join(testDir, "packages", "api");
      await ensureDir(subprojectDir);
      await writeFileContent(join(subprojectDir, "AGENTS.md"), "# API\n\nAPI instructions.");

      const rulesyncRule = (
        await AgentsMdRule.fromFile({
          outputRoot: testDir,
          relativeDirPath: join("packages", "api"),
          relativeFilePath: "AGENTS.md",
        })
      ).toRulesyncRule();

      // Every nested file is named AGENTS.md, so the rulesync file is named
      // after the directory it scopes.
      expect(rulesyncRule.getRelativeFilePath()).toBe("packages-api.md");
      expect(rulesyncRule.getFrontmatter()).toMatchObject({
        root: false,
        globs: ["packages/api/**/*"],
        agentsmd: { subprojectPath: "packages/api" },
      });

      // Back out to the same place on the next generate.
      const regenerated = AgentsMdRule.fromRulesyncRule({ outputRoot: testDir, rulesyncRule });
      expect(regenerated.getRelativeDirPath()).toBe(join("packages", "api"));
      expect(regenerated.getRelativeFilePath()).toBe("AGENTS.md");
    });

    it("should not treat the project root file or a memories file as a subproject", async () => {
      await writeFileContent(join(testDir, "AGENTS.md"), "# Root");
      const memoriesDir = join(testDir, ".agents", "memories");
      await ensureDir(memoriesDir);
      await writeFileContent(join(memoriesDir, "AGENTS.md"), "# Memory");

      const rootRule = await AgentsMdRule.fromFile({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
      });
      expect(rootRule.isRoot()).toBe(true);
      expect(rootRule.getSubprojectPath()).toBeUndefined();

      const memoryRule = await AgentsMdRule.fromFile({
        outputRoot: testDir,
        relativeDirPath: join(".agents", "memories"),
        relativeFilePath: "AGENTS.md",
      });
      expect(memoryRule.isRoot()).toBe(false);
      expect(memoryRule.getSubprojectPath()).toBeUndefined();
    });
  });

  describe("validate", () => {
    it("should always return success for any content", () => {
      const rule = new AgentsMdRule({
        outputRoot: testDir,
        relativeDirPath: ".agents/memories",
        relativeFilePath: "test.md",
        fileContent: "# Test Agent\n\nValid content.",
      });

      const result = rule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });

    it("should return success for empty content", () => {
      const rule = new AgentsMdRule({
        outputRoot: testDir,
        relativeDirPath: ".agents/memories",
        relativeFilePath: "test.md",
        fileContent: "",
      });

      const result = rule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });

    it("should return success for malformed markdown", () => {
      const rule = new AgentsMdRule({
        outputRoot: testDir,
        relativeDirPath: ".agents/memories",
        relativeFilePath: "test.md",
        fileContent: "# Unclosed heading\nSome text without proper structure\n### Random heading",
      });

      const result = rule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });

    it("should return success for very long content", () => {
      const longContent = "# Long Agent\n\n" + "A".repeat(10000);
      const rule = new AgentsMdRule({
        outputRoot: testDir,
        relativeDirPath: ".agents/memories",
        relativeFilePath: "test.md",
        fileContent: longContent,
      });

      const result = rule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });
  });

  describe("file operations", () => {
    it("should handle files with special characters", async () => {
      const memoriesDir = join(testDir, ".agents", "memories");
      await ensureDir(memoriesDir);

      const content = "# Special Agent\n\nContent with special chars: éñüñ";
      await writeFileContent(join(memoriesDir, "special-char.md"), content);

      const rule = await AgentsMdRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "special-char.md",
      });

      expect(rule.getFileContent()).toBe(content);
    });

    it("should handle nested directory structure", async () => {
      const nestedDir = join(testDir, ".agents", "memories", "nested");
      await ensureDir(nestedDir);

      const content = "# Nested Agent\n\nNested configuration.";
      await writeFileContent(join(nestedDir, "nested.md"), content);

      const rule = await AgentsMdRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "nested/nested.md",
      });

      expect(rule.getFileContent()).toBe(content);
    });
  });

  describe("getSettablePaths", () => {
    it("should return correct paths for root and nonRoot", () => {
      const paths = AgentsMdRule.getSettablePaths();

      expect(paths.root).toEqual({
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
      });

      expect(paths.nonRoot).toEqual({
        relativeDirPath: ".agents/memories",
      });
    });

    it("should have consistent paths structure", () => {
      const paths = AgentsMdRule.getSettablePaths();

      expect(paths).toHaveProperty("root");
      expect(paths).toHaveProperty("nonRoot");
      expect(paths.root).toHaveProperty("relativeDirPath");
      expect(paths.root).toHaveProperty("relativeFilePath");
      expect(paths.nonRoot).toHaveProperty("relativeDirPath");
    });
  });

  describe("isTargetedByRulesyncRule", () => {
    it("should return true for rules targeting agentsmd", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: ".agents/memories",
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["agentsmd"],
        },
        body: "Test content",
      });

      expect(AgentsMdRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should return true for rules targeting all tools (*)", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: ".agents/memories",
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["*"],
        },
        body: "Test content",
      });

      expect(AgentsMdRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should return false for rules not targeting agentsmd", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: ".agents/memories",
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["cursor", "copilot"],
        },
        body: "Test content",
      });

      expect(AgentsMdRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(false);
    });

    it("should return false for empty targets", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: ".agents/memories",
        relativeFilePath: "test.md",
        frontmatter: {
          targets: [],
        },
        body: "Test content",
      });

      expect(AgentsMdRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(false);
    });

    it("should handle mixed targets including agentsmd", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: ".agents/memories",
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["cursor", "agentsmd", "copilot"],
        },
        body: "Test content",
      });

      expect(AgentsMdRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should handle undefined targets in frontmatter", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: ".agents/memories",
        relativeFilePath: "test.md",
        frontmatter: {},
        body: "Test content",
      });

      expect(AgentsMdRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("should handle empty file content", async () => {
      const memoriesDir = join(testDir, ".agents", "memories");
      await ensureDir(memoriesDir);

      await writeFileContent(join(memoriesDir, "empty.md"), "");

      const rule = await AgentsMdRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "empty.md",
      });

      expect(rule.getFileContent()).toBe("");
      expect(rule.validate().success).toBe(true);
    });

    it("should handle file with only whitespace", async () => {
      const memoriesDir = join(testDir, ".agents", "memories");
      await ensureDir(memoriesDir);

      const content = "   \n\n\t  \n";
      await writeFileContent(join(memoriesDir, "whitespace.md"), content);

      const rule = await AgentsMdRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "whitespace.md",
      });

      expect(rule.getFileContent()).toBe(content);
      expect(rule.validate().success).toBe(true);
    });

    it("should handle very large file content", () => {
      const largeContent = "# Large Agent\n\n" + "Content ".repeat(100000);
      const rule = new AgentsMdRule({
        outputRoot: testDir,
        relativeDirPath: ".agents/memories",
        relativeFilePath: "large.md",
        fileContent: largeContent,
      });

      expect(rule.getFileContent()).toBe(largeContent);
      expect(rule.validate().success).toBe(true);
    });
  });
});
