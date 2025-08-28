import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import { RulesyncRule } from "./rulesync-rule.js";
import { WindsurfRule, type WindsurfRuleFrontmatter } from "./windsurf-rule.js";

describe("WindsurfRule", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("constructor", () => {
    it("should create WindsurfRule instance with valid frontmatter", () => {
      const frontmatter: WindsurfRuleFrontmatter = {
        description: "Test rule description",
        activationMode: "always",
      };

      const windsurfRule = new WindsurfRule({
        baseDir: testDir,
        relativeDirPath: ".windsurf/rules",
        relativeFilePath: "test-rule.md",
        fileContent: "---\ndescription: Test rule\n---\n\nTest content",
        frontmatter,
        body: "Test content",
      });

      expect(windsurfRule.getActivationMode()).toBe("always");
      expect(windsurfRule.getBody()).toBe("Test content");
    });

    it("should create WindsurfRule with glob activation mode", () => {
      const frontmatter: WindsurfRuleFrontmatter = {
        description: "TypeScript rule",
        activationMode: "glob",
        globPattern: "**/*.ts",
      };

      const windsurfRule = new WindsurfRule({
        baseDir: testDir,
        relativeDirPath: ".windsurf/rules",
        relativeFilePath: "typescript-rule.md",
        fileContent: "---\ndescription: TypeScript rule\n---\n\nTS content",
        frontmatter,
        body: "TS content",
      });

      expect(windsurfRule.getActivationMode()).toBe("glob");
      expect(windsurfRule.getGlobPattern()).toBe("**/*.ts");
    });
  });

  describe("fromFilePath", () => {
    it("should create WindsurfRule from file with frontmatter", async () => {
      const ruleContent = `---
description: "Test rule from file"
activationMode: "manual"
---

# Test Rule

This is a test rule content.`;

      const filePath = join(testDir, "test-rule.md");
      await writeFile(filePath, ruleContent, "utf-8");

      const windsurfRule = await WindsurfRule.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "test-rule.md",
        filePath,
      });

      expect(windsurfRule.getActivationMode()).toBe("manual");
      expect(windsurfRule.getBody()).toBe("\n# Test Rule\n\nThis is a test rule content.");
    });

    it("should create WindsurfRule from file without frontmatter", async () => {
      const ruleContent = `# Simple Rule

This rule has no frontmatter.`;

      const filePath = join(testDir, "simple-rule.md");
      await writeFile(filePath, ruleContent, "utf-8");

      const windsurfRule = await WindsurfRule.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "simple-rule.md",
        filePath,
      });

      expect(windsurfRule.getActivationMode()).toBe("always");
      expect(windsurfRule.getBody()).toBe(ruleContent);
    });
  });

  describe("fromRulesyncRule", () => {
    it("should create WindsurfRule from RulesyncRule", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "test-rule.md",
        fileContent: "---\ndescription: Test\n---\n\nContent",
        frontmatter: {
          root: false,
          targets: ["windsurf"],
          description: "Test rule from rulesync",
          globs: ["**/*.ts", "**/*.tsx"],
        },
        body: "# Test Content\n\nThis is test content.",
      });

      const windsurfRule = WindsurfRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule,
        relativeDirPath: ".windsurf/rules",
      });

      expect(windsurfRule).toBeInstanceOf(WindsurfRule);
      expect((windsurfRule as WindsurfRule).getActivationMode()).toBe("glob");
      expect((windsurfRule as WindsurfRule).getGlobPattern()).toBe("**/*.ts|**/*.tsx");
    });

    it("should map rulesync without globs to always mode", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "general-rule.md",
        fileContent: "---\ndescription: General rule\n---\n\nContent",
        frontmatter: {
          root: false,
          targets: ["windsurf"],
          description: "General rule",
          globs: [],
        },
        body: "# General Rule\n\nThis applies to all files.",
      });

      const windsurfRule = WindsurfRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule,
        relativeDirPath: ".windsurf/rules",
      });

      expect((windsurfRule as WindsurfRule).getActivationMode()).toBe("always");
    });

    it("should map rulesync without description to manual mode", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "manual-rule.md",
        fileContent: '---\ndescription: ""\n---\n\nContent',
        frontmatter: {
          root: false,
          targets: ["windsurf"],
          description: "",
          globs: [],
        },
        body: "# Manual Rule\n\nThis is manually activated.",
      });

      const windsurfRule = WindsurfRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule,
        relativeDirPath: ".windsurf/rules",
      });

      expect((windsurfRule as WindsurfRule).getActivationMode()).toBe("manual");
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert WindsurfRule to RulesyncRule", () => {
      const frontmatter: WindsurfRuleFrontmatter = {
        description: "Test rule for conversion",
        activationMode: "glob",
        globPattern: "**/*.js",
      };

      const windsurfRule = new WindsurfRule({
        baseDir: testDir,
        relativeDirPath: ".windsurf/rules",
        relativeFilePath: "test-conversion.md",
        fileContent: "---\ndescription: Test\n---\n\nContent",
        frontmatter,
        body: "# Converted Rule\n\nThis rule was converted.",
      });

      const rulesyncRule = windsurfRule.toRulesyncRule();

      expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
      expect(rulesyncRule.getFrontmatter().targets).toEqual(["windsurf"]);
      expect(rulesyncRule.getFrontmatter().description).toBe("Test rule for conversion");
      expect(rulesyncRule.getFrontmatter().globs).toEqual(["**/*.js"]);
      expect(rulesyncRule.getBody()).toBe("# Converted Rule\n\nThis rule was converted.");
    });
  });

  describe("shouldActivate", () => {
    it("should activate always rules", () => {
      const windsurfRule = new WindsurfRule({
        baseDir: testDir,
        relativeDirPath: ".windsurf/rules",
        relativeFilePath: "always-rule.md",
        fileContent: "test",
        frontmatter: {
          description: "Always active",
          activationMode: "always",
        },
        body: "Always active content",
      });

      expect(windsurfRule.shouldActivate()).toBe(true);
      expect(windsurfRule.shouldActivate({ filePattern: "test.ts" })).toBe(true);
    });

    it("should not activate manual rules", () => {
      const windsurfRule = new WindsurfRule({
        baseDir: testDir,
        relativeDirPath: ".windsurf/rules",
        relativeFilePath: "manual-rule.md",
        fileContent: "test",
        frontmatter: {
          description: "Manual rule",
          activationMode: "manual",
        },
        body: "Manual content",
      });

      expect(windsurfRule.shouldActivate()).toBe(false);
      expect(windsurfRule.shouldActivate({ filePattern: "test.ts" })).toBe(false);
    });

    it("should activate model-decision rules", () => {
      const windsurfRule = new WindsurfRule({
        baseDir: testDir,
        relativeDirPath: ".windsurf/rules",
        relativeFilePath: "model-rule.md",
        fileContent: "test",
        frontmatter: {
          description: "Model decision rule",
          activationMode: "model-decision",
        },
        body: "Model decision content",
      });

      expect(windsurfRule.shouldActivate()).toBe(true);
    });

    it("should activate glob rules when pattern matches", () => {
      const windsurfRule = new WindsurfRule({
        baseDir: testDir,
        relativeDirPath: ".windsurf/rules",
        relativeFilePath: "glob-rule.md",
        fileContent: "test",
        frontmatter: {
          description: "TypeScript rule",
          activationMode: "glob",
          globPattern: ".ts",
        },
        body: "TypeScript content",
      });

      expect(windsurfRule.shouldActivate({ filePattern: "test.ts" })).toBe(true);
      expect(windsurfRule.shouldActivate({ filePattern: "test.js" })).toBe(false);
      expect(windsurfRule.shouldActivate()).toBe(false);
    });

    it("should not activate glob rules when pattern doesn't match", () => {
      const windsurfRule = new WindsurfRule({
        baseDir: testDir,
        relativeDirPath: ".windsurf/rules",
        relativeFilePath: "glob-rule.md",
        fileContent: "test",
        frontmatter: {
          description: "Python rule",
          activationMode: "glob",
          globPattern: ".py",
        },
        body: "Python content",
      });

      expect(windsurfRule.shouldActivate({ filePattern: "test.ts" })).toBe(false);
      expect(windsurfRule.shouldActivate({ filePattern: "test.py" })).toBe(true);
    });
  });

  describe("validate", () => {
    it("should validate correct frontmatter", () => {
      const windsurfRule = new WindsurfRule({
        baseDir: testDir,
        relativeDirPath: ".windsurf/rules",
        relativeFilePath: "valid-rule.md",
        fileContent: "test",
        frontmatter: {
          description: "Valid rule",
          activationMode: "always",
        },
        body: "Valid content",
      });

      const result = windsurfRule.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });
  });

  describe("utility methods", () => {
    it("should return activation mode", () => {
      const windsurfRule = new WindsurfRule({
        baseDir: testDir,
        relativeDirPath: ".windsurf/rules",
        relativeFilePath: "test-rule.md",
        fileContent: "test",
        frontmatter: {
          description: "Test",
          activationMode: "model-decision",
        },
        body: "Content",
      });

      expect(windsurfRule.getActivationMode()).toBe("model-decision");
    });

    it("should default to always activation mode", () => {
      const windsurfRule = new WindsurfRule({
        baseDir: testDir,
        relativeDirPath: ".windsurf/rules",
        relativeFilePath: "test-rule.md",
        fileContent: "test",
        frontmatter: {
          description: "Test",
        },
        body: "Content",
      });

      expect(windsurfRule.getActivationMode()).toBe("always");
    });

    it("should return glob pattern when present", () => {
      const windsurfRule = new WindsurfRule({
        baseDir: testDir,
        relativeDirPath: ".windsurf/rules",
        relativeFilePath: "test-rule.md",
        fileContent: "test",
        frontmatter: {
          description: "Test",
          globPattern: "**/*.test.ts",
        },
        body: "Content",
      });

      expect(windsurfRule.getGlobPattern()).toBe("**/*.test.ts");
    });

    it("should return undefined for glob pattern when not present", () => {
      const windsurfRule = new WindsurfRule({
        baseDir: testDir,
        relativeDirPath: ".windsurf/rules",
        relativeFilePath: "test-rule.md",
        fileContent: "test",
        frontmatter: {
          description: "Test",
        },
        body: "Content",
      });

      expect(windsurfRule.getGlobPattern()).toBeUndefined();
    });
  });
});
