import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { writeFileContent } from "../utils/file.js";
import { RulesyncRule } from "./rulesync-rule.js";
import { WindsurfRule } from "./windsurf-rule.js";

describe("WindsurfRule", () => {
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
      const windsurfRule = new WindsurfRule({
        relativeDirPath: ".windsurf/rules",
        relativeFilePath: "test-rule.md",
        fileContent: "# Test Rule\n\nThis is a test rule.",
      });

      expect(windsurfRule).toBeInstanceOf(WindsurfRule);
      expect(windsurfRule.getRelativeDirPath()).toBe(".windsurf/rules");
      expect(windsurfRule.getRelativeFilePath()).toBe("test-rule.md");
      expect(windsurfRule.getFileContent()).toBe("# Test Rule\n\nThis is a test rule.");
    });

    it("should create instance with custom baseDir", () => {
      const windsurfRule = new WindsurfRule({
        baseDir: "/custom/path",
        relativeDirPath: ".windsurf/rules",
        relativeFilePath: "test-rule.md",
        fileContent: "# Custom Rule",
      });

      expect(windsurfRule.getFilePath()).toBe("/custom/path/.windsurf/rules/test-rule.md");
    });

    it("should validate content by default", () => {
      expect(() => {
        const _instance = new WindsurfRule({
          relativeDirPath: ".windsurf/rules",
          relativeFilePath: "test-rule.md",
          fileContent: "", // empty content should be valid since validate always returns success
        });
      }).not.toThrow();
    });

    it("should skip validation when validate is false", () => {
      expect(() => {
        const _instance = new WindsurfRule({
          relativeDirPath: ".windsurf/rules",
          relativeFilePath: "test-rule.md",
          fileContent: "invalid content",
          validate: false,
        });
      }).not.toThrow();
    });

    it("should create instance with root property", () => {
      const windsurfRule = new WindsurfRule({
        relativeDirPath: ".windsurf/rules",
        relativeFilePath: "test-rule.md",
        fileContent: "# Test Rule",
        root: true,
      });

      expect(windsurfRule.isRoot()).toBe(true);
    });
  });

  describe("fromFile", () => {
    it("should create instance from file", async () => {
      const ruleContent = "# Test Rule\n\nThis is a test rule from file.";
      const filePath = join(testDir, ".windsurf", "rules", "test-rule.md");
      await writeFileContent(filePath, ruleContent);

      const windsurfRule = await WindsurfRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "test-rule.md",
      });

      expect(windsurfRule).toBeInstanceOf(WindsurfRule);
      expect(windsurfRule.getRelativeDirPath()).toBe(".windsurf/rules");
      expect(windsurfRule.getRelativeFilePath()).toBe("test-rule.md");
      expect(windsurfRule.getFileContent()).toBe(ruleContent);
      expect(windsurfRule.getFilePath()).toBe(filePath);
    });

    it("should create instance from file with validate false", async () => {
      const ruleContent = "# Another Rule";
      const filePath = join(testDir, ".windsurf", "rules", "another-rule.md");
      await writeFileContent(filePath, ruleContent);

      const windsurfRule = await WindsurfRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "another-rule.md",
        validate: false,
      });

      expect(windsurfRule.getFileContent()).toBe(ruleContent);
    });

    it("should create instance from file with custom baseDir", async () => {
      const customDir = join(testDir, "custom");
      const ruleContent = "# Custom Base Dir Rule";
      await writeFileContent(join(customDir, ".windsurf", "rules", "custom-rule.md"), ruleContent);

      const windsurfRule = await WindsurfRule.fromFile({
        baseDir: customDir,
        relativeFilePath: "custom-rule.md",
      });

      expect(windsurfRule.getFileContent()).toBe(ruleContent);
      expect(windsurfRule.getFilePath()).toBe(
        join(customDir, ".windsurf", "rules", "custom-rule.md"),
      );
    });

    it("should throw error when file does not exist", async () => {
      await expect(
        WindsurfRule.fromFile({
          baseDir: testDir,
          relativeFilePath: "non-existent.md",
        }),
      ).rejects.toThrow();
    });

    it("should handle nested file paths", async () => {
      const ruleContent = "# Nested Rule";
      await writeFileContent(
        join(testDir, ".windsurf", "rules", "nested", "deep", "nested-rule.md"),
        ruleContent,
      );

      const windsurfRule = await WindsurfRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "nested/deep/nested-rule.md",
      });

      expect(windsurfRule.getFileContent()).toBe(ruleContent);
      expect(windsurfRule.getRelativeFilePath()).toBe("nested/deep/nested-rule.md");
    });
  });

  describe("fromRulesyncRule", () => {
    it("should create instance from RulesyncRule with default parameters", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".rulesync",
        relativeFilePath: "test-rule.md",
        frontmatter: { description: "Test Rule" },
        body: "# Test Rule Content",
      });

      const windsurfRule = WindsurfRule.fromRulesyncRule({
        rulesyncRule,
      }) as WindsurfRule;

      expect(windsurfRule).toBeInstanceOf(WindsurfRule);
      expect(windsurfRule.getRelativeDirPath()).toBe(".windsurf/rules");
      expect(windsurfRule.getRelativeFilePath()).toBe("test-rule.md");
      expect(windsurfRule.getFileContent()).toBe("# Test Rule Content");
    });

    it("should create instance from RulesyncRule with custom baseDir", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: "/existing/path",
        relativeDirPath: ".rulesync",
        relativeFilePath: "custom-rule.md",
        frontmatter: { description: "Custom Rule" },
        body: "# Custom Content",
      });

      const windsurfRule = WindsurfRule.fromRulesyncRule({
        baseDir: "/custom/path",
        rulesyncRule,
      }) as WindsurfRule;

      expect(windsurfRule.getFilePath()).toBe("/custom/path/.windsurf/rules/custom-rule.md");
      expect(windsurfRule.getFileContent()).toBe("# Custom Content");
    });

    it("should create instance from RulesyncRule with validate false", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".rulesync",
        relativeFilePath: "test-rule.md",
        frontmatter: { description: "Test Rule" },
        body: "# Content",
      });

      const windsurfRule = WindsurfRule.fromRulesyncRule({
        rulesyncRule,
        validate: false,
      }) as WindsurfRule;

      expect(windsurfRule).toBeInstanceOf(WindsurfRule);
      expect(windsurfRule.getFileContent()).toBe("# Content");
    });

    it("should handle RulesyncRule with complex frontmatter", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".rulesync",
        relativeFilePath: "complex-rule.md",
        frontmatter: {
          description: "A complex rule with metadata",
          targets: ["windsurf", "cursor"],
        },
        body: "# Complex Rule\n\nThis is a complex rule with multiple targets.",
      });

      const windsurfRule = WindsurfRule.fromRulesyncRule({
        rulesyncRule,
      }) as WindsurfRule;

      expect(windsurfRule.getFileContent()).toBe(
        "# Complex Rule\n\nThis is a complex rule with multiple targets.",
      );
    });

    it("should handle RulesyncRule with empty content after frontmatter", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".rulesync",
        relativeFilePath: "empty-content.md",
        frontmatter: { description: "Empty Content" },
        body: "",
      });

      const windsurfRule = WindsurfRule.fromRulesyncRule({
        rulesyncRule,
      }) as WindsurfRule;

      expect(windsurfRule.getFileContent()).toBe("");
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert WindsurfRule to RulesyncRule", () => {
      const windsurfRule = new WindsurfRule({
        relativeDirPath: ".windsurf/rules",
        relativeFilePath: "test-rule.md",
        fileContent: "# Test Rule Content",
      });

      const rulesyncRule = windsurfRule.toRulesyncRule();

      expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
      expect(rulesyncRule.getRelativeFilePath()).toBe("test-rule.md");
      expect(rulesyncRule.getFileContent()).toContain("# Test Rule Content");
      expect(rulesyncRule.getFrontmatter()).toEqual({
        root: false,
        targets: ["*"],
        description: "",
        globs: [],
      });
    });

    it("should convert WindsurfRule with nested path to RulesyncRule", () => {
      const windsurfRule = new WindsurfRule({
        relativeDirPath: ".windsurf/rules",
        relativeFilePath: "category/subcategory/nested-rule.md",
        fileContent: "# Nested Rule Content",
      });

      const rulesyncRule = windsurfRule.toRulesyncRule();

      expect(rulesyncRule.getRelativeFilePath()).toBe("category/subcategory/nested-rule.md");
      expect(rulesyncRule.getFrontmatter().root).toBe(false);
    });

    it("should preserve file content during conversion", () => {
      const content =
        "# Multi-line Rule\n\nThis rule has:\n- Multiple lines\n- Various content\n- Special characters: !@#$%";
      const windsurfRule = new WindsurfRule({
        relativeDirPath: ".windsurf/rules",
        relativeFilePath: "multi-line.md",
        fileContent: content,
      });

      const rulesyncRule = windsurfRule.toRulesyncRule();

      expect(rulesyncRule.getFileContent()).toContain(content);
    });

    it("should handle empty content during conversion", () => {
      const windsurfRule = new WindsurfRule({
        relativeDirPath: ".windsurf/rules",
        relativeFilePath: "empty.md",
        fileContent: "",
      });

      const rulesyncRule = windsurfRule.toRulesyncRule();

      expect(rulesyncRule.getFileContent()).toContain(
        "---\nroot: false\ntargets:\n  - '*'\ndescription: ''\nglobs: []\n---\n",
      );
    });
  });

  describe("validate", () => {
    it("should always return success", () => {
      const windsurfRule = new WindsurfRule({
        relativeDirPath: ".windsurf/rules",
        relativeFilePath: "test-rule.md",
        fileContent: "# Test Content",
      });

      const result = windsurfRule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return success even for empty content", () => {
      const windsurfRule = new WindsurfRule({
        relativeDirPath: ".windsurf/rules",
        relativeFilePath: "empty.md",
        fileContent: "",
      });

      const result = windsurfRule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return success for any content", () => {
      const windsurfRule = new WindsurfRule({
        relativeDirPath: ".windsurf/rules",
        relativeFilePath: "any-content.md",
        fileContent: "Any kind of content\nWith special chars: !@#$%^&*()\nAnd unicode: 🚀🎉",
      });

      const result = windsurfRule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });

  describe("inheritance from ToolRule", () => {
    it("should inherit base functionality from ToolRule", () => {
      const windsurfRule = new WindsurfRule({
        relativeDirPath: ".windsurf/rules",
        relativeFilePath: "inheritance-test.md",
        fileContent: "# Inheritance Test",
      });

      // Test inherited methods
      expect(windsurfRule.getRelativeDirPath()).toBe(".windsurf/rules");
      expect(windsurfRule.getRelativeFilePath()).toBe("inheritance-test.md");
      expect(windsurfRule.getFileContent()).toBe("# Inheritance Test");
      expect(windsurfRule.isRoot()).toBe(false);
    });

    it("should support root property", () => {
      const windsurfRule = new WindsurfRule({
        relativeDirPath: ".windsurf/rules",
        relativeFilePath: "root-test.md",
        fileContent: "# Root Test",
        root: true, // true means it's a root rule
      });

      expect(windsurfRule.isRoot()).toBe(true);
    });
  });

  describe("error handling", () => {
    it("should handle file read errors in fromFile", async () => {
      await expect(
        WindsurfRule.fromFile({
          baseDir: "/non-existent-directory",
          relativeFilePath: "non-existent.md",
        }),
      ).rejects.toThrow();
    });

    it("should handle permission errors gracefully", async () => {
      // Try to read from a non-existent file in a valid directory
      await expect(
        WindsurfRule.fromFile({
          baseDir: testDir,
          relativeFilePath: "restricted/non-existent.md",
        }),
      ).rejects.toThrow();
    });
  });

  describe("integration with file system", () => {
    it("should work with various file extensions", async () => {
      const extensions = [".md", ".txt", ".rule"];

      for (const ext of extensions) {
        const fileName = `test-rule${ext}`;
        const content = `# Test Rule for ${ext}`;
        await writeFileContent(join(testDir, ".windsurf", "rules", fileName), content);

        const windsurfRule = await WindsurfRule.fromFile({
          baseDir: testDir,
          relativeFilePath: fileName,
        });

        expect(windsurfRule.getFileContent()).toBe(content);
        expect(windsurfRule.getRelativeFilePath()).toBe(fileName);
      }
    });

    it("should handle unicode content correctly", async () => {
      const unicodeContent = "# Unicode Rule 🚀\n\n日本語のルール\nEmoji: 🎉🔥💯";
      await writeFileContent(join(testDir, ".windsurf", "rules", "unicode.md"), unicodeContent);

      const windsurfRule = await WindsurfRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "unicode.md",
      });

      expect(windsurfRule.getFileContent()).toBe(unicodeContent);
    });

    it("should handle very large files", async () => {
      // Create a large content string
      const largeContent = "# Large Rule\n\n" + "A".repeat(10000) + "\n\nEnd of large rule.";
      await writeFileContent(join(testDir, ".windsurf", "rules", "large.md"), largeContent);

      const windsurfRule = await WindsurfRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "large.md",
      });

      expect(windsurfRule.getFileContent()).toBe(largeContent);
      expect(windsurfRule.getFileContent().length).toBe(largeContent.length);
    });
  });
});
