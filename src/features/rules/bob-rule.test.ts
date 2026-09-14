import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { BobRule } from "./bob-rule.js";
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

describe("BobRule", () => {
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
    it("should return root AGENTS.md and nonRoot .bob/rules for project scope", () => {
      const paths = BobRule.getSettablePaths();

      expect(paths.root.relativeDirPath).toBe(".");
      expect(paths.root.relativeFilePath).toBe("AGENTS.md");
      expect(paths.nonRoot.relativeDirPath).toBe(join(".bob", "rules"));
    });

    it("should return root .bob/AGENTS.md and nonRoot .bob/rules for global scope", () => {
      const paths = BobRule.getSettablePaths({ global: true });

      expect(paths.root.relativeDirPath).toBe(".bob");
      expect(paths.root.relativeFilePath).toBe("AGENTS.md");
      expect(paths.nonRoot.relativeDirPath).toBe(join(".bob", "rules"));
    });

    it("should drop the tool directory when excludeToolDir is set", () => {
      const paths = BobRule.getSettablePaths({ global: true, excludeToolDir: true });

      expect(paths.root.relativeDirPath).toBe(".");
      expect(paths.nonRoot.relativeDirPath).toBe("rules");
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

      const bobRule = BobRule.fromRulesyncRule({ rulesyncRule });

      expect(bobRule).toBeInstanceOf(BobRule);
      expect(bobRule.getRelativeDirPath()).toBe(".");
      expect(bobRule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(bobRule.isRoot()).toBe(true);
      expect(bobRule.getFileContent().trim()).toBe("# Root Memory\n\nPlain body.");
    });

    it("should place a non-root rule in .bob/rules without frontmatter", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "coding-style.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "Coding style",
          globs: ["**/*.ts"],
        },
        body: "# Coding Style",
      });

      const bobRule = BobRule.fromRulesyncRule({ rulesyncRule });

      expect(bobRule.getRelativeDirPath()).toBe(join(".bob", "rules"));
      expect(bobRule.getRelativeFilePath()).toBe("coding-style.md");
      expect(bobRule.isRoot()).toBe(false);
      expect(bobRule.getFileContent().trim()).toBe("# Coding Style");
    });

    it("should place a global root rule in .bob/AGENTS.md", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "overview.md",
        frontmatter: {
          root: true,
          targets: ["*"],
          globs: ["**/*"],
        },
        body: "# Global",
      });

      const bobRule = BobRule.fromRulesyncRule({ rulesyncRule, global: true });

      expect(bobRule.getRelativeDirPath()).toBe(".bob");
      expect(bobRule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(bobRule.isRoot()).toBe(true);
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

      const bobRule = BobRule.fromRulesyncRule({
        outputRoot: "/custom/base",
        rulesyncRule,
      });

      expect(bobRule.getFilePath()).toBe(join("/custom/base", ".bob", "rules", "custom.md"));
    });
  });

  describe("fromFile", () => {
    it("should read the root AGENTS.md", async () => {
      await writeFileContent(join(testDir, "AGENTS.md"), "# Root\n");

      const bobRule = await BobRule.fromFile({ relativeFilePath: "AGENTS.md" });

      expect(bobRule.isRoot()).toBe(true);
      expect(bobRule.getRelativeDirPath()).toBe(".");
      expect(bobRule.getFileContent()).toBe("# Root\n");
    });

    it("should read a non-root rule from .bob/rules", async () => {
      await ensureDir(join(testDir, ".bob", "rules"));
      await writeFileContent(join(testDir, ".bob", "rules", "style.md"), "# Style\n");

      const bobRule = await BobRule.fromFile({ relativeFilePath: "style.md" });

      expect(bobRule.isRoot()).toBe(false);
      expect(bobRule.getRelativeDirPath()).toBe(join(".bob", "rules"));
      expect(bobRule.getFileContent()).toBe("# Style\n");
    });

    it("should read the global root from .bob/AGENTS.md", async () => {
      await ensureDir(join(testDir, ".bob"));
      await writeFileContent(join(testDir, ".bob", "AGENTS.md"), "# Global\n");

      const bobRule = await BobRule.fromFile({ relativeFilePath: "AGENTS.md", global: true });

      expect(bobRule.isRoot()).toBe(true);
      expect(bobRule.getRelativeDirPath()).toBe(".bob");
      expect(bobRule.getFileContent()).toBe("# Global\n");
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

      const bobRule = BobRule.fromRulesyncRule({ rulesyncRule });
      const result = bobRule.toRulesyncRule();

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

      const bobRule = BobRule.fromRulesyncRule({ rulesyncRule });
      const result = bobRule.toRulesyncRule();

      expect(result).toBeInstanceOf(RulesyncRule);
      expect(result.getFrontmatter().root).toBe(true);
      expect(result.getBody().trim()).toBe("# Root Body");
    });
  });

  describe("forDeletion", () => {
    it("should mark the root file as root", () => {
      const bobRule = BobRule.forDeletion({
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
      });

      expect(bobRule.isRoot()).toBe(true);
    });

    it("should treat a file under .bob/rules as non-root even when named AGENTS.md", () => {
      const bobRule = BobRule.forDeletion({
        relativeDirPath: join(".bob", "rules"),
        relativeFilePath: "AGENTS.md",
      });

      expect(bobRule.isRoot()).toBe(false);
    });
  });

  describe("isTargetedByRulesyncRule", () => {
    it("should return true for wildcard target", () => {
      expect(BobRule.isTargetedByRulesyncRule(buildRule(["*"]))).toBe(true);
    });

    it("should return true for bob target", () => {
      expect(BobRule.isTargetedByRulesyncRule(buildRule(["bob"]))).toBe(true);
    });

    it("should return false for cursor target", () => {
      expect(BobRule.isTargetedByRulesyncRule(buildRule(["cursor"]))).toBe(false);
    });
  });

  describe("validate", () => {
    it("should always return success", () => {
      const bobRule = new BobRule({
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
        fileContent: "# Test",
      });

      const result = bobRule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });
});
