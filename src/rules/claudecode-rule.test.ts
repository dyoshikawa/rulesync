import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import matter from "gray-matter";
import { setupTestDirectory } from "../test-utils/index.js";
import type { RuleFrontmatter } from "../types/rules.js";
import { ClaudecodeRule } from "./claudecode-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("ClaudecodeRule", () => {
  let _testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir: _testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("fromFilePath", () => {
    it("should create ClaudecodeRule from file path", async () => {
      const filePath = join(_testDir, "claudecode-rule.md");
      const fileContent = `---
description: "Claude Code specific rule"
---

Use TypeScript strict mode
Always write tests`;

      await writeFile(filePath, fileContent);

      const rule = await ClaudecodeRule.fromFilePath({
        baseDir: _testDir,
        relativeDirPath: ".",
        relativeFilePath: "claudecode-rule.md",
        filePath,
        validate: false,
      });

      expect(rule).toBeInstanceOf(ClaudecodeRule);
      expect(rule.getRelativeFilePath()).toBe("claudecode-rule.md");
    });

    it("should provide default description when missing", async () => {
      const filePath = join(_testDir, "no-description-rule.md");
      const fileContent = `---
invalidField: true
---

Content`;

      await writeFile(filePath, fileContent);

      const rule = await ClaudecodeRule.fromFilePath({
        baseDir: _testDir,
        relativeDirPath: ".",
        relativeFilePath: "no-description-rule.md",
        filePath,
        validate: false,
      });

      expect(rule).toBeInstanceOf(ClaudecodeRule);
      expect(rule.validate().success).toBe(true);
    });
  });

  describe("fromRulesyncRule", () => {
    it("should create ClaudecodeRule from RulesyncRule", () => {
      const rulesyncFrontmatter: RuleFrontmatter = {
        root: false,
        targets: ["claudecode"],
        description: "Test description",
        globs: ["**/*.ts"],
      };

      const rulesyncRule = new RulesyncRule({
        baseDir: _testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        frontmatter: rulesyncFrontmatter,
        body: "Test content",
        fileContent: "---\ndescription: Test description\n---\nTest content",
      });

      const rule = ClaudecodeRule.fromRulesyncRule({
        baseDir: _testDir,
        relativeDirPath: "rules",
        rulesyncRule,
        validate: false,
      });

      expect(rule).toBeInstanceOf(ClaudecodeRule);
      expect(rule.getRelativeFilePath()).toBe("test.md");
      expect(rule.getRelativeDirPath()).toBe(join(".claude", "memories"));
    });

    it("should create ClaudecodeRule with CLAUDE.md when root is true", () => {
      const rulesyncFrontmatter: RuleFrontmatter = {
        root: true,
        targets: ["claudecode"],
        description: "Root rule description",
        globs: ["**/*.ts"],
      };

      const rulesyncRule = new RulesyncRule({
        baseDir: _testDir,
        relativeDirPath: "rules",
        relativeFilePath: "root-test.md",
        frontmatter: rulesyncFrontmatter,
        body: "Root test content",
        fileContent: "---\ndescription: Root rule description\nroot: true\n---\nRoot test content",
      });

      const rule = ClaudecodeRule.fromRulesyncRule({
        baseDir: _testDir,
        relativeDirPath: "rules",
        rulesyncRule,
        validate: false,
      });

      expect(rule).toBeInstanceOf(ClaudecodeRule);
      expect(rule.getRelativeFilePath()).toBe("CLAUDE.md");
      expect(rule.getRelativeDirPath()).toBe("rules");
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert ClaudecodeRule to RulesyncRule", () => {
      const rule = new ClaudecodeRule({
        baseDir: _testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        fileContent: "---\ndescription: Test\n---\nContent",
        frontmatter: { description: "Test" },
        body: "Content",
        validate: false,
      });

      const rulesyncRule = rule.toRulesyncRule();

      expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
      expect(rulesyncRule.getFrontmatter().targets).toEqual(["claudecode"]);
      expect(rulesyncRule.getFrontmatter().description).toBe("Test");
    });
  });

  describe("validate", () => {
    it("should validate successfully with valid frontmatter", () => {
      const rule = new ClaudecodeRule({
        baseDir: _testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        fileContent: "---\ndescription: Test\n---\nContent",
        frontmatter: { description: "Test description" },
        body: "Content",
        validate: false,
      });

      const result = rule.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });

    it("should fail validation with invalid frontmatter", () => {
      const rule = new ClaudecodeRule({
        baseDir: _testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        fileContent: "---\ntest: invalid\n---\nContent",
        frontmatter: {} as any,
        body: "Content",
        validate: false,
      });

      const result = rule.validate();
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });


  describe("getFilePath", () => {
    it("should return correct file path", () => {
      const rule = new ClaudecodeRule({
        baseDir: _testDir,
        relativeDirPath: ".claude/memories",
        relativeFilePath: "test.md",
        fileContent: "---\ndescription: Test\n---\nContent",
        frontmatter: { description: "Test" },
        body: "Content",
        validate: false,
      });

      expect(rule.getFilePath()).toContain("test.md");
    });
  });


  describe("inheritance", () => {
    it("should inherit from ToolRule", () => {
      const rule = new ClaudecodeRule({
        baseDir: _testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        fileContent: "---\ndescription: Test\n---\nContent",
        frontmatter: { description: "Test" },
        body: "Content",
        validate: false,
      });

      expect(rule.getRelativeFilePath()).toBe("test.md");
      expect(rule.getRelativeDirPath()).toBe("rules");
      expect(rule.getFilePath()).toBe(join(_testDir, "rules", "test.md"));
    });
  });

  describe("setBody", () => {
    it("should update body and fileContent when setBody is called", () => {
      const rule = new ClaudecodeRule({
        baseDir: _testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        fileContent: "---\ndescription: Original description\n---\nOriginal content",
        frontmatter: { description: "Original description" },
        body: "Original content",
        validate: false,
      });

      const newBody = "Updated content with new rules";
      rule.setBody(newBody);

      // Verify the fileContent is updated with new body
      const parsedContent = matter(rule.getFileContent());
      expect(parsedContent.content.trim()).toBe(newBody);
      expect(parsedContent.data.description).toBe("Original description");
    });

    it("should preserve frontmatter when updating body", () => {
      const originalFrontmatter = { description: "Test description" };
      const rule = new ClaudecodeRule({
        baseDir: _testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        fileContent: "---\ndescription: Test description\n---\nOriginal body",
        frontmatter: originalFrontmatter,
        body: "Original body",
        validate: false,
      });

      rule.setBody("New body content");

      const parsedContent = matter(rule.getFileContent());
      expect(parsedContent.data).toEqual(originalFrontmatter);
      expect(parsedContent.content.trim()).toBe("New body content");
    });
  });

  describe("complex scenarios", () => {
    it("should handle multiline content with markdown formatting", () => {
      const rule = new ClaudecodeRule({
        baseDir: _testDir,
        relativeDirPath: "rules",
        relativeFilePath: "complex.md",
        fileContent:
          "---\ndescription: Complex project\n---\n# Coding Standards\n\n- Use TypeScript\n- Write tests\n\n## Security\n\n- Validate inputs",
        frontmatter: { description: "Complex project" },
        body: "# Coding Standards\n\n- Use TypeScript\n- Write tests\n\n## Security\n\n- Validate inputs",
        validate: false,
      });

      expect(rule.getRelativeFilePath()).toBe("complex.md");
    });

    it("should handle rule with special characters in path", () => {
      const rule = new ClaudecodeRule({
        baseDir: _testDir,
        relativeDirPath: "special-rules",
        relativeFilePath: "rule-with-spaces and symbols.md",
        fileContent: "---\ndescription: Special rule\n---\nContent",
        frontmatter: { description: "Special rule" },
        body: "Content",
        validate: false,
      });

      expect(rule.getRelativeFilePath()).toBe("rule-with-spaces and symbols.md");
    });
  });
});
