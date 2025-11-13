import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RULESYNC_RULES_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { AugmentcodeRule } from "./augmentcode-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("AugmentcodeRule", () => {
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
      const augmentcodeRule = new AugmentcodeRule({
        relativeDirPath: ".augment/rules",
        relativeFilePath: "test-rule.md",
        fileContent: "# Test Rule\n\nThis is a test augment rule.",
      });

      expect(augmentcodeRule).toBeInstanceOf(AugmentcodeRule);
      expect(augmentcodeRule.getRelativeDirPath()).toBe(".augment/rules");
      expect(augmentcodeRule.getRelativeFilePath()).toBe("test-rule.md");
      expect(augmentcodeRule.getFileContent()).toBe("# Test Rule\n\nThis is a test augment rule.");
    });

    it("should create instance with custom baseDir", () => {
      const augmentcodeRule = new AugmentcodeRule({
        baseDir: "/custom/path",
        relativeDirPath: ".augment/rules",
        relativeFilePath: "custom-rule.md",
        fileContent: "# Custom Rule",
      });

      expect(augmentcodeRule.getFilePath()).toBe("/custom/path/.augment/rules/custom-rule.md");
    });

    it("should create instance with validation enabled", () => {
      const augmentcodeRule = new AugmentcodeRule({
        relativeDirPath: ".augment/rules",
        relativeFilePath: "validated-rule.md",
        fileContent: "# Validated Rule",
        validate: true,
      });

      expect(augmentcodeRule).toBeInstanceOf(AugmentcodeRule);
      expect(augmentcodeRule.getFileContent()).toBe("# Validated Rule");
    });

    it("should create instance with validation disabled", () => {
      const augmentcodeRule = new AugmentcodeRule({
        relativeDirPath: ".augment/rules",
        relativeFilePath: "unvalidated-rule.md",
        fileContent: "# Unvalidated Rule",
        validate: false,
      });

      expect(augmentcodeRule).toBeInstanceOf(AugmentcodeRule);
      expect(augmentcodeRule.getFileContent()).toBe("# Unvalidated Rule");
    });
  });

  describe("fromRulesyncRule", () => {
    it("should create AugmentcodeRule from RulesyncRule with default parameters", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "source-rule.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "",
          globs: [],
        },
        body: "# Source Rule\n\nThis is a source rule.",
      });

      const augmentcodeRule = AugmentcodeRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(augmentcodeRule).toBeInstanceOf(AugmentcodeRule);
      expect(augmentcodeRule.getRelativeDirPath()).toBe(".augment/rules");
      expect(augmentcodeRule.getRelativeFilePath()).toBe("source-rule.md");
      expect(augmentcodeRule.getFileContent()).toBe("# Source Rule\n\nThis is a source rule.");
    });

    it("should create AugmentcodeRule from RulesyncRule with custom baseDir", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: "/source/path",
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

      const augmentcodeRule = AugmentcodeRule.fromRulesyncRule({
        baseDir: "/target/path",
        rulesyncRule,
      });

      expect(augmentcodeRule.getFilePath()).toBe("/target/path/.augment/rules/source-rule.md");
    });

    it("should create AugmentcodeRule from RulesyncRule with validation enabled", () => {
      const rulesyncRule = new RulesyncRule({
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

      const augmentcodeRule = AugmentcodeRule.fromRulesyncRule({
        rulesyncRule,
        validate: true,
      });

      expect(augmentcodeRule).toBeInstanceOf(AugmentcodeRule);
      expect(augmentcodeRule.getFileContent()).toBe("# Source Rule");
    });

    it("should create AugmentcodeRule from RulesyncRule with validation disabled", () => {
      const rulesyncRule = new RulesyncRule({
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

      const augmentcodeRule = AugmentcodeRule.fromRulesyncRule({
        rulesyncRule,
        validate: false,
      });

      expect(augmentcodeRule).toBeInstanceOf(AugmentcodeRule);
      expect(augmentcodeRule.getFileContent()).toBe("# Source Rule");
    });
  });

  describe("fromFile", () => {
    it("should create AugmentcodeRule from file with default parameters", async () => {
      const augmentRulesDir = join(testDir, ".augment", "rules");
      await ensureDir(augmentRulesDir);
      const testFilePath = join(augmentRulesDir, "test-rule.md");
      await writeFileContent(
        testFilePath,
        "---\ntitle: Test\n---\n# Test Rule\n\nThis is a test rule from file.",
      );

      const augmentcodeRule = await AugmentcodeRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "test-rule.md",
      });

      expect(augmentcodeRule).toBeInstanceOf(AugmentcodeRule);
      expect(augmentcodeRule.getRelativeDirPath()).toBe(".augment/rules");
      expect(augmentcodeRule.getRelativeFilePath()).toBe("test-rule.md");
      expect(augmentcodeRule.getFileContent()).toBe(
        "# Test Rule\n\nThis is a test rule from file.",
      );
    });

    it("should create AugmentcodeRule from file with custom baseDir", async () => {
      const customBaseDir = join(testDir, "custom");
      const augmentRulesDir = join(customBaseDir, ".augment", "rules");
      await ensureDir(augmentRulesDir);
      const testFilePath = join(augmentRulesDir, "custom-rule.md");
      await writeFileContent(testFilePath, "---\ntitle: Custom\n---\n# Custom Rule");

      const augmentcodeRule = await AugmentcodeRule.fromFile({
        baseDir: customBaseDir,
        relativeFilePath: "custom-rule.md",
      });

      expect(augmentcodeRule.getFilePath()).toBe(
        join(customBaseDir, ".augment", "rules", "custom-rule.md"),
      );
      expect(augmentcodeRule.getFileContent()).toBe("# Custom Rule");
    });

    it("should create AugmentcodeRule from file with validation enabled", async () => {
      const augmentRulesDir = join(testDir, ".augment", "rules");
      await ensureDir(augmentRulesDir);
      const testFilePath = join(augmentRulesDir, "validated-rule.md");
      await writeFileContent(testFilePath, "---\ntitle: Validated\n---\n# Validated Rule");

      const augmentcodeRule = await AugmentcodeRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "validated-rule.md",
        validate: true,
      });

      expect(augmentcodeRule).toBeInstanceOf(AugmentcodeRule);
      expect(augmentcodeRule.getFileContent()).toBe("# Validated Rule");
    });

    it("should create AugmentcodeRule from file with validation disabled", async () => {
      const augmentRulesDir = join(testDir, ".augment", "rules");
      await ensureDir(augmentRulesDir);
      const testFilePath = join(augmentRulesDir, "unvalidated-rule.md");
      await writeFileContent(testFilePath, "---\ntitle: Unvalidated\n---\n# Unvalidated Rule");

      const augmentcodeRule = await AugmentcodeRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "unvalidated-rule.md",
        validate: false,
      });

      expect(augmentcodeRule).toBeInstanceOf(AugmentcodeRule);
      expect(augmentcodeRule.getFileContent()).toBe("# Unvalidated Rule");
    });

    it("should handle file content without frontmatter", async () => {
      const augmentRulesDir = join(testDir, ".augment", "rules");
      await ensureDir(augmentRulesDir);
      const testFilePath = join(augmentRulesDir, "no-frontmatter.md");
      await writeFileContent(testFilePath, "# Simple Rule\n\nNo frontmatter here.");

      const augmentcodeRule = await AugmentcodeRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "no-frontmatter.md",
      });

      expect(augmentcodeRule.getFileContent()).toBe("# Simple Rule\n\nNo frontmatter here.");
    });

    it("should handle file content with whitespace trimming", async () => {
      const augmentRulesDir = join(testDir, ".augment", "rules");
      await ensureDir(augmentRulesDir);
      const testFilePath = join(augmentRulesDir, "whitespace-rule.md");
      await writeFileContent(
        testFilePath,
        "---\ntitle: Whitespace\n---\n\n# Whitespace Rule\n\nContent with whitespace.\n\n\n",
      );

      const augmentcodeRule = await AugmentcodeRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "whitespace-rule.md",
      });

      expect(augmentcodeRule.getFileContent()).toBe(
        "# Whitespace Rule\n\nContent with whitespace.",
      );
    });

    it("should throw error when file does not exist", async () => {
      await expect(
        AugmentcodeRule.fromFile({
          baseDir: testDir,
          relativeFilePath: "nonexistent-rule.md",
        }),
      ).rejects.toThrow();
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert AugmentcodeRule to RulesyncRule", () => {
      const augmentcodeRule = new AugmentcodeRule({
        baseDir: testDir,
        relativeDirPath: ".augment/rules",
        relativeFilePath: "test-rule.md",
        fileContent: "# Test Rule\n\nThis is a test rule.",
      });

      const rulesyncRule = augmentcodeRule.toRulesyncRule();

      expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
      expect(rulesyncRule.getBaseDir()).toBe(testDir);
      expect(rulesyncRule.getRelativeDirPath()).toBe(RULESYNC_RULES_RELATIVE_DIR_PATH);
      expect(rulesyncRule.getRelativeFilePath()).toBe("test-rule.md");
      expect(rulesyncRule.getBody()).toBe("# Test Rule\n\nThis is a test rule.");
    });

    it("should convert AugmentcodeRule to RulesyncRule preserving metadata", () => {
      const augmentcodeRule = new AugmentcodeRule({
        baseDir: "/custom/path",
        relativeDirPath: ".augment/rules",
        relativeFilePath: "complex-rule.md",
        fileContent: "# Complex Rule\n\nThis is a more complex rule with content.",
        validate: false,
      });

      const rulesyncRule = augmentcodeRule.toRulesyncRule();

      expect(rulesyncRule.getBaseDir()).toBe(testDir);
      expect(rulesyncRule.getRelativeDirPath()).toBe(RULESYNC_RULES_RELATIVE_DIR_PATH);
      expect(rulesyncRule.getRelativeFilePath()).toBe("complex-rule.md");
      expect(rulesyncRule.getBody()).toBe(
        "# Complex Rule\n\nThis is a more complex rule with content.",
      );
    });
  });

  describe("validate", () => {
    it("should always return successful validation", () => {
      const augmentcodeRule = new AugmentcodeRule({
        relativeDirPath: ".augment/rules",
        relativeFilePath: "test-rule.md",
        fileContent: "# Test Rule",
      });

      const validationResult = augmentcodeRule.validate();

      expect(validationResult.success).toBe(true);
      expect(validationResult.error).toBe(null);
    });

    it("should return successful validation for empty content", () => {
      const augmentcodeRule = new AugmentcodeRule({
        relativeDirPath: ".augment/rules",
        relativeFilePath: "empty-rule.md",
        fileContent: "",
      });

      const validationResult = augmentcodeRule.validate();

      expect(validationResult.success).toBe(true);
      expect(validationResult.error).toBe(null);
    });

    it("should return successful validation for any content", () => {
      const augmentcodeRule = new AugmentcodeRule({
        relativeDirPath: ".augment/rules",
        relativeFilePath: "any-rule.md",
        fileContent: "Any kind of content\nwith multiple lines\nand various formats!@#$%",
      });

      const validationResult = augmentcodeRule.validate();

      expect(validationResult.success).toBe(true);
      expect(validationResult.error).toBe(null);
    });
  });

  describe("inheritance from ToolRule", () => {
    it("should inherit ToolRule methods and properties", () => {
      const augmentcodeRule = new AugmentcodeRule({
        relativeDirPath: ".augment/rules",
        relativeFilePath: "inheritance-test.md",
        fileContent: "# Inheritance Test",
      });

      // Test inherited methods
      expect(typeof augmentcodeRule.getBaseDir).toBe("function");
      expect(typeof augmentcodeRule.getRelativeDirPath).toBe("function");
      expect(typeof augmentcodeRule.getRelativeFilePath).toBe("function");
      expect(typeof augmentcodeRule.getFileContent).toBe("function");
      expect(typeof augmentcodeRule.getFilePath).toBe("function");

      // Test inherited method results
      expect(augmentcodeRule.getRelativeDirPath()).toBe(".augment/rules");
      expect(augmentcodeRule.getRelativeFilePath()).toBe("inheritance-test.md");
      expect(augmentcodeRule.getFileContent()).toBe("# Inheritance Test");
    });
  });

  describe("getSettablePaths", () => {
    it("should return correct paths for nonRoot", () => {
      const paths = AugmentcodeRule.getSettablePaths();

      expect(paths.nonRoot).toEqual({
        relativeDirPath: ".augment/rules",
      });
    });

    it("should have consistent paths structure", () => {
      const paths = AugmentcodeRule.getSettablePaths();

      expect(paths).toHaveProperty("nonRoot");
      expect(paths.nonRoot).toHaveProperty("relativeDirPath");
    });
  });

  describe("isTargetedByRulesyncRule", () => {
    it("should return true for rules targeting augmentcode", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".augment/rules",
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["augmentcode"],
        },
        body: "Test content",
      });

      expect(AugmentcodeRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should return true for rules targeting all tools (*)", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".augment/rules",
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["*"],
        },
        body: "Test content",
      });

      expect(AugmentcodeRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should return false for rules not targeting augmentcode", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".augment/rules",
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["cursor", "copilot"],
        },
        body: "Test content",
      });

      expect(AugmentcodeRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(false);
    });

    it("should return false for empty targets", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".augment/rules",
        relativeFilePath: "test.md",
        frontmatter: {
          targets: [],
        },
        body: "Test content",
      });

      expect(AugmentcodeRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(false);
    });

    it("should handle mixed targets including augmentcode", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".augment/rules",
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["cursor", "augmentcode", "copilot"],
        },
        body: "Test content",
      });

      expect(AugmentcodeRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should handle undefined targets in frontmatter", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".augment/rules",
        relativeFilePath: "test.md",
        frontmatter: {},
        body: "Test content",
      });

      expect(AugmentcodeRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });
  });
});
