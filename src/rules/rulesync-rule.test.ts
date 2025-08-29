import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import type { RuleFrontmatter } from "../types/rules.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("RulesyncRule", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("constructor", () => {
    it("should create instance with valid frontmatter", () => {
      const frontmatter: RuleFrontmatter = {
        root: true,
        targets: ["*"],
        description: "Test rule",
        globs: ["**/*.ts"],
      };

      const rule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "test-rule.md",
        frontmatter,
        body: "Test content",
        fileContent: "---\nroot: true\n---\nTest content",
      });

      expect(rule.getFrontmatter()).toEqual(frontmatter);
      expect(rule.getBody()).toBe("Test content");
    });

    it("should create instance with wildcard targets", () => {
      const frontmatter: RuleFrontmatter = {
        root: false,
        targets: ["*"],
        description: "Wildcard rule",
        globs: [],
      };

      const rule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "wildcard.md",
        frontmatter,
        body: "Content",
        fileContent: "Content",
      });

      expect(rule.getFrontmatter().targets).toEqual(["*"]);
    });

    it("should create instance with multiple specific targets", () => {
      const frontmatter: RuleFrontmatter = {
        root: false,
        targets: ["cursor", "claudecode"],
        description: "Multi-target rule",
        globs: [],
      };

      const rule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "multi.md",
        frontmatter,
        body: "Content",
        fileContent: "Content",
      });

      expect(rule.getFrontmatter().targets).toEqual(["cursor", "claudecode"]);
    });

    it("should create instance with optional fields", () => {
      const frontmatter: RuleFrontmatter = {
        root: true,
        targets: ["*"],
        description: "Complex rule",
        globs: ["**/*.tsx"],
        cursorRuleType: "always",
        windsurfActivationMode: "model-decision",
        windsurfOutputFormat: "single-file",
        tags: ["frontend", "react"],
      };

      const rule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "complex.md",
        frontmatter,
        body: "Complex content",
        fileContent: "Complex content",
      });

      expect(rule.getFrontmatter().cursorRuleType).toBe("always");
      expect(rule.getFrontmatter().tags).toEqual(["frontend", "react"]);
    });

    it("should validate frontmatter by default", () => {
      const invalidFrontmatter = {
        root: "invalid", // Should be boolean
        targets: "invalid", // Should be array
        description: 123, // Should be string
      } as unknown as RuleFrontmatter;

      expect(() => {
        const _rule = new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: ".rulesync/rules",
          relativeFilePath: "invalid.md",
          frontmatter: invalidFrontmatter,
          body: "Content",
          fileContent: "Content",
        });
      }).toThrow();
    });

    it("should skip validation when validate is false", () => {
      const invalidFrontmatter = {
        root: "invalid",
        targets: "invalid",
        description: 123,
      } as unknown as RuleFrontmatter;

      expect(() => {
        const _rule = new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: ".rulesync/rules",
          relativeFilePath: "invalid.md",
          frontmatter: invalidFrontmatter,
          body: "Content",
          fileContent: "Content",
          validate: false,
        });
      }).not.toThrow();
    });
  });

  describe("getFrontmatter", () => {
    it("should return the frontmatter", () => {
      const frontmatter: RuleFrontmatter = {
        root: false,
        targets: ["cursor"],
        description: "Test frontmatter",
        globs: [],
      };

      const rule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "test.md",
        frontmatter,
        body: "Content",
        fileContent: "Content",
      });

      expect(rule.getFrontmatter()).toBe(frontmatter);
    });
  });

  describe("validate", () => {
    it("should return success for valid frontmatter", () => {
      const frontmatter: RuleFrontmatter = {
        root: true,
        targets: ["*"],
        description: "Valid rule",
        globs: ["**/*.ts"],
      };

      const rule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "valid.md",
        frontmatter,
        body: "Content",
        fileContent: "Content",
      });

      const result = rule.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return error for invalid frontmatter", () => {
      const invalidFrontmatter = {
        root: "invalid",
        targets: "invalid",
        description: 123,
      } as unknown as RuleFrontmatter;

      const rule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "invalid.md",
        frontmatter: invalidFrontmatter,
        body: "Content",
        fileContent: "Content",
        validate: false, // Skip validation during construction
      });

      const result = rule.validate();
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should handle undefined frontmatter", () => {
      // Create rule with undefined frontmatter (edge case)
      const rule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "test.md",
        frontmatter: undefined as unknown as RuleFrontmatter,
        body: "Content",
        fileContent: "Content",
        validate: false,
      });

      const result = rule.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });

  describe("fromFilePath", () => {
    it("should parse markdown file with frontmatter", async () => {
      const filePath = join(testDir, "test-rule.md");
      const fileContent = `---
root: true
targets: 
  - "*"
description: "Test rule from file"
globs:
  - "**/*.ts"
  - "**/*.tsx"
---

# Test Rule

This is a test rule content.
`;

      await writeFile(filePath, fileContent, "utf-8");

      const rule = await RulesyncRule.fromFilePath({ filePath });

      expect(rule.getFrontmatter().root).toBe(true);
      expect(rule.getFrontmatter().targets).toEqual(["*"]);
      expect(rule.getFrontmatter().description).toBe("Test rule from file");
      expect(rule.getFrontmatter().globs).toEqual(["**/*.ts", "**/*.tsx"]);
      expect(rule.getBody()).toBe("# Test Rule\n\nThis is a test rule content.");
    });

    it("should handle files with complex frontmatter", async () => {
      const filePath = join(testDir, "complex-rule.md");
      const fileContent = `---
root: false
targets: 
  - cursor
  - claudecode
description: "Complex rule with all fields"
globs:
  - "src/**/*.tsx"
cursorRuleType: "always"
windsurfActivationMode: "glob"
windsurfOutputFormat: "directory"
tags:
  - frontend
  - react
  - typescript
---

# Complex Rule

This rule has all optional fields defined.

## Features
- TypeScript support
- React components
- Frontend guidelines
`;

      await writeFile(filePath, fileContent, "utf-8");

      const rule = await RulesyncRule.fromFilePath({ filePath });

      expect(rule.getFrontmatter().root).toBe(false);
      expect(rule.getFrontmatter().targets).toEqual(["cursor", "claudecode"]);
      expect(rule.getFrontmatter().cursorRuleType).toBe("always");
      expect(rule.getFrontmatter().windsurfActivationMode).toBe("glob");
      expect(rule.getFrontmatter().tags).toEqual(["frontend", "react", "typescript"]);
    });

    it("should throw error for invalid frontmatter in file", async () => {
      const filePath = join(testDir, "invalid-rule.md");
      const fileContent = `---
root: "invalid_boolean"
targets: "invalid_array"
description: 123
---

Content
`;

      await writeFile(filePath, fileContent, "utf-8");

      await expect(RulesyncRule.fromFilePath({ filePath })).rejects.toThrow(
        "Invalid frontmatter in",
      );
    });

    it("should trim content body", async () => {
      const filePath = join(testDir, "whitespace-rule.md");
      const fileContent = `---
root: false
targets: ["*"]
description: "Whitespace test"
globs: []
---

   # Rule with whitespace   

   Content with leading/trailing whitespace   

`;

      await writeFile(filePath, fileContent, "utf-8");

      const rule = await RulesyncRule.fromFilePath({ filePath });

      expect(rule.getBody()).toBe(
        "# Rule with whitespace   \n\n   Content with leading/trailing whitespace",
      );
    });

    it("should preserve original file content", async () => {
      const filePath = join(testDir, "original-content.md");
      const originalContent = `---
root: true
targets: ["cursor"]
description: "Original content test"
globs: []
---

Original content
`;

      await writeFile(filePath, originalContent, "utf-8");

      const rule = await RulesyncRule.fromFilePath({ filePath });

      // The implementation uses matter.stringify which normalizes YAML formatting
      // Arrays in inline format ["cursor"] get converted to YAML list format
      const expectedNormalizedContent = `---
root: true
targets:
  - cursor
description: Original content test
globs: []
---
Original content
`;

      expect(rule.getFileContent()).toBe(expectedNormalizedContent);
    });

    it("should handle minimal valid frontmatter", async () => {
      const filePath = join(testDir, "minimal-rule.md");
      const fileContent = `---
root: false
targets: ["*"]
description: "Minimal rule"
globs: []
---

Minimal content
`;

      await writeFile(filePath, fileContent, "utf-8");

      const rule = await RulesyncRule.fromFilePath({ filePath });

      expect(rule.getFrontmatter().root).toBe(false);
      expect(rule.getFrontmatter().targets).toEqual(["*"]);
      expect(rule.getFrontmatter().description).toBe("Minimal rule");
      expect(rule.getFrontmatter().globs).toEqual([]);
      expect(rule.getFrontmatter().cursorRuleType).toBeUndefined();
      expect(rule.getFrontmatter().tags).toBeUndefined();
    });
  });
});
