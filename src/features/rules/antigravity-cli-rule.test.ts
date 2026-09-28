import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { AntigravityCliRule } from "./antigravity-cli-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

const buildRule = (targets: string[]): RulesyncRule =>
  new RulesyncRule({
    relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
    relativeFilePath: "test.md",
    frontmatter: {
      root: false,
      targets: targets as any,
      globs: [],
    },
    body: "# Test",
    validate: false,
  });

describe("AntigravityCliRule", () => {
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
    it("should return root AGENTS.md and nonRoot .agents/rules for project scope", () => {
      const paths = AntigravityCliRule.getSettablePaths();

      expect(paths.root.relativeDirPath).toBe(".");
      expect(paths.root.relativeFilePath).toBe("AGENTS.md");
      const nonRoot = (paths as { nonRoot: { relativeDirPath: string } }).nonRoot;
      expect(nonRoot.relativeDirPath).toBe(join(".agents", "rules"));
    });

    it("should return global root path under .gemini/GEMINI.md for global scope", () => {
      const paths = AntigravityCliRule.getSettablePaths({ global: true });

      expect(paths.root.relativeDirPath).toBe(".gemini");
      expect(paths.root.relativeFilePath).toBe("GEMINI.md");
    });

    it("should return global nonRoot path under .gemini/config/rules for global scope", () => {
      const paths = AntigravityCliRule.getSettablePaths({ global: true });

      expect(paths.nonRoot?.relativeDirPath).toBe(join(".gemini", "config", "rules"));
    });

    it("should drop the .gemini prefix from global paths when excludeToolDir is set", () => {
      const paths = AntigravityCliRule.getSettablePaths({ global: true, excludeToolDir: true });

      expect(paths.root.relativeDirPath).toBe(".");
      expect(paths.nonRoot?.relativeDirPath).toBe(join("config", "rules"));
    });
  });

  describe("global non-root rules", () => {
    const buildNonRootRule = (frontmatter: Partial<RulesyncRule["frontmatter"]> = {}) =>
      new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "coding-style.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          globs: ["**/*"],
          ...frontmatter,
        },
        body: "# Coding Style",
      });

    it("should write a plain non-root rule to .gemini/config/rules with always_on trigger", () => {
      const cliRule = AntigravityCliRule.fromRulesyncRule({
        rulesyncRule: buildNonRootRule(),
        global: true,
      });

      expect(cliRule.getRelativeDirPath()).toBe(join(".gemini", "config", "rules"));
      expect(cliRule.getRelativeFilePath()).toBe("coding-style.md");
      expect(cliRule.isRoot()).toBe(false);
      expect(cliRule.getFileContent()).toBe("---\ntrigger: always_on\n---\n# Coding Style\n");
      expect(cliRule.validate().success).toBe(true);
    });

    it("should use a glob trigger for a non-root rule with specific globs", () => {
      const cliRule = AntigravityCliRule.fromRulesyncRule({
        rulesyncRule: buildNonRootRule({ globs: ["src/**/*.ts", "test/**/*.ts"] }),
        global: true,
      });

      expect(cliRule.getFileContent()).toContain("trigger: glob");
      expect(cliRule.getFileContent()).toContain("globs: src/**/*.ts,test/**/*.ts");
    });

    it("should honor a stored antigravity trigger", () => {
      const cliRule = AntigravityCliRule.fromRulesyncRule({
        rulesyncRule: buildNonRootRule({
          description: "Use when writing tests",
          antigravity: { trigger: "model_decision" },
        }),
        global: true,
      });

      expect(cliRule.getFileContent()).toContain("trigger: model_decision");
      expect(cliRule.getFileContent()).toContain("description: Use when writing tests");
    });

    it("should keep the global root rule as plain GEMINI.md", () => {
      const cliRule = AntigravityCliRule.fromRulesyncRule({
        rulesyncRule: buildNonRootRule({ root: true }),
        global: true,
      });

      expect(cliRule.getRelativeDirPath()).toBe(".gemini");
      expect(cliRule.getRelativeFilePath()).toBe("GEMINI.md");
      expect(cliRule.getFileContent().trim()).toBe("# Coding Style");
    });

    it("should round-trip trigger and globs back to a rulesync rule", () => {
      const cliRule = AntigravityCliRule.fromRulesyncRule({
        rulesyncRule: buildNonRootRule({ globs: ["src/**/*.ts"] }),
        global: true,
      });

      const result = cliRule.toRulesyncRule();

      expect(result.getFrontmatter().root).toBe(false);
      expect(result.getFrontmatter().globs).toEqual(["src/**/*.ts"]);
      expect(result.getFrontmatter().antigravity).toEqual({
        trigger: "glob",
        globs: ["src/**/*.ts"],
      });
      expect(result.getBody().trim()).toBe("# Coding Style");
    });

    it("should load a global non-root rule from .gemini/config/rules", async () => {
      await writeFileContent(
        join(testDir, ".gemini", "config", "rules", "style.md"),
        "---\ntrigger: always_on\n---\n# Style\n",
      );

      const cliRule = await AntigravityCliRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "style.md",
        global: true,
      });

      expect(cliRule.isRoot()).toBe(false);
      expect(cliRule.getRelativeDirPath()).toBe(join(".gemini", "config", "rules"));
      const result = cliRule.toRulesyncRule();
      expect(result.getFrontmatter().globs).toEqual(["**/*"]);
      expect(result.getFrontmatter().antigravity).toEqual({ trigger: "always_on" });
      expect(result.getBody().trim()).toBe("# Style");
    });

    it("should reject a global non-root rule with invalid frontmatter", async () => {
      await writeFileContent(
        join(testDir, ".gemini", "config", "rules", "broken.md"),
        "---\ntrigger: 1\n---\n# Broken\n",
      );

      await expect(
        AntigravityCliRule.fromFile({
          outputRoot: testDir,
          relativeFilePath: "broken.md",
          global: true,
        }),
      ).rejects.toThrow("Invalid frontmatter");
    });

    it("should flatten a nested rule into a top-level file name", () => {
      const cliRule = AntigravityCliRule.fromRulesyncRule({
        rulesyncRule: new RulesyncRule({
          relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
          relativeFilePath: join("frontend", "style.md"),
          frontmatter: { root: false, targets: ["*"], globs: [] },
          body: "# Frontend Style",
        }),
        global: true,
      });

      expect(cliRule.getRelativeDirPath()).toBe(join(".gemini", "config", "rules"));
      expect(cliRule.getRelativeFilePath()).toBe("frontend-style.md");
    });

    it("should load a non-root GEMINI.md in .gemini/config/rules as a non-root rule", async () => {
      await writeFileContent(
        join(testDir, ".gemini", "config", "rules", "GEMINI.md"),
        "---\ntrigger: always_on\n---\n# Named Like Root\n",
      );

      const cliRule = await AntigravityCliRule.fromFile({
        outputRoot: testDir,
        relativeDirPath: join(".gemini", "config", "rules"),
        relativeFilePath: "GEMINI.md",
        global: true,
      });

      expect(cliRule.isRoot()).toBe(false);
      expect(cliRule.getRelativeDirPath()).toBe(join(".gemini", "config", "rules"));
    });

    it("should never let the orphan sweep delete files in the shared global rules directory", () => {
      const nonRootRule = AntigravityCliRule.forDeletion({
        relativeDirPath: join(".gemini", "config", "rules"),
        relativeFilePath: "user-rule.md",
        global: true,
      });
      const rootRule = AntigravityCliRule.forDeletion({
        relativeDirPath: ".gemini",
        relativeFilePath: "GEMINI.md",
        global: true,
      });
      const projectRule = AntigravityCliRule.forDeletion({
        relativeDirPath: join(".agents", "rules"),
        relativeFilePath: "style.md",
      });

      expect(nonRootRule.isDeletable()).toBe(false);
      expect(rootRule.isDeletable()).toBe(true);
      expect(projectRule.isDeletable()).toBe(true);
    });

    it("should mark only the global GEMINI.md as root for deletion", () => {
      const rootRule = AntigravityCliRule.forDeletion({
        relativeDirPath: ".gemini",
        relativeFilePath: "GEMINI.md",
        global: true,
      });
      const nonRootRule = AntigravityCliRule.forDeletion({
        relativeDirPath: join(".gemini", "config", "rules"),
        relativeFilePath: "GEMINI.md",
        global: true,
      });

      expect(rootRule.isRoot()).toBe(true);
      expect(nonRootRule.isRoot()).toBe(false);
    });
  });

  describe("fromRulesyncRule", () => {
    it("should place a root rule in root AGENTS.md", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "overview.md",
        frontmatter: {
          root: true,
          targets: ["*"],
          globs: ["**/*"],
        },
        body: "# Root Memory\n\nPlain body.",
      });

      const cliRule = AntigravityCliRule.fromRulesyncRule({ rulesyncRule });

      expect(cliRule).toBeInstanceOf(AntigravityCliRule);
      expect(cliRule.getRelativeDirPath()).toBe(".");
      expect(cliRule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(cliRule.isRoot()).toBe(true);
      expect(cliRule.getFileContent().trim()).toBe("# Root Memory\n\nPlain body.");
    });

    it("should place a non-root rule in .agents/rules", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "coding-style.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          globs: ["**/*.ts"],
        },
        body: "# Coding Style",
      });

      const cliRule = AntigravityCliRule.fromRulesyncRule({ rulesyncRule });

      expect(cliRule.getRelativeDirPath()).toBe(join(".agents", "rules"));
      expect(cliRule.getRelativeFilePath()).toBe("coding-style.md");
      expect(cliRule.isRoot()).toBe(false);
      expect(cliRule.getFileContent().trim()).toBe("# Coding Style");
    });

    it("should use custom outputRoot for non-root rule", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "custom.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          globs: [],
        },
        body: "# Custom",
      });

      const cliRule = AntigravityCliRule.fromRulesyncRule({
        outputRoot: "/custom/base",
        rulesyncRule,
      });

      expect(cliRule.getFilePath()).toBe(join("/custom/base", ".agents", "rules", "custom.md"));
    });
  });

  describe("toRulesyncRule", () => {
    it("should round-trip the body for a non-root rule", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "round-trip.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          globs: ["*.ts"],
        },
        body: "# Round Trip\n\nContent",
      });

      const cliRule = AntigravityCliRule.fromRulesyncRule({ rulesyncRule });
      const result = cliRule.toRulesyncRule();

      expect(result).toBeInstanceOf(RulesyncRule);
      expect(result.getFrontmatter().root).toBe(false);
      expect(result.getBody().trim()).toBe("# Round Trip\n\nContent");
    });

    it("should round-trip the body for a root rule", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "overview.md",
        frontmatter: {
          root: true,
          targets: ["*"],
          globs: ["**/*"],
        },
        body: "# Root Body",
      });

      const cliRule = AntigravityCliRule.fromRulesyncRule({ rulesyncRule });
      const result = cliRule.toRulesyncRule();

      expect(result).toBeInstanceOf(RulesyncRule);
      expect(result.getFrontmatter().root).toBe(true);
      expect(result.getBody().trim()).toBe("# Root Body");
    });
  });

  describe("isTargetedByRulesyncRule", () => {
    it("should return true for wildcard target", () => {
      expect(AntigravityCliRule.isTargetedByRulesyncRule(buildRule(["*"]))).toBe(true);
    });

    it("should return true for antigravity-cli target", () => {
      expect(AntigravityCliRule.isTargetedByRulesyncRule(buildRule(["antigravity-cli"]))).toBe(
        true,
      );
    });

    it("should return false for cursor target", () => {
      expect(AntigravityCliRule.isTargetedByRulesyncRule(buildRule(["cursor"]))).toBe(false);
    });

    it("should return false for the deprecated antigravity alias target", () => {
      expect(AntigravityCliRule.isTargetedByRulesyncRule(buildRule(["antigravity"]))).toBe(false);
    });

    it("should return false for antigravity-ide target", () => {
      expect(AntigravityCliRule.isTargetedByRulesyncRule(buildRule(["antigravity-ide"]))).toBe(
        false,
      );
    });
  });

  describe("validate", () => {
    it("should always return success for project-scope rules", () => {
      const cliRule = new AntigravityCliRule({
        relativeDirPath: ".",
        relativeFilePath: "GEMINI.md",
        fileContent: "# Test",
      });

      const result = cliRule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });
});
