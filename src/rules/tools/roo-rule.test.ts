import { promises as fs } from "node:fs";
import path, { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../../test-utils/index.js";
import { RulesyncRule } from "../rulesync-rule.js";
import { RooRule } from "./roo-rule.js";

describe("RooRule", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const testSetup = await setupTestDirectory();
    testDir = testSetup.testDir;
    cleanup = testSetup.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("build", () => {
    it("should build a rule from file path and content", () => {
      const filePath = join(testDir, ".roo", "rules", "project-guidelines.md");
      const fileContent = `# Project Guidelines

## Tech Stack
- Framework: Next.js 14
- Language: TypeScript
- Styling: Tailwind CSS

## Coding Standards
- Use functional components with hooks
- Write meaningful variable names`;

      const rule = RooRule.build({ filePath, fileContent });

      expect(rule.getFilePath()).toBe(filePath);
      expect(rule.getFileContent()).toBe(fileContent);
    });
  });

  describe("fromFilePath", () => {
    it("should load a rule from file", async () => {
      const filePath = join(testDir, ".roo", "rules", "coding-standards.md");
      const fileContent = `# Coding Standards

## Architecture Patterns
- Follow clean architecture principles
- Use dependency injection for services

## Security Guidelines
- Never commit secrets or API keys
- Use environment variables for configuration`;

      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, fileContent, "utf-8");

      const rule = await RooRule.fromFilePath(filePath);

      expect(rule.getFilePath()).toBe(filePath);
      expect(rule.getFileContent()).toBe(fileContent);
    });

    it("should load a nested rule from deep directory structure", async () => {
      const filePath = join(testDir, ".roo", "rules", "security", "api", "authentication.md");
      const fileContent = `# Authentication Rules

## JWT Standards
- Use secure signing algorithms
- Implement proper token rotation`;

      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, fileContent, "utf-8");

      const rule = await RooRule.fromFilePath(filePath);

      expect(rule.getFilePath()).toBe(filePath);
      expect(rule.getFileContent()).toBe(fileContent);
    });
  });

  describe("fromRulesyncRule", () => {
    it("should convert from RulesyncRule to RooRule", () => {
      const rulesyncPath = join(testDir, "roo-project.md");
      const rulesyncContent = `---
target: roo
description: "Roo Code project rules"
---

# Project Guidelines

## Tech Stack
- Framework: Next.js 14
- Language: TypeScript

## Coding Standards
- Use functional components with hooks
- Follow clean architecture principles`;

      const rulesyncRule = RulesyncRule.build({
        filePath: rulesyncPath,
        fileContent: rulesyncContent,
      });

      const rooRule = RooRule.fromRulesyncRule(rulesyncRule);

      expect(rooRule.getFilePath()).toBe(join(testDir, ".roo", "rules", "project.md"));
      expect(rooRule.getFileContent()).toBe(`# Project Guidelines

## Tech Stack
- Framework: Next.js 14
- Language: TypeScript

## Coding Standards
- Use functional components with hooks
- Follow clean architecture principles`);
    });

    it("should handle mode-specific rules", () => {
      const rulesyncPath = join(testDir, "roo-coding-standards-ask.md");
      const rulesyncContent = `---
target: roo
description: "Roo Code rules for Ask mode"
mode: ask
---

# Ask Mode Coding Standards

## Response Guidelines
- Provide clear explanations
- Include code examples`;

      const rulesyncRule = RulesyncRule.build({
        filePath: rulesyncPath,
        fileContent: rulesyncContent,
      });

      const rooRule = RooRule.fromRulesyncRule(rulesyncRule);

      expect(rooRule.getFilePath()).toBe(join(testDir, ".roo", "rules-ask", "coding-standards.md"));
      expect(rooRule.getFileContent()).toContain("Ask Mode Coding Standards");
      expect(rooRule.getFileContent()).not.toContain("---");
    });

    it("should handle root rules", () => {
      const rulesyncPath = join(testDir, "roo-global-standards-root.md");
      const rulesyncContent = `---
target: roo
description: "Roo Code root rules"
root: true
---

# Global Workspace Standards

## Organization-wide Rules
- Follow company coding standards
- Use approved libraries only`;

      const rulesyncRule = RulesyncRule.build({
        filePath: rulesyncPath,
        fileContent: rulesyncContent,
      });

      const rooRule = RooRule.fromRulesyncRule(rulesyncRule);

      expect(rooRule.getFilePath()).toBe(join(testDir, ".roo", "rules", "global-standards.md"));
      expect(rooRule.getFileContent()).toContain("Global Workspace Standards");
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert regular rule to RulesyncRule format", () => {
      const rooRule = RooRule.build({
        filePath: join(testDir, ".roo", "rules", "coding-standards.md"),
        fileContent: `# Coding Standards

## TypeScript Guidelines
- Use strict mode
- Prefer interfaces over types

## Testing Requirements
- Write unit tests for all business logic
- Maintain 80% code coverage`,
      });

      const rulesyncRule = rooRule.toRulesyncRule();

      expect(rulesyncRule.getFilePath()).toBe(join(testDir, "roo-coding-standards.md"));
      expect(rulesyncRule.getFrontmatter()).toEqual({
        target: "roo",
        description: "Roo Code rules - coding-standards",
      });
      expect(rulesyncRule.getContent()).toContain("Coding Standards");
      expect(rulesyncRule.getContent()).toContain("TypeScript Guidelines");
    });

    it("should convert mode-specific rule to RulesyncRule format", () => {
      const rooRule = RooRule.build({
        filePath: join(testDir, ".roo", "rules-code", "generation-patterns.md"),
        fileContent: `# Code Generation Patterns

## Best Practices
- Generate clean, readable code
- Include proper error handling`,
      });

      const rulesyncRule = rooRule.toRulesyncRule();

      expect(rulesyncRule.getFilePath()).toBe(join(testDir, "roo-generation-patterns-code.md"));
      expect(rulesyncRule.getFrontmatter()).toEqual({
        target: "roo",
        description: "Roo Code rules for code mode - generation-patterns",
        mode: "code",
      });
    });

    it("should convert root rule to RulesyncRule format", () => {
      const rooRule = RooRule.build({
        filePath: join(testDir, ".roo", "rules", "global-standards.md"),
        fileContent: `# Global Workspace Standards

## Organization-wide Rules
- Follow company coding standards
- Use approved libraries only
- Workspace-wide enforcement required`,
      });

      const rulesyncRule = rooRule.toRulesyncRule();

      expect(rulesyncRule.getFilePath()).toBe(join(testDir, "roo-global-standards-root.md"));
      expect(rulesyncRule.getFrontmatter()).toEqual({
        target: "roo",
        description: "Roo Code root rules - global-standards",
        root: true,
      });
    });
  });

  describe("writeFile", () => {
    it("should write rule to file system", async () => {
      const filePath = join(testDir, ".roo", "rules", "project-rules.md");
      const fileContent = `# Project Rules

## Standards
- Follow TypeScript conventions`;

      const rule = RooRule.build({ filePath, fileContent });
      await rule.writeFile();

      const writtenContent = await fs.readFile(filePath, "utf-8");
      expect(writtenContent).toBe(fileContent);
    });

    it("should create nested directories if they don't exist", async () => {
      const filePath = join(testDir, ".roo", "rules", "security", "api", "auth.md");
      const fileContent = `# API Authentication Rules`;

      const rule = RooRule.build({ filePath, fileContent });
      await rule.writeFile();

      const writtenContent = await fs.readFile(filePath, "utf-8");
      expect(writtenContent).toBe(fileContent);
    });
  });

  describe("validate", () => {
    it("should validate correct Roo rule", () => {
      const rule = RooRule.build({
        filePath: join(testDir, ".roo", "rules", "coding-standards.md"),
        fileContent: `# Valid Roo Rules

## Project Overview
This is a valid Roo Code project configuration.`,
      });

      const result = rule.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should validate nested rules", () => {
      const rule = RooRule.build({
        filePath: join(testDir, ".roo", "rules", "frontend", "components.md"),
        fileContent: `# Component Rules`,
      });

      const result = rule.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should reject invalid file path", () => {
      const rule = RooRule.build({
        filePath: join(testDir, "invalid.txt"),
        fileContent: "Valid content",
      });

      const result = rule.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain(
        "Roo Code rule file must be in .roo/rules/ directory and have .md extension",
      );
    });

    it("should reject empty content", () => {
      const rule = RooRule.build({
        filePath: join(testDir, ".roo", "rules", "test.md"),
        fileContent: "",
      });

      const result = rule.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("Roo Code rule content cannot be empty");
    });

    it("should reject whitespace-only content", () => {
      const rule = RooRule.build({
        filePath: join(testDir, ".roo", "rules", "test.md"),
        fileContent: "   \n   \t   ",
      });

      const result = rule.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("Roo Code rule content cannot be only whitespace");
    });
  });

  describe("getFilePath", () => {
    it("should return the file path", () => {
      const filePath = join(testDir, ".roo", "rules", "test.md");
      const rule = RooRule.build({
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
      const rule = RooRule.build({
        filePath: join(testDir, ".roo", "rules", "test.md"),
        fileContent: content,
      });

      expect(rule.getFileContent()).toBe(content);
    });
  });
});
