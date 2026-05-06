import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RULES_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { QoderRule } from "./qoder-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("QoderRule", () => {
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
    it("should create instance with frontmatter and body", () => {
      const rule = new QoderRule({
        relativeDirPath: ".qoder/rules",
        relativeFilePath: "test-rule.md",
        frontmatter: { trigger: "always_on", alwaysApply: true },
        body: "# Test Rule\n\nThis is a test qoder rule.",
      });

      expect(rule).toBeInstanceOf(QoderRule);
      expect(rule.getRelativeDirPath()).toBe(".qoder/rules");
      expect(rule.getRelativeFilePath()).toBe("test-rule.md");
      expect(rule.getFrontmatter()).toEqual({ trigger: "always_on", alwaysApply: true });
      expect(rule.getBody()).toBe("# Test Rule\n\nThis is a test qoder rule.");
    });

    it("should generate file content with YAML frontmatter", () => {
      const rule = new QoderRule({
        relativeDirPath: ".qoder/rules",
        relativeFilePath: "test-rule.md",
        frontmatter: { trigger: "always_on", alwaysApply: true, description: "Test rule" },
        body: "# Test Rule",
      });

      const content = rule.getFileContent();
      expect(content).toContain("---");
      expect(content).toContain("trigger: always_on");
      expect(content).toContain("alwaysApply: true");
      expect(content).toContain("description: Test rule");
      expect(content).toContain("# Test Rule");
    });

    it("should create instance with empty frontmatter", () => {
      const rule = new QoderRule({
        relativeDirPath: ".qoder/rules",
        relativeFilePath: "test-rule.md",
        frontmatter: {},
        body: "# Test Rule",
      });

      expect(rule).toBeInstanceOf(QoderRule);
      expect(rule.getFrontmatter()).toEqual({});
    });

    it("should create instance with custom outputRoot", () => {
      const rule = new QoderRule({
        outputRoot: "/custom/path",
        relativeDirPath: ".qoder/rules",
        relativeFilePath: "custom-rule.md",
        frontmatter: {},
        body: "# Custom Rule",
      });

      expect(rule.getFilePath()).toBe("/custom/path/.qoder/rules/custom-rule.md");
    });
  });

  describe("getSettablePaths", () => {
    it("should return correct paths for nonRoot", () => {
      const paths = QoderRule.getSettablePaths();
      expect(paths.nonRoot).toEqual({
        relativeDirPath: ".qoder/rules",
      });
    });
  });

  describe("fromRulesyncRule", () => {
    it("should use explicit qoder trigger when set", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "source-rule.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "Test description",
          globs: [],
          qoder: {
            trigger: "always_on",
            alwaysApply: true,
          },
        },
        body: "# Source Rule\n\nThis is a source rule.",
      });

      const qoderRule = QoderRule.fromRulesyncRule({ rulesyncRule });

      expect(qoderRule).toBeInstanceOf(QoderRule);
      expect(qoderRule.getRelativeDirPath()).toBe(".qoder/rules");
      expect(qoderRule.getRelativeFilePath()).toBe("source-rule.md");
      expect(qoderRule.getFrontmatter().trigger).toBe("always_on");
      expect(qoderRule.getFrontmatter().alwaysApply).toBe(true);
      expect(qoderRule.getFrontmatter().description).toBeUndefined();
      expect(qoderRule.getBody()).toBe("# Source Rule\n\nThis is a source rule.");
    });

    it("should use explicit qoder trigger: glob with glob field", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "source-rule.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          globs: [],
          qoder: {
            trigger: "glob",
            globs: ["*.java", "*.kt"],
          },
        },
        body: "# Source Rule",
      });

      const qoderRule = QoderRule.fromRulesyncRule({ rulesyncRule });
      expect(qoderRule.getFrontmatter().trigger).toBe("glob");
      expect(qoderRule.getFrontmatter().glob).toBe("*.java,*.kt");
    });

    it("should use explicit qoder trigger: model_decision with description", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "source-rule.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          globs: [],
          qoder: {
            trigger: "model_decision",
            description: "Qoder specific desc",
          },
        },
        body: "# Source Rule",
      });

      const qoderRule = QoderRule.fromRulesyncRule({ rulesyncRule });
      expect(qoderRule.getFrontmatter().trigger).toBe("model_decision");
      expect(qoderRule.getFrontmatter().description).toBe("Qoder specific desc");
    });

    it("should infer always_on from cursor.alwaysApply", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "source-rule.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          globs: ["**/*"],
          cursor: { alwaysApply: true, globs: ["**/*"] },
        },
        body: "# Always On Rule",
      });

      const qoderRule = QoderRule.fromRulesyncRule({ rulesyncRule });
      expect(qoderRule.getFrontmatter().trigger).toBe("always_on");
      expect(qoderRule.getFrontmatter().alwaysApply).toBe(true);
      expect(qoderRule.getFrontmatter().glob).toBeUndefined();
      expect(qoderRule.getFrontmatter().description).toBeUndefined();
    });

    it("should infer always_on from catch-all globs without cursor section", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "source-rule.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          globs: ["**/*"],
        },
        body: "# Always On Rule",
      });

      const qoderRule = QoderRule.fromRulesyncRule({ rulesyncRule });
      expect(qoderRule.getFrontmatter().trigger).toBe("always_on");
      expect(qoderRule.getFrontmatter().alwaysApply).toBe(true);
    });

    it("should infer glob from specific globs", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "source-rule.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          globs: ["*.ts", "*.js"],
        },
        body: "# Glob Rule",
      });

      const qoderRule = QoderRule.fromRulesyncRule({ rulesyncRule });
      expect(qoderRule.getFrontmatter().trigger).toBe("glob");
      expect(qoderRule.getFrontmatter().glob).toBe("*.ts,*.js");
      expect(qoderRule.getFrontmatter().alwaysApply).toBeUndefined();
    });

    it("should infer model_decision from description with empty globs", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "source-rule.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "开发参考：API 模式、代码示例",
          globs: [],
        },
        body: "# Dev Reference",
      });

      const qoderRule = QoderRule.fromRulesyncRule({ rulesyncRule });
      expect(qoderRule.getFrontmatter().trigger).toBe("model_decision");
      expect(qoderRule.getFrontmatter().description).toBe("开发参考：API 模式、代码示例");
      expect(qoderRule.getFrontmatter().glob).toBeUndefined();
    });

    it("should infer manual when no description and no globs", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "source-rule.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          globs: [],
        },
        body: "# Manual Rule",
      });

      const qoderRule = QoderRule.fromRulesyncRule({ rulesyncRule });
      expect(qoderRule.getFrontmatter().trigger).toBe("manual");
      expect(qoderRule.getFrontmatter().alwaysApply).toBe(false);
      expect(qoderRule.getFrontmatter().glob).toBeUndefined();
      expect(qoderRule.getFrontmatter().description).toBeUndefined();
    });

    it("should infer from qoder.alwaysApply without explicit trigger", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "source-rule.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          globs: [],
          qoder: { alwaysApply: true },
        },
        body: "# Source Rule",
      });

      const qoderRule = QoderRule.fromRulesyncRule({ rulesyncRule });
      expect(qoderRule.getFrontmatter().trigger).toBe("always_on");
      expect(qoderRule.getFrontmatter().alwaysApply).toBe(true);
    });

    it("should prefer qoder.globs over common globs for inference", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "source-rule.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          globs: ["**/*"],
          qoder: { globs: ["*.java"] },
        },
        body: "# Source Rule",
      });

      const qoderRule = QoderRule.fromRulesyncRule({ rulesyncRule });
      expect(qoderRule.getFrontmatter().trigger).toBe("glob");
      expect(qoderRule.getFrontmatter().glob).toBe("*.java");
    });

    it("should create QoderRule with custom outputRoot", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: "/source/path",
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "source-rule.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "",
          globs: [],
        },
        body: "# Source Rule",
      });

      const qoderRule = QoderRule.fromRulesyncRule({
        outputRoot: "/target/path",
        rulesyncRule,
      });

      expect(qoderRule.getFilePath()).toBe("/target/path/.qoder/rules/source-rule.md");
    });
  });

  describe("fromFile", () => {
    it("should create QoderRule from file with frontmatter", async () => {
      const rulesDir = join(testDir, ".qoder", "rules");
      await ensureDir(rulesDir);
      await writeFileContent(
        join(rulesDir, "test-rule.md"),
        "---\ntrigger: always_on\nalwaysApply: true\n---\n# Test Rule\n\nThis is a test rule from file.",
      );

      const rule = await QoderRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "test-rule.md",
      });

      expect(rule).toBeInstanceOf(QoderRule);
      expect(rule.getFrontmatter().trigger).toBe("always_on");
      expect(rule.getFrontmatter().alwaysApply).toBe(true);
      expect(rule.getBody()).toBe("# Test Rule\n\nThis is a test rule from file.");
    });

    it("should handle file content without frontmatter", async () => {
      const rulesDir = join(testDir, ".qoder", "rules");
      await ensureDir(rulesDir);
      await writeFileContent(
        join(rulesDir, "no-frontmatter.md"),
        "# Simple Rule\n\nNo frontmatter here.",
      );

      const rule = await QoderRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "no-frontmatter.md",
      });

      expect(rule.getFrontmatter()).toEqual({});
      expect(rule.getBody()).toBe("# Simple Rule\n\nNo frontmatter here.");
    });

    it("should throw error when file does not exist", async () => {
      await expect(
        QoderRule.fromFile({
          outputRoot: testDir,
          relativeFilePath: "nonexistent-rule.md",
        }),
      ).rejects.toThrow();
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert QoderRule to RulesyncRule preserving frontmatter", () => {
      const rule = new QoderRule({
        outputRoot: testDir,
        relativeDirPath: ".qoder/rules",
        relativeFilePath: "test-rule.md",
        frontmatter: { trigger: "always_on", alwaysApply: true, description: "Test" },
        body: "# Test Rule\n\nThis is a test rule.",
      });

      const rulesyncRule = rule.toRulesyncRule();

      expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
      expect(rulesyncRule.getRelativeDirPath()).toBe(RULESYNC_RULES_RELATIVE_DIR_PATH);
      expect(rulesyncRule.getRelativeFilePath()).toBe("test-rule.md");
      expect(rulesyncRule.getBody()).toBe("# Test Rule\n\nThis is a test rule.");
      expect(rulesyncRule.getFrontmatter().description).toBe("Test");
      expect(rulesyncRule.getFrontmatter().qoder?.trigger).toBe("always_on");
      expect(rulesyncRule.getFrontmatter().qoder?.alwaysApply).toBe(true);
    });

    it("should set globs to **/* when alwaysApply is true", () => {
      const rule = new QoderRule({
        outputRoot: testDir,
        relativeDirPath: ".qoder/rules",
        relativeFilePath: "test-rule.md",
        frontmatter: { alwaysApply: true },
        body: "# Test Rule",
      });

      const rulesyncRule = rule.toRulesyncRule();
      expect(rulesyncRule.getFrontmatter().globs).toEqual(["**/*"]);
    });

    it("should parse comma-separated glob", () => {
      const rule = new QoderRule({
        outputRoot: testDir,
        relativeDirPath: ".qoder/rules",
        relativeFilePath: "test-rule.md",
        frontmatter: { trigger: "glob", glob: "*.ts, *.js" },
        body: "# Test Rule",
      });

      const rulesyncRule = rule.toRulesyncRule();
      expect(rulesyncRule.getFrontmatter().globs).toEqual(["*.ts", "*.js"]);
    });
  });

  describe("validate", () => {
    it("should return successful validation for valid frontmatter", () => {
      const rule = new QoderRule({
        relativeDirPath: ".qoder/rules",
        relativeFilePath: "test-rule.md",
        frontmatter: { trigger: "always_on", alwaysApply: true },
        body: "# Test Rule",
        validate: false,
      });

      const result = rule.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });

    it("should return successful validation for empty frontmatter", () => {
      const rule = new QoderRule({
        relativeDirPath: ".qoder/rules",
        relativeFilePath: "test-rule.md",
        frontmatter: {},
        body: "",
        validate: false,
      });

      const result = rule.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });
  });

  describe("isTargetedByRulesyncRule", () => {
    it("should return true for rules targeting qoder", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: ".qoder/rules",
        relativeFilePath: "test.md",
        frontmatter: { targets: ["qoder"] },
        body: "Test content",
      });

      expect(QoderRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should return true for rules targeting all tools (*)", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: ".qoder/rules",
        relativeFilePath: "test.md",
        frontmatter: { targets: ["*"] },
        body: "Test content",
      });

      expect(QoderRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should return false for rules not targeting qoder", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: ".qoder/rules",
        relativeFilePath: "test.md",
        frontmatter: { targets: ["cursor", "copilot"] },
        body: "Test content",
      });

      expect(QoderRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(false);
    });

    it("should return false for empty targets", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: ".qoder/rules",
        relativeFilePath: "test.md",
        frontmatter: { targets: [] },
        body: "Test content",
      });

      expect(QoderRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(false);
    });
  });

  describe("forDeletion", () => {
    it("should create a QoderRule instance for deletion", () => {
      const rule = QoderRule.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".qoder/rules",
        relativeFilePath: "to-delete.md",
      });

      expect(rule).toBeInstanceOf(QoderRule);
    });
  });
});
