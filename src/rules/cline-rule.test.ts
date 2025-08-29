import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import { ClineRule, type ClineRuleFrontmatter } from "./cline-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("ClineRule", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("constructor", () => {
    it("should create instance with valid parameters", () => {
      const frontmatter: ClineRuleFrontmatter = {
        description: "Test rule",
      };

      const rule = new ClineRule({
        baseDir: testDir,
        relativeDirPath: ".clinerules",
        relativeFilePath: "test-rule.md",
        frontmatter,
        body: "This is a test rule",
        fileContent: "This is a test rule",
      });

      expect(rule).toBeInstanceOf(ClineRule);
      expect(rule.getFrontmatter()).toEqual(frontmatter);
      expect(rule.getBody()).toBe("This is a test rule");
    });

    it("should validate frontmatter by default", () => {
      expect(() => {
        const _rule = new ClineRule({
          baseDir: testDir,
          relativeDirPath: ".clinerules",
          relativeFilePath: "test-rule.md",
          frontmatter: {} as ClineRuleFrontmatter, // Invalid frontmatter
          body: "This is a test rule",
          fileContent: "This is a test rule",
        });
      }).toThrow();
    });

    it("should skip validation when validate=false", () => {
      const rule = new ClineRule({
        baseDir: testDir,
        relativeDirPath: ".clinerules",
        relativeFilePath: "test-rule.md",
        frontmatter: {} as ClineRuleFrontmatter, // Invalid frontmatter
        body: "This is a test rule",
        fileContent: "This is a test rule",
        validate: false,
      });

      expect(rule).toBeInstanceOf(ClineRule);
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert to RulesyncRule correctly", () => {
      const frontmatter: ClineRuleFrontmatter = {
        description: "Test rule for Cline",
      };

      const rule = new ClineRule({
        baseDir: testDir,
        relativeDirPath: ".clinerules",
        relativeFilePath: "test-rule.md",
        frontmatter,
        body: "This is a test rule",
        fileContent: "This is a test rule",
      });

      const rulesyncRule = rule.toRulesyncRule();

      expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
      expect(rulesyncRule.getFrontmatter()).toEqual({
        targets: ["cline"],
        root: false,
        description: "Test rule for Cline",
        globs: [],
      });
      expect(rulesyncRule.getBody()).toBe("This is a test rule");
      expect(rulesyncRule.getRelativeDirPath()).toBe(".rulesync/rules");
      expect(rulesyncRule.getRelativeFilePath()).toBe("test-rule.md");
    });
  });

  describe("fromRulesyncRule", () => {
    it("should create ClineRule from RulesyncRule", () => {
      // Create a RulesyncRule first
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "test-rule.md",
        frontmatter: {
          targets: ["cline"],
          root: false,
          description: "Test rule from Rulesync",
          globs: [],
        },
        body: "This is a converted rule",
        fileContent:
          "---\ntargets: [cline]\ndescription: Test rule from Rulesync\n---\nThis is a converted rule",
        validate: false,
      });

      const clineRule = ClineRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule,
        relativeDirPath: ".clinerules",
      }) as ClineRule;

      expect(clineRule).toBeInstanceOf(ClineRule);
      expect(clineRule.getFrontmatter()).toEqual({
        description: "Test rule from Rulesync",
      });
      expect(clineRule.getBody()).toBe("This is a converted rule");
    });
  });

  describe("validate", () => {
    it("should return success for valid frontmatter", () => {
      const frontmatter: ClineRuleFrontmatter = {
        description: "Valid test rule",
      };

      const rule = new ClineRule({
        baseDir: testDir,
        relativeDirPath: ".clinerules",
        relativeFilePath: "test-rule.md",
        frontmatter,
        body: "This is a test rule",
        fileContent: "This is a test rule",
        validate: false, // Skip constructor validation to test validate() method
      });

      const result = rule.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return error for invalid frontmatter", () => {
      const rule = new ClineRule({
        baseDir: testDir,
        relativeDirPath: ".clinerules",
        relativeFilePath: "test-rule.md",
        frontmatter: {} as ClineRuleFrontmatter, // Invalid frontmatter
        body: "This is a test rule",
        fileContent: "This is a test rule",
        validate: false, // Skip constructor validation
      });

      const result = rule.validate();
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it("should return success when frontmatter is undefined", () => {
      const rule = new ClineRule({
        baseDir: testDir,
        relativeDirPath: ".clinerules",
        relativeFilePath: "test-rule.md",
        frontmatter: undefined as any,
        body: "This is a test rule",
        fileContent: "This is a test rule",
        validate: false,
      });

      const result = rule.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });

  describe("fromFilePath", () => {
    it("should create rule from file with heading", async () => {
      const filePath = join(testDir, "test-rule.md");
      const content = "# Coding Standards\n\nFollow TypeScript best practices.";
      await writeFile(filePath, content);

      const rule = await ClineRule.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".clinerules",
        relativeFilePath: "test-rule.md",
        filePath,
      });

      expect(rule.getFrontmatter().description).toBe("Coding Standards");
      expect(rule.getBody()).toBe(content);
    });

    it("should create rule from file without heading using filename", async () => {
      const filePath = join(testDir, "coding-standards.md");
      const content = "Follow TypeScript best practices.";
      await writeFile(filePath, content);

      const rule = await ClineRule.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".clinerules",
        relativeFilePath: "coding-standards.md",
        filePath,
      });

      expect(rule.getFrontmatter().description).toBe("Coding Standards");
      expect(rule.getBody()).toBe(content);
    });

    it("should handle filenames with underscores", async () => {
      const filePath = join(testDir, "api_design_rules.md");
      const content = "API design guidelines.";
      await writeFile(filePath, content);

      const rule = await ClineRule.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".clinerules",
        relativeFilePath: "api_design_rules.md",
        filePath,
      });

      expect(rule.getFrontmatter().description).toBe("Api Design Rules");
      expect(rule.getBody()).toBe(content);
    });

    it("should handle empty files", async () => {
      const filePath = join(testDir, "empty.md");
      await writeFile(filePath, "");

      const rule = await ClineRule.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".clinerules",
        relativeFilePath: "empty.md",
        filePath,
      });

      expect(rule.getFrontmatter().description).toBe("Empty");
      expect(rule.getBody()).toBe("");
    });

    it("should use default description for files without extension", async () => {
      const filePath = join(testDir, "rules");
      const content = "Some rules here.";
      await writeFile(filePath, content);

      const rule = await ClineRule.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".clinerules",
        relativeFilePath: "rules",
        filePath,
      });

      expect(rule.getFrontmatter().description).toBe("Rules");
      expect(rule.getBody()).toBe(content);
    });

    it("should handle multiple headings and use the first one", async () => {
      const filePath = join(testDir, "multiple-headings.md");
      const content =
        "Some content\n\n# First Heading\n\nMore content\n\n# Second Heading\n\nEven more content";
      await writeFile(filePath, content);

      const rule = await ClineRule.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".clinerules",
        relativeFilePath: "multiple-headings.md",
        filePath,
      });

      expect(rule.getFrontmatter().description).toBe("First Heading");
      expect(rule.getBody()).toBe(content);
    });

    it("should skip validation when validate=false", async () => {
      const filePath = join(testDir, "test-rule.md");
      const content = "# Test Rule\n\nThis is a test rule.";
      await writeFile(filePath, content);

      const rule = await ClineRule.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".clinerules",
        relativeFilePath: "test-rule.md",
        filePath,
        validate: false,
      });

      expect(rule).toBeInstanceOf(ClineRule);
    });

    it("should handle complex filenames", async () => {
      const filePath = join(testDir, "complex-file-name_with-special123.md");
      const content = "Complex rule content.";
      await writeFile(filePath, content);

      const rule = await ClineRule.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".clinerules",
        relativeFilePath: "complex-file-name_with-special123.md",
        filePath,
      });

      expect(rule.getFrontmatter().description).toBe("Complex File Name With Special123");
      expect(rule.getBody()).toBe(content);
    });
  });

  describe("static methods", () => {
    it("should create rule from valid file path", async () => {
      const filePath = join(testDir, "test.md");
      const content = "# Test Rule\n\nThis is a test rule.";
      await writeFile(filePath, content);

      const rule = await ClineRule.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".clinerules",
        relativeFilePath: "test.md",
        filePath,
      });

      expect(rule).toBeInstanceOf(ClineRule);
      expect(rule.getFrontmatter().description).toBe("Test Rule");
      expect(rule.getBody()).toBe(content);
    });
  });

  describe("edge cases", () => {
    it("should handle very long content", async () => {
      const filePath = join(testDir, "long-content.md");
      const longContent = "# Long Rule\n\n" + "a".repeat(10000);
      await writeFile(filePath, longContent);

      const rule = await ClineRule.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".clinerules",
        relativeFilePath: "long-content.md",
        filePath,
      });

      expect(rule.getFrontmatter().description).toBe("Long Rule");
      expect(rule.getBody().length).toBe(longContent.length);
    });

    it("should handle special characters in headings", async () => {
      const filePath = join(testDir, "special-chars.md");
      const content = "# Rule with Special Chars: @#$%\n\nContent here.";
      await writeFile(filePath, content);

      const rule = await ClineRule.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".clinerules",
        relativeFilePath: "special-chars.md",
        filePath,
      });

      expect(rule.getFrontmatter().description).toBe("Rule with Special Chars: @#$%");
      expect(rule.getBody()).toBe(content);
    });

    it("should handle headings with extra spaces", async () => {
      const filePath = join(testDir, "spaced-heading.md");
      const content = "#    Spaced Heading    \n\nContent here.";
      await writeFile(filePath, content);

      const rule = await ClineRule.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".clinerules",
        relativeFilePath: "spaced-heading.md",
        filePath,
      });

      expect(rule.getFrontmatter().description).toBe("Spaced Heading");
      expect(rule.getBody()).toBe(content);
    });
  });

  describe("integration with file system", () => {
    it("should work with nested directory structure", async () => {
      const ruleDir = join(testDir, ".clinerules");
      await mkdir(ruleDir, { recursive: true });

      const filePath = join(ruleDir, "nested-rule.md");
      const content = "# Nested Rule\n\nThis rule is in a nested directory.";
      await writeFile(filePath, content);

      const rule = await ClineRule.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".clinerules",
        relativeFilePath: "nested-rule.md",
        filePath,
      });

      expect(rule.getFrontmatter().description).toBe("Nested Rule");
      expect(rule.getBody()).toBe(content);
      expect(rule.getRelativeFilePath()).toBe("nested-rule.md");
    });

    it("should preserve file content exactly", async () => {
      const filePath = join(testDir, "preserve-content.md");
      const content =
        "# Preserve Content\n\nThis content should be preserved exactly\n  with whitespace\n\n\nand multiple empty lines.";
      await writeFile(filePath, content);

      const rule = await ClineRule.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".clinerules",
        relativeFilePath: "preserve-content.md",
        filePath,
      });

      expect(rule.getBody()).toBe(content);
      expect(rule.getFileContent()).toBe(content);
    });
  });
});
