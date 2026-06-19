import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_OVERVIEW_FILE_NAME,
  RULESYNC_RELATIVE_DIR_PATH,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { parseFrontmatter } from "../../utils/frontmatter.js";
import { QwencodeRule } from "./qwencode-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("QwencodeRule", () => {
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
    it("should create a non-root instance from frontmatter and body", () => {
      const qwencodeRule = new QwencodeRule({
        relativeDirPath: ".qwen/rules",
        relativeFilePath: "test-rule.md",
        frontmatter: {},
        body: "# Test Rule\n\nThis is a test rule.",
      });

      expect(qwencodeRule).toBeInstanceOf(QwencodeRule);
      expect(qwencodeRule.getRelativeDirPath()).toBe(".qwen/rules");
      expect(qwencodeRule.getRelativeFilePath()).toBe("test-rule.md");
      expect(qwencodeRule.getBody()).toBe("# Test Rule\n\nThis is a test rule.");
      expect(qwencodeRule.isRoot()).toBe(false);
    });

    it("should emit baseline (no frontmatter) rules as plain Markdown", () => {
      const qwencodeRule = new QwencodeRule({
        relativeDirPath: ".qwen/rules",
        relativeFilePath: "baseline.md",
        frontmatter: {},
        body: "# Baseline",
      });

      // No `paths`/`description` => no frontmatter block.
      expect(qwencodeRule.getFileContent()).toBe("# Baseline");
    });

    it("should emit conditional rules with paths frontmatter", () => {
      const qwencodeRule = new QwencodeRule({
        relativeDirPath: ".qwen/rules",
        relativeFilePath: "conditional.md",
        frontmatter: { paths: ["src/**/*.ts"], description: "TS rule" },
        body: "# Conditional",
      });

      const { frontmatter, body } = parseFrontmatter(qwencodeRule.getFileContent());
      expect(frontmatter.paths).toEqual(["src/**/*.ts"]);
      expect(frontmatter.description).toBe("TS rule");
      expect(body.trim()).toBe("# Conditional");
    });

    it("should create a root instance with fileContent", () => {
      const qwencodeRule = new QwencodeRule({
        relativeDirPath: ".",
        relativeFilePath: "QWEN.md",
        fileContent: "# Root Rule",
        root: true,
      });

      expect(qwencodeRule.isRoot()).toBe(true);
      expect(qwencodeRule.getFileContent()).toBe("# Root Rule");
    });

    it("should skip validation when requested", () => {
      expect(() => {
        const _instance = new QwencodeRule({
          relativeDirPath: ".qwen/rules",
          relativeFilePath: "test-rule.md",
          frontmatter: {},
          body: "",
          validate: false,
        });
      }).not.toThrow();
    });
  });

  describe("fromFile", () => {
    it("should create instance from existing non-root file with frontmatter", async () => {
      const rulesDir = join(testDir, ".qwen/rules");
      await ensureDir(rulesDir);
      const testContent = "---\npaths:\n  - src/**/*.ts\ndescription: TS rule\n---\n\n# Rule body";
      await writeFileContent(join(rulesDir, "test.md"), testContent);

      const qwencodeRule = await QwencodeRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "test.md",
      });

      expect(qwencodeRule.getRelativeDirPath()).toBe(".qwen/rules");
      expect(qwencodeRule.getRelativeFilePath()).toBe("test.md");
      expect(qwencodeRule.getFrontmatter()?.paths).toEqual(["src/**/*.ts"]);
      expect(qwencodeRule.getFrontmatter()?.description).toBe("TS rule");
      expect(qwencodeRule.getBody()).toBe("# Rule body");
      expect(qwencodeRule.isRoot()).toBe(false);
    });

    it("should create instance from baseline non-root file without frontmatter", async () => {
      const rulesDir = join(testDir, ".qwen/rules");
      await ensureDir(rulesDir);
      const testContent = "# Baseline rule body";
      await writeFileContent(join(rulesDir, "baseline.md"), testContent);

      const qwencodeRule = await QwencodeRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "baseline.md",
      });

      expect(qwencodeRule.getRelativeDirPath()).toBe(".qwen/rules");
      expect(qwencodeRule.getBody()).toBe("# Baseline rule body");
      expect(qwencodeRule.getFrontmatter()?.paths).toBeUndefined();
      expect(qwencodeRule.isRoot()).toBe(false);
    });

    it("should create instance from existing root file (QWEN.md)", async () => {
      const testContent = "# Root Rule from File\n\nThis is the root QWEN.md file.";
      await writeFileContent(join(testDir, "QWEN.md"), testContent);

      const qwencodeRule = await QwencodeRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "QWEN.md",
      });

      expect(qwencodeRule.getRelativeDirPath()).toBe(".");
      expect(qwencodeRule.getRelativeFilePath()).toBe("QWEN.md");
      expect(qwencodeRule.getFileContent()).toBe(testContent);
      expect(qwencodeRule.getFilePath()).toBe(join(testDir, "QWEN.md"));
      expect(qwencodeRule.isRoot()).toBe(true);
    });

    it("should read non-root rules from ~/.qwen/rules in global mode", async () => {
      const globalRulesDir = join(testDir, ".qwen/rules");
      await ensureDir(globalRulesDir);
      const testContent = "# Global rule";
      await writeFileContent(join(globalRulesDir, "global.md"), testContent);

      const qwencodeRule = await QwencodeRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "global.md",
        global: true,
      });

      expect(qwencodeRule.getRelativeDirPath()).toBe(".qwen/rules");
      expect(qwencodeRule.getBody()).toBe("# Global rule");
      expect(qwencodeRule.isRoot()).toBe(false);
    });

    it("should throw error when file does not exist", async () => {
      await expect(
        QwencodeRule.fromFile({
          outputRoot: testDir,
          relativeFilePath: "nonexistent.md",
        }),
      ).rejects.toThrow();
    });

    it("should throw error when root file does not exist", async () => {
      await expect(
        QwencodeRule.fromFile({
          outputRoot: testDir,
          relativeFilePath: "QWEN.md",
        }),
      ).rejects.toThrow();
    });
  });

  describe("fromRulesyncRule", () => {
    it("should create a conditional rule from non-root RulesyncRule with globs", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "test-rule.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "Test rule",
          globs: ["src/**/*.ts", "lib/**/*.ts"],
        },
        body: "# Test RulesyncRule\n\nContent from rulesync.",
      });

      const qwencodeRule = QwencodeRule.fromRulesyncRule({ rulesyncRule });

      expect(qwencodeRule.getRelativeDirPath()).toBe(".qwen/rules");
      expect(qwencodeRule.getRelativeFilePath()).toBe("test-rule.md");
      expect(qwencodeRule.getFrontmatter()?.paths).toEqual(["src/**/*.ts", "lib/**/*.ts"]);
      expect(qwencodeRule.getFrontmatter()?.description).toBe("Test rule");
      expect(qwencodeRule.getBody()).toBe("# Test RulesyncRule\n\nContent from rulesync.");
      expect(qwencodeRule.isRoot()).toBe(false);
    });

    it("should create a baseline rule (no paths) when globs are empty", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "baseline.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "Baseline",
          globs: [],
        },
        body: "# Baseline body",
      });

      const qwencodeRule = QwencodeRule.fromRulesyncRule({ rulesyncRule });

      expect(qwencodeRule.getRelativeDirPath()).toBe(".qwen/rules");
      expect(qwencodeRule.getFrontmatter()?.paths).toBeUndefined();
      expect(qwencodeRule.getFrontmatter()?.description).toBe("Baseline");
    });

    it("should treat universal globs (**/*) as baseline (no paths)", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "universal.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "",
          globs: ["**/*"],
        },
        body: "# Universal body",
      });

      const qwencodeRule = QwencodeRule.fromRulesyncRule({ rulesyncRule });

      expect(qwencodeRule.getFrontmatter()?.paths).toBeUndefined();
    });

    it("should create instance from root RulesyncRule", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "root-rule.md",
        frontmatter: {
          root: true,
          targets: ["*"],
          description: "Root rule",
          globs: ["**/*"],
        },
        body: "# Root RulesyncRule\n\nContent from root rulesync.",
      });

      const qwencodeRule = QwencodeRule.fromRulesyncRule({ rulesyncRule });

      expect(qwencodeRule.getRelativeDirPath()).toBe(".");
      expect(qwencodeRule.getRelativeFilePath()).toBe("QWEN.md");
      expect(qwencodeRule.getFileContent()).toBe(
        "# Root RulesyncRule\n\nContent from root rulesync.",
      );
      expect(qwencodeRule.isRoot()).toBe(true);
    });

    it("should emit non-root rules to ~/.qwen/rules in global mode", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "global-rule.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "Global rule",
          globs: ["docs/**/*.md"],
        },
        body: "# Global rule",
      });

      const qwencodeRule = QwencodeRule.fromRulesyncRule({ rulesyncRule, global: true });

      expect(qwencodeRule.getRelativeDirPath()).toBe(".qwen/rules");
      expect(qwencodeRule.getFrontmatter()?.paths).toEqual(["docs/**/*.md"]);
      expect(qwencodeRule.isRoot()).toBe(false);
    });

    it("should use custom outputRoot", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "custom-base.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "",
          globs: [],
        },
        body: "# Custom Base Directory",
      });

      const qwencodeRule = QwencodeRule.fromRulesyncRule({
        outputRoot: "/custom/base",
        rulesyncRule,
      });

      expect(qwencodeRule.getFilePath()).toBe("/custom/base/.qwen/rules/custom-base.md");
      expect(qwencodeRule.isRoot()).toBe(false);
    });

    it("should handle undefined root frontmatter as false", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "no-root-frontmatter.md",
        frontmatter: {
          targets: ["*"],
          description: "",
          globs: [],
        } as any,
        body: "# No Root Frontmatter",
      });

      const qwencodeRule = QwencodeRule.fromRulesyncRule({ rulesyncRule });

      expect(qwencodeRule.isRoot()).toBe(false);
      expect(qwencodeRule.getRelativeDirPath()).toBe(".qwen/rules");
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert conditional QwencodeRule to RulesyncRule with globs", () => {
      const qwencodeRule = new QwencodeRule({
        outputRoot: testDir,
        relativeDirPath: ".qwen/rules",
        relativeFilePath: "convert-test.md",
        frontmatter: { paths: ["src/**/*.ts"], description: "TS rule" },
        body: "# Convert Test",
      });

      const rulesyncRule = qwencodeRule.toRulesyncRule();

      expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
      expect(rulesyncRule.getRelativeDirPath()).toBe(RULESYNC_RULES_RELATIVE_DIR_PATH);
      expect(rulesyncRule.getRelativeFilePath()).toBe("convert-test.md");
      expect(rulesyncRule.getBody()).toBe("# Convert Test");

      const frontmatter = rulesyncRule.getFrontmatter();
      expect(frontmatter.root).toBe(false);
      expect(frontmatter.targets).toEqual(["*"]);
      expect(frontmatter.description).toBe("TS rule");
      expect(frontmatter.globs).toEqual(["src/**/*.ts"]);
    });

    it("should convert baseline QwencodeRule to RulesyncRule with empty globs", () => {
      const qwencodeRule = new QwencodeRule({
        outputRoot: testDir,
        relativeDirPath: ".qwen/rules",
        relativeFilePath: "baseline.md",
        frontmatter: {},
        body: "# Baseline",
      });

      const rulesyncRule = qwencodeRule.toRulesyncRule();

      const frontmatter = rulesyncRule.getFrontmatter();
      expect(frontmatter.globs).toEqual([]);
      expect(frontmatter.description).toBeUndefined();
    });

    it("should convert root QwencodeRule to RulesyncRule", () => {
      const qwencodeRule = new QwencodeRule({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "QWEN.md",
        fileContent: "# Root Convert Test\n\nThis root will be converted.",
        root: true,
      });

      const rulesyncRule = qwencodeRule.toRulesyncRule();

      expect(rulesyncRule.getRelativeDirPath()).toBe(RULESYNC_RULES_RELATIVE_DIR_PATH);
      expect(rulesyncRule.getRelativeFilePath()).toBe(RULESYNC_OVERVIEW_FILE_NAME);
      expect(rulesyncRule.getBody()).toBe("# Root Convert Test\n\nThis root will be converted.");

      const frontmatter = rulesyncRule.getFrontmatter();
      expect(frontmatter.root).toBe(true);
      expect(frontmatter.globs).toEqual(["**/*"]);
    });
  });

  describe("validate", () => {
    it("should return success for valid frontmatter", () => {
      const qwencodeRule = new QwencodeRule({
        relativeDirPath: ".qwen/rules",
        relativeFilePath: "validation-test.md",
        frontmatter: { paths: ["**/*.ts"] },
        body: "# Any content is valid",
      });

      const result = qwencodeRule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return success for root content", () => {
      const qwencodeRule = new QwencodeRule({
        relativeDirPath: ".",
        relativeFilePath: "QWEN.md",
        fileContent: "# Root Content\n\nThis is root content.",
        root: true,
      });

      const result = qwencodeRule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });

  describe("getSettablePaths", () => {
    it("should return correct paths for root and nonRoot (project scope)", () => {
      const paths = QwencodeRule.getSettablePaths();

      expect(paths.root).toEqual({
        relativeDirPath: ".",
        relativeFilePath: "QWEN.md",
      });

      expect(paths.nonRoot).toEqual({
        relativeDirPath: ".qwen/rules",
      });
    });

    it("should return global paths for root and nonRoot", () => {
      const paths = QwencodeRule.getSettablePaths({ global: true });

      expect(paths.root).toEqual({
        relativeDirPath: ".qwen",
        relativeFilePath: "QWEN.md",
      });

      expect(paths.nonRoot).toEqual({
        relativeDirPath: ".qwen/rules",
      });
    });
  });

  describe("isTargetedByRulesyncRule", () => {
    it("should return true for rules targeting qwencode", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: ".qwen/rules",
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["qwencode"],
        },
        body: "Test content",
      });

      expect(QwencodeRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should return true for rules targeting all tools (*)", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: ".qwen/rules",
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["*"],
        },
        body: "Test content",
      });

      expect(QwencodeRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should return false for rules not targeting qwencode", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: ".qwen/rules",
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["cursor", "copilot"],
        },
        body: "Test content",
      });

      expect(QwencodeRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(false);
    });

    it("should handle undefined targets in frontmatter", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: ".qwen/rules",
        relativeFilePath: "test.md",
        frontmatter: {},
        body: "Test content",
      });

      expect(QwencodeRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });
  });

  describe("forDeletion", () => {
    it("should create a deletable non-root rule", () => {
      const qwencodeRule = QwencodeRule.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".qwen/rules",
        relativeFilePath: "old-rule.md",
      });

      expect(qwencodeRule.isRoot()).toBe(false);
      expect(qwencodeRule.getRelativeDirPath()).toBe(".qwen/rules");
    });

    it("should create a deletable root rule", () => {
      const qwencodeRule = QwencodeRule.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "QWEN.md",
      });

      expect(qwencodeRule.isRoot()).toBe(true);
    });
  });

  describe("integration tests", () => {
    it("should handle complete workflow from non-root file to rulesync rule", async () => {
      const rulesDir = join(testDir, ".qwen/rules");
      await ensureDir(rulesDir);
      const originalContent =
        "---\npaths:\n  - src/**/*.ts\ndescription: Integration\n---\n\n# Integration Test";
      await writeFileContent(join(rulesDir, "integration.md"), originalContent);

      const qwencodeRule = await QwencodeRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "integration.md",
      });

      const rulesyncRule = qwencodeRule.toRulesyncRule();

      expect(rulesyncRule.getBody()).toBe("# Integration Test");
      expect(rulesyncRule.getRelativeDirPath()).toBe(RULESYNC_RULES_RELATIVE_DIR_PATH);
      expect(rulesyncRule.getRelativeFilePath()).toBe("integration.md");
      expect(rulesyncRule.getFrontmatter().globs).toEqual(["src/**/*.ts"]);
    });

    it("should handle roundtrip conversion rulesync -> qwencode -> rulesync", () => {
      const originalBody = "# Roundtrip Test\n\nContent should remain the same.";

      const originalRulesync = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "roundtrip.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "Roundtrip",
          globs: ["src/**/*.ts"],
        },
        body: originalBody,
      });

      const qwencodeRule = QwencodeRule.fromRulesyncRule({
        outputRoot: testDir,
        rulesyncRule: originalRulesync,
      });

      const finalRulesync = qwencodeRule.toRulesyncRule();

      expect(finalRulesync.getBody()).toBe(originalBody);
      expect(finalRulesync.getRelativeFilePath()).toBe("roundtrip.md");
      expect(finalRulesync.getFrontmatter().globs).toEqual(["src/**/*.ts"]);
      expect(finalRulesync.getFrontmatter().description).toBe("Roundtrip");
    });

    it("should preserve root status through roundtrip conversion", () => {
      const originalBody = "# Root Roundtrip Test";

      const originalRulesync = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "root-roundtrip.md",
        frontmatter: {
          root: true,
          targets: ["*"],
          description: "",
          globs: ["**/*"],
        },
        body: originalBody,
      });

      const qwencodeRule = QwencodeRule.fromRulesyncRule({
        outputRoot: testDir,
        rulesyncRule: originalRulesync,
      });

      expect(qwencodeRule.isRoot()).toBe(true);

      const finalRulesync = qwencodeRule.toRulesyncRule();

      expect(finalRulesync.getFrontmatter().root).toBe(true);
      expect(finalRulesync.getFrontmatter().globs).toEqual(["**/*"]);
    });
  });
});
