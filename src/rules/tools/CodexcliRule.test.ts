import { promises as fs } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../../test-utils/index.js";
import { RulesyncRule } from "../RulesyncRule.js";
import { CodexcliRule } from "./CodexcliRule.js";

describe("CodexcliRule", () => {
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
      const filePath = join(testDir, "AGENTS.md");
      const fileContent = `# Project Instructions

This is a test AGENTS.md file for Codex CLI.

## Tech Stack
- Language: TypeScript
- Framework: Next.js

## Coding Standards
- Use TypeScript strict mode
- Write meaningful variable names`;

      const rule = CodexcliRule.build({ filePath, fileContent });

      expect(rule.getFilePath()).toBe(filePath);
      expect(rule.getFileContent()).toBe(fileContent);
    });
  });

  describe("fromFilePath", () => {
    it("should load a rule from AGENTS.md file", async () => {
      const filePath = join(testDir, "AGENTS.md");
      const fileContent = `# E-commerce Platform

This is a modern e-commerce platform built with Next.js and TypeScript.

## Architecture
- Frontend: Next.js 14 with TypeScript
- Backend: Next.js API routes
- Database: PostgreSQL with Prisma ORM`;

      await fs.writeFile(filePath, fileContent, "utf-8");

      const rule = await CodexcliRule.fromFilePath(filePath);

      expect(rule.getFilePath()).toBe(filePath);
      expect(rule.getFileContent()).toBe(fileContent);
    });

    it("should load a rule from global instructions file", async () => {
      const codexDir = join(testDir, ".codex");
      await fs.mkdir(codexDir, { recursive: true });
      const filePath = join(codexDir, "instructions.md");
      const fileContent = `# Global Development Guidelines

## Safety Rules
- Always ask for confirmation before running destructive commands
- Never execute \`rm -rf\` without explicit user approval

## Code Quality Standards
- Use consistent indentation
- Write descriptive commit messages`;

      await fs.writeFile(filePath, fileContent, "utf-8");

      const rule = await CodexcliRule.fromFilePath(filePath);

      expect(rule.getFilePath()).toBe(filePath);
      expect(rule.getFileContent()).toBe(fileContent);
    });
  });

  describe("fromRulesyncRule", () => {
    it("should create CodexcliRule from RulesyncRule with root rule", () => {
      const rulesyncPath = join(testDir, "rules", "project-rule.md");
      const rulesyncContent = `---
target: codexcli
root: true
description: Project-level Codex CLI instructions
---

# Project Instructions
This is root rule content for project-level instructions.

## Tech Stack
- Language: TypeScript
- Framework: React`;

      const rulesyncRule = RulesyncRule.build({
        filePath: rulesyncPath,
        fileContent: rulesyncContent,
      });

      const codexcliRule = CodexcliRule.fromRulesyncRule(rulesyncRule);

      expect(codexcliRule.getFilePath()).toBe(join(testDir, "rules", "AGENTS.md"));
      expect(codexcliRule.getFileContent()).toBe(`# Project Instructions
This is root rule content for project-level instructions.

## Tech Stack
- Language: TypeScript
- Framework: React`);
    });

    it("should create CodexcliRule from RulesyncRule with global rule", () => {
      const rulesyncPath = join(testDir, "rules", "global-rule.md");
      const rulesyncContent = `---
target: codexcli
global: true
description: Global Codex CLI instructions
---

# Global Instructions
These are global user instructions.

## Safety Rules
- Ask before destructive operations`;

      const rulesyncRule = RulesyncRule.build({
        filePath: rulesyncPath,
        fileContent: rulesyncContent,
      });

      const codexcliRule = CodexcliRule.fromRulesyncRule(rulesyncRule);

      const homeDir = process.env.HOME || process.env.USERPROFILE || "";
      const expectedPath = join(homeDir, ".codex", "instructions.md");
      expect(codexcliRule.getFilePath()).toBe(expectedPath);
      expect(codexcliRule.getFileContent()).toBe(`# Global Instructions
These are global user instructions.

## Safety Rules
- Ask before destructive operations`);
    });

    it("should create CodexcliRule from RulesyncRule with detail rule (directory-specific)", () => {
      const rulesyncPath = join(testDir, "rules", "detail-rule.md");
      const rulesyncContent = `---
target: codexcli
description: Directory-specific Codex CLI instructions
---

# Component Guidelines
Directory-specific instructions for components.

## Structure
- One component per file
- Co-locate tests with components`;

      const rulesyncRule = RulesyncRule.build({
        filePath: rulesyncPath,
        fileContent: rulesyncContent,
      });

      const codexcliRule = CodexcliRule.fromRulesyncRule(rulesyncRule);

      expect(codexcliRule.getFilePath()).toBe(join(testDir, "rules", "AGENTS.md"));
      expect(codexcliRule.getFileContent()).toBe(`# Component Guidelines
Directory-specific instructions for components.

## Structure
- One component per file
- Co-locate tests with components`);
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert project AGENTS.md to RulesyncRule", () => {
      const filePath = join(testDir, "AGENTS.md");
      const fileContent = `# Project Instructions

## Architecture
- Frontend: React
- Backend: Node.js

## Standards
- Use TypeScript strict mode`;

      const codexcliRule = CodexcliRule.build({ filePath, fileContent });
      const rulesyncRule = codexcliRule.toRulesyncRule();

      expect(rulesyncRule.getFilePath()).toBe(join(testDir, "codexcli-rule.md"));
      expect(rulesyncRule.getContent().trim()).toBe(fileContent);

      const frontmatter = rulesyncRule.getFrontmatter();
      expect(frontmatter.target).toBe("codexcli");
      expect(frontmatter.description).toBe("Project-level instructions for Codex CLI");
      expect(frontmatter.root).toBe(true);
    });

    it("should convert global instructions.md to RulesyncRule", () => {
      const filePath = join(testDir, ".codex", "instructions.md");
      const fileContent = `# Global Guidelines

## Safety
- Never run destructive commands without confirmation

## Quality
- Write comprehensive tests`;

      const codexcliRule = CodexcliRule.build({ filePath, fileContent });
      const rulesyncRule = codexcliRule.toRulesyncRule();

      expect(rulesyncRule.getFilePath()).toBe(join(testDir, ".codex", "codexcli-rule.md"));
      expect(rulesyncRule.getContent().trim()).toBe(fileContent);

      const frontmatter = rulesyncRule.getFrontmatter();
      expect(frontmatter.target).toBe("codexcli");
      expect(frontmatter.description).toBe("Global user instructions for Codex CLI");
      expect(frontmatter.global).toBe(true);
    });
  });

  describe("writeFile", () => {
    it("should write AGENTS.md rule to file system", async () => {
      const filePath = join(testDir, "output", "AGENTS.md");
      const fileContent = `# Test Project

## Description
This is a test project for Codex CLI.

## Standards
- Follow clean code principles
- Write comprehensive tests`;

      const rule = CodexcliRule.build({ filePath, fileContent });
      await rule.writeFile();

      const writtenContent = await fs.readFile(filePath, "utf-8");
      expect(writtenContent).toBe(fileContent);
    });

    it("should write global instructions.md rule to file system", async () => {
      const filePath = join(testDir, "home", ".codex", "instructions.md");
      const fileContent = `# Personal Development Guidelines

## Philosophy
- Code should be self-documenting
- Tests are documentation

## Tools
- Prefer TypeScript over JavaScript
- Use ESLint and Prettier`;

      const rule = CodexcliRule.build({ filePath, fileContent });
      await rule.writeFile();

      const writtenContent = await fs.readFile(filePath, "utf-8");
      expect(writtenContent).toBe(fileContent);
    });

    it("should create directories if they do not exist", async () => {
      const filePath = join(testDir, "nested", "deep", ".codex", "instructions.md");
      const fileContent = "Deep nested global instructions";

      const rule = CodexcliRule.build({ filePath, fileContent });
      await rule.writeFile();

      const writtenContent = await fs.readFile(filePath, "utf-8");
      expect(writtenContent).toBe(fileContent);
    });
  });

  describe("validate", () => {
    it("should validate valid AGENTS.md rule", () => {
      const filePath = join(testDir, "AGENTS.md");
      const fileContent = `# Valid Project Instructions

This is valid content for Codex CLI project instructions.`;

      const rule = CodexcliRule.build({ filePath, fileContent });
      const result = rule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should validate valid global instructions rule", () => {
      const filePath = join(testDir, ".codex", "instructions.md");
      const fileContent = `# Valid Global Instructions

These are valid global instructions for Codex CLI.`;

      const rule = CodexcliRule.build({ filePath, fileContent });
      const result = rule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should reject empty content", () => {
      const filePath = join(testDir, "AGENTS.md");
      const fileContent = "";

      const rule = CodexcliRule.build({ filePath, fileContent });
      const result = rule.validate();

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("cannot be empty");
    });

    it("should reject whitespace-only content", () => {
      const filePath = join(testDir, "AGENTS.md");
      const fileContent = "   \n\t  \n  ";

      const rule = CodexcliRule.build({ filePath, fileContent });
      const result = rule.validate();

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("cannot be only whitespace");
    });

    it("should reject invalid file path", () => {
      const filePath = join(testDir, "wrong-name.md");
      const fileContent = "# Content";

      const rule = CodexcliRule.build({ filePath, fileContent });
      const result = rule.validate();

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("must be AGENTS.md or .codex/instructions.md");
    });

    it("should accept various valid file paths", () => {
      const validPaths = [
        join(testDir, "AGENTS.md"),
        join(testDir, "project", "AGENTS.md"),
        join(testDir, "src", "components", "AGENTS.md"),
        join(testDir, ".codex", "instructions.md"),
        join("/home/user/.codex/instructions.md"),
      ];

      const fileContent = "# Valid content";

      validPaths.forEach((filePath) => {
        const rule = CodexcliRule.build({ filePath, fileContent });
        const result = rule.validate();

        expect(result.success).toBe(true);
        expect(result.error).toBeNull();
      });
    });
  });

  describe("getFilePath", () => {
    it("should return the correct file path", () => {
      const filePath = join(testDir, "test", "AGENTS.md");
      const fileContent = "# Test content";

      const rule = CodexcliRule.build({ filePath, fileContent });

      expect(rule.getFilePath()).toBe(filePath);
    });
  });

  describe("getFileContent", () => {
    it("should return the correct file content", () => {
      const filePath = join(testDir, "AGENTS.md");
      const fileContent = `# My Project Instructions

## Architecture
This project follows clean architecture principles.

## Testing
All business logic must have unit tests.`;

      const rule = CodexcliRule.build({ filePath, fileContent });

      expect(rule.getFileContent()).toBe(fileContent);
    });
  });

  describe("integration with existing file content", () => {
    it("should handle typical Codex CLI AGENTS.md content", () => {
      const filePath = join(testDir, "AGENTS.md");
      const fileContent = `# E-commerce Platform

This is a modern e-commerce platform built with Next.js and TypeScript.

## Architecture
- Frontend: Next.js 14 with TypeScript
- Backend: Next.js API routes
- Database: PostgreSQL with Prisma ORM
- Styling: Tailwind CSS
- Authentication: NextAuth.js

## Development Workflow
### Setup
\`\`\`bash
pnpm install
cp .env.example .env.local
pnpm db:push
\`\`\`

### Daily Development
\`\`\`bash
pnpm dev      # Start development server
pnpm test     # Run test suite
pnpm lint     # Check code quality
\`\`\`

## Component Standards
- One component per file
- Use TypeScript interfaces for props
- Implement proper error boundaries
- Follow atomic design principles`;

      const rule = CodexcliRule.build({ filePath, fileContent });
      const validationResult = rule.validate();

      expect(validationResult.success).toBe(true);
      expect(rule.getFileContent()).toBe(fileContent);

      // Test round-trip conversion
      const rulesyncRule = rule.toRulesyncRule();
      expect(rulesyncRule.getContent().trim()).toBe(fileContent);
      expect(rulesyncRule.getFrontmatter().target).toBe("codexcli");
    });

    it("should handle typical global instructions content", () => {
      const filePath = join(testDir, ".codex", "instructions.md");
      const fileContent = `# Global Development Guidelines

## Safety Rules
- Always ask for confirmation before running destructive commands
- Never execute \`rm -rf\` without explicit user approval
- Validate paths before file operations

## Code Quality Standards
- Use consistent indentation (2 spaces for JS/TS, 4 for Python)
- Write descriptive commit messages
- Include error handling in all functions
- Use meaningful variable names

## Testing Philosophy
- Write tests before implementing features (TDD)
- Maintain minimum 80% code coverage
- Test edge cases and error conditions`;

      const rule = CodexcliRule.build({ filePath, fileContent });
      const validationResult = rule.validate();

      expect(validationResult.success).toBe(true);
      expect(rule.getFileContent()).toBe(fileContent);

      // Test round-trip conversion
      const rulesyncRule = rule.toRulesyncRule();
      expect(rulesyncRule.getContent().trim()).toBe(fileContent);
      expect(rulesyncRule.getFrontmatter().target).toBe("codexcli");
      expect(rulesyncRule.getFrontmatter().global).toBe(true);
    });
  });
});
