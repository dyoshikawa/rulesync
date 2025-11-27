import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { AntigravityRule } from "./antigravity-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("AntigravityRule", () => {
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
      const antigravityRule = new AntigravityRule({
        relativeDirPath: ".agent/rules",
        relativeFilePath: "test-rule.md",
        fileContent: "# Test Rule\n\nThis is a test rule.",
      });

      expect(antigravityRule).toBeInstanceOf(AntigravityRule);
      expect(antigravityRule.getRelativeDirPath()).toBe(".agent/rules");
      expect(antigravityRule.getRelativeFilePath()).toBe("test-rule.md");
      expect(antigravityRule.getFileContent()).toBe("# Test Rule\n\nThis is a test rule.");
    });

    it("should create instance with custom baseDir", () => {
      const antigravityRule = new AntigravityRule({
        baseDir: "/custom/path",
        relativeDirPath: ".agent/rules",
        relativeFilePath: "test-rule.md",
        fileContent: "# Custom Rule",
      });

      expect(antigravityRule.getFilePath()).toBe("/custom/path/.agent/rules/test-rule.md");
    });

    it("should validate content by default", () => {
      expect(() => {
        const _instance = new AntigravityRule({
          relativeDirPath: ".agent/rules",
          relativeFilePath: "test-rule.md",
          fileContent: "", // empty content should be valid since validate always returns success
        });
      }).not.toThrow();
    });

    it("should skip validation when requested", () => {
      expect(() => {
        const _instance = new AntigravityRule({
          relativeDirPath: ".agent/rules",
          relativeFilePath: "test-rule.md",
          fileContent: "",
          validate: false,
        });
      }).not.toThrow();
    });

    it("should handle root rule parameter", () => {
      const antigravityRule = new AntigravityRule({
        relativeDirPath: ".agent/rules",
        relativeFilePath: "test-rule.md",
        fileContent: "# Root Rule",
        root: false,
      });

      expect(antigravityRule.getFileContent()).toBe("# Root Rule");
    });
  });

  describe("fromFile", () => {
    it("should create instance from existing file", async () => {
      // Setup test file
      const rulesDir = join(testDir, ".agent/rules");
      await ensureDir(rulesDir);
      const testContent = "# Test Rule from File\n\nContent from file.";
      await writeFileContent(join(rulesDir, "test.md"), testContent);

      const antigravityRule = await AntigravityRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "test.md",
      });

      expect(antigravityRule.getRelativeDirPath()).toBe(".agent/rules");
      expect(antigravityRule.getRelativeFilePath()).toBe("test.md");
      expect(antigravityRule.getFileContent()).toBe(testContent);
      expect(antigravityRule.getFilePath()).toBe(join(testDir, ".agent/rules/test.md"));
    });

    it("should use default baseDir when not provided", async () => {
      // Setup test file using testDir
      const rulesDir = join(testDir, ".agent/rules");
      await ensureDir(rulesDir);
      const testContent = "# Default BaseDir Test";
      const testFilePath = join(rulesDir, "default-test.md");
      await writeFileContent(testFilePath, testContent);

      // process.cwd() is already mocked in beforeEach
      const antigravityRule = await AntigravityRule.fromFile({
        relativeFilePath: "default-test.md",
      });

      expect(antigravityRule.getRelativeDirPath()).toBe(".agent/rules");
      expect(antigravityRule.getRelativeFilePath()).toBe("default-test.md");
      expect(antigravityRule.getFileContent()).toBe(testContent);
      expect(antigravityRule.getFilePath()).toBe(join(testDir, ".agent/rules/default-test.md"));
    });

    it("should handle validation parameter", async () => {
      const rulesDir = join(testDir, ".agent/rules");
      await ensureDir(rulesDir);
      const testContent = "# Validation Test";
      await writeFileContent(join(rulesDir, "validation-test.md"), testContent);

      const antigravityRuleWithValidation = await AntigravityRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "validation-test.md",
        validate: true,
      });

      const antigravityRuleWithoutValidation = await AntigravityRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "validation-test.md",
        validate: false,
      });

      expect(antigravityRuleWithValidation.getFileContent()).toBe(testContent);
      expect(antigravityRuleWithoutValidation.getFileContent()).toBe(testContent);
    });

    it("should throw error when file does not exist", async () => {
      await expect(
        AntigravityRule.fromFile({
          baseDir: testDir,
          relativeFilePath: "nonexistent.md",
        }),
      ).rejects.toThrow();
    });
  });

  describe("fromRulesyncRule", () => {
    it("should create instance from RulesyncRule", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "test-rule.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "Test rule",
          globs: [],
        },
        body: "# Test RulesyncRule\n\nContent from rulesync.",
      });

      const antigravityRule = AntigravityRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(antigravityRule).toBeInstanceOf(AntigravityRule);
      expect(antigravityRule.getRelativeDirPath()).toBe(".agent/rules");
      expect(antigravityRule.getRelativeFilePath()).toBe("test-rule.md");
      expect(antigravityRule.getFileContent()).toContain(
        "# Test RulesyncRule\n\nContent from rulesync.",
      );
    });

    it("should use custom baseDir", () => {
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

      const antigravityRule = AntigravityRule.fromRulesyncRule({
        baseDir: "/custom/base",
        rulesyncRule,
      });

      expect(antigravityRule.getFilePath()).toBe("/custom/base/.agent/rules/custom-base.md");
    });

    it("should handle validation parameter", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "validation.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "",
          globs: [],
        },
        body: "# Validation Test",
      });

      const withValidation = AntigravityRule.fromRulesyncRule({
        rulesyncRule,
        validate: true,
      });

      const withoutValidation = AntigravityRule.fromRulesyncRule({
        rulesyncRule,
        validate: false,
      });

      expect(withValidation.getFileContent()).toContain("# Validation Test");
      expect(withoutValidation.getFileContent()).toContain("# Validation Test");
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert to RulesyncRule", () => {
      const antigravityRule = new AntigravityRule({
        relativeDirPath: ".agent/rules",
        relativeFilePath: "test.md",
        fileContent: "# Test Rule\n\nContent",
      });

      const rulesyncRule = antigravityRule.toRulesyncRule();

      expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
      expect(rulesyncRule.getRelativeFilePath()).toBe("test.md");
      expect(rulesyncRule.getBody()).toContain("# Test Rule\n\nContent");
    });
  });

  describe("validate", () => {
    it("should always return success", () => {
      const antigravityRule = new AntigravityRule({
        relativeDirPath: ".agent/rules",
        relativeFilePath: "test.md",
        fileContent: "# Test",
      });

      const result = antigravityRule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });

  describe("isTargetedByRulesyncRule", () => {
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

      expect(AntigravityRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should return true for antigravity target", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          root: false,
          targets: ["antigravity"],
          description: "",
          globs: [],
        },
        body: "# Test",
      });

      expect(AntigravityRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should return false for other specific targets", () => {
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

      expect(AntigravityRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(false);
    });
  });

  describe("getSettablePaths", () => {
    it("should return correct nonRoot path", () => {
      const paths = AntigravityRule.getSettablePaths();

      expect(paths.nonRoot.relativeDirPath).toBe(".agent/rules");
    });
  });
});
