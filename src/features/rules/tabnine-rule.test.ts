import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { RulesyncRule } from "./rulesync-rule.js";
import { TabnineRule } from "./tabnine-rule.js";

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

describe("TabnineRule", () => {
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
    it("should return root TABNINE.md and nonRoot .tabnine/guidelines for project scope", () => {
      const paths = TabnineRule.getSettablePaths();

      expect(paths.root.relativeDirPath).toBe(".");
      expect(paths.root.relativeFilePath).toBe("TABNINE.md");
      expect(paths.nonRoot.relativeDirPath).toBe(join(".tabnine", "guidelines"));
    });

    it("should return root .tabnine/agent/TABNINE.md and nonRoot .tabnine/guidelines for global scope", () => {
      const paths = TabnineRule.getSettablePaths({ global: true });

      expect(paths.root.relativeDirPath).toBe(join(".tabnine", "agent"));
      expect(paths.root.relativeFilePath).toBe("TABNINE.md");
      expect(paths.nonRoot.relativeDirPath).toBe(join(".tabnine", "guidelines"));
    });

    it("should drop the tool directory when excludeToolDir is set", () => {
      const paths = TabnineRule.getSettablePaths({ global: true, excludeToolDir: true });

      expect(paths.root.relativeDirPath).toBe(".");
      expect(paths.nonRoot.relativeDirPath).toBe("guidelines");
    });
  });

  describe("fromRulesyncRule", () => {
    it("should place a root rule in root TABNINE.md", () => {
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

      const tabnineRule = TabnineRule.fromRulesyncRule({ rulesyncRule });

      expect(tabnineRule).toBeInstanceOf(TabnineRule);
      expect(tabnineRule.getRelativeDirPath()).toBe(".");
      expect(tabnineRule.getRelativeFilePath()).toBe("TABNINE.md");
      expect(tabnineRule.isRoot()).toBe(true);
      expect(tabnineRule.getFileContent().trim()).toBe("# Root Memory\n\nPlain body.");
    });

    it("should place a non-root rule in .tabnine/guidelines without frontmatter", () => {
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

      const tabnineRule = TabnineRule.fromRulesyncRule({ rulesyncRule });

      expect(tabnineRule.getRelativeDirPath()).toBe(join(".tabnine", "guidelines"));
      expect(tabnineRule.getRelativeFilePath()).toBe("coding-style.md");
      expect(tabnineRule.isRoot()).toBe(false);
      expect(tabnineRule.getFileContent().trim()).toBe("# Coding Style");
    });

    it("should place a global root rule in .tabnine/agent/TABNINE.md", () => {
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

      const tabnineRule = TabnineRule.fromRulesyncRule({ rulesyncRule, global: true });

      expect(tabnineRule.getRelativeDirPath()).toBe(join(".tabnine", "agent"));
      expect(tabnineRule.getRelativeFilePath()).toBe("TABNINE.md");
      expect(tabnineRule.isRoot()).toBe(true);
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

      const tabnineRule = TabnineRule.fromRulesyncRule({
        outputRoot: "/custom/base",
        rulesyncRule,
      });

      expect(tabnineRule.getFilePath()).toBe(
        join("/custom/base", ".tabnine", "guidelines", "custom.md"),
      );
    });
  });

  describe("fromFile", () => {
    it("should read the root TABNINE.md", async () => {
      await writeFileContent(join(testDir, "TABNINE.md"), "# Root\n");

      const tabnineRule = await TabnineRule.fromFile({ relativeFilePath: "TABNINE.md" });

      expect(tabnineRule.isRoot()).toBe(true);
      expect(tabnineRule.getRelativeDirPath()).toBe(".");
      expect(tabnineRule.getFileContent()).toBe("# Root\n");
    });

    it("should read a non-root rule from .tabnine/guidelines", async () => {
      await ensureDir(join(testDir, ".tabnine", "guidelines"));
      await writeFileContent(join(testDir, ".tabnine", "guidelines", "style.md"), "# Style\n");

      const tabnineRule = await TabnineRule.fromFile({ relativeFilePath: "style.md" });

      expect(tabnineRule.isRoot()).toBe(false);
      expect(tabnineRule.getRelativeDirPath()).toBe(join(".tabnine", "guidelines"));
      expect(tabnineRule.getFileContent()).toBe("# Style\n");
    });

    it("should read the global root from .tabnine/agent/TABNINE.md", async () => {
      await ensureDir(join(testDir, ".tabnine", "agent"));
      await writeFileContent(join(testDir, ".tabnine", "agent", "TABNINE.md"), "# Global\n");

      const tabnineRule = await TabnineRule.fromFile({
        relativeFilePath: "TABNINE.md",
        global: true,
      });

      expect(tabnineRule.isRoot()).toBe(true);
      expect(tabnineRule.getRelativeDirPath()).toBe(join(".tabnine", "agent"));
      expect(tabnineRule.getFileContent()).toBe("# Global\n");
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

      const tabnineRule = TabnineRule.fromRulesyncRule({ rulesyncRule });
      const result = tabnineRule.toRulesyncRule();

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

      const tabnineRule = TabnineRule.fromRulesyncRule({ rulesyncRule });
      const result = tabnineRule.toRulesyncRule();

      expect(result).toBeInstanceOf(RulesyncRule);
      expect(result.getFrontmatter().root).toBe(true);
      expect(result.getBody().trim()).toBe("# Root Body");
    });
  });

  describe("forDeletion", () => {
    it("should mark the root file as root", () => {
      const tabnineRule = TabnineRule.forDeletion({
        relativeDirPath: ".",
        relativeFilePath: "TABNINE.md",
      });

      expect(tabnineRule.isRoot()).toBe(true);
    });

    it("should treat a file under .tabnine/guidelines as non-root even when named TABNINE.md", () => {
      const tabnineRule = TabnineRule.forDeletion({
        relativeDirPath: join(".tabnine", "guidelines"),
        relativeFilePath: "TABNINE.md",
      });

      expect(tabnineRule.isRoot()).toBe(false);
    });
  });

  describe("isTargetedByRulesyncRule", () => {
    it("should return true for wildcard target", () => {
      expect(TabnineRule.isTargetedByRulesyncRule(buildRule(["*"]))).toBe(true);
    });

    it("should return true for tabnine target", () => {
      expect(TabnineRule.isTargetedByRulesyncRule(buildRule(["tabnine"]))).toBe(true);
    });

    it("should return false for cursor target", () => {
      expect(TabnineRule.isTargetedByRulesyncRule(buildRule(["cursor"]))).toBe(false);
    });
  });

  describe("validate", () => {
    it("should always return success", () => {
      const tabnineRule = new TabnineRule({
        relativeDirPath: ".",
        relativeFilePath: "TABNINE.md",
        fileContent: "# Test",
      });

      const result = tabnineRule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });
});
