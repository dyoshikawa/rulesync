import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import type { RuleFrontmatter } from "../types/rules.js";
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

  describe("fromFilePath", () => {
    it("should create GeminiCliRule from plain markdown file", async () => {
      const filePath = join(testDir, "GEMINI.md");
      const fileContent = `# Project Guidelines

## Tech Stack
- TypeScript
- Node.js

## Coding Standards
- Use strict mode
- Write comprehensive tests`;

      await writeFile(filePath, fileContent);

      const rule = await GeminiCliRule.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "GEMINI.md",
        filePath,
        validate: false,
      });

      expect(rule).toBeInstanceOf(GeminiCliRule);
      expect(rule.getRelativeFilePath()).toBe("GEMINI.md");
    });

    it("should handle empty file", async () => {
      const filePath = join(testDir, "empty.md");
      const fileContent = "";

      await writeFile(filePath, fileContent);

      const rule = await GeminiCliRule.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "empty.md",
        filePath,
        validate: false,
      });

      expect(rule).toBeInstanceOf(GeminiCliRule);
      expect(rule.getOutputContent()).toBe("");
    });

    it("should handle whitespace-only file", async () => {
      const filePath = join(testDir, "whitespace.md");
      const fileContent = "   \n  \n\t\n";

      await writeFile(filePath, fileContent);

      const rule = await GeminiCliRule.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "whitespace.md",
        filePath,
        validate: false,
      });

      expect(rule).toBeInstanceOf(GeminiCliRule);
      expect(rule.getOutputContent()).toBe("");
    });
  });

  describe("fromRulesyncRule", () => {
    it("should create GeminiCliRule from RulesyncRule", () => {
      const rulesyncFrontmatter: RuleFrontmatter = {
        root: false,
        targets: ["geminicli"],
        description: "Test description",
        globs: ["**/*.ts"],
      };

      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        frontmatter: rulesyncFrontmatter,
        body: "Test content",
        fileContent: "---\ndescription: Test description\n---\nTest content",
      });

      const rule = GeminiCliRule.fromRulesyncRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        rulesyncRule,
        validate: false,
      });

      expect(rule).toBeInstanceOf(GeminiCliRule);
      expect(rule.getRelativeFilePath()).toBe("test.md");
    });

    it("should handle RulesyncRule without description", () => {
      const rulesyncFrontmatter: RuleFrontmatter = {
        root: false,
        targets: ["geminicli"],
        description: "",
        globs: ["**/*.ts"],
      };

      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        frontmatter: rulesyncFrontmatter,
        body: "Test content",
        fileContent: "---\n---\nTest content",
      });

      const rule = GeminiCliRule.fromRulesyncRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        rulesyncRule,
        validate: false,
      });

      expect(rule).toBeInstanceOf(GeminiCliRule);
      const outputContent = rule.getOutputContent();
      expect(outputContent).toBe("Test content");
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert GeminiCliRule to RulesyncRule", () => {
      const rule = new GeminiCliRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        fileContent: "Test content",
        body: "Test content",
        description: "Test description",
        validate: false,
      });

      const rulesyncRule = rule.toRulesyncRule();

      expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
      expect(rulesyncRule.getFrontmatter().targets).toEqual(["geminicli"]);
      expect(rulesyncRule.getFrontmatter().description).toBe("Test description");
      expect(rulesyncRule.getBody()).toBe("Test content");
    });

    it("should convert without description", () => {
      const rule = new GeminiCliRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        fileContent: "Test content",
        body: "Test content",
        validate: false,
      });

      const rulesyncRule = rule.toRulesyncRule();

      expect(rulesyncRule.getFrontmatter().description).toBe("");
    });
  });

  describe("validate", () => {
    it("should always validate successfully (no frontmatter required)", () => {
      const rule = new GeminiCliRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        fileContent: "Any content without frontmatter",
        body: "Any content without frontmatter",
        validate: false,
      });

      const result = rule.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });

    it("should validate successfully even with empty content", () => {
      const rule = new GeminiCliRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        fileContent: "",
        body: "",
        validate: false,
      });

      const result = rule.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });
  });

  describe("generateMemoryFile", () => {
    it("should generate memory file with description and content", () => {
      const rule = new GeminiCliRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        fileContent: "# Coding Standards\n\n- Use TypeScript\n- Write tests",
        body: "# Coding Standards\n\n- Use TypeScript\n- Write tests",
        description: "Project coding guidelines",
        validate: false,
      });

      const memoryContent = rule.generateMemoryFile();

      expect(memoryContent).toContain("# Project: Project coding guidelines");
      expect(memoryContent).toContain("# Coding Standards");
      expect(memoryContent).toContain("- Use TypeScript");
      expect(memoryContent).toContain("- Write tests");
    });

    it("should handle content without description", () => {
      const rule = new GeminiCliRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        fileContent: "# Tech Stack\n\n- Node.js\n- TypeScript",
        body: "# Tech Stack\n\n- Node.js\n- TypeScript",
        validate: false,
      });

      const memoryContent = rule.generateMemoryFile();

      expect(memoryContent).toBe("# Tech Stack\n\n- Node.js\n- TypeScript");
      expect(memoryContent).not.toContain("# Project:");
    });

    it("should handle empty body", () => {
      const rule = new GeminiCliRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        fileContent: "",
        body: "",
        description: "Empty project",
        validate: false,
      });

      const memoryContent = rule.generateMemoryFile();

      expect(memoryContent).toBe("# Project: Empty project");
    });

    it("should handle whitespace-only body", () => {
      const rule = new GeminiCliRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        fileContent: "   \n  \n",
        body: "   \n  \n",
        description: "Whitespace project",
        validate: false,
      });

      const memoryContent = rule.generateMemoryFile();

      expect(memoryContent).toBe("# Project: Whitespace project");
    });

    it("should handle both empty description and body", () => {
      const rule = new GeminiCliRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        fileContent: "",
        body: "",
        validate: false,
      });

      const memoryContent = rule.generateMemoryFile();

      expect(memoryContent).toBe("");
    });
  });

  describe("getOutputFilePath", () => {
    it("should return GEMINI.md as output file path", () => {
      const rule = new GeminiCliRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        fileContent: "Content",
        body: "Content",
        validate: false,
      });

      expect(rule.getOutputFilePath()).toBe("GEMINI.md");
    });
  });

  describe("getOutputContent", () => {
    it("should return the same content as generateMemoryFile", () => {
      const rule = new GeminiCliRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        fileContent: "# Guidelines\n\nUse best practices",
        body: "# Guidelines\n\nUse best practices",
        description: "Test project",
        validate: false,
      });

      const memoryContent = rule.generateMemoryFile();
      const outputContent = rule.getOutputContent();

      expect(outputContent).toBe(memoryContent);
    });
  });

  describe("inheritance", () => {
    it("should inherit from ToolRule", () => {
      const rule = new GeminiCliRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        fileContent: "Content",
        body: "Content",
        validate: false,
      });

      expect(rule.getRelativeFilePath()).toBe("test.md");
      expect(rule.getRelativeDirPath()).toBe("rules");
      expect(rule.getFilePath()).toBe(join(testDir, "rules", "test.md"));
    });
  });

  describe("complex scenarios", () => {
    it("should handle multiline content with markdown formatting", () => {
      const rule = new GeminiCliRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "complex.md",
        fileContent: `# Project Guidelines

## Tech Stack
- Framework: Next.js 14
- Language: TypeScript
- Package manager: pnpm

## Coding Standards
1. Use TypeScript strict mode
2. Prefer functional components with hooks
3. Write meaningful variable names
4. Always write unit tests for business logic

## Security Guidelines
- Never commit API keys or secrets
- Validate all user inputs
- Use environment variables for configuration`,
        body: `# Project Guidelines

## Tech Stack
- Framework: Next.js 14
- Language: TypeScript
- Package manager: pnpm

## Coding Standards
1. Use TypeScript strict mode
2. Prefer functional components with hooks
3. Write meaningful variable names
4. Always write unit tests for business logic

## Security Guidelines
- Never commit API keys or secrets
- Validate all user inputs
- Use environment variables for configuration`,
        description: "Complex project with comprehensive guidelines",
        validate: false,
      });

      const memoryContent = rule.generateMemoryFile();

      expect(memoryContent).toContain("# Project: Complex project with comprehensive guidelines");
      expect(memoryContent).toContain("# Project Guidelines");
      expect(memoryContent).toContain("## Tech Stack");
      expect(memoryContent).toContain("- Framework: Next.js 14");
      expect(memoryContent).toContain("## Security Guidelines");
    });

    it("should handle rule with special characters in path", () => {
      const rule = new GeminiCliRule({
        baseDir: testDir,
        relativeDirPath: "special-rules",
        relativeFilePath: "rule-with-spaces and symbols.md",
        fileContent: "# Special Guidelines\n\nUse special practices",
        body: "# Special Guidelines\n\nUse special practices",
        description: "Special rule",
        validate: false,
      });

      const memoryContent = rule.generateMemoryFile();

      expect(memoryContent).toContain("# Project: Special rule");
      expect(memoryContent).toContain("# Special Guidelines");
      expect(memoryContent).toContain("Use special practices");
    });
  });
});
