import { promises as fs } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../../test-utils/index.js";
import { RulesyncRule } from "../rulesync-rule.js";
import { ClaudecodeRule } from "./claudecode-rule.js";

describe("ClaudecodeRule", () => {
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
    it("should build a ClaudecodeRule from file path and content", () => {
      const filePath = join(testDir, "CLAUDE.md");
      const fileContent = `# Claude Code Memory

## Project Guidelines
- Use TypeScript
- Follow clean architecture`;

      const rule = ClaudecodeRule.build({ filePath, fileContent });

      expect(rule.getFilePath()).toBe(filePath);
      expect(rule.getContent()).toBe(fileContent);
    });
  });

  describe("fromFilePath", () => {
    it("should load a ClaudecodeRule from file", async () => {
      const filePath = join(testDir, "CLAUDE.md");
      const fileContent = `# Project Rules

## Coding Standards
- Use functional components
- Write tests`;

      await fs.writeFile(filePath, fileContent, "utf-8");

      const rule = await ClaudecodeRule.fromFilePath(filePath);

      expect(rule.getContent()).toBe(fileContent);
      expect(rule.getFilePath()).toContain("CLAUDE.md");
    });
  });

  describe("fromRulesyncRule", () => {
    it("should convert from RulesyncRule to ClaudecodeRule", () => {
      const rulesyncPath = join(testDir, "rules", "claudecode.md");
      const rulesyncContent = `---
target: claudecode
description: Claude Code rules
---

# Claude Code Guidelines

## Standards
- TypeScript strict mode
- Clean code principles`;

      const rulesyncRule = RulesyncRule.build({
        filePath: rulesyncPath,
        fileContent: rulesyncContent,
      });

      const claudecodeRule = ClaudecodeRule.fromRulesyncRule(rulesyncRule);

      // Claude Code doesn't use frontmatter, only content
      expect(claudecodeRule.getContent()).not.toContain("---");
      expect(claudecodeRule.getContent()).toContain("# Claude Code Guidelines");
      expect(claudecodeRule.getContent()).toContain("TypeScript strict mode");

      // File path should be CLAUDE.md in the appropriate directory
      expect(claudecodeRule.getFilePath()).toContain("CLAUDE.md");
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert to RulesyncRule format", () => {
      const claudePath = join(testDir, "CLAUDE.md");
      const claudeContent = `# Claude Code Memory

## Tech Stack
- Next.js 14
- TypeScript
- Tailwind CSS`;

      const claudecodeRule = ClaudecodeRule.build({
        filePath: claudePath,
        fileContent: claudeContent,
      });

      const rulesyncRule = claudecodeRule.toRulesyncRule();

      // Check frontmatter was added
      const frontmatter = rulesyncRule.getFrontmatter();
      expect(frontmatter.target).toBe("claudecode");
      expect(frontmatter.description).toBe("Claude Code memory configuration");
      expect(frontmatter.modified).toBeDefined();

      // Check content is preserved
      expect(rulesyncRule.getContent()).toBe(claudeContent);

      // Check file path is in rules directory
      expect(rulesyncRule.getFilePath()).toContain(join("rules", "claudecode.md"));
    });
  });

  describe("writeFile", () => {
    it("should write ClaudecodeRule to file system", async () => {
      const filePath = join(testDir, "CLAUDE.md");
      const fileContent = `# Claude Code Configuration

## Guidelines
- Use modern JavaScript features
- Prefer composition over inheritance`;

      const rule = ClaudecodeRule.build({ filePath, fileContent });
      await rule.writeFile();

      const writtenContent = await fs.readFile(filePath, "utf-8");
      expect(writtenContent).toBe(fileContent);
    });

    it("should create directories if needed", async () => {
      const filePath = join(testDir, ".claude", "CLAUDE.md");
      const fileContent = "# Global Claude Code Rules";

      const rule = ClaudecodeRule.build({ filePath, fileContent });
      await rule.writeFile();

      const writtenContent = await fs.readFile(filePath, "utf-8");
      expect(writtenContent).toBe(fileContent);
    });
  });

  describe("validate", () => {
    it("should validate valid ClaudecodeRule", () => {
      const filePath = join(testDir, "CLAUDE.md");
      const fileContent = "# Valid Claude Code Memory";

      const rule = ClaudecodeRule.build({ filePath, fileContent });
      const result = rule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });

    it("should reject empty content", () => {
      const filePath = join(testDir, "CLAUDE.md");
      const fileContent = "";

      const rule = ClaudecodeRule.build({ filePath, fileContent });
      const result = rule.validate();

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("Claude Code memory content cannot be empty");
    });

    it("should reject incorrect filename", () => {
      const filePath = join(testDir, "wrong-name.md");
      const fileContent = "# Content";

      const rule = ClaudecodeRule.build({ filePath, fileContent });
      const result = rule.validate();

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("must be named CLAUDE.md");
    });

    it("should accept user global location", () => {
      const filePath = join(testDir, ".claude", "CLAUDE.md");
      const fileContent = "# Global Rules";

      const rule = ClaudecodeRule.build({ filePath, fileContent });
      const result = rule.validate();

      expect(result.success).toBe(true);
    });
  });

  describe("round-trip conversion", () => {
    it("should preserve content through round-trip conversion", () => {
      const originalContent = `# Project Configuration

## Development Standards
- Use ESLint and Prettier
- Write comprehensive tests
- Document public APIs

## Architecture
- Clean architecture principles
- Dependency injection
- SOLID principles`;

      // Start with a ClaudecodeRule
      const claudePath = join(testDir, "CLAUDE.md");
      const claudecodeRule = ClaudecodeRule.build({
        filePath: claudePath,
        fileContent: originalContent,
      });

      // Convert to RulesyncRule
      const rulesyncRule = claudecodeRule.toRulesyncRule();

      // Convert back to ClaudecodeRule
      const convertedBack = ClaudecodeRule.fromRulesyncRule(rulesyncRule);

      // Content should be preserved
      expect(convertedBack.getContent()).toBe(originalContent);
    });
  });
});
