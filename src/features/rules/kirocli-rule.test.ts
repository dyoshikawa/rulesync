import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RULESYNC_RELATIVE_DIR_PATH,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { KiroCliRule } from "./kirocli-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("KiroCliRule", () => {
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
    it("should create instance with default parameters", () => {
      const rule = new KiroCliRule({
        relativeDirPath: ".kiro/steering",
        relativeFilePath: "product.md",
        fileContent: "# Product Guidelines",
      });

      expect(rule).toBeInstanceOf(KiroCliRule);
      expect(rule.getRelativeDirPath()).toBe(".kiro/steering");
      expect(rule.getRelativeFilePath()).toBe("product.md");
      expect(rule.getFileContent()).toBe("# Product Guidelines");
    });

    it("should create instance with custom baseDir", () => {
      const rule = new KiroCliRule({
        baseDir: "/custom/path",
        relativeDirPath: ".kiro/steering",
        relativeFilePath: "structure.md",
        fileContent: "# Structure Guidelines",
      });

      expect(rule.getFilePath()).toBe("/custom/path/.kiro/steering/structure.md");
    });
  });

  describe("getSettablePaths", () => {
    it("should return correct paths for non-root", () => {
      const paths = KiroCliRule.getSettablePaths();
      expect(paths.nonRoot.relativeDirPath).toBe(join(".kiro", "steering"));
    });
  });

  describe("fromFile", () => {
    it("should create instance from file", async () => {
      const steeringDir = join(testDir, ".kiro/steering");
      await ensureDir(steeringDir);
      const testContent = "# Product Steering\n\nProduct guidelines.";
      await writeFileContent(join(steeringDir, "product.md"), testContent);

      const rule = await KiroCliRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "product.md",
      });

      expect(rule.getRelativeDirPath()).toBe(".kiro/steering");
      expect(rule.getRelativeFilePath()).toBe("product.md");
      expect(rule.getFileContent()).toBe(testContent);
    });

    it("should throw error when file does not exist", async () => {
      await expect(
        KiroCliRule.fromFile({
          baseDir: testDir,
          relativeFilePath: "nonexistent.md",
        }),
      ).rejects.toThrow();
    });
  });

  describe("fromRulesyncRule", () => {
    it("should create instance from RulesyncRule for non-root rule", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "detail-rule.md",
        frontmatter: {
          root: false,
          targets: ["kirocli"],
          description: "Test detail rule",
          globs: [],
        },
        body: "# Detail RulesyncRule",
      });

      const rule = KiroCliRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(rule).toBeInstanceOf(KiroCliRule);
      expect(rule.getRelativeDirPath()).toBe(".kiro/steering");
      expect(rule.getRelativeFilePath()).toBe("detail-rule.md");
      expect(rule.getFileContent()).toContain("# Detail RulesyncRule");
    });

    it("should use custom baseDir", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "custom-base.md",
        frontmatter: {
          root: false,
          targets: ["kirocli"],
          description: "",
          globs: [],
        },
        body: "# Custom Base Directory",
      });

      const rule = KiroCliRule.fromRulesyncRule({
        baseDir: "/custom/base",
        rulesyncRule,
      });

      expect(rule.getFilePath()).toBe("/custom/base/.kiro/steering/custom-base.md");
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert KiroCliRule to RulesyncRule", () => {
      const rule = new KiroCliRule({
        baseDir: testDir,
        relativeDirPath: ".kiro/steering",
        relativeFilePath: "product.md",
        fileContent: "# Convert Test",
        root: false,
      });

      const rulesyncRule = rule.toRulesyncRule();

      expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
      expect(rulesyncRule.getRelativeDirPath()).toBe(RULESYNC_RULES_RELATIVE_DIR_PATH);
      expect(rulesyncRule.getFileContent()).toContain("# Convert Test");
    });
  });

  describe("validate", () => {
    it("should always return success", () => {
      const rule = new KiroCliRule({
        relativeDirPath: ".kiro/steering",
        relativeFilePath: "product.md",
        fileContent: "",
      });

      const result = rule.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });

  describe("forDeletion", () => {
    it("should create instance for deletion", () => {
      const rule = KiroCliRule.forDeletion({
        baseDir: testDir,
        relativeDirPath: ".kiro/steering",
        relativeFilePath: "to-delete.md",
      });

      expect(rule).toBeInstanceOf(KiroCliRule);
      expect(rule.getRelativeDirPath()).toBe(".kiro/steering");
      expect(rule.getRelativeFilePath()).toBe("to-delete.md");
      expect(rule.getFileContent()).toBe("");
    });
  });

  describe("isTargetedByRulesyncRule", () => {
    it("should return true for kirocli target", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          root: false,
          targets: ["kirocli"],
          description: "",
          globs: [],
        },
        body: "# Test",
      });

      expect(KiroCliRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should return true for wildcard target", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "",
          globs: [],
        },
        body: "# Test",
      });

      expect(KiroCliRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should return false for other targets", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          root: false,
          targets: ["cursor"],
          description: "",
          globs: [],
        },
        body: "# Test",
      });

      expect(KiroCliRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(false);
    });
  });
});
