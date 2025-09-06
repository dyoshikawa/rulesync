import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../utils/file.js";
import { AugmentcodeLegacyRule } from "./augmentcode-legacy-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("AugmentcodeLegacyRule", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("constructor", () => {
    it("should create instance with default parameters", () => {
      const augmentcodeLegacyRule = new AugmentcodeLegacyRule({
        relativeDirPath: ".augment/rules",
        relativeFilePath: "test-rule.md",
        fileContent: "# Test Legacy Rule\n\nThis is a test augment legacy rule.",
      });

      expect(augmentcodeLegacyRule).toBeInstanceOf(AugmentcodeLegacyRule);
      expect(augmentcodeLegacyRule.getRelativeDirPath()).toBe(".augment/rules");
      expect(augmentcodeLegacyRule.getRelativeFilePath()).toBe("test-rule.md");
      expect(augmentcodeLegacyRule.getFileContent()).toBe(
        "# Test Legacy Rule\n\nThis is a test augment legacy rule.",
      );
    });

    it("should create instance with custom baseDir", () => {
      const augmentcodeLegacyRule = new AugmentcodeLegacyRule({
        baseDir: "/custom/path",
        relativeDirPath: ".augment/rules",
        relativeFilePath: "custom-rule.md",
        fileContent: "# Custom Legacy Rule",
      });

      expect(augmentcodeLegacyRule.getFilePath()).toBe(
        "/custom/path/.augment/rules/custom-rule.md",
      );
    });

    it("should create root instance for .augment-guidelines", () => {
      const augmentcodeLegacyRule = new AugmentcodeLegacyRule({
        relativeDirPath: ".",
        relativeFilePath: ".augment-guidelines",
        fileContent: "# Root Guidelines",
        root: true,
      });

      expect(augmentcodeLegacyRule.isRoot()).toBe(true);
      expect(augmentcodeLegacyRule.getRelativeDirPath()).toBe(".");
      expect(augmentcodeLegacyRule.getRelativeFilePath()).toBe(".augment-guidelines");
    });

    it("should create non-root instance", () => {
      const augmentcodeLegacyRule = new AugmentcodeLegacyRule({
        relativeDirPath: ".augment/rules",
        relativeFilePath: "non-root-rule.md",
        fileContent: "# Non-Root Rule",
        root: false,
      });

      expect(augmentcodeLegacyRule.isRoot()).toBe(false);
      expect(augmentcodeLegacyRule.getRelativeDirPath()).toBe(".augment/rules");
    });

    it("should create instance with validation enabled", () => {
      const augmentcodeLegacyRule = new AugmentcodeLegacyRule({
        relativeDirPath: ".augment/rules",
        relativeFilePath: "validated-rule.md",
        fileContent: "# Validated Legacy Rule",
        validate: true,
      });

      expect(augmentcodeLegacyRule).toBeInstanceOf(AugmentcodeLegacyRule);
      expect(augmentcodeLegacyRule.getFileContent()).toBe("# Validated Legacy Rule");
    });

    it("should create instance with validation disabled", () => {
      const augmentcodeLegacyRule = new AugmentcodeLegacyRule({
        relativeDirPath: ".augment/rules",
        relativeFilePath: "unvalidated-rule.md",
        fileContent: "# Unvalidated Legacy Rule",
        validate: false,
      });

      expect(augmentcodeLegacyRule).toBeInstanceOf(AugmentcodeLegacyRule);
      expect(augmentcodeLegacyRule.getFileContent()).toBe("# Unvalidated Legacy Rule");
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert non-root AugmentcodeLegacyRule to RulesyncRule", () => {
      const augmentcodeLegacyRule = new AugmentcodeLegacyRule({
        baseDir: testDir,
        relativeDirPath: ".augment/rules",
        relativeFilePath: "test-rule.md",
        fileContent: "# Test Legacy Rule\n\nThis is a test legacy rule.",
        root: false,
      });

      const rulesyncRule = augmentcodeLegacyRule.toRulesyncRule();

      expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
      expect(rulesyncRule.getBaseDir()).toBe(testDir);
      expect(rulesyncRule.getRelativeDirPath()).toBe(".rulesync/rules");
      expect(rulesyncRule.getRelativeFilePath()).toBe("test-rule.md");
      expect(rulesyncRule.getBody()).toBe("# Test Legacy Rule\n\nThis is a test legacy rule.");

      const frontmatter = rulesyncRule.getFrontmatter();
      expect(frontmatter.root).toBe(false);
      expect(frontmatter.targets).toEqual(["*"]);
      expect(frontmatter.description).toBe("");
      expect(frontmatter.globs).toEqual([]);
    });

    it("should convert root AugmentcodeLegacyRule to RulesyncRule", () => {
      const augmentcodeLegacyRule = new AugmentcodeLegacyRule({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".augment-guidelines",
        fileContent: "# Root Guidelines\n\nThese are root guidelines.",
        root: true,
      });

      const rulesyncRule = augmentcodeLegacyRule.toRulesyncRule();

      expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
      expect(rulesyncRule.getBaseDir()).toBe(testDir);
      expect(rulesyncRule.getRelativeDirPath()).toBe(".rulesync/rules");
      expect(rulesyncRule.getRelativeFilePath()).toBe(".augment-guidelines");
      expect(rulesyncRule.getBody()).toBe("# Root Guidelines\n\nThese are root guidelines.");

      const frontmatter = rulesyncRule.getFrontmatter();
      expect(frontmatter.root).toBe(true);
      expect(frontmatter.targets).toEqual(["*"]);
      expect(frontmatter.description).toBe("");
      expect(frontmatter.globs).toEqual(["**/*"]);
    });

    it("should convert AugmentcodeLegacyRule to RulesyncRule preserving metadata", () => {
      const augmentcodeLegacyRule = new AugmentcodeLegacyRule({
        baseDir: "/custom/path",
        relativeDirPath: ".augment/rules",
        relativeFilePath: "complex-rule.md",
        fileContent: "# Complex Legacy Rule\n\nThis is a more complex legacy rule with content.",
        validate: false,
      });

      const rulesyncRule = augmentcodeLegacyRule.toRulesyncRule();

      expect(rulesyncRule.getBaseDir()).toBe("/custom/path");
      expect(rulesyncRule.getRelativeDirPath()).toBe(".rulesync/rules");
      expect(rulesyncRule.getRelativeFilePath()).toBe("complex-rule.md");
      expect(rulesyncRule.getBody()).toBe(
        "# Complex Legacy Rule\n\nThis is a more complex legacy rule with content.",
      );
    });
  });

  describe("fromRulesyncRule", () => {
    it("should create AugmentcodeLegacyRule from RulesyncRule with default parameters", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "source-rule.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "",
          globs: [],
        },
        body: "# Source Legacy Rule\n\nThis is a source legacy rule.",
      });

      const augmentcodeLegacyRule = AugmentcodeLegacyRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(augmentcodeLegacyRule).toBeInstanceOf(AugmentcodeLegacyRule);
      expect(augmentcodeLegacyRule.getRelativeDirPath()).toBe(".augment/rules");
      expect(augmentcodeLegacyRule.getRelativeFilePath()).toBe("source-rule.md");
      expect(augmentcodeLegacyRule.getFileContent()).toBe(
        "# Source Legacy Rule\n\nThis is a source legacy rule.",
      );
    });

    it("should create AugmentcodeLegacyRule from RulesyncRule with custom baseDir", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: "/source/path",
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "source-rule.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "",
          globs: [],
        },
        body: "# Source Legacy Rule",
      });

      const augmentcodeLegacyRule = AugmentcodeLegacyRule.fromRulesyncRule({
        baseDir: "/target/path",
        rulesyncRule,
      });

      expect(augmentcodeLegacyRule.getFilePath()).toBe(
        "/target/path/.augment/rules/source-rule.md",
      );
    });

    it("should create root AugmentcodeLegacyRule from RulesyncRule", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: ".augment-guidelines",
        frontmatter: {
          root: true,
          targets: ["*"],
          description: "",
          globs: ["**/*"],
        },
        body: "# Root Guidelines",
      });

      const augmentcodeLegacyRule = AugmentcodeLegacyRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(augmentcodeLegacyRule).toBeInstanceOf(AugmentcodeLegacyRule);
      expect(augmentcodeLegacyRule.getRelativeDirPath()).toBe(".");
      expect(augmentcodeLegacyRule.getRelativeFilePath()).toBe(".augment-guidelines");
      expect(augmentcodeLegacyRule.getFileContent()).toBe("# Root Guidelines");
    });

    it("should create AugmentcodeLegacyRule from RulesyncRule with validation enabled", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "source-rule.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "",
          globs: [],
        },
        body: "# Source Legacy Rule",
      });

      const augmentcodeLegacyRule = AugmentcodeLegacyRule.fromRulesyncRule({
        rulesyncRule,
        validate: true,
      });

      expect(augmentcodeLegacyRule).toBeInstanceOf(AugmentcodeLegacyRule);
      expect(augmentcodeLegacyRule.getFileContent()).toBe("# Source Legacy Rule");
    });

    it("should create AugmentcodeLegacyRule from RulesyncRule with validation disabled", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "source-rule.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "",
          globs: [],
        },
        body: "# Source Legacy Rule",
      });

      const augmentcodeLegacyRule = AugmentcodeLegacyRule.fromRulesyncRule({
        rulesyncRule,
        validate: false,
      });

      expect(augmentcodeLegacyRule).toBeInstanceOf(AugmentcodeLegacyRule);
      expect(augmentcodeLegacyRule.getFileContent()).toBe("# Source Legacy Rule");
    });
  });

  describe("fromFile", () => {
    it("should create AugmentcodeLegacyRule from non-root file with default parameters", async () => {
      const augmentRulesDir = join(testDir, ".augment", "rules");
      await ensureDir(augmentRulesDir);
      const testFilePath = join(augmentRulesDir, "test-rule.md");
      await writeFileContent(
        testFilePath,
        "# Test Legacy Rule\n\nThis is a test legacy rule from file.",
      );

      const augmentcodeLegacyRule = await AugmentcodeLegacyRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "test-rule.md",
      });

      expect(augmentcodeLegacyRule).toBeInstanceOf(AugmentcodeLegacyRule);
      expect(augmentcodeLegacyRule.getRelativeDirPath()).toBe(".augment/rules");
      expect(augmentcodeLegacyRule.getRelativeFilePath()).toBe("test-rule.md");
      expect(augmentcodeLegacyRule.getFileContent()).toBe(
        "# Test Legacy Rule\n\nThis is a test legacy rule from file.",
      );
      expect(augmentcodeLegacyRule.isRoot()).toBe(false);
    });

    it("should create AugmentcodeLegacyRule from root file (.augment-guidelines)", async () => {
      const testFilePath = join(testDir, ".augment-guidelines");
      await writeFileContent(testFilePath, "# Root Guidelines\n\nThese are the root guidelines.");

      const augmentcodeLegacyRule = await AugmentcodeLegacyRule.fromFile({
        baseDir: testDir,
        relativeFilePath: ".augment-guidelines",
      });

      expect(augmentcodeLegacyRule).toBeInstanceOf(AugmentcodeLegacyRule);
      expect(augmentcodeLegacyRule.getRelativeDirPath()).toBe(".");
      expect(augmentcodeLegacyRule.getRelativeFilePath()).toBe(".augment-guidelines");
      expect(augmentcodeLegacyRule.getFileContent()).toBe(
        "# Root Guidelines\n\nThese are the root guidelines.",
      );
      expect(augmentcodeLegacyRule.isRoot()).toBe(true);
    });

    it("should create AugmentcodeLegacyRule from file with custom baseDir", async () => {
      const customBaseDir = join(testDir, "custom");
      const augmentRulesDir = join(customBaseDir, ".augment", "rules");
      await ensureDir(augmentRulesDir);
      const testFilePath = join(augmentRulesDir, "custom-rule.md");
      await writeFileContent(testFilePath, "# Custom Legacy Rule");

      const augmentcodeLegacyRule = await AugmentcodeLegacyRule.fromFile({
        baseDir: customBaseDir,
        relativeFilePath: "custom-rule.md",
      });

      expect(augmentcodeLegacyRule.getFilePath()).toBe(
        join(customBaseDir, ".augment", "rules", "custom-rule.md"),
      );
      expect(augmentcodeLegacyRule.getFileContent()).toBe("# Custom Legacy Rule");
      expect(augmentcodeLegacyRule.isRoot()).toBe(false);
    });

    it("should create root AugmentcodeLegacyRule from file with custom baseDir", async () => {
      const customBaseDir = join(testDir, "custom");
      await ensureDir(customBaseDir);
      const testFilePath = join(customBaseDir, ".augment-guidelines");
      await writeFileContent(testFilePath, "# Custom Root Guidelines");

      const augmentcodeLegacyRule = await AugmentcodeLegacyRule.fromFile({
        baseDir: customBaseDir,
        relativeFilePath: ".augment-guidelines",
      });

      expect(augmentcodeLegacyRule.getFilePath()).toBe(join(customBaseDir, ".augment-guidelines"));
      expect(augmentcodeLegacyRule.getFileContent()).toBe("# Custom Root Guidelines");
      expect(augmentcodeLegacyRule.isRoot()).toBe(true);
    });

    it("should create AugmentcodeLegacyRule from file with validation enabled", async () => {
      const augmentRulesDir = join(testDir, ".augment", "rules");
      await ensureDir(augmentRulesDir);
      const testFilePath = join(augmentRulesDir, "validated-rule.md");
      await writeFileContent(testFilePath, "# Validated Legacy Rule");

      const augmentcodeLegacyRule = await AugmentcodeLegacyRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "validated-rule.md",
        validate: true,
      });

      expect(augmentcodeLegacyRule).toBeInstanceOf(AugmentcodeLegacyRule);
      expect(augmentcodeLegacyRule.getFileContent()).toBe("# Validated Legacy Rule");
    });

    it("should create AugmentcodeLegacyRule from file with validation disabled", async () => {
      const augmentRulesDir = join(testDir, ".augment", "rules");
      await ensureDir(augmentRulesDir);
      const testFilePath = join(augmentRulesDir, "unvalidated-rule.md");
      await writeFileContent(testFilePath, "# Unvalidated Legacy Rule");

      const augmentcodeLegacyRule = await AugmentcodeLegacyRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "unvalidated-rule.md",
        validate: false,
      });

      expect(augmentcodeLegacyRule).toBeInstanceOf(AugmentcodeLegacyRule);
      expect(augmentcodeLegacyRule.getFileContent()).toBe("# Unvalidated Legacy Rule");
    });

    it("should handle file content with different formats", async () => {
      const augmentRulesDir = join(testDir, ".augment", "rules");
      await ensureDir(augmentRulesDir);
      const testFilePath = join(augmentRulesDir, "formatted-rule.md");
      await writeFileContent(
        testFilePath,
        "# Formatted Legacy Rule\n\n- Item 1\n- Item 2\n\n## Section\n\nContent here.",
      );

      const augmentcodeLegacyRule = await AugmentcodeLegacyRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "formatted-rule.md",
      });

      expect(augmentcodeLegacyRule.getFileContent()).toBe(
        "# Formatted Legacy Rule\n\n- Item 1\n- Item 2\n\n## Section\n\nContent here.",
      );
    });

    it("should handle empty file content", async () => {
      const augmentRulesDir = join(testDir, ".augment", "rules");
      await ensureDir(augmentRulesDir);
      const testFilePath = join(augmentRulesDir, "empty-rule.md");
      await writeFileContent(testFilePath, "");

      const augmentcodeLegacyRule = await AugmentcodeLegacyRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "empty-rule.md",
      });

      expect(augmentcodeLegacyRule.getFileContent()).toBe("");
    });

    it("should throw error when non-root file does not exist", async () => {
      await expect(
        AugmentcodeLegacyRule.fromFile({
          baseDir: testDir,
          relativeFilePath: "nonexistent-rule.md",
        }),
      ).rejects.toThrow();
    });

    it("should throw error when root file does not exist", async () => {
      await expect(
        AugmentcodeLegacyRule.fromFile({
          baseDir: testDir,
          relativeFilePath: ".augment-guidelines",
        }),
      ).rejects.toThrow();
    });
  });

  describe("validate", () => {
    it("should always return successful validation", () => {
      const augmentcodeLegacyRule = new AugmentcodeLegacyRule({
        relativeDirPath: ".augment/rules",
        relativeFilePath: "test-rule.md",
        fileContent: "# Test Legacy Rule",
      });

      const validationResult = augmentcodeLegacyRule.validate();

      expect(validationResult.success).toBe(true);
      expect(validationResult.error).toBe(null);
    });

    it("should return successful validation for root rule", () => {
      const augmentcodeLegacyRule = new AugmentcodeLegacyRule({
        relativeDirPath: ".",
        relativeFilePath: ".augment-guidelines",
        fileContent: "# Root Guidelines",
        root: true,
      });

      const validationResult = augmentcodeLegacyRule.validate();

      expect(validationResult.success).toBe(true);
      expect(validationResult.error).toBe(null);
    });

    it("should return successful validation for empty content", () => {
      const augmentcodeLegacyRule = new AugmentcodeLegacyRule({
        relativeDirPath: ".augment/rules",
        relativeFilePath: "empty-rule.md",
        fileContent: "",
      });

      const validationResult = augmentcodeLegacyRule.validate();

      expect(validationResult.success).toBe(true);
      expect(validationResult.error).toBe(null);
    });

    it("should return successful validation for any content", () => {
      const augmentcodeLegacyRule = new AugmentcodeLegacyRule({
        relativeDirPath: ".augment/rules",
        relativeFilePath: "any-rule.md",
        fileContent: "Any kind of content\nwith multiple lines\nand various formats!@#$%",
      });

      const validationResult = augmentcodeLegacyRule.validate();

      expect(validationResult.success).toBe(true);
      expect(validationResult.error).toBe(null);
    });
  });

  describe("inheritance from ToolRule", () => {
    it("should inherit ToolRule methods and properties", () => {
      const augmentcodeLegacyRule = new AugmentcodeLegacyRule({
        relativeDirPath: ".augment/rules",
        relativeFilePath: "inheritance-test.md",
        fileContent: "# Inheritance Test",
      });

      // Test inherited methods
      expect(typeof augmentcodeLegacyRule.getBaseDir).toBe("function");
      expect(typeof augmentcodeLegacyRule.getRelativeDirPath).toBe("function");
      expect(typeof augmentcodeLegacyRule.getRelativeFilePath).toBe("function");
      expect(typeof augmentcodeLegacyRule.getFileContent).toBe("function");
      expect(typeof augmentcodeLegacyRule.getFilePath).toBe("function");
      expect(typeof augmentcodeLegacyRule.isRoot).toBe("function");

      // Test inherited method results
      expect(augmentcodeLegacyRule.getRelativeDirPath()).toBe(".augment/rules");
      expect(augmentcodeLegacyRule.getRelativeFilePath()).toBe("inheritance-test.md");
      expect(augmentcodeLegacyRule.getFileContent()).toBe("# Inheritance Test");
    });

    it("should properly handle root property from ToolRule", () => {
      const nonRootRule = new AugmentcodeLegacyRule({
        relativeDirPath: ".augment/rules",
        relativeFilePath: "non-root.md",
        fileContent: "# Non-Root Rule",
        root: false,
      });

      const rootRule = new AugmentcodeLegacyRule({
        relativeDirPath: ".",
        relativeFilePath: ".augment-guidelines",
        fileContent: "# Root Rule",
        root: true,
      });

      expect(nonRootRule.isRoot()).toBe(false);
      expect(rootRule.isRoot()).toBe(true);
    });
  });

  describe("type exports", () => {
    it("should export AugmentcodeLegacyRuleParams type", () => {
      // This test ensures the type is properly exported and can be used
      const params: import("./augmentcode-legacy-rule.js").AugmentcodeLegacyRuleParams = {
        relativeDirPath: ".augment/rules",
        relativeFilePath: "test.md",
        fileContent: "test content",
      };

      const rule = new AugmentcodeLegacyRule(params);
      expect(rule).toBeInstanceOf(AugmentcodeLegacyRule);
    });
  });
});
