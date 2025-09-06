import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../utils/file.js";
import { GeminiCliRule } from "./geminicli-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("GeminiCliRule", () => {
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
      const geminiCliRule = new GeminiCliRule({
        relativeDirPath: ".gemini/memories",
        relativeFilePath: "test-rule.md",
        fileContent: "# Test Rule\n\nThis is a test rule.",
      });

      expect(geminiCliRule).toBeInstanceOf(GeminiCliRule);
      expect(geminiCliRule.getRelativeDirPath()).toBe(".gemini/memories");
      expect(geminiCliRule.getRelativeFilePath()).toBe("test-rule.md");
      expect(geminiCliRule.getFileContent()).toBe("# Test Rule\n\nThis is a test rule.");
    });

    it("should create instance with custom baseDir", () => {
      const geminiCliRule = new GeminiCliRule({
        baseDir: "/custom/path",
        relativeDirPath: ".gemini/memories",
        relativeFilePath: "test-rule.md",
        fileContent: "# Custom Rule",
      });

      expect(geminiCliRule.getFilePath()).toBe("/custom/path/.gemini/memories/test-rule.md");
    });

    it("should validate content by default", () => {
      expect(() => {
        const _instance = new GeminiCliRule({
          relativeDirPath: ".gemini/memories",
          relativeFilePath: "test-rule.md",
          fileContent: "", // empty content should be valid since validate always returns success
        });
      }).not.toThrow();
    });

    it("should skip validation when requested", () => {
      expect(() => {
        const _instance = new GeminiCliRule({
          relativeDirPath: ".gemini/memories",
          relativeFilePath: "test-rule.md",
          fileContent: "",
          validate: false,
        });
      }).not.toThrow();
    });

    it("should handle root rule parameter", () => {
      const geminiCliRule = new GeminiCliRule({
        relativeDirPath: ".",
        relativeFilePath: "GEMINI.md",
        fileContent: "# Root Rule",
        root: true,
      });

      expect(geminiCliRule.getFileContent()).toBe("# Root Rule");
      expect(geminiCliRule.getFilePath()).toBe("GEMINI.md");
    });
  });

  describe("fromFile", () => {
    it("should create instance from existing non-root file", async () => {
      // Setup test file
      const memoriesDir = join(testDir, ".gemini/memories");
      await ensureDir(memoriesDir);
      const testContent = "# Test Rule from File\n\nContent from file.";
      await writeFileContent(join(memoriesDir, "test.md"), testContent);

      const geminiCliRule = await GeminiCliRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "test.md",
      });

      expect(geminiCliRule.getRelativeDirPath()).toBe(".gemini/memories");
      expect(geminiCliRule.getRelativeFilePath()).toBe("test.md");
      expect(geminiCliRule.getFileContent()).toBe(testContent);
      expect(geminiCliRule.getFilePath()).toBe(join(testDir, ".gemini/memories/test.md"));
    });

    it("should create instance from root GEMINI.md file", async () => {
      // Setup root test file
      const testContent = "# Root Gemini CLI Rule\n\nThis is the root configuration.";
      await writeFileContent(join(testDir, "GEMINI.md"), testContent);

      const geminiCliRule = await GeminiCliRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "GEMINI.md",
      });

      expect(geminiCliRule.getRelativeDirPath()).toBe(".");
      expect(geminiCliRule.getRelativeFilePath()).toBe("GEMINI.md");
      expect(geminiCliRule.getFileContent()).toBe(testContent);
      expect(geminiCliRule.getFilePath()).toBe(join(testDir, "GEMINI.md"));
    });

    it("should use default baseDir when not provided", async () => {
      // Setup test file in current directory
      const memoriesDir = join(".", ".gemini/memories");
      await ensureDir(memoriesDir);
      const testContent = "# Default BaseDir Test";
      const testFilePath = join(memoriesDir, "default-test.md");
      await writeFileContent(testFilePath, testContent);

      try {
        const geminiCliRule = await GeminiCliRule.fromFile({
          relativeFilePath: "default-test.md",
        });

        expect(geminiCliRule.getRelativeDirPath()).toBe(".gemini/memories");
        expect(geminiCliRule.getRelativeFilePath()).toBe("default-test.md");
        expect(geminiCliRule.getFileContent()).toBe(testContent);
      } finally {
        // Cleanup
        await import("node:fs/promises").then((fs) =>
          fs.rm(memoriesDir, { recursive: true, force: true }),
        );
      }
    });

    it("should handle validation parameter", async () => {
      const memoriesDir = join(testDir, ".gemini/memories");
      await ensureDir(memoriesDir);
      const testContent = "# Validation Test";
      await writeFileContent(join(memoriesDir, "validation-test.md"), testContent);

      const geminiCliRuleWithValidation = await GeminiCliRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "validation-test.md",
        validate: true,
      });

      const geminiCliRuleWithoutValidation = await GeminiCliRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "validation-test.md",
        validate: false,
      });

      expect(geminiCliRuleWithValidation.getFileContent()).toBe(testContent);
      expect(geminiCliRuleWithoutValidation.getFileContent()).toBe(testContent);
    });

    it("should throw error when file does not exist", async () => {
      await expect(
        GeminiCliRule.fromFile({
          baseDir: testDir,
          relativeFilePath: "nonexistent.md",
        }),
      ).rejects.toThrow();
    });
  });

  describe("fromRulesyncRule", () => {
    it("should create instance from RulesyncRule", () => {
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

      const geminiCliRule = GeminiCliRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(geminiCliRule).toBeInstanceOf(GeminiCliRule);
      expect(geminiCliRule.getRelativeDirPath()).toBe(".gemini/memories");
      expect(geminiCliRule.getRelativeFilePath()).toBe("test-rule.md");
      expect(geminiCliRule.getFileContent()).toContain(
        "# Test RulesyncRule\n\nContent from rulesync.",
      );
    });

    it("should create root rule from root RulesyncRule", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".rulesync",
        relativeFilePath: "root.md",
        frontmatter: {
          root: true,
          targets: ["*"],
          description: "Root rule",
          globs: [],
        },
        body: "# Root RulesyncRule\n\nRoot content from rulesync.",
      });

      const geminiCliRule = GeminiCliRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(geminiCliRule).toBeInstanceOf(GeminiCliRule);
      expect(geminiCliRule.getRelativeDirPath()).toBe(".");
      expect(geminiCliRule.getRelativeFilePath()).toBe("GEMINI.md");
      expect(geminiCliRule.getFileContent()).toContain(
        "# Root RulesyncRule\n\nRoot content from rulesync.",
      );
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

      const geminiCliRule = GeminiCliRule.fromRulesyncRule({
        baseDir: "/custom/base",
        rulesyncRule,
      });

      expect(geminiCliRule.getFilePath()).toBe("/custom/base/.gemini/memories/custom-base.md");
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

      const geminiCliRuleWithValidation = GeminiCliRule.fromRulesyncRule({
        rulesyncRule,
        validate: true,
      });

      const geminiCliRuleWithoutValidation = GeminiCliRule.fromRulesyncRule({
        rulesyncRule,
        validate: false,
      });

      expect(geminiCliRuleWithValidation.getFileContent()).toContain("# Validation Test");
      expect(geminiCliRuleWithoutValidation.getFileContent()).toContain("# Validation Test");
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert GeminiCliRule to RulesyncRule", () => {
      const geminiCliRule = new GeminiCliRule({
        baseDir: testDir,
        relativeDirPath: ".gemini/memories",
        relativeFilePath: "convert-test.md",
        fileContent: "# Convert Test\n\nThis will be converted.",
      });

      const rulesyncRule = geminiCliRule.toRulesyncRule();

      expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
      expect(rulesyncRule.getRelativeDirPath()).toBe(".rulesync/rules");
      expect(rulesyncRule.getRelativeFilePath()).toBe("convert-test.md");
      expect(rulesyncRule.getFileContent()).toContain("# Convert Test\n\nThis will be converted.");
    });

    it("should preserve metadata in conversion", () => {
      const geminiCliRule = new GeminiCliRule({
        baseDir: "/test/path",
        relativeDirPath: ".",
        relativeFilePath: "GEMINI.md",
        fileContent: "# Root Gemini Rule\n\nRoot content.",
        root: true,
      });

      const rulesyncRule = geminiCliRule.toRulesyncRule();

      expect(rulesyncRule.getFilePath()).toBe("/test/path/.rulesync/rules/GEMINI.md");
      expect(rulesyncRule.getFileContent()).toContain("# Root Gemini Rule\n\nRoot content.");
    });
  });

  describe("validate", () => {
    it("should always return success", () => {
      const geminiCliRule = new GeminiCliRule({
        relativeDirPath: ".gemini/memories",
        relativeFilePath: "validation-test.md",
        fileContent: "# Any content is valid",
      });

      const result = geminiCliRule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return success for empty content", () => {
      const geminiCliRule = new GeminiCliRule({
        relativeDirPath: ".gemini/memories",
        relativeFilePath: "empty.md",
        fileContent: "",
      });

      const result = geminiCliRule.validate();

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
        "Unicode characters: 🚀 📝 ✨",
      ];

      for (const content of contents) {
        const geminiCliRule = new GeminiCliRule({
          relativeDirPath: ".gemini/memories",
          relativeFilePath: "test.md",
          fileContent: content,
        });

        const result = geminiCliRule.validate();
        expect(result.success).toBe(true);
        expect(result.error).toBeNull();
      }
    });

    it("should return success for root rule", () => {
      const geminiCliRule = new GeminiCliRule({
        relativeDirPath: ".",
        relativeFilePath: "GEMINI.md",
        fileContent: "# Root rule content",
        root: true,
      });

      const result = geminiCliRule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });

  describe("integration tests", () => {
    it("should handle complete workflow from file to rulesync rule", async () => {
      // Create original file
      const memoriesDir = join(testDir, ".gemini/memories");
      await ensureDir(memoriesDir);
      const originalContent = "# Integration Test\n\nComplete workflow test.";
      await writeFileContent(join(memoriesDir, "integration.md"), originalContent);

      // Load from file
      const geminiCliRule = await GeminiCliRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "integration.md",
      });

      // Convert to rulesync rule
      const rulesyncRule = geminiCliRule.toRulesyncRule();

      // Verify conversion
      expect(rulesyncRule.getFileContent()).toContain(originalContent);
      expect(rulesyncRule.getRelativeDirPath()).toBe(".rulesync/rules");
      expect(rulesyncRule.getRelativeFilePath()).toBe("integration.md");
    });

    it("should handle root file workflow", async () => {
      // Create root file
      const rootContent = "# Root Gemini CLI Configuration\n\nThis is the main configuration.";
      await writeFileContent(join(testDir, "GEMINI.md"), rootContent);

      // Load from file
      const geminiCliRule = await GeminiCliRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "GEMINI.md",
      });

      // Verify root properties
      expect(geminiCliRule.getRelativeDirPath()).toBe(".");
      expect(geminiCliRule.getRelativeFilePath()).toBe("GEMINI.md");
      expect(geminiCliRule.getFileContent()).toBe(rootContent);

      // Convert to rulesync rule
      const rulesyncRule = geminiCliRule.toRulesyncRule();

      // Verify conversion
      expect(rulesyncRule.getFileContent()).toContain(rootContent);
      expect(rulesyncRule.getRelativeDirPath()).toBe(".rulesync/rules");
      expect(rulesyncRule.getRelativeFilePath()).toBe("GEMINI.md");
    });

    it("should handle roundtrip conversion rulesync -> geminicli -> rulesync", () => {
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

      // Convert to gemini cli rule
      const geminiCliRule = GeminiCliRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule: originalRulesync,
      });

      // Convert back to rulesync rule
      const finalRulesync = geminiCliRule.toRulesyncRule();

      // Verify content preservation
      expect(finalRulesync.getFileContent()).toContain(originalBody);
      expect(finalRulesync.getRelativeFilePath()).toBe("roundtrip.md");
    });

    it("should handle roundtrip conversion with root rule", () => {
      const originalBody = "# Root Roundtrip Test\n\nRoot content should remain the same.";

      // Start with root rulesync rule
      const originalRulesync = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "root-roundtrip.md",
        frontmatter: {
          root: true,
          targets: ["*"],
          description: "",
          globs: [],
        },
        body: originalBody,
      });

      // Convert to gemini cli rule
      const geminiCliRule = GeminiCliRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule: originalRulesync,
      });

      // Verify root conversion
      expect(geminiCliRule.getRelativeDirPath()).toBe(".");
      expect(geminiCliRule.getRelativeFilePath()).toBe("GEMINI.md");

      // Convert back to rulesync rule
      const finalRulesync = geminiCliRule.toRulesyncRule();

      // Verify content preservation
      expect(finalRulesync.getFileContent()).toContain(originalBody);
      expect(finalRulesync.getRelativeFilePath()).toBe("GEMINI.md");
    });

    it("should handle mixed file types in directory", async () => {
      // Create multiple files
      const memoriesDir = join(testDir, ".gemini/memories");
      await ensureDir(memoriesDir);

      const files = [
        { name: "general.md", content: "# General Rules\n\nGeneral content." },
        { name: "specific.md", content: "# Specific Rules\n\nSpecific content." },
        { name: "guidelines.md", content: "# Guidelines\n\nGuideline content." },
      ];

      // Write all files
      for (const file of files) {
        await writeFileContent(join(memoriesDir, file.name), file.content);
      }

      // Load each file and verify
      for (const file of files) {
        const geminiCliRule = await GeminiCliRule.fromFile({
          baseDir: testDir,
          relativeFilePath: file.name,
        });

        expect(geminiCliRule.getFileContent()).toBe(file.content);
        expect(geminiCliRule.getRelativeDirPath()).toBe(".gemini/memories");
        expect(geminiCliRule.getRelativeFilePath()).toBe(file.name);

        // Verify conversion works
        const rulesyncRule = geminiCliRule.toRulesyncRule();
        expect(rulesyncRule.getFileContent()).toContain(file.content);
      }
    });

    it("should handle large content files", () => {
      const largeContent = "# Large Content Test\n\n" + "Lorem ipsum dolor sit amet. ".repeat(1000);

      const geminiCliRule = new GeminiCliRule({
        baseDir: testDir,
        relativeDirPath: ".gemini/memories",
        relativeFilePath: "large.md",
        fileContent: largeContent,
      });

      // Verify validation still works
      const result = geminiCliRule.validate();
      expect(result.success).toBe(true);

      // Verify conversion works
      const rulesyncRule = geminiCliRule.toRulesyncRule();
      expect(rulesyncRule.getFileContent()).toContain(largeContent);
    });
  });
});
