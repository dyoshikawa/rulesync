import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

    it("should validate frontmatter", async () => {
      const filePath = join(_testDir, "invalid-rule.md");
      const fileContent = `---
invalidField: true
---

Content`;

      await writeFile(filePath, fileContent);

      await expect(
        ClaudecodeRule.fromFilePath({
          baseDir: _testDir,
          relativeDirPath: ".",
          relativeFilePath: "invalid-rule.md",
          filePath,
        }),
      ).rejects.toThrow();
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
      expect(rule.getRelativeFilePath()).toBe("CLAUDE.md");
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

  describe("generateClaudeMemoryFile", () => {
    it("should generate memory file with description and content", () => {
      const rule = new ClaudecodeRule({
        baseDir: _testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        fileContent: "---\ndescription: Project description\n---\nCoding guidelines",
        frontmatter: { description: "Project description" },
        body: "Coding guidelines",
        validate: false,
      });

      const memoryContent = rule.generateClaudeMemoryFile();

      expect(memoryContent).toContain("# Project Context");
      expect(memoryContent).toContain("Project description");
      expect(memoryContent).toContain("# Development Guidelines");
      expect(memoryContent).toContain("Coding guidelines");
      expect(memoryContent).toContain("# Additional Context");
      expect(memoryContent).toContain("@test.md");
    });

    it("should handle empty body", () => {
      const rule = new ClaudecodeRule({
        baseDir: _testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        fileContent: "---\ndescription: Test\n---\n",
        frontmatter: { description: "Test description" },
        body: "",
        validate: false,
      });

      const memoryContent = rule.generateClaudeMemoryFile();

      expect(memoryContent).toContain("# Project Context");
      expect(memoryContent).toContain("Test description");
      expect(memoryContent).toContain("# Additional Context");
      expect(memoryContent).toContain("@test.md");
      expect(memoryContent).not.toContain("# Development Guidelines");
    });

    it("should handle whitespace-only body", () => {
      const rule = new ClaudecodeRule({
        baseDir: _testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        fileContent: "---\ndescription: Test\n---\n   \n  \n",
        frontmatter: { description: "Test description" },
        body: "   \n  \n",
        validate: false,
      });

      const memoryContent = rule.generateClaudeMemoryFile();

      expect(memoryContent).not.toContain("# Development Guidelines");
    });
  });

  describe("getOutputFilePath", () => {
    it("should return CLAUDE.md as output file path", () => {
      const rule = new ClaudecodeRule({
        baseDir: _testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        fileContent: "---\ndescription: Test\n---\nContent",
        frontmatter: { description: "Test" },
        body: "Content",
        validate: false,
      });

      expect(rule.getOutputFilePath()).toBe("CLAUDE.md");
    });
  });

  describe("getOutputContent", () => {
    it("should return the same content as generateClaudeMemoryFile", () => {
      const rule = new ClaudecodeRule({
        baseDir: _testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        fileContent: "---\ndescription: Test\n---\nContent",
        frontmatter: { description: "Test" },
        body: "Content",
        validate: false,
      });

      const memoryContent = rule.generateClaudeMemoryFile();
      const outputContent = rule.getOutputContent();

      expect(outputContent).toBe(memoryContent);
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

      const memoryContent = rule.generateClaudeMemoryFile();

      expect(memoryContent).toContain("Complex project");
      expect(memoryContent).toContain("# Coding Standards");
      expect(memoryContent).toContain("- Use TypeScript");
      expect(memoryContent).toContain("## Security");
      expect(memoryContent).toContain("@complex.md");
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

      const memoryContent = rule.generateClaudeMemoryFile();

      expect(memoryContent).toContain("@rule-with-spaces and symbols.md");
    });
  });
});
