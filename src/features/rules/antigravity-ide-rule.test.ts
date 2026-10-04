import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { AntigravityCliRule } from "./antigravity-cli-rule.js";
import { AntigravityIdeRule } from "./antigravity-ide-rule.js";
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

describe("AntigravityIdeRule", () => {
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
    it("should return root AGENTS.md and nonRoot .agents/rules paths for project scope", () => {
      const paths = AntigravityIdeRule.getSettablePaths();

      const root = (paths as { root: { relativeDirPath: string; relativeFilePath: string } }).root;
      expect(root.relativeDirPath).toBe(".");
      expect(root.relativeFilePath).toBe("AGENTS.md");
      const nonRoot = (paths as { nonRoot: { relativeDirPath: string } }).nonRoot;
      expect(nonRoot.relativeDirPath).toBe(join(".agents", "rules"));
    });

    it("should return global root path under .gemini/GEMINI.md for global scope", () => {
      const paths = AntigravityIdeRule.getSettablePaths({ global: true });

      const root = (paths as { root: { relativeDirPath: string; relativeFilePath: string } }).root;
      expect(root.relativeDirPath).toBe(".gemini");
      expect(root.relativeFilePath).toBe("GEMINI.md");
    });

    it("should return global nonRoot path under .gemini/config/rules for global scope", () => {
      const paths = AntigravityIdeRule.getSettablePaths({ global: true });

      expect(paths.nonRoot.relativeDirPath).toBe(join(".gemini", "config", "rules"));
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
      const ideRule = AntigravityIdeRule.fromRulesyncRule({
        rulesyncRule: buildNonRootRule(),
        global: true,
      });

      expect(ideRule.getRelativeDirPath()).toBe(join(".gemini", "config", "rules"));
      expect(ideRule.getRelativeFilePath()).toBe("coding-style.md");
      expect(ideRule.isRoot()).toBe(false);
      expect(ideRule.getFileContent()).toBe("---\ntrigger: always_on\n---\n# Coding Style\n");
    });

    it("should write the same global files as antigravity-cli", () => {
      const rulesyncRules = [
        buildNonRootRule({
          description: "API rules",
          globs: ["src/api/**/*.ts"],
          antigravity: { trigger: "model_decision" },
        }),
        buildNonRootRule({ root: true }),
        new RulesyncRule({
          relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
          relativeFilePath: join("frontend", "styleGuide.md"),
          frontmatter: { root: false, targets: ["*"], globs: ["src/**/*.tsx"] },
          body: "# Frontend Style",
        }),
      ];

      for (const rulesyncRule of rulesyncRules) {
        const ideRule = AntigravityIdeRule.fromRulesyncRule({ rulesyncRule, global: true });
        const cliRule = AntigravityCliRule.fromRulesyncRule({ rulesyncRule, global: true });

        expect(ideRule.getRelativeDirPath()).toBe(cliRule.getRelativeDirPath());
        expect(ideRule.getRelativeFilePath()).toBe(cliRule.getRelativeFilePath());
        expect(ideRule.getFileContent()).toBe(cliRule.getFileContent());
      }
    });

    it("should flatten a nested rule into a top-level file name", () => {
      const ideRule = AntigravityIdeRule.fromRulesyncRule({
        rulesyncRule: new RulesyncRule({
          relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
          relativeFilePath: join("frontend", "style.md"),
          frontmatter: { root: false, targets: ["*"], globs: [] },
          body: "# Frontend Style",
        }),
        global: true,
      });

      expect(ideRule.getRelativeDirPath()).toBe(join(".gemini", "config", "rules"));
      expect(ideRule.getRelativeFilePath()).toBe("frontend-style.md");
    });

    it("should load a global non-root rule from .gemini/config/rules", async () => {
      await writeFileContent(
        join(testDir, ".gemini", "config", "rules", "style.md"),
        "---\ntrigger: glob\nglobs: src/**/*.ts\n---\n# Style\n",
      );

      const ideRule = await AntigravityIdeRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "style.md",
        global: true,
      });

      expect(ideRule.isRoot()).toBe(false);
      expect(ideRule.getRelativeDirPath()).toBe(join(".gemini", "config", "rules"));
      const result = ideRule.toRulesyncRule();
      expect(result.getFrontmatter().globs).toEqual(["src/**/*.ts"]);
      expect(result.getFrontmatter().antigravity?.trigger).toBe("glob");
      expect(result.getBody().trim()).toBe("# Style");
    });

    it("should load a non-root GEMINI.md in .gemini/config/rules as a non-root rule", async () => {
      await writeFileContent(
        join(testDir, ".gemini", "config", "rules", "GEMINI.md"),
        "---\ntrigger: always_on\n---\n# Named Like Root\n",
      );

      const ideRule = await AntigravityIdeRule.fromFile({
        outputRoot: testDir,
        relativeDirPath: join(".gemini", "config", "rules"),
        relativeFilePath: "GEMINI.md",
        global: true,
      });

      expect(ideRule.isRoot()).toBe(false);
      expect(ideRule.getRelativeDirPath()).toBe(join(".gemini", "config", "rules"));
    });

    it("should still load the global GEMINI.md as the root rule", async () => {
      await writeFileContent(join(testDir, ".gemini", "GEMINI.md"), "# Global Root\n");

      const ideRule = await AntigravityIdeRule.fromFile({
        outputRoot: testDir,
        relativeDirPath: ".gemini",
        relativeFilePath: "GEMINI.md",
        global: true,
      });

      expect(ideRule.isRoot()).toBe(true);
      expect(ideRule.getFileContent()).toBe("# Global Root\n");
    });

    it("should never let the orphan sweep delete files in the shared global rules directory", () => {
      const nonRootRule = AntigravityIdeRule.forDeletion({
        relativeDirPath: join(".gemini", "config", "rules"),
        relativeFilePath: "user-rule.md",
        global: true,
      });
      const rootRule = AntigravityIdeRule.forDeletion({
        relativeDirPath: ".gemini",
        relativeFilePath: "GEMINI.md",
        global: true,
      });
      const projectRule = AntigravityIdeRule.forDeletion({
        relativeDirPath: join(".agents", "rules"),
        relativeFilePath: "style.md",
      });

      expect(nonRootRule.isRoot()).toBe(false);
      expect(nonRootRule.isDeletable()).toBe(false);
      expect(rootRule.isRoot()).toBe(true);
      expect(rootRule.isDeletable()).toBe(true);
      expect(projectRule.isDeletable()).toBe(true);
    });
  });

  describe("fromRulesyncRule", () => {
    it("should place a non-root rule in .agents/rules with antigravity trigger frontmatter", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "GlobRule.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          globs: ["src/**/*.ts"],
        },
        body: "# Glob Rule\n\nBody content.",
      });

      const ideRule = AntigravityIdeRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(ideRule).toBeInstanceOf(AntigravityIdeRule);
      expect(ideRule.getRelativeDirPath()).toBe(join(".agents", "rules"));
      // Filename is kebab-cased.
      expect(ideRule.getRelativeFilePath()).toBe("glob-rule.md");
      expect(ideRule.isRoot()).toBe(false);
      // Frontmatter trigger should be "glob" for a specific glob.
      expect(ideRule.getFrontmatter().trigger).toBe("glob");
      expect(ideRule.getFileContent()).toContain("trigger: glob");
      expect(ideRule.getFileContent()).toContain("# Glob Rule");
    });

    it("should produce a plain root GEMINI.md for global scope", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "overview.md",
        frontmatter: {
          root: true,
          targets: ["*"],
          globs: ["**/*"],
        },
        body: "# Global Overview\n\nPlain body.",
      });

      const ideRule = AntigravityIdeRule.fromRulesyncRule({
        rulesyncRule,
        global: true,
      });

      expect(ideRule.getRelativeDirPath()).toBe(".gemini");
      expect(ideRule.getRelativeFilePath()).toBe("GEMINI.md");
      expect(ideRule.isRoot()).toBe(true);
      // Root/global rules are plain markdown without frontmatter.
      expect(ideRule.getFileContent().trim()).toBe("# Global Overview\n\nPlain body.");
      expect(ideRule.getFileContent()).not.toContain("trigger:");
    });

    it("should produce a plain root AGENTS.md for a project-scope root rule", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "overview.md",
        frontmatter: {
          root: true,
          targets: ["*"],
          globs: ["**/*"],
        },
        body: "# Project Overview\n\nPlain body.",
      });

      const ideRule = AntigravityIdeRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(ideRule.getRelativeDirPath()).toBe(".");
      expect(ideRule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(ideRule.isRoot()).toBe(true);
      // Root rules are plain markdown without antigravity trigger frontmatter.
      expect(ideRule.getFileContent().trim()).toBe("# Project Overview\n\nPlain body.");
      expect(ideRule.getFileContent()).not.toContain("trigger:");
    });

    it("should use custom outputRoot for project scope", () => {
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

      const ideRule = AntigravityIdeRule.fromRulesyncRule({
        outputRoot: "/custom/base",
        rulesyncRule,
      });

      expect(ideRule.getFilePath()).toBe(join("/custom/base", ".agents", "rules", "custom.md"));
    });
  });

  describe("toRulesyncRule", () => {
    it("should round-trip a non-root rule with the antigravity frontmatter key", () => {
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

      const ideRule = AntigravityIdeRule.fromRulesyncRule({ rulesyncRule });
      const result = ideRule.toRulesyncRule();

      expect(result).toBeInstanceOf(RulesyncRule);
      expect(result.getFrontmatter().root).toBe(false);
      expect(result.getFrontmatter().antigravity?.trigger).toBe("glob");
      expect(result.getBody().trim()).toBe("# Round Trip\n\nContent");
    });

    it("should round-trip a global root rule as a default root RulesyncRule", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "overview.md",
        frontmatter: {
          root: true,
          targets: ["*"],
          globs: ["**/*"],
        },
        body: "# Global Root",
      });

      const ideRule = AntigravityIdeRule.fromRulesyncRule({ rulesyncRule, global: true });
      const result = ideRule.toRulesyncRule();

      expect(result).toBeInstanceOf(RulesyncRule);
      // Default conversion for a root rule does not carry the antigravity key.
      expect(result.getFrontmatter().root).toBe(true);
      expect(result.getFrontmatter().antigravity).toBeUndefined();
      expect(result.getBody().trim()).toBe("# Global Root");
    });

    it("should round-trip a project-scope root AGENTS.md as a default root RulesyncRule", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "overview.md",
        frontmatter: {
          root: true,
          targets: ["*"],
          globs: ["**/*"],
        },
        body: "# Project Root",
      });

      const ideRule = AntigravityIdeRule.fromRulesyncRule({ rulesyncRule });
      expect(ideRule.getRelativeFilePath()).toBe("AGENTS.md");

      const result = ideRule.toRulesyncRule();
      expect(result).toBeInstanceOf(RulesyncRule);
      expect(result.getFrontmatter().root).toBe(true);
      expect(result.getFrontmatter().antigravity).toBeUndefined();
      expect(result.getBody().trim()).toBe("# Project Root");
    });
  });

  describe("fromFile", () => {
    it("should read a project-root AGENTS.md as a plain root rule", async () => {
      await ensureDir(testDir);
      await writeFileContent(join(testDir, "AGENTS.md"), "# Root\n\nPlain project rule.");

      const ideRule = await AntigravityIdeRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "AGENTS.md",
      });

      expect(ideRule.isRoot()).toBe(true);
      expect(ideRule.getRelativeDirPath()).toBe(".");
      expect(ideRule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(ideRule.getFileContent().trim()).toBe("# Root\n\nPlain project rule.");
      expect(ideRule.getFileContent()).not.toContain("trigger:");
    });
  });

  describe("isTargetedByRulesyncRule", () => {
    it("should return true for wildcard target", () => {
      expect(AntigravityIdeRule.isTargetedByRulesyncRule(buildRule(["*"]))).toBe(true);
    });

    it("should return true for antigravity-ide target", () => {
      expect(AntigravityIdeRule.isTargetedByRulesyncRule(buildRule(["antigravity-ide"]))).toBe(
        true,
      );
    });

    it("should return false for cursor target", () => {
      expect(AntigravityIdeRule.isTargetedByRulesyncRule(buildRule(["cursor"]))).toBe(false);
    });

    it("should return false for the deprecated antigravity alias target", () => {
      expect(AntigravityIdeRule.isTargetedByRulesyncRule(buildRule(["antigravity"]))).toBe(false);
    });

    it("should return false for antigravity-cli target", () => {
      expect(AntigravityIdeRule.isTargetedByRulesyncRule(buildRule(["antigravity-cli"]))).toBe(
        false,
      );
    });
  });

  describe("validate", () => {
    it("should return success for valid frontmatter", () => {
      const ideRule = new AntigravityIdeRule({
        frontmatter: { trigger: "always_on" },
        relativeDirPath: join(".agents", "rules"),
        relativeFilePath: "test.md",
        body: "# Test",
      });

      const result = ideRule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });
});
