import { promises as fs } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../../test-utils/index.js";
import { RulesyncRule } from "../rulesync-rule.js";
import { GeminicliRule } from "./geminicli-rule.js";

describe("GeminicliRule", () => {
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
      const filePath = join(testDir, "GEMINI.md");
      const fileContent = `# Project: <name>
Brief project description (2-3 sentences)

## Tech Stack
- Technology list
- Architecture details

## Coding Standards
1. Style rules
2. Quality requirements
3. Testing requirements`;

      const rule = GeminicliRule.build({ filePath, fileContent });

      expect(rule.getFilePath()).toBe(filePath);
      expect(rule.getFileContent()).toBe(fileContent);
    });
  });

  describe("fromFilePath", () => {
    it("should load a rule from file", async () => {
      const filePath = join(testDir, "GEMINI.md");
      const fileContent = `# Project: MyApp

Brief description of what this project does.

## Tech Stack
- Language: TypeScript
- Framework: Next.js 14
- Database: PostgreSQL

## Coding Standards
- Use TypeScript strict mode
- Prefer functional components
- Write comprehensive tests

## Mandatory Tooling
Commands that should be run:
\`\`\`bash
npm test
npm run lint
\`\`\`

## Build & Run Commands
- Install: npm install
- Dev server: npm run dev
- Tests: npm test`;

      await fs.mkdir(testDir, { recursive: true });
      await fs.writeFile(filePath, fileContent, "utf-8");

      const rule = await GeminicliRule.fromFilePath(filePath);

      expect(rule.getFilePath()).toBe(filePath);
      expect(rule.getFileContent()).toBe(fileContent);
    });
  });

  describe("fromRulesyncRule", () => {
    it("should convert from RulesyncRule to GeminicliRule", () => {
      const rulesyncPath = join(testDir, "geminicli-project.md");
      const rulesyncContent = `---
target: geminicli
description: "Gemini CLI memory file"
---

# Project: MyProject

Brief project overview goes here.

## Tech Stack
- Frontend: React 18
- Backend: Node.js
- Database: MongoDB

## Coding Standards
- Use ESLint configuration
- Follow TypeScript strict mode
- Write unit tests for all functions

## Security / Don't-ever-do
- Never commit API keys
- Don't use deprecated functions`;

      const rulesyncRule = RulesyncRule.build({
        filePath: rulesyncPath,
        fileContent: rulesyncContent,
      });

      const geminiRule = GeminicliRule.fromRulesyncRule(rulesyncRule);

      expect(geminiRule.getFilePath()).toBe(join(testDir, "GEMINI.md"));
      expect(geminiRule.getFileContent()).toBe(`# Project: MyProject

Brief project overview goes here.

## Tech Stack
- Frontend: React 18
- Backend: Node.js
- Database: MongoDB

## Coding Standards
- Use ESLint configuration
- Follow TypeScript strict mode
- Write unit tests for all functions

## Security / Don't-ever-do
- Never commit API keys
- Don't use deprecated functions`);
    });

    it("should handle complex Gemini CLI memory content", () => {
      const rulesyncPath = join(testDir, "geminicli-complex.md");
      const rulesyncContent = `---
target: geminicli
description: "Complex Gemini CLI rules"
---

# Project: E-commerce Platform

This is a modern e-commerce platform built with React and Node.js.

## Tech Stack
- Frontend: React 18 with TypeScript
- Backend: Express.js with TypeScript
- Database: PostgreSQL with Prisma
- Styling: Tailwind CSS

## Build & Run Commands
### Development
\`\`\`bash
npm install
npm run dev
\`\`\`

### Testing
\`\`\`bash
npm test
npm run test:e2e
\`\`\`

## Security Guidelines
- All API endpoints require authentication
- Input validation on all user data
- Rate limiting on public endpoints

## Architecture Guidelines
- Follow clean architecture principles
- Use dependency injection
- Implement proper error boundaries`;

      const rulesyncRule = RulesyncRule.build({
        filePath: rulesyncPath,
        fileContent: rulesyncContent,
      });

      const geminiRule = GeminicliRule.fromRulesyncRule(rulesyncRule);

      expect(geminiRule.getFileContent()).toContain("E-commerce Platform");
      expect(geminiRule.getFileContent()).toContain("Build & Run Commands");
      expect(geminiRule.getFileContent()).toContain("Security Guidelines");
      expect(geminiRule.getFileContent()).not.toContain("---");
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert to RulesyncRule format", () => {
      const geminiRule = GeminicliRule.build({
        filePath: join(testDir, "GEMINI.md"),
        fileContent: `# Project: MyApp

Brief description of the project.

## Tech Stack
- React 18 with TypeScript
- Express.js backend
- PostgreSQL database

## Coding Standards
- Use strict TypeScript mode
- Follow ESLint configuration
- Write comprehensive tests

## Build Commands
- Install: npm install
- Dev: npm run dev
- Test: npm test`,
      });

      const rulesyncRule = geminiRule.toRulesyncRule();

      expect(rulesyncRule.getFilePath()).toBe(join(testDir, "geminicli-gemini.md"));
      expect(rulesyncRule.getFrontmatter()).toEqual({
        target: "geminicli",
        description: "Gemini CLI memory and project context",
      });
      expect(rulesyncRule.getContent()).toContain("Project: MyApp");
      expect(rulesyncRule.getContent()).toContain("Tech Stack");
      expect(rulesyncRule.getContent()).toContain("Build Commands");
    });
  });

  describe("writeFile", () => {
    it("should write rule to file system", async () => {
      const filePath = join(testDir, "GEMINI.md");
      const fileContent = `# Project Rules

## Standards
- Follow TypeScript conventions
- Write comprehensive tests`;

      const rule = GeminicliRule.build({ filePath, fileContent });
      await rule.writeFile();

      const writtenContent = await fs.readFile(filePath, "utf-8");
      expect(writtenContent).toBe(fileContent);
    });

    it("should create directories if they don't exist", async () => {
      const filePath = join(testDir, "nested", "deep", "GEMINI.md");
      const fileContent = `# Nested Project Memory`;

      const rule = GeminicliRule.build({ filePath, fileContent });
      await rule.writeFile();

      const writtenContent = await fs.readFile(filePath, "utf-8");
      expect(writtenContent).toBe(fileContent);
    });
  });

  describe("validate", () => {
    it("should validate correct Gemini CLI rule", () => {
      const rule = GeminicliRule.build({
        filePath: join(testDir, "GEMINI.md"),
        fileContent: `# Valid Gemini CLI Memory

## Project Overview
This is a valid Gemini CLI project memory file.

## Tech Stack
- Language: TypeScript
- Framework: React`,
      });

      const result = rule.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should reject invalid file path", () => {
      const rule = GeminicliRule.build({
        filePath: join(testDir, "invalid.txt"),
        fileContent: "Valid content",
      });

      const result = rule.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("Gemini CLI rule file must be named GEMINI.md");
    });

    it("should reject empty content", () => {
      const rule = GeminicliRule.build({
        filePath: join(testDir, "GEMINI.md"),
        fileContent: "",
      });

      const result = rule.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("Gemini CLI rule content cannot be empty");
    });

    it("should reject whitespace-only content", () => {
      const rule = GeminicliRule.build({
        filePath: join(testDir, "GEMINI.md"),
        fileContent: "   \n   \t   ",
      });

      const result = rule.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("Gemini CLI rule content cannot be only whitespace");
    });
  });

  describe("getFilePath", () => {
    it("should return the file path", () => {
      const filePath = join(testDir, "GEMINI.md");
      const rule = GeminicliRule.build({
        filePath,
        fileContent: "# Memory",
      });

      expect(rule.getFilePath()).toBe(filePath);
    });
  });

  describe("getFileContent", () => {
    it("should return the file content", () => {
      const content = `# Project Memory

## Standards
- Follow conventions`;
      const rule = GeminicliRule.build({
        filePath: join(testDir, "GEMINI.md"),
        fileContent: content,
      });

      expect(rule.getFileContent()).toBe(content);
    });
  });
});
