import { promises as fs } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../../test-utils/index.js";
import { RulesyncRule } from "../RulesyncRule.js";
import { QwencodeRule } from "./QwencodeRule.js";

describe("QwencodeRule", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("build", () => {
    it("should build a rule from file path and content", () => {
      const filePath = join(testDir, "QWEN.md");
      const fileContent = `# Project: MyProject

## Tech Stack
- Framework: Next.js 14
- Language: TypeScript
- AI Models: Qwen3-Coder`;

      const rule = QwencodeRule.build({ filePath, fileContent });

      expect(rule.getFilePath()).toBe(filePath);
      expect(rule.getFileContent()).toBe(fileContent);
    });
  });

  describe("fromFilePath", () => {
    it("should load a rule from file", async () => {
      const filePath = join(testDir, "QWEN.md");
      const fileContent = `# Project: QwenCode Project

## Coding Standards
- Use TypeScript strict mode
- Prefer functional components with hooks
- Write comprehensive tests

## AI Assistant Instructions
- Focus on Qwen3-Coder optimized patterns
- Provide detailed code explanations`;

      await fs.mkdir(testDir, { recursive: true });
      await fs.writeFile(filePath, fileContent, "utf-8");

      const rule = await QwencodeRule.fromFilePath(filePath);

      expect(rule.getFilePath()).toBe(filePath);
      expect(rule.getFileContent()).toBe(fileContent);
    });

    it("should handle AGENTS.md files", async () => {
      const filePath = join(testDir, "AGENTS.md");
      const fileContent = `# QwenCode Agent Rules

## Project Overview
This is a QwenCode project using AGENTS.md format.`;

      await fs.mkdir(testDir, { recursive: true });
      await fs.writeFile(filePath, fileContent, "utf-8");

      const rule = await QwencodeRule.fromFilePath(filePath);

      expect(rule.getFilePath()).toBe(filePath);
      expect(rule.getFileContent()).toBe(fileContent);
    });

    it("should handle GEMINI.md files", async () => {
      const filePath = join(testDir, "GEMINI.md");
      const fileContent = `# Gemini Compatible Rules

## Tech Stack
- Language: TypeScript
- AI Models: Qwen3-Coder`;

      await fs.mkdir(testDir, { recursive: true });
      await fs.writeFile(filePath, fileContent, "utf-8");

      const rule = await QwencodeRule.fromFilePath(filePath);

      expect(rule.getFilePath()).toBe(filePath);
      expect(rule.getFileContent()).toBe(fileContent);
    });
  });

  describe("fromRulesyncRule", () => {
    it("should convert from RulesyncRule to QwencodeRule", () => {
      const rulesyncPath = join(testDir, "qwencode-project.md");
      const rulesyncContent = `---
target: qwencode
description: "QwenCode project rules"
---

# Project: MyProject

## Tech Stack
- Framework: Next.js 14
- Language: TypeScript
- AI Models: Qwen3-Coder

## Coding Standards
- Use TypeScript strict mode
- Follow clean architecture principles`;

      const rulesyncRule = RulesyncRule.build({
        filePath: rulesyncPath,
        fileContent: rulesyncContent,
      });

      const qwencodeRule = QwencodeRule.fromRulesyncRule(rulesyncRule);

      expect(qwencodeRule.getFilePath()).toBe(join(testDir, "QWEN.md"));
      expect(qwencodeRule.getFileContent()).toBe(`# Project: MyProject

## Tech Stack
- Framework: Next.js 14
- Language: TypeScript
- AI Models: Qwen3-Coder

## Coding Standards
- Use TypeScript strict mode
- Follow clean architecture principles`);
    });

    it("should handle rules with Qwen3-Coder specific instructions", () => {
      const rulesyncPath = join(testDir, "qwencode-ai.md");
      const rulesyncContent = `---
target: qwencode
description: "QwenCode AI-specific rules"
---

## Qwen3-Coder Optimization
- Leverage advanced code understanding capabilities
- Use multi-language programming support
- Apply agentic coding patterns
- Implement function calling where appropriate`;

      const rulesyncRule = RulesyncRule.build({
        filePath: rulesyncPath,
        fileContent: rulesyncContent,
      });

      const qwencodeRule = QwencodeRule.fromRulesyncRule(rulesyncRule);

      expect(qwencodeRule.getFileContent()).toContain("Qwen3-Coder Optimization");
      expect(qwencodeRule.getFileContent()).toContain("agentic coding patterns");
      expect(qwencodeRule.getFileContent()).not.toContain("---");
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert QWEN.md to RulesyncRule format", () => {
      const qwencodeRule = QwencodeRule.build({
        filePath: join(testDir, "QWEN.md"),
        fileContent: `# Project: MyApp

## Tech Stack
- Framework: React 18 with TypeScript
- AI Models: Qwen3-Coder

## Security Guidelines
- Never commit API keys or secrets
- Use environment variables for configuration`,
      });

      const rulesyncRule = qwencodeRule.toRulesyncRule();

      expect(rulesyncRule.getFilePath()).toBe(join(testDir, "qwencode-qwen.md"));
      expect(rulesyncRule.getFrontmatter()).toEqual({
        target: "qwencode",
        description: "QwenCode context and memory for QWEN",
      });
      expect(rulesyncRule.getContent()).toContain("Project: MyApp");
      expect(rulesyncRule.getContent()).toContain("Tech Stack");
    });

    it("should convert AGENTS.md to RulesyncRule format", () => {
      const qwencodeRule = QwencodeRule.build({
        filePath: join(testDir, "AGENTS.md"),
        fileContent: `# Agent Rules

## Development Standards
- Use semantic versioning
- Follow conventional commit messages`,
      });

      const rulesyncRule = qwencodeRule.toRulesyncRule();

      expect(rulesyncRule.getFilePath()).toBe(join(testDir, "qwencode-agents.md"));
      expect(rulesyncRule.getFrontmatter()).toEqual({
        target: "qwencode",
        description: "QwenCode context and memory for AGENTS",
      });
    });
  });

  describe("writeFile", () => {
    it("should write rule to file system", async () => {
      const filePath = join(testDir, "QWEN.md");
      const fileContent = `# QwenCode Rules

## Standards
- Follow TypeScript conventions`;

      const rule = QwencodeRule.build({ filePath, fileContent });
      await rule.writeFile();

      const writtenContent = await fs.readFile(filePath, "utf-8");
      expect(writtenContent).toBe(fileContent);
    });

    it("should create directories if they don't exist", async () => {
      const filePath = join(testDir, "nested", "deep", "QWEN.md");
      const fileContent = `# Nested QwenCode Rules`;

      const rule = QwencodeRule.build({ filePath, fileContent });
      await rule.writeFile();

      const writtenContent = await fs.readFile(filePath, "utf-8");
      expect(writtenContent).toBe(fileContent);
    });
  });

  describe("validate", () => {
    it("should validate correct QwenCode rule with QWEN.md", () => {
      const rule = QwencodeRule.build({
        filePath: join(testDir, "QWEN.md"),
        fileContent: `# Valid QwenCode Rules

## Project Overview
This is a valid QwenCode project configuration.`,
      });

      const result = rule.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should validate correct QwenCode rule with AGENTS.md", () => {
      const rule = QwencodeRule.build({
        filePath: join(testDir, "AGENTS.md"),
        fileContent: `# Valid Agent Rules`,
      });

      const result = rule.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should validate correct QwenCode rule with GEMINI.md", () => {
      const rule = QwencodeRule.build({
        filePath: join(testDir, "GEMINI.md"),
        fileContent: `# Valid Gemini Compatible Rules`,
      });

      const result = rule.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should reject invalid file path", () => {
      const rule = QwencodeRule.build({
        filePath: join(testDir, "invalid.txt"),
        fileContent: "Valid content",
      });

      const result = rule.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain(
        "QwenCode rule file must be QWEN.md, AGENTS.md, or GEMINI.md",
      );
    });

    it("should reject empty content", () => {
      const rule = QwencodeRule.build({
        filePath: join(testDir, "QWEN.md"),
        fileContent: "",
      });

      const result = rule.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("QwenCode rule content cannot be empty");
    });

    it("should reject whitespace-only content", () => {
      const rule = QwencodeRule.build({
        filePath: join(testDir, "QWEN.md"),
        fileContent: "   \n   \t   ",
      });

      const result = rule.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("QwenCode rule content cannot be only whitespace");
    });
  });

  describe("getFilePath", () => {
    it("should return the file path", () => {
      const filePath = join(testDir, "QWEN.md");
      const rule = QwencodeRule.build({
        filePath,
        fileContent: "# Rules",
      });

      expect(rule.getFilePath()).toBe(filePath);
    });
  });

  describe("getFileContent", () => {
    it("should return the file content", () => {
      const content = `# Project Rules

## Standards
- Follow conventions`;
      const rule = QwencodeRule.build({
        filePath: join(testDir, "QWEN.md"),
        fileContent: content,
      });

      expect(rule.getFileContent()).toBe(content);
    });
  });
});
