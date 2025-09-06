import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../utils/file.js";
import { QwencodeRule } from "./qwencode-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("QwencodeRule", () => {
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
      const qwencodeRule = new QwencodeRule({
        relativeDirPath: ".qwencode/memories",
        relativeFilePath: "test-rule.md",
        fileContent: "# Test Rule\n\nThis is a test rule.",
      });

      expect(qwencodeRule).toBeInstanceOf(QwencodeRule);
      expect(qwencodeRule.getRelativeDirPath()).toBe(".qwencode/memories");
      expect(qwencodeRule.getRelativeFilePath()).toBe("test-rule.md");
      expect(qwencodeRule.getFileContent()).toBe("# Test Rule\n\nThis is a test rule.");
      expect(qwencodeRule.isRoot()).toBe(false);
    });

    it("should create instance with custom baseDir", () => {
      const qwencodeRule = new QwencodeRule({
        baseDir: "/custom/path",
        relativeDirPath: ".qwencode/memories",
        relativeFilePath: "test-rule.md",
        fileContent: "# Custom Rule",
      });

      expect(qwencodeRule.getFilePath()).toBe("/custom/path/.qwencode/memories/test-rule.md");
      expect(qwencodeRule.isRoot()).toBe(false);
    });

    it("should validate content by default", () => {
      expect(() => {
        const _instance = new QwencodeRule({
          relativeDirPath: ".qwencode/memories",
          relativeFilePath: "test-rule.md",
          fileContent: "", // empty content should be valid since validate always returns success
        });
      }).not.toThrow();
    });

    it("should skip validation when requested", () => {
      expect(() => {
        const _instance = new QwencodeRule({
          relativeDirPath: ".qwencode/memories",
          relativeFilePath: "test-rule.md",
          fileContent: "",
          validate: false,
        });
      }).not.toThrow();
    });

    it("should handle root rule parameter", () => {
      const qwencodeRule = new QwencodeRule({
        relativeDirPath: ".",
        relativeFilePath: "QWEN.md",
        fileContent: "# Root Rule",
        root: true,
      });

      expect(qwencodeRule.isRoot()).toBe(true);
      expect(qwencodeRule.getFileContent()).toBe("# Root Rule");
    });

    it("should handle non-root rule parameter", () => {
      const qwencodeRule = new QwencodeRule({
        relativeDirPath: ".qwencode/memories",
        relativeFilePath: "non-root-rule.md",
        fileContent: "# Non-Root Rule",
        root: false,
      });

      expect(qwencodeRule.isRoot()).toBe(false);
      expect(qwencodeRule.getFileContent()).toBe("# Non-Root Rule");
    });
  });

  describe("fromFile", () => {
    it("should create instance from existing non-root file", async () => {
      // Setup test file
      const memoriesDir = join(testDir, ".qwencode/memories");
      await ensureDir(memoriesDir);
      const testContent = "# Test Rule from File\n\nContent from file.";
      await writeFileContent(join(memoriesDir, "test.md"), testContent);

      const qwencodeRule = await QwencodeRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "test.md",
      });

      expect(qwencodeRule.getRelativeDirPath()).toBe(".qwencode/memories");
      expect(qwencodeRule.getRelativeFilePath()).toBe("test.md");
      expect(qwencodeRule.getFileContent()).toBe(testContent);
      expect(qwencodeRule.getFilePath()).toBe(join(testDir, ".qwencode/memories/test.md"));
      expect(qwencodeRule.isRoot()).toBe(false);
    });

    it("should create instance from existing root file (QWEN.md)", async () => {
      // Setup root test file
      const testContent = "# Root Rule from File\n\nThis is the root QWEN.md file.";
      await writeFileContent(join(testDir, "QWEN.md"), testContent);

      const qwencodeRule = await QwencodeRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "QWEN.md",
      });

      expect(qwencodeRule.getRelativeDirPath()).toBe(".");
      expect(qwencodeRule.getRelativeFilePath()).toBe("QWEN.md");
      expect(qwencodeRule.getFileContent()).toBe(testContent);
      expect(qwencodeRule.getFilePath()).toBe(join(testDir, "QWEN.md"));
      expect(qwencodeRule.isRoot()).toBe(true);
    });

    it("should use default baseDir when not provided", async () => {
      // Setup test file in current directory
      const memoriesDir = join(".", ".qwencode/memories");
      await ensureDir(memoriesDir);
      const testContent = "# Default BaseDir Test";
      const testFilePath = join(memoriesDir, "default-test.md");
      await writeFileContent(testFilePath, testContent);

      try {
        const qwencodeRule = await QwencodeRule.fromFile({
          relativeFilePath: "default-test.md",
        });

        expect(qwencodeRule.getRelativeDirPath()).toBe(".qwencode/memories");
        expect(qwencodeRule.getRelativeFilePath()).toBe("default-test.md");
        expect(qwencodeRule.getFileContent()).toBe(testContent);
        expect(qwencodeRule.isRoot()).toBe(false);
      } finally {
        // Cleanup
        await import("node:fs/promises").then((fs) =>
          fs.rm(memoriesDir, { recursive: true, force: true }),
        );
      }
    });

    it("should handle root file detection with default baseDir", async () => {
      // Setup root test file in current directory
      const testContent = "# Root Default BaseDir Test";
      const rootFilePath = join(".", "QWEN.md");
      await writeFileContent(rootFilePath, testContent);

      try {
        const qwencodeRule = await QwencodeRule.fromFile({
          relativeFilePath: "QWEN.md",
        });

        expect(qwencodeRule.getRelativeDirPath()).toBe(".");
        expect(qwencodeRule.getRelativeFilePath()).toBe("QWEN.md");
        expect(qwencodeRule.getFileContent()).toBe(testContent);
        expect(qwencodeRule.isRoot()).toBe(true);
      } finally {
        // Cleanup
        await import("node:fs/promises").then((fs) => fs.rm(rootFilePath, { force: true }));
      }
    });

    it("should handle validation parameter", async () => {
      const memoriesDir = join(testDir, ".qwencode/memories");
      await ensureDir(memoriesDir);
      const testContent = "# Validation Test";
      await writeFileContent(join(memoriesDir, "validation-test.md"), testContent);

      const qwencodeRuleWithValidation = await QwencodeRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "validation-test.md",
        validate: true,
      });

      const qwencodeRuleWithoutValidation = await QwencodeRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "validation-test.md",
        validate: false,
      });

      expect(qwencodeRuleWithValidation.getFileContent()).toBe(testContent);
      expect(qwencodeRuleWithoutValidation.getFileContent()).toBe(testContent);
    });

    it("should throw error when file does not exist", async () => {
      await expect(
        QwencodeRule.fromFile({
          baseDir: testDir,
          relativeFilePath: "nonexistent.md",
        }),
      ).rejects.toThrow();
    });

    it("should throw error when root file does not exist", async () => {
      await expect(
        QwencodeRule.fromFile({
          baseDir: testDir,
          relativeFilePath: "QWEN.md",
        }),
      ).rejects.toThrow();
    });
  });

  describe("fromRulesyncRule", () => {
    it("should create instance from non-root RulesyncRule", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".rulesync",
        relativeFilePath: "test-rule.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "Test rule",
          globs: [],
        },
        body: "# Test RulesyncRule\n\nContent from rulesync.",
      });

      const qwencodeRule = QwencodeRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(qwencodeRule).toBeInstanceOf(QwencodeRule);
      expect(qwencodeRule.getRelativeDirPath()).toBe(".qwencode/memories");
      expect(qwencodeRule.getRelativeFilePath()).toBe("test-rule.md");
      expect(qwencodeRule.getFileContent()).toBe("# Test RulesyncRule\n\nContent from rulesync.");
      expect(qwencodeRule.isRoot()).toBe(false);
    });

    it("should create instance from root RulesyncRule", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".rulesync",
        relativeFilePath: "root-rule.md",
        frontmatter: {
          root: true,
          targets: ["*"],
          description: "Root rule",
          globs: ["**/*"],
        },
        body: "# Root RulesyncRule\n\nContent from root rulesync.",
      });

      const qwencodeRule = QwencodeRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(qwencodeRule).toBeInstanceOf(QwencodeRule);
      expect(qwencodeRule.getRelativeDirPath()).toBe(".");
      expect(qwencodeRule.getRelativeFilePath()).toBe("QWEN.md");
      expect(qwencodeRule.getFileContent()).toBe(
        "# Root RulesyncRule\n\nContent from root rulesync.",
      );
      expect(qwencodeRule.isRoot()).toBe(true);
    });

    it("should use custom baseDir", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".rulesync",
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
        baseDir: "/custom/base",
        rulesyncRule,
      });

      expect(qwencodeRule.getFilePath()).toBe("/custom/base/.qwencode/memories/custom-base.md");
      expect(qwencodeRule.isRoot()).toBe(false);
    });

    it("should handle validation parameter", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".rulesync",
        relativeFilePath: "validation.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "",
          globs: [],
        },
        body: "# Validation Test",
      });

      const qwencodeRuleWithValidation = QwencodeRule.fromRulesyncRule({
        rulesyncRule,
        validate: true,
      });

      const qwencodeRuleWithoutValidation = QwencodeRule.fromRulesyncRule({
        rulesyncRule,
        validate: false,
      });

      expect(qwencodeRuleWithValidation.getFileContent()).toBe("# Validation Test");
      expect(qwencodeRuleWithoutValidation.getFileContent()).toBe("# Validation Test");
    });

    it("should handle undefined root frontmatter as false", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".rulesync",
        relativeFilePath: "no-root-frontmatter.md",
        frontmatter: {
          targets: ["*"],
          description: "",
          globs: [],
        } as any, // root is undefined
        body: "# No Root Frontmatter",
      });

      const qwencodeRule = QwencodeRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(qwencodeRule.isRoot()).toBe(false);
      expect(qwencodeRule.getRelativeDirPath()).toBe(".qwencode/memories");
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert non-root QwencodeRule to RulesyncRule", () => {
      const qwencodeRule = new QwencodeRule({
        baseDir: testDir,
        relativeDirPath: ".qwencode/memories",
        relativeFilePath: "convert-test.md",
        fileContent: "# Convert Test\n\nThis will be converted.",
      });

      const rulesyncRule = qwencodeRule.toRulesyncRule();

      expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
      expect(rulesyncRule.getRelativeDirPath()).toBe(".rulesync/rules");
      expect(rulesyncRule.getRelativeFilePath()).toBe("convert-test.md");
      expect(rulesyncRule.getBody()).toBe("# Convert Test\n\nThis will be converted.");

      const frontmatter = rulesyncRule.getFrontmatter();
      expect(frontmatter.root).toBe(false);
      expect(frontmatter.targets).toEqual(["*"]);
      expect(frontmatter.description).toBe("");
      expect(frontmatter.globs).toEqual([]);
    });

    it("should convert root QwencodeRule to RulesyncRule", () => {
      const qwencodeRule = new QwencodeRule({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "QWEN.md",
        fileContent: "# Root Convert Test\n\nThis root will be converted.",
        root: true,
      });

      const rulesyncRule = qwencodeRule.toRulesyncRule();

      expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
      expect(rulesyncRule.getRelativeDirPath()).toBe(".rulesync/rules");
      expect(rulesyncRule.getRelativeFilePath()).toBe("QWEN.md");
      expect(rulesyncRule.getBody()).toBe("# Root Convert Test\n\nThis root will be converted.");

      const frontmatter = rulesyncRule.getFrontmatter();
      expect(frontmatter.root).toBe(true);
      expect(frontmatter.targets).toEqual(["*"]);
      expect(frontmatter.description).toBe("");
      expect(frontmatter.globs).toEqual(["**/*"]);
    });

    it("should preserve metadata in conversion", () => {
      const qwencodeRule = new QwencodeRule({
        baseDir: "/test/path",
        relativeDirPath: ".qwencode/memories",
        relativeFilePath: "metadata-test.md",
        fileContent: "# Metadata Test\n\nContent with metadata.",
      });

      const rulesyncRule = qwencodeRule.toRulesyncRule();

      expect(rulesyncRule.getFilePath()).toBe("/test/path/.rulesync/rules/metadata-test.md");
      expect(rulesyncRule.getBody()).toBe("# Metadata Test\n\nContent with metadata.");
    });
  });

  describe("validate", () => {
    it("should always return success", () => {
      const qwencodeRule = new QwencodeRule({
        relativeDirPath: ".qwencode/memories",
        relativeFilePath: "validation-test.md",
        fileContent: "# Any content is valid",
      });

      const result = qwencodeRule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return success for empty content", () => {
      const qwencodeRule = new QwencodeRule({
        relativeDirPath: ".qwencode/memories",
        relativeFilePath: "empty.md",
        fileContent: "",
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

    it("should return success for any content format", () => {
      const contents = [
        "# Markdown content",
        "Plain text content",
        "---\nfrontmatter: true\n---\nContent with frontmatter",
        "/* Code comments */",
        "Invalid markdown ### ###",
      ];

      for (const content of contents) {
        const qwencodeRule = new QwencodeRule({
          relativeDirPath: ".qwencode/memories",
          relativeFilePath: "test.md",
          fileContent: content,
        });

        const result = qwencodeRule.validate();
        expect(result.success).toBe(true);
        expect(result.error).toBeNull();
      }
    });
  });

  describe("integration tests", () => {
    it("should handle complete workflow from non-root file to rulesync rule", async () => {
      // Create original file
      const memoriesDir = join(testDir, ".qwencode/memories");
      await ensureDir(memoriesDir);
      const originalContent = "# Integration Test\n\nComplete workflow test.";
      await writeFileContent(join(memoriesDir, "integration.md"), originalContent);

      // Load from file
      const qwencodeRule = await QwencodeRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "integration.md",
      });

      // Convert to rulesync rule
      const rulesyncRule = qwencodeRule.toRulesyncRule();

      // Verify conversion
      expect(rulesyncRule.getBody()).toBe(originalContent);
      expect(rulesyncRule.getRelativeDirPath()).toBe(".rulesync/rules");
      expect(rulesyncRule.getRelativeFilePath()).toBe("integration.md");
    });

    it("should handle complete workflow from root file to rulesync rule", async () => {
      // Create root file
      const originalContent = "# Root Integration Test\n\nComplete root workflow test.";
      await writeFileContent(join(testDir, "QWEN.md"), originalContent);

      // Load from file
      const qwencodeRule = await QwencodeRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "QWEN.md",
      });

      expect(qwencodeRule.isRoot()).toBe(true);

      // Convert to rulesync rule
      const rulesyncRule = qwencodeRule.toRulesyncRule();

      // Verify conversion
      expect(rulesyncRule.getBody()).toBe(originalContent);
      expect(rulesyncRule.getRelativeDirPath()).toBe(".rulesync/rules");
      expect(rulesyncRule.getRelativeFilePath()).toBe("QWEN.md");
      expect(rulesyncRule.getFrontmatter().root).toBe(true);
    });

    it("should handle roundtrip conversion rulesync -> qwencode -> rulesync", () => {
      const originalBody = "# Roundtrip Test\n\nContent should remain the same.";

      // Start with rulesync rule
      const originalRulesync = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "roundtrip.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "",
          globs: [],
        },
        body: originalBody,
      });

      // Convert to qwencode rule
      const qwencodeRule = QwencodeRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule: originalRulesync,
      });

      // Convert back to rulesync rule
      const finalRulesync = qwencodeRule.toRulesyncRule();

      // Verify content preservation
      expect(finalRulesync.getBody()).toBe(originalBody);
      expect(finalRulesync.getRelativeFilePath()).toBe("roundtrip.md");
    });

    it("should preserve root status through roundtrip conversion", () => {
      const originalBody = "# Root Roundtrip Test";

      // Start with root rulesync rule
      const originalRulesync = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "root-roundtrip.md",
        frontmatter: {
          root: true,
          targets: ["*"],
          description: "",
          globs: ["**/*"],
        },
        body: originalBody,
      });

      // Convert to qwencode rule
      const qwencodeRule = QwencodeRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule: originalRulesync,
      });

      expect(qwencodeRule.isRoot()).toBe(true);

      // Convert back to rulesync rule
      const finalRulesync = qwencodeRule.toRulesyncRule();

      // Verify root status preservation
      expect(finalRulesync.getFrontmatter().root).toBe(true);
      expect(finalRulesync.getFrontmatter().globs).toEqual(["**/*"]);
    });

    it("should handle path determination correctly for root vs non-root files", () => {
      // Test non-root file path determination
      const nonRootRulesync = new RulesyncRule({
        relativeDirPath: ".rulesync",
        relativeFilePath: "non-root.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "",
          globs: [],
        },
        body: "# Non-Root Rule",
      });

      const nonRootQwencode = QwencodeRule.fromRulesyncRule({
        rulesyncRule: nonRootRulesync,
      });

      expect(nonRootQwencode.getRelativeDirPath()).toBe(".qwencode/memories");
      expect(nonRootQwencode.getRelativeFilePath()).toBe("non-root.md");
      expect(nonRootQwencode.isRoot()).toBe(false);

      // Test root file path determination
      const rootRulesync = new RulesyncRule({
        relativeDirPath: ".rulesync",
        relativeFilePath: "some-root.md",
        frontmatter: {
          root: true,
          targets: ["*"],
          description: "",
          globs: ["**/*"],
        },
        body: "# Root Rule",
      });

      const rootQwencode = QwencodeRule.fromRulesyncRule({
        rulesyncRule: rootRulesync,
      });

      expect(rootQwencode.getRelativeDirPath()).toBe(".");
      expect(rootQwencode.getRelativeFilePath()).toBe("QWEN.md");
      expect(rootQwencode.isRoot()).toBe(true);
    });
  });
});
