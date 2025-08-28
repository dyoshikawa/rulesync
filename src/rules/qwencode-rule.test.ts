import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import type { RuleFrontmatter } from "../types/rules.js";
import { QwencodeRule } from "./qwencode-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("QwencodeRule", () => {
  let _testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir: _testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("fromFilePath", () => {
    it("should create QwencodeRule from file path", async () => {
      const filePath = join(_testDir, "qwencode-rule.md");
      const fileContent = `---
description: "Qwen Code specific rule"
---

Use TypeScript strict mode
Focus on Qwen3-Coder optimization`;

      await writeFile(filePath, fileContent);

      const rule = await QwencodeRule.fromFilePath({
        baseDir: _testDir,
        relativeDirPath: ".",
        relativeFilePath: "qwencode-rule.md",
        filePath,
        validate: false,
      });

      expect(rule).toBeInstanceOf(QwencodeRule);
      expect(rule.getRelativeFilePath()).toBe("qwencode-rule.md");
    });

    it("should validate frontmatter", async () => {
      const filePath = join(_testDir, "invalid-rule.md");
      const fileContent = `---
invalidField: true
---

Content`;

      await writeFile(filePath, fileContent);

      await expect(
        QwencodeRule.fromFilePath({
          baseDir: _testDir,
          relativeDirPath: ".",
          relativeFilePath: "invalid-rule.md",
          filePath,
        }),
      ).rejects.toThrow();
    });

    it("should handle missing description in frontmatter", async () => {
      const filePath = join(_testDir, "no-description.md");
      const fileContent = `---
otherField: "value"
---

Content`;

      await writeFile(filePath, fileContent);

      const rule = await QwencodeRule.fromFilePath({
        baseDir: _testDir,
        relativeDirPath: ".",
        relativeFilePath: "no-description.md",
        filePath,
        validate: false,
      });

      expect(rule).toBeInstanceOf(QwencodeRule);
      // Should default to empty description
      expect(rule.validate().success).toBe(true);
    });
  });

  describe("fromRulesyncRule", () => {
    it("should create QwencodeRule from RulesyncRule", () => {
      const rulesyncFrontmatter: RuleFrontmatter = {
        root: false,
        targets: ["qwencode"],
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

      const rule = QwencodeRule.fromRulesyncRule({
        baseDir: _testDir,
        relativeDirPath: "rules",
        rulesyncRule,
        validate: false,
      });

      expect(rule).toBeInstanceOf(QwencodeRule);
      expect(rule.getRelativeFilePath()).toBe("test.md");
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert QwencodeRule to RulesyncRule", () => {
      const rule = new QwencodeRule({
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
      expect(rulesyncRule.getFrontmatter().targets).toEqual(["qwencode"]);
      expect(rulesyncRule.getFrontmatter().description).toBe("Test");
    });
  });

  describe("validate", () => {
    it("should validate successfully with valid frontmatter", () => {
      const rule = new QwencodeRule({
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
      const rule = new QwencodeRule({
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

  describe("generateQwenMemoryFile", () => {
    it("should generate memory file with description and content", () => {
      const rule = new QwencodeRule({
        baseDir: _testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        fileContent: "---\ndescription: Project description\n---\nCoding guidelines",
        frontmatter: { description: "Project description" },
        body: "Coding guidelines",
        validate: false,
      });

      const memoryContent = rule.generateQwenMemoryFile();

      expect(memoryContent).toContain("# Project Context");
      expect(memoryContent).toContain("Project description");
      expect(memoryContent).toContain("# Development Guidelines");
      expect(memoryContent).toContain("Coding guidelines");
      expect(memoryContent).toContain("# AI Assistant Instructions");
      expect(memoryContent).toContain("## Qwen3-Coder Optimization");
      expect(memoryContent).toContain("- Leverage advanced code understanding capabilities");
      expect(memoryContent).toContain("- Apply agentic coding patterns");
      expect(memoryContent).toContain("# Additional Context");
      expect(memoryContent).toContain("Source rule file: test.md");
    });

    it("should handle empty body", () => {
      const rule = new QwencodeRule({
        baseDir: _testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        fileContent: "---\ndescription: Test\n---\n",
        frontmatter: { description: "Test description" },
        body: "",
        validate: false,
      });

      const memoryContent = rule.generateQwenMemoryFile();

      expect(memoryContent).toContain("# Project Context");
      expect(memoryContent).toContain("Test description");
      expect(memoryContent).toContain("# AI Assistant Instructions");
      expect(memoryContent).toContain("# Additional Context");
      expect(memoryContent).not.toContain("# Development Guidelines");
    });

    it("should handle whitespace-only body", () => {
      const rule = new QwencodeRule({
        baseDir: _testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        fileContent: "---\ndescription: Test\n---\n   \n  \n",
        frontmatter: { description: "Test description" },
        body: "   \n  \n",
        validate: false,
      });

      const memoryContent = rule.generateQwenMemoryFile();

      expect(memoryContent).not.toContain("# Development Guidelines");
      expect(memoryContent).toContain("# AI Assistant Instructions");
    });

    it("should include Qwen3-Coder specific instructions", () => {
      const rule = new QwencodeRule({
        baseDir: _testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        fileContent: "---\ndescription: Test\n---\nContent",
        frontmatter: { description: "Test" },
        body: "Content",
        validate: false,
      });

      const memoryContent = rule.generateQwenMemoryFile();

      expect(memoryContent).toContain("## Qwen3-Coder Optimization");
      expect(memoryContent).toContain("- Leverage advanced code understanding capabilities");
      expect(memoryContent).toContain("- Use multi-language programming support");
      expect(memoryContent).toContain("- Apply agentic coding patterns");
      expect(memoryContent).toContain("- Implement function calling where appropriate");
      expect(memoryContent).toContain("- Use code interpretation features for complex analysis");
      expect(memoryContent).toContain("- Focus on providing detailed code explanations");
      expect(memoryContent).toContain("- Include comprehensive error handling in all functions");
      expect(memoryContent).toContain("- Use descriptive variable names and clear documentation");
    });
  });

  describe("getOutputFilePath", () => {
    it("should return QWEN.md as output file path", () => {
      const rule = new QwencodeRule({
        baseDir: _testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        fileContent: "---\ndescription: Test\n---\nContent",
        frontmatter: { description: "Test" },
        body: "Content",
        validate: false,
      });

      expect(rule.getOutputFilePath()).toBe("QWEN.md");
    });
  });

  describe("getOutputContent", () => {
    it("should return the same content as generateQwenMemoryFile", () => {
      const rule = new QwencodeRule({
        baseDir: _testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        fileContent: "---\ndescription: Test\n---\nContent",
        frontmatter: { description: "Test" },
        body: "Content",
        validate: false,
      });

      const memoryContent = rule.generateQwenMemoryFile();
      const outputContent = rule.getOutputContent();

      expect(outputContent).toBe(memoryContent);
    });
  });

  describe("inheritance", () => {
    it("should inherit from ToolRule", () => {
      const rule = new QwencodeRule({
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
      const rule = new QwencodeRule({
        baseDir: _testDir,
        relativeDirPath: "rules",
        relativeFilePath: "complex.md",
        fileContent:
          "---\ndescription: Complex Qwen project\n---\n# Tech Stack\n\n- Language: TypeScript\n- AI Models: Qwen3-Coder\n\n## Security\n\n- Validate inputs\n- Use environment variables",
        frontmatter: { description: "Complex Qwen project" },
        body: "# Tech Stack\n\n- Language: TypeScript\n- AI Models: Qwen3-Coder\n\n## Security\n\n- Validate inputs\n- Use environment variables",
        validate: false,
      });

      const memoryContent = rule.generateQwenMemoryFile();

      expect(memoryContent).toContain("Complex Qwen project");
      expect(memoryContent).toContain("# Tech Stack");
      expect(memoryContent).toContain("- Language: TypeScript");
      expect(memoryContent).toContain("- AI Models: Qwen3-Coder");
      expect(memoryContent).toContain("## Security");
      expect(memoryContent).toContain("Source rule file: complex.md");
    });

    it("should handle rule with special characters in path", () => {
      const rule = new QwencodeRule({
        baseDir: _testDir,
        relativeDirPath: "qwen-rules",
        relativeFilePath: "rule-with-spaces and symbols.md",
        fileContent: "---\ndescription: Special Qwen rule\n---\nContent",
        frontmatter: { description: "Special Qwen rule" },
        body: "Content",
        validate: false,
      });

      const memoryContent = rule.generateQwenMemoryFile();

      expect(memoryContent).toContain("Source rule file: rule-with-spaces and symbols.md");
    });

    it("should handle empty description", () => {
      const rule = new QwencodeRule({
        baseDir: _testDir,
        relativeDirPath: "rules",
        relativeFilePath: "no-desc.md",
        fileContent: '---\ndescription: ""\n---\nContent only',
        frontmatter: { description: "" },
        body: "Content only",
        validate: false,
      });

      const memoryContent = rule.generateQwenMemoryFile();

      expect(memoryContent).not.toContain("# Project Context");
      expect(memoryContent).toContain("# Development Guidelines");
      expect(memoryContent).toContain("Content only");
      expect(memoryContent).toContain("# AI Assistant Instructions");
    });
  });

  describe("Qwen-specific features", () => {
    it("should generate content optimized for Qwen3-Coder", () => {
      const rule = new QwencodeRule({
        baseDir: _testDir,
        relativeDirPath: "rules",
        relativeFilePath: "qwen-optimization.md",
        fileContent: "---\ndescription: Qwen optimization rule\n---\nOptimize for Qwen3-Coder",
        frontmatter: { description: "Qwen optimization rule" },
        body: "Optimize for Qwen3-Coder",
        validate: false,
      });

      const memoryContent = rule.generateQwenMemoryFile();

      // Check for Qwen3-Coder specific instructions
      expect(memoryContent).toContain("## Qwen3-Coder Optimization");
      expect(memoryContent).toContain("advanced code understanding capabilities");
      expect(memoryContent).toContain("multi-language programming support");
      expect(memoryContent).toContain("agentic coding patterns");
      expect(memoryContent).toContain("function calling where appropriate");
      expect(memoryContent).toContain("code interpretation features");
      expect(memoryContent).toContain("detailed code explanations");
      expect(memoryContent).toContain("comprehensive error handling");
      expect(memoryContent).toContain("descriptive variable names");
    });

    it("should properly format the AI Assistant Instructions section", () => {
      const rule = new QwencodeRule({
        baseDir: _testDir,
        relativeDirPath: "rules",
        relativeFilePath: "formatting-test.md",
        fileContent: "---\ndescription: Format test\n---\nTest body",
        frontmatter: { description: "Format test" },
        body: "Test body",
        validate: false,
      });

      const memoryContent = rule.generateQwenMemoryFile();
      const lines = memoryContent.split("\n");

      // Check that AI Assistant Instructions section is properly formatted
      const aiInstructionsIndex = lines.findIndex((line) => line === "# AI Assistant Instructions");
      expect(aiInstructionsIndex).toBeGreaterThan(-1);

      const optimizationIndex = lines.findIndex((line) => line === "## Qwen3-Coder Optimization");
      expect(optimizationIndex).toBe(aiInstructionsIndex + 2); // Should be 2 lines after (with blank line)

      // Check that each instruction starts with "- "
      const instructionLines = lines.slice(
        optimizationIndex + 1,
        lines.findIndex((line) => line === "# Additional Context"),
      );
      const actualInstructions = instructionLines.filter((line) => line.startsWith("- "));
      expect(actualInstructions.length).toBe(8); // Should have 8 bullet points
    });
  });
});
