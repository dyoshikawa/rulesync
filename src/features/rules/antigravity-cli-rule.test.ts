import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
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
    it("should return root GEMINI.md and nonRoot .agents/rules for project scope", () => {
      const paths = AntigravityCliRule.getSettablePaths();

      expect(paths.root.relativeDirPath).toBe(".");
      expect(paths.root.relativeFilePath).toBe("GEMINI.md");
      const nonRoot = (paths as { nonRoot: { relativeDirPath: string } }).nonRoot;
      expect(nonRoot.relativeDirPath).toBe(join(".agents", "rules"));
    });

    it("should return global root path under .gemini/GEMINI.md for global scope", () => {
      const paths = AntigravityCliRule.getSettablePaths({ global: true });

      expect(paths.root.relativeDirPath).toBe(".gemini");
      expect(paths.root.relativeFilePath).toBe("GEMINI.md");
    });
  });

  describe("fromRulesyncRule", () => {
    it("should place a root rule in root GEMINI.md", () => {
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
      expect(cliRule.getRelativeFilePath()).toBe("GEMINI.md");
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
    it("should always return success", () => {
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
