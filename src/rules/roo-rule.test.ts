import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { describe, it, beforeEach, afterEach, expect } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import { RooRule, RooRuleFrontmatter } from "./roo-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";
import { RuleFrontmatter } from "../types/rules.js";

describe("RooRule", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("fromFilePath", () => {
    it("should create RooRule from plain Markdown file", async () => {
      const content = `# Project Guidelines

## Tech Stack
- Framework: Next.js 14
- Language: TypeScript

## Coding Standards
- Use functional components with hooks
- Write meaningful variable names`;

      const filePath = join(testDir, "coding-standards.md");
      await writeFile(filePath, content, "utf-8");

      const rule = await RooRule.fromFilePath({
        filePath,
        baseDir: testDir,
        relativeDirPath: "",
        relativeFilePath: "coding-standards.md",
      });

      expect(rule).toBeInstanceOf(RooRule);
      expect(rule.getOutputContent()).toBe(content);
      expect(rule.getMode()).toBeUndefined();
      expect(rule.getOutputFilePath()).toBe("coding-standards.md");
    });

    it("should extract description from first heading", async () => {
      const content = `# Development Guidelines

Content here`;

      const filePath = join(testDir, "dev-guide.md");
      await writeFile(filePath, content, "utf-8");

      const rule = await RooRule.fromFilePath({
        filePath,
        baseDir: testDir,
        relativeDirPath: "",
        relativeFilePath: "dev-guide.md",
      });

      const rulesyncRule = rule.toRulesyncRule();
      expect(rulesyncRule.getFrontmatter().description).toBe("Development Guidelines");
    });

    it("should generate description from filename when no heading present", async () => {
      const content = "Some content without heading";

      const filePath = join(testDir, "api-standards.md");
      await writeFile(filePath, content, "utf-8");

      const rule = await RooRule.fromFilePath({
        filePath,
        baseDir: testDir,
        relativeDirPath: "",
        relativeFilePath: "api-standards.md",
      });

      const rulesyncRule = rule.toRulesyncRule();
      expect(rulesyncRule.getFrontmatter().description).toBe("Api Standards");
    });

    it("should handle directory-based rules", async () => {
      const content = `# Directory Rule

This is in .roo/rules/`;

      const rooDir = join(testDir, ".roo/rules");
      await mkdir(rooDir, { recursive: true });
      const filePath = join(rooDir, "main-rule.md");
      await writeFile(filePath, content, "utf-8");

      const rule = await RooRule.fromFilePath({
        filePath,
        baseDir: testDir,
        relativeDirPath: ".roo/rules",
        relativeFilePath: ".roo/rules/main-rule.md",
      });

      expect(rule.isDirectoryBased()).toBe(true);
      expect(rule.isModeSpecific()).toBe(false);
      expect(rule.getOutputFilePath()).toBe(".roo/rules/main-rule.md");
    });

    it("should handle mode-specific directory rules", async () => {
      const content = `# Code Mode Rules

These are specific to code mode`;

      const rooDir = join(testDir, ".roo/rules-code");
      await mkdir(rooDir, { recursive: true });
      const filePath = join(rooDir, "react-patterns.md");
      await writeFile(filePath, content, "utf-8");

      const rule = await RooRule.fromFilePath({
        filePath,
        baseDir: testDir,
        relativeDirPath: ".roo/rules-code",
        relativeFilePath: ".roo/rules-code/react-patterns.md",
      });

      expect(rule.getMode()).toBe("code");
      expect(rule.isModeSpecific()).toBe(true);
      expect(rule.isDirectoryBased()).toBe(true);
    });

    it("should handle single-file rules", async () => {
      const content = `# Single File Rules

Basic project rules`;

      const filePath = join(testDir, ".roorules");
      await writeFile(filePath, content, "utf-8");

      const rule = await RooRule.fromFilePath({
        filePath,
        baseDir: testDir,
        relativeDirPath: "",
        relativeFilePath: ".roorules",
      });

      expect(rule.isDirectoryBased()).toBe(false);
      expect(rule.isModeSpecific()).toBe(false);
      expect(rule.getOutputFilePath()).toBe(".roorules");
    });

    it("should handle mode-specific single-file rules", async () => {
      const content = `# Mode-Specific Rules

Rules for ask mode`;

      const filePath = join(testDir, ".roorules-ask");
      await writeFile(filePath, content, "utf-8");

      const rule = await RooRule.fromFilePath({
        filePath,
        baseDir: testDir,
        relativeDirPath: "",
        relativeFilePath: ".roorules-ask",
      });

      expect(rule.getMode()).toBe("ask");
      expect(rule.isModeSpecific()).toBe(true);
      expect(rule.isDirectoryBased()).toBe(false);
    });

    it("should handle legacy .clinerules files", async () => {
      const content = `# Legacy Rules

Old format rules`;

      const filePath = join(testDir, ".clinerules");
      await writeFile(filePath, content, "utf-8");

      const rule = await RooRule.fromFilePath({
        filePath,
        baseDir: testDir,
        relativeDirPath: "",
        relativeFilePath: ".clinerules",
      });

      expect(rule.isLegacyRule()).toBe(true);
      expect(rule.isModeSpecific()).toBe(false);
      expect(rule.getOutputFilePath()).toBe(".clinerules");
    });

    it("should handle legacy mode-specific .clinerules files", async () => {
      const content = `# Legacy Mode Rules

Old format mode rules`;

      const filePath = join(testDir, ".clinerules-architect");
      await writeFile(filePath, content, "utf-8");

      const rule = await RooRule.fromFilePath({
        filePath,
        baseDir: testDir,
        relativeDirPath: "",
        relativeFilePath: ".clinerules-architect",
      });

      expect(rule.getMode()).toBe("architect");
      expect(rule.isModeSpecific()).toBe(true);
      expect(rule.isLegacyRule()).toBe(true);
    });

    it("should handle nested subdirectories", async () => {
      const content = `# Nested Rule

Deep nested rule`;

      const nestedDir = join(testDir, ".roo/rules/frontend/components");
      await mkdir(nestedDir, { recursive: true });
      const filePath = join(nestedDir, "react-component.md");
      await writeFile(filePath, content, "utf-8");

      const rule = await RooRule.fromFilePath({
        filePath,
        baseDir: testDir,
        relativeDirPath: ".roo/rules/frontend/components",
        relativeFilePath: ".roo/rules/frontend/components/react-component.md",
      });

      expect(rule.isDirectoryBased()).toBe(true);
      expect(rule.getOutputFilePath()).toBe(".roo/rules/frontend/components/react-component.md");
    });
  });

  describe("fromRulesyncRule", () => {
    it("should create RooRule from RulesyncRule", () => {
      const frontmatter: RuleFrontmatter = {
        targets: ["roo"],
        root: false,
        description: "Test description",
        globs: ["**/*"],
      };

      const body = "Rule content";
      const fileContent = `---
targets: ["roo"]
root: false
description: "Test description"
globs: ["**/*"]
---
${body}`;

      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".roo/rules",
        relativeFilePath: ".roo/rules/test.md",
        frontmatter,
        body,
        fileContent,
        validate: false,
      });

      const rule = RooRule.fromRulesyncRule({
        rulesyncRule,
        baseDir: testDir,
        relativeDirPath: ".roo/rules",
      });

      expect(rule).toBeInstanceOf(RooRule);
      expect(rule.getOutputContent()).toBe(body);
    });

    it("should extract mode from RulesyncRule path", () => {
      const frontmatter: RuleFrontmatter = {
        targets: ["roo"],
        root: false,
        description: "Test mode rule",
        globs: ["**/*"],
      };

      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".roo/rules-typescript",
        relativeFilePath: ".roo/rules-typescript/patterns.md",
        frontmatter,
        body: "Content",
        fileContent: "Content",
        validate: false,
      });

      const rule = RooRule.fromRulesyncRule({
        rulesyncRule,
        baseDir: testDir,
        relativeDirPath: ".roo/rules-typescript",
      });

      expect(rule.getMode()).toBe("typescript");
      expect(rule.isModeSpecific()).toBe(true);
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert RooRule to RulesyncRule", async () => {
      const content = `# Test Rule

Test content`;

      const filePath = join(testDir, ".roorules");
      await writeFile(filePath, content, "utf-8");

      const rule = await RooRule.fromFilePath({
        filePath,
        baseDir: testDir,
        relativeDirPath: "",
        relativeFilePath: ".roorules",
      });

      const rulesyncRule = rule.toRulesyncRule();

      expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
      expect(rulesyncRule.getFrontmatter().targets).toEqual(["roo"]);
      expect(rulesyncRule.getFrontmatter().description).toBe("Test Rule");
      expect(rulesyncRule.getBody()).toBe(content);
    });
  });

  describe("extractModeFromPath", () => {
    it("should extract mode from directory path", () => {
      expect(RooRule.extractModeFromPath(".roo/rules-code/test.md")).toBe("code");
      expect(RooRule.extractModeFromPath(".roo/rules-architect/patterns.md")).toBe("architect");
      expect(RooRule.extractModeFromPath(".roo/rules-ask/guidelines.md")).toBe("ask");
    });

    it("should extract mode from single-file path", () => {
      expect(RooRule.extractModeFromPath(".roorules-code")).toBe("code");
      expect(RooRule.extractModeFromPath(".roorules-typescript")).toBe("typescript");
      expect(RooRule.extractModeFromPath(".clinerules-architect")).toBe("architect");
    });

    it("should return undefined for non-mode-specific paths", () => {
      expect(RooRule.extractModeFromPath(".roo/rules/test.md")).toBeUndefined();
      expect(RooRule.extractModeFromPath(".roorules")).toBeUndefined();
      expect(RooRule.extractModeFromPath(".clinerules")).toBeUndefined();
      expect(RooRule.extractModeFromPath("some-file.md")).toBeUndefined();
    });

    it("should handle complex mode slugs", () => {
      expect(RooRule.extractModeFromPath(".roo/rules-docs-writer/guide.md")).toBe("docs-writer");
      expect(RooRule.extractModeFromPath(".roorules-frontend-dev")).toBe("frontend-dev");
    });
  });

  describe("validation", () => {
    it("should validate successfully with valid data", async () => {
      const content = `# Valid Rule

Valid content`;

      const filePath = join(testDir, "valid.md");
      await writeFile(filePath, content, "utf-8");

      const rule = await RooRule.fromFilePath({
        filePath,
        baseDir: testDir,
        relativeDirPath: "",
        relativeFilePath: "valid.md",
      });

      const result = rule.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should validate mode slug pattern", async () => {
      const content = `# Mode Rule

Content`;

      const filePath = join(testDir, ".roorules-valid-mode");
      await writeFile(filePath, content, "utf-8");

      const rule = await RooRule.fromFilePath({
        filePath,
        baseDir: testDir,
        relativeDirPath: "",
        relativeFilePath: ".roorules-valid-mode",
      });

      const result = rule.validate();
      expect(result.success).toBe(true);
    });

    it("should reject invalid mode slug", async () => {
      // Create rule with invalid mode by manually setting it
      const frontmatter: RooRuleFrontmatter = {
        description: "Test",
      };

      const rule = new RooRule({
        baseDir: testDir,
        relativeDirPath: "",
        relativeFilePath: "test.md",
        fileContent: "content",
        frontmatter,
        body: "content",
        mode: "invalid mode!",
        validate: false, // Skip validation during construction
      });

      const result = rule.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("Invalid mode slug");
    });
  });

  describe("helper methods", () => {
    it("should identify directory-based rules", async () => {
      const content = "content";
      
      // Directory-based
      const filePath1 = join(testDir, ".roo/rules/test.md");
      await mkdir(join(testDir, ".roo/rules"), { recursive: true });
      await writeFile(filePath1, content, "utf-8");
      
      const rule1 = await RooRule.fromFilePath({
        filePath: filePath1,
        baseDir: testDir,
        relativeDirPath: ".roo/rules",
        relativeFilePath: ".roo/rules/test.md",
      });
      
      expect(rule1.isDirectoryBased()).toBe(true);

      // Single-file
      const filePath2 = join(testDir, ".roorules");
      await writeFile(filePath2, content, "utf-8");
      
      const rule2 = await RooRule.fromFilePath({
        filePath: filePath2,
        baseDir: testDir,
        relativeDirPath: "",
        relativeFilePath: ".roorules",
      });
      
      expect(rule2.isDirectoryBased()).toBe(false);
    });

    it("should identify mode-specific rules", async () => {
      const content = "content";
      
      // Mode-specific
      await mkdir(join(testDir, ".roo/rules-code"), { recursive: true });
      const filePath1 = join(testDir, ".roo/rules-code/test.md");
      await writeFile(filePath1, content, "utf-8");
      
      const rule1 = await RooRule.fromFilePath({
        filePath: filePath1,
        baseDir: testDir,
        relativeDirPath: ".roo/rules-code",
        relativeFilePath: ".roo/rules-code/test.md",
      });
      
      expect(rule1.isModeSpecific()).toBe(true);

      // General
      await mkdir(join(testDir, ".roo/rules"), { recursive: true });
      const filePath2 = join(testDir, ".roo/rules/test.md");
      await writeFile(filePath2, content, "utf-8");
      
      const rule2 = await RooRule.fromFilePath({
        filePath: filePath2,
        baseDir: testDir,
        relativeDirPath: ".roo/rules",
        relativeFilePath: ".roo/rules/test.md",
      });
      
      expect(rule2.isModeSpecific()).toBe(false);
    });

    it("should identify legacy rules", async () => {
      const content = "content";
      
      // Legacy
      const filePath1 = join(testDir, ".clinerules");
      await writeFile(filePath1, content, "utf-8");
      
      const rule1 = await RooRule.fromFilePath({
        filePath: filePath1,
        baseDir: testDir,
        relativeDirPath: "",
        relativeFilePath: ".clinerules",
      });
      
      expect(rule1.isLegacyRule()).toBe(true);

      // Modern
      const filePath2 = join(testDir, ".roorules");
      await writeFile(filePath2, content, "utf-8");
      
      const rule2 = await RooRule.fromFilePath({
        filePath: filePath2,
        baseDir: testDir,
        relativeDirPath: "",
        relativeFilePath: ".roorules",
      });
      
      expect(rule2.isLegacyRule()).toBe(false);
    });

    it("should provide informative rule type description", async () => {
      const content = "content";

      // Directory-based mode-specific
      await mkdir(join(testDir, ".roo/rules-code"), { recursive: true });
      const filePath1 = join(testDir, ".roo/rules-code/test.md");
      await writeFile(filePath1, content, "utf-8");
      
      const rule1 = await RooRule.fromFilePath({
        filePath: filePath1,
        baseDir: testDir,
        relativeDirPath: ".roo/rules-code",
        relativeFilePath: ".roo/rules-code/test.md",
      });
      
      expect(rule1.getRuleType()).toBe("directory mode:code");

      // Single-file legacy
      const filePath2 = join(testDir, ".clinerules-ask");
      await writeFile(filePath2, content, "utf-8");
      
      const rule2 = await RooRule.fromFilePath({
        filePath: filePath2,
        baseDir: testDir,
        relativeDirPath: "",
        relativeFilePath: ".clinerules-ask",
      });
      
      expect(rule2.getRuleType()).toBe("single-file mode:ask legacy");
    });
  });

  describe("edge cases", () => {
    it("should handle empty content", async () => {
      const filePath = join(testDir, "empty.md");
      await writeFile(filePath, "", "utf-8");

      const rule = await RooRule.fromFilePath({
        filePath,
        baseDir: testDir,
        relativeDirPath: "",
        relativeFilePath: "empty.md",
      });

      expect(rule.getOutputContent()).toBe("");
      const rulesyncRule = rule.toRulesyncRule();
      expect(rulesyncRule.getFrontmatter().description).toBe("Empty");
    });

    it("should handle files with only whitespace", async () => {
      const content = "   \n\n   \t  \n   ";
      const filePath = join(testDir, "whitespace.md");
      await writeFile(filePath, content, "utf-8");

      const rule = await RooRule.fromFilePath({
        filePath,
        baseDir: testDir,
        relativeDirPath: "",
        relativeFilePath: "whitespace.md",
      });

      expect(rule.getOutputContent()).toBe("");
    });

    it("should handle files with special characters in names", async () => {
      const content = "Content";
      const filePath = join(testDir, "special-chars_123.md");
      await writeFile(filePath, content, "utf-8");

      const rule = await RooRule.fromFilePath({
        filePath,
        baseDir: testDir,
        relativeDirPath: "",
        relativeFilePath: "special-chars_123.md",
      });

      const rulesyncRule = rule.toRulesyncRule();
      expect(rulesyncRule.getFrontmatter().description).toBe("Special Chars 123");
    });
  });
});