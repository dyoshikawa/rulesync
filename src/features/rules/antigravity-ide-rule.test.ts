import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { AntigravityIdeRule } from "./antigravity-ide-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

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
    it("should return nonRoot path under .agents/rules for project scope", () => {
      const paths = AntigravityIdeRule.getSettablePaths();

      expect("root" in paths).toBe(false);
      const nonRoot = (paths as { nonRoot: { relativeDirPath: string } }).nonRoot;
      expect(nonRoot.relativeDirPath).toBe(join(".agents", "rules"));
    });

    it("should return global root path under .gemini/GEMINI.md for global scope", () => {
      const paths = AntigravityIdeRule.getSettablePaths({ global: true });

      const root = (paths as { root: { relativeDirPath: string; relativeFilePath: string } }).root;
      expect(root.relativeDirPath).toBe(".gemini");
      expect(root.relativeFilePath).toBe("GEMINI.md");
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
  });

  describe("isTargetedByRulesyncRule", () => {
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
