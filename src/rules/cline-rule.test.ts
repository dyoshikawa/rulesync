import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import matter from "gray-matter";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import type { ToolTargets } from "../types/tool-targets.js";
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
    it("should create an instance with valid frontmatter", () => {
      const frontmatter: ClineRuleFrontmatter = {
        description: "Test rule for Cline",
      };

      const rule = new ClineRule({
        relativeDirPath: ".clinerules",
        relativeFilePath: "test-rule.md",
        frontmatter,
        body: "# Test Rule\n\nThis is a test rule for Cline",
        fileContent: "# Test Rule\n\nThis is a test rule for Cline",
      });

      expect(rule).toBeInstanceOf(ClineRule);
      expect(rule.getFrontmatter()).toEqual(frontmatter);
      expect(rule.getBody()).toBe("# Test Rule\n\nThis is a test rule for Cline");
    });

    it("should create an instance without description", () => {
      const frontmatter: ClineRuleFrontmatter = {};

      const rule = new ClineRule({
        relativeDirPath: ".clinerules",
        relativeFilePath: "coding-standards.md",
        frontmatter,
        body: "# Coding Standards\n\nUse TypeScript for all new code",
        fileContent: "# Coding Standards\n\nUse TypeScript for all new code",
      });

      expect(rule.getFrontmatter()).toEqual(frontmatter);
    });

    it("should not throw error when validation disabled", () => {
      const frontmatter = {
        description: "Test rule",
        invalidField: "should be ignored",
      } as any;

      expect(() => {
        const rule = new ClineRule({
          relativeDirPath: ".clinerules",
          relativeFilePath: "test.md",
          frontmatter,
          body: "Test content",
          fileContent: "Test content",
          validate: false,
        });
        return rule;
      }).not.toThrow();
    });
  });

  describe("fromFilePath", () => {
    it("should create rule from plain Markdown file", async () => {
      const content = "# Coding Standards\n\nAlways use TypeScript strict mode";
      const dirPath = join(testDir, ".clinerules");
      await mkdir(dirPath, { recursive: true });
      const filePath = join(dirPath, "coding-standards.md");
      await writeFile(filePath, content);

      const rule = await ClineRule.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".clinerules",
        relativeFilePath: "coding-standards.md",
        filePath,
      });

      expect(rule).toBeInstanceOf(ClineRule);
      expect(rule.getBody()).toBe(content);
      expect(rule.getFrontmatter().description).toBe("Coding Standards");
    });

    it("should handle files with numeric prefixes", async () => {
      const content = "# API Design\n\nRESTful principles";
      const dirPath = join(testDir, ".clinerules");
      await mkdir(dirPath, { recursive: true });
      const filePath = join(dirPath, "01-api-design.md");
      await writeFile(filePath, content);

      const rule = await ClineRule.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".clinerules",
        relativeFilePath: "01-api-design.md",
        filePath,
      });

      // Description should come from content, not filename
      expect(rule.getFrontmatter().description).toBe("API Design");
    });

    it("should handle files without headings", async () => {
      const content = "Use consistent naming conventions across the codebase";
      const dirPath = join(testDir, ".clinerules");
      await mkdir(dirPath, { recursive: true });
      const filePath = join(dirPath, "naming-conventions.md");
      await writeFile(filePath, content);

      const rule = await ClineRule.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".clinerules",
        relativeFilePath: "naming-conventions.md",
        filePath,
      });

      expect(rule.getFrontmatter().description).toBe(
        "Use consistent naming conventions across the codebase",
      );
    });

    it("should handle .mdx files", async () => {
      const content = "# Component Guidelines\n\nUse functional components";
      const dirPath = join(testDir, ".clinerules");
      await mkdir(dirPath, { recursive: true });
      const filePath = join(dirPath, "components.mdx");
      await writeFile(filePath, content);

      const rule = await ClineRule.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".clinerules",
        relativeFilePath: "components.mdx",
        filePath,
      });

      expect(rule.getBody()).toBe(content);
      expect(rule.getFrontmatter().description).toBe("Component Guidelines");
    });

    it("should ignore accidental frontmatter in Cline files", async () => {
      // Cline files shouldn't have frontmatter, but handle gracefully if they do
      const content = matter.stringify("# Test Rule\n\nContent", { type: "manual" });
      const dirPath = join(testDir, ".clinerules");
      await mkdir(dirPath, { recursive: true });
      const filePath = join(dirPath, "accidental-frontmatter.md");
      await writeFile(filePath, content);

      const rule = await ClineRule.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".clinerules",
        relativeFilePath: "accidental-frontmatter.md",
        filePath,
      });

      // Should treat the entire file as body since Cline doesn't use frontmatter
      expect(rule.getBody()).toBe(content);
    });

    it("should extract description from kebab-case filename", async () => {
      // Use empty content to force fallback to filename
      const content = "";
      const dirPath = join(testDir, ".clinerules");
      await mkdir(dirPath, { recursive: true });
      const filePath = join(dirPath, "database-migrations.md");
      await writeFile(filePath, content);

      const rule = await ClineRule.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".clinerules",
        relativeFilePath: "database-migrations.md",
        filePath,
      });

      expect(rule.getFrontmatter().description).toBe("Database Migrations");
    });

    it("should extract description from snake_case filename", async () => {
      // Use empty content to force fallback to filename
      const content = "";
      const dirPath = join(testDir, ".clinerules");
      await mkdir(dirPath, { recursive: true });
      const filePath = join(dirPath, "test_coverage.md");
      await writeFile(filePath, content);

      const rule = await ClineRule.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".clinerules",
        relativeFilePath: "test_coverage.md",
        filePath,
      });

      expect(rule.getFrontmatter().description).toBe("Test Coverage");
    });
  });

  describe("fromRulesyncRule", () => {
    it("should convert from RulesyncRule", () => {
      const rulesyncFrontmatter = {
        targets: ["cline"] as ToolTargets,
        root: false,
        description: "Test rule",
        globs: [],
      };

      const rulesyncRule = new RulesyncRule({
        frontmatter: rulesyncFrontmatter,
        body: "# Test Rule\n\nRule content",
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "test.md",
        fileContent: matter.stringify("# Test Rule\n\nRule content", rulesyncFrontmatter),
        validate: false,
      });

      const clineRule = ClineRule.fromRulesyncRule({
        baseDir: ".",
        rulesyncRule,
        relativeDirPath: ".clinerules",
      });

      expect(clineRule).toBeInstanceOf(ClineRule);
      expect(clineRule.getFrontmatter().description).toBe("Test rule");
      expect(clineRule.getBody()).toBe("# Test Rule\n\nRule content");
    });

    it("should handle RulesyncRule without description", () => {
      const rulesyncFrontmatter = {
        targets: ["cline"] as ToolTargets,
        root: false,
        description: "",
        globs: [],
      };

      const rulesyncRule = new RulesyncRule({
        frontmatter: rulesyncFrontmatter,
        body: "Rule content",
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "test.md",
        fileContent: matter.stringify("Rule content", rulesyncFrontmatter),
        validate: false,
      });

      const clineRule = ClineRule.fromRulesyncRule({
        baseDir: ".",
        rulesyncRule,
        relativeDirPath: ".clinerules",
      });

      expect(clineRule.getFrontmatter().description).toBe("");
    });

    it("should not validate when validate is false", () => {
      const rulesyncFrontmatter = {
        targets: ["cline"] as ToolTargets,
        root: false,
        description: "Test",
        globs: [],
      };

      const rulesyncRule = new RulesyncRule({
        frontmatter: rulesyncFrontmatter,
        body: "Content",
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "test.md",
        fileContent: matter.stringify("Content", rulesyncFrontmatter),
        validate: false,
      });

      expect(() => {
        ClineRule.fromRulesyncRule({
          baseDir: ".",
          rulesyncRule,
          relativeDirPath: ".clinerules",
          validate: false,
        });
      }).not.toThrow();
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert to RulesyncRule with description", () => {
      const frontmatter: ClineRuleFrontmatter = {
        description: "Custom description",
      };

      const clineRule = new ClineRule({
        relativeDirPath: ".clinerules",
        relativeFilePath: "test.md",
        frontmatter,
        body: "# Different Heading\n\nContent",
        fileContent: "# Different Heading\n\nContent",
      });

      const rulesyncRule = clineRule.toRulesyncRule();

      expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
      expect(rulesyncRule.getFrontmatter().targets).toEqual(["cline"]);
      expect(rulesyncRule.getFrontmatter().description).toBe("Custom description");
      expect(rulesyncRule.getFrontmatter().globs).toEqual([]);
      expect(rulesyncRule.getBody()).toBe("# Different Heading\n\nContent");
    });

    it("should extract description from heading when not provided", () => {
      const frontmatter: ClineRuleFrontmatter = {};

      const clineRule = new ClineRule({
        relativeDirPath: ".clinerules",
        relativeFilePath: "test.md",
        frontmatter,
        body: "# Testing Guidelines\n\nWrite tests first",
        fileContent: "# Testing Guidelines\n\nWrite tests first",
      });

      const rulesyncRule = clineRule.toRulesyncRule();

      expect(rulesyncRule.getFrontmatter().description).toBe("Testing Guidelines");
    });

    it("should extract description from filename when no heading", () => {
      const frontmatter: ClineRuleFrontmatter = {};

      const clineRule = new ClineRule({
        relativeDirPath: ".clinerules",
        relativeFilePath: "security-best-practices.md",
        frontmatter,
        body: "Always validate user input",
        fileContent: "Always validate user input",
      });

      const rulesyncRule = clineRule.toRulesyncRule();

      expect(rulesyncRule.getFrontmatter().description).toBe("Security Best Practices");
    });

    it("should use default description as last resort", () => {
      const frontmatter: ClineRuleFrontmatter = {};

      const clineRule = new ClineRule({
        relativeDirPath: ".clinerules",
        relativeFilePath: ".md", // Edge case: invalid filename
        frontmatter,
        body: "", // Empty content
        fileContent: "",
      });

      const rulesyncRule = clineRule.toRulesyncRule();

      expect(rulesyncRule.getFrontmatter().description).toBe("Cline rule");
    });
  });

  describe("validate", () => {
    it("should return success for valid frontmatter", () => {
      const frontmatter: ClineRuleFrontmatter = {
        description: "Test rule",
      };

      const rule = new ClineRule({
        relativeDirPath: ".clinerules",
        relativeFilePath: "test.md",
        frontmatter,
        body: "Content",
        fileContent: "Content",
      });

      const result = rule.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });

    it("should return success for empty frontmatter", () => {
      const frontmatter: ClineRuleFrontmatter = {};

      const rule = new ClineRule({
        relativeDirPath: ".clinerules",
        relativeFilePath: "test.md",
        frontmatter,
        body: "Content",
        fileContent: "Content",
      });

      const result = rule.validate();
      expect(result.success).toBe(true);
    });

    it("should handle undefined frontmatter gracefully", () => {
      const rule = new ClineRule({
        relativeDirPath: ".clinerules",
        relativeFilePath: "test.md",
        frontmatter: undefined as any,
        body: "Content",
        fileContent: "Content",
        validate: false,
      });

      const result = rule.validate();
      expect(result.success).toBe(true);
    });
  });

  describe("getters", () => {
    it("should return frontmatter correctly", () => {
      const frontmatter: ClineRuleFrontmatter = {
        description: "Test description",
      };

      const rule = new ClineRule({
        relativeDirPath: ".clinerules",
        relativeFilePath: "test.md",
        frontmatter,
        body: "Content",
        fileContent: "Content",
      });

      expect(rule.getFrontmatter()).toEqual(frontmatter);
    });

    it("should return body correctly", () => {
      const body = "# Rule\n\nContent here";

      const rule = new ClineRule({
        relativeDirPath: ".clinerules",
        relativeFilePath: "test.md",
        frontmatter: {},
        body,
        fileContent: body,
      });

      expect(rule.getBody()).toBe(body);
    });
  });

  describe("edge cases", () => {
    it("should handle very long content", () => {
      const longContent = "# Title\n\n" + "Lorem ipsum ".repeat(1000);

      const rule = new ClineRule({
        relativeDirPath: ".clinerules",
        relativeFilePath: "long.md",
        frontmatter: {}, // No description set initially
        body: longContent,
        fileContent: longContent,
      });

      expect(rule.getBody()).toBe(longContent);
      // The description is extracted when converting to RulesyncRule, not stored in frontmatter
      const rulesyncRule = rule.toRulesyncRule();
      expect(rulesyncRule.getFrontmatter().description).toBe("Title");
    });

    it("should handle content with multiple headings", () => {
      const content = "# First Heading\n\n## Second Heading\n\n# Third Heading";

      const rule = new ClineRule({
        relativeDirPath: ".clinerules",
        relativeFilePath: "multi-heading.md",
        frontmatter: {},
        body: content,
        fileContent: content,
      });

      // Should use the first heading
      const rulesyncRule = rule.toRulesyncRule();
      expect(rulesyncRule.getFrontmatter().description).toBe("First Heading");
    });

    it("should handle markdown with special characters", () => {
      const content = "# Rule with `code` and **bold**\n\nContent with *emphasis*";

      const rule = new ClineRule({
        relativeDirPath: ".clinerules",
        relativeFilePath: "special.md",
        frontmatter: {},
        body: content,
        fileContent: content,
      });

      expect(rule.getBody()).toBe(content);
      const rulesyncRule = rule.toRulesyncRule();
      expect(rulesyncRule.getFrontmatter().description).toBe("Rule with `code` and **bold**");
    });

    it("should handle empty content", () => {
      const rule = new ClineRule({
        relativeDirPath: ".clinerules",
        relativeFilePath: "empty.md",
        frontmatter: {},
        body: "",
        fileContent: "",
      });

      expect(rule.getBody()).toBe("");
      const rulesyncRule = rule.toRulesyncRule();
      expect(rulesyncRule.getFrontmatter().description).toBe("Empty");
    });
  });
});
