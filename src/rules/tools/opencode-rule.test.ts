import { promises as fs } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../../test-utils/index.js";
import { RulesyncRule } from "../rulesync-rule.js";
import { OpencodeRule } from "./opencode-rule.js";

describe("OpencodeRule", () => {
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
      const fileContent = `# Project Rules

## Coding Standards
- Use TypeScript strict mode
- Follow ESLint configuration`;

      const rule = OpencodeRule.build({ filePath, fileContent });

      expect(rule.getFilePath()).toBe(filePath);
      expect(rule.getFileContent()).toBe(fileContent);
    });
  });

  describe("fromFilePath", () => {
    it("should load a rule from file", async () => {
      const filePath = join(testDir, "AGENTS.md");
      const fileContent = `# Project Guidelines

## Tech Stack
- Language: TypeScript
- Framework: React 18

## Security Guidelines
- Never commit API keys
- Use environment variables`;

      await fs.mkdir(testDir, { recursive: true });
      await fs.writeFile(filePath, fileContent, "utf-8");

      const rule = await OpencodeRule.fromFilePath(filePath);

      expect(rule.getFilePath()).toBe(filePath);
      expect(rule.getFileContent()).toBe(fileContent);
    });
  });

  describe("fromRulesyncRule", () => {
    it("should convert from RulesyncRule to OpencodeRule", () => {
      const rulesyncPath = join(testDir, "opencode-project.md");
      const rulesyncContent = `---
target: opencode
description: "OpenCode project rules"
---

# Project Rules

## Coding Standards
- Use TypeScript strict mode
- Follow clean architecture`;

      const rulesyncRule = RulesyncRule.build({
        filePath: rulesyncPath,
        fileContent: rulesyncContent,
      });

      const opencodeRule = OpencodeRule.fromRulesyncRule(rulesyncRule);

      expect(opencodeRule.getFilePath()).toBe(join(testDir, "AGENTS.md"));
      expect(opencodeRule.getFileContent()).toBe(`# Project Rules

## Coding Standards
- Use TypeScript strict mode
- Follow clean architecture`);
    });

    it("should handle rules with complex content", () => {
      const rulesyncPath = join(testDir, "opencode-complex.md");
      const rulesyncContent = `---
target: opencode
description: "Complex OpenCode rules"
---

# Complex Project Rules

## AI Guard-rails
* Never change code under \`packages/generated/**\`
* Ask before running shell commands that modify prod data

## Directory Glossary
- \`apps/…\` — front-end Next.js apps
- \`packages/…\` — shared libs (import as \`@my-app/<pkg>\`)`;

      const rulesyncRule = RulesyncRule.build({
        filePath: rulesyncPath,
        fileContent: rulesyncContent,
      });

      const opencodeRule = OpencodeRule.fromRulesyncRule(rulesyncRule);

      expect(opencodeRule.getFileContent()).toContain("AI Guard-rails");
      expect(opencodeRule.getFileContent()).toContain("Directory Glossary");
      expect(opencodeRule.getFileContent()).not.toContain("---");
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert to RulesyncRule format", () => {
      const opencodeRule = OpencodeRule.build({
        filePath: join(testDir, "AGENTS.md"),
        fileContent: `# Project Rules

## Coding Standards
- Use TypeScript strict mode
- Follow ESLint configuration

## Security Guidelines
- Never commit secrets
- Use environment variables`,
      });

      const rulesyncRule = opencodeRule.toRulesyncRule();

      expect(rulesyncRule.getFilePath()).toBe(join(testDir, "opencode-agents.md"));
      expect(rulesyncRule.getFrontmatter()).toEqual({
        target: "opencode",
        description: "OpenCode project rules and instructions",
      });
      expect(rulesyncRule.getContent()).toContain("Project Rules");
      expect(rulesyncRule.getContent()).toContain("Coding Standards");
    });
  });

  describe("writeFile", () => {
    it("should write rule to file system", async () => {
      const filePath = join(testDir, "AGENTS.md");
      const fileContent = `# Project Rules

## Standards
- Follow TypeScript conventions`;

      const rule = OpencodeRule.build({ filePath, fileContent });
      await rule.writeFile();

      const writtenContent = await fs.readFile(filePath, "utf-8");
      expect(writtenContent).toBe(fileContent);
    });

    it("should create directories if they don't exist", async () => {
      const filePath = join(testDir, "nested", "deep", "AGENTS.md");
      const fileContent = `# Nested Project Rules`;

      const rule = OpencodeRule.build({ filePath, fileContent });
      await rule.writeFile();

      const writtenContent = await fs.readFile(filePath, "utf-8");
      expect(writtenContent).toBe(fileContent);
    });
  });

  describe("validate", () => {
    it("should validate correct OpenCode rule", () => {
      const rule = OpencodeRule.build({
        filePath: join(testDir, "AGENTS.md"),
        fileContent: `# Valid OpenCode Rules

## Project Overview
This is a valid OpenCode project configuration.`,
      });

      const result = rule.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should reject invalid file path", () => {
      const rule = OpencodeRule.build({
        filePath: join(testDir, "invalid.txt"),
        fileContent: "Valid content",
      });

      const result = rule.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("OpenCode rule file must be named AGENTS.md");
    });

    it("should reject empty content", () => {
      const rule = OpencodeRule.build({
        filePath: join(testDir, "AGENTS.md"),
        fileContent: "",
      });

      const result = rule.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("OpenCode rule content cannot be empty");
    });

    it("should reject whitespace-only content", () => {
      const rule = OpencodeRule.build({
        filePath: join(testDir, "AGENTS.md"),
        fileContent: "   \n   \t   ",
      });

      const result = rule.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("OpenCode rule content cannot be only whitespace");
    });
  });

  describe("getFilePath", () => {
    it("should return the file path", () => {
      const filePath = join(testDir, "AGENTS.md");
      const rule = OpencodeRule.build({
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
      const rule = OpencodeRule.build({
        filePath: join(testDir, "AGENTS.md"),
        fileContent: content,
      });

      expect(rule.getFileContent()).toBe(content);
    });
  });
});
