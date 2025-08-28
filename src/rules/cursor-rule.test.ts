import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import matter from "gray-matter";
import { describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import { CursorRule, type CursorRuleFrontmatter } from "./cursor-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("CursorRule", () => {
  describe("constructor", () => {
    it("should create CursorRule with valid frontmatter", () => {
      const frontmatter: CursorRuleFrontmatter = {
        description: "Test rule",
        globs: "**/*.ts",
        alwaysApply: false,
      };

      const rule = new CursorRule({
        baseDir: ".",
        relativeDirPath: ".cursor/rules",
        relativeFilePath: "test-rule.mdc",
        frontmatter,
        body: "Test rule content",
        fileContent: "test content",
      });

      expect(rule.getFrontmatter()).toEqual(frontmatter);
      expect(rule.getBody()).toBe("Test rule content");
    });

    it("should throw error with invalid frontmatter", () => {
      const invalidFrontmatter = {
        // missing required description field
        globs: "**/*.ts",
        alwaysApply: false,
      };

      expect(() => {
         
        new CursorRule({
          baseDir: ".",
          relativeDirPath: ".cursor/rules",
          relativeFilePath: "test-rule.mdc",
          frontmatter: invalidFrontmatter as any,
          body: "Test rule content",
          fileContent: "test content",
        });
      }).toThrow();
    });

    it("should skip validation when validate=false", () => {
      const invalidFrontmatter = {
        // missing required description field
        globs: "**/*.ts",
        alwaysApply: false,
      };

      expect(() => {
         
        new CursorRule({
          baseDir: ".",
          relativeDirPath: ".cursor/rules",
          relativeFilePath: "test-rule.mdc",
          frontmatter: invalidFrontmatter as any,
          body: "Test rule content",
          fileContent: "test content",
          validate: false,
        });
      }).not.toThrow();
    });
  });

  describe("fromFilePath", () => {
    it("should read and parse .mdc file correctly", async () => {
      const { testDir, cleanup } = await setupTestDirectory();

      try {
        const filePath = join(testDir, "test-rule.mdc");
        const frontmatter: CursorRuleFrontmatter = {
          description: "API development rule",
          globs: "**/*.ts,**/*.js",
          alwaysApply: false,
        };
        const body = "Use TypeScript for all new development";
        const fileContent = matter.stringify(body, frontmatter);

        await writeFile(filePath, fileContent, "utf-8");

        const rule = await CursorRule.fromFilePath({
          baseDir: testDir,
          relativeDirPath: ".cursor/rules",
          relativeFilePath: "test-rule.mdc",
          filePath,
        });

        expect(rule.getFrontmatter()).toEqual(frontmatter);
        expect(rule.getBody()).toBe(body);
      } finally {
        await cleanup();
      }
    });

    it("should handle minimal frontmatter", async () => {
      const { testDir, cleanup } = await setupTestDirectory();

      try {
        const filePath = join(testDir, "minimal-rule.mdc");
        const frontmatter = {
          description: "Minimal rule",
        };
        const body = "This is a minimal rule";
        const fileContent = matter.stringify(body, frontmatter);

        await writeFile(filePath, fileContent, "utf-8");

        const rule = await CursorRule.fromFilePath({
          baseDir: testDir,
          relativeDirPath: ".cursor/rules",
          relativeFilePath: "minimal-rule.mdc",
          filePath,
        });

        expect(rule.getFrontmatter()).toEqual({
          description: "Minimal rule",
        });
        expect(rule.getBody()).toBe(body);
      } finally {
        await cleanup();
      }
    });

    it("should throw error for invalid frontmatter", async () => {
      const { testDir, cleanup } = await setupTestDirectory();

      try {
        const filePath = join(testDir, "invalid-rule.mdc");
        const invalidFrontmatter = {
          // missing required description
          globs: "**/*.ts",
        };
        const body = "Invalid rule content";
        const fileContent = matter.stringify(body, invalidFrontmatter);

        await writeFile(filePath, fileContent, "utf-8");

        await expect(
          CursorRule.fromFilePath({
            baseDir: testDir,
            relativeDirPath: ".cursor/rules",
            relativeFilePath: "invalid-rule.mdc",
            filePath,
          }),
        ).rejects.toThrow("Invalid frontmatter");
      } finally {
        await cleanup();
      }
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert always-apply rule correctly", () => {
      const frontmatter: CursorRuleFrontmatter = {
        description: "Always apply rule",
        alwaysApply: true,
      };

      const rule = new CursorRule({
        baseDir: ".",
        relativeDirPath: ".cursor/rules",
        relativeFilePath: "always-rule.mdc",
        frontmatter,
        body: "This rule always applies",
        fileContent: "test content",
      });

      const rulesyncRule = rule.toRulesyncRule();
      const rulesyncFrontmatter = rulesyncRule.getFrontmatter();

      expect(rulesyncFrontmatter.targets).toEqual(["cursor"]);
      expect(rulesyncFrontmatter.description).toBe("Always apply rule");
      expect(rulesyncFrontmatter.globs).toEqual(["**/*"]);
      expect(rulesyncFrontmatter.root).toBe(false);
    });

    it("should convert rule with globs correctly", () => {
      const frontmatter: CursorRuleFrontmatter = {
        description: "TypeScript rule",
        globs: "**/*.ts,**/*.tsx",
        alwaysApply: false,
      };

      const rule = new CursorRule({
        baseDir: ".",
        relativeDirPath: ".cursor/rules",
        relativeFilePath: "ts-rule.mdc",
        frontmatter,
        body: "TypeScript specific rules",
        fileContent: "test content",
      });

      const rulesyncRule = rule.toRulesyncRule();
      const rulesyncFrontmatter = rulesyncRule.getFrontmatter();

      expect(rulesyncFrontmatter.targets).toEqual(["cursor"]);
      expect(rulesyncFrontmatter.description).toBe("TypeScript rule");
      expect(rulesyncFrontmatter.globs).toEqual(["**/*.ts", "**/*.tsx"]);
      expect(rulesyncFrontmatter.root).toBe(false);
    });

    it("should handle empty globs", () => {
      const frontmatter: CursorRuleFrontmatter = {
        description: "Manual rule",
      };

      const rule = new CursorRule({
        baseDir: ".",
        relativeDirPath: ".cursor/rules",
        relativeFilePath: "manual-rule.mdc",
        frontmatter,
        body: "This is a manual rule",
        fileContent: "test content",
      });

      const rulesyncRule = rule.toRulesyncRule();
      const rulesyncFrontmatter = rulesyncRule.getFrontmatter();

      expect(rulesyncFrontmatter.globs).toEqual([]);
    });
  });

  describe("fromRulesyncRule", () => {
    it("should convert from RulesyncRule with globs", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: ".",
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "test-rule.md",
        frontmatter: {
          targets: ["cursor"],
          root: false,
          description: "Test rule from rulesync",
          globs: ["**/*.ts", "**/*.js"],
        },
        body: "Converted rule content",
        fileContent: "test content",
        validate: false,
      });

      const cursorRule = CursorRule.fromRulesyncRule({
        baseDir: ".",
        rulesyncRule,
        relativeDirPath: ".cursor/rules",
      });

      const frontmatter = cursorRule.getFrontmatter();
      expect(frontmatter.description).toBe("Test rule from rulesync");
      expect(frontmatter.globs).toBe("**/*.ts,**/*.js");
      expect(frontmatter.alwaysApply).toBe(undefined); // Should not be set for non-always rules
      expect(cursorRule.getRelativeFilePath()).toBe("test-rule.mdc");
    });

    it("should convert from RulesyncRule with always glob", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: ".",
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "always-rule.md",
        frontmatter: {
          targets: ["cursor"],
          root: false,
          description: "Always rule from rulesync",
          globs: ["**/*"],
        },
        body: "Always apply this rule",
        fileContent: "test content",
        validate: false,
      });

      const cursorRule = CursorRule.fromRulesyncRule({
        baseDir: ".",
        rulesyncRule,
        relativeDirPath: ".cursor/rules",
      });

      const frontmatter = cursorRule.getFrontmatter();
      expect(frontmatter.description).toBe("Always rule from rulesync");
      expect(frontmatter.globs).toBe("**/*");
      expect(frontmatter.alwaysApply).toBe(true);
      expect(cursorRule.getRelativeFilePath()).toBe("always-rule.mdc");
    });

    it("should convert from RulesyncRule with empty globs", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: ".",
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "manual-rule.md",
        frontmatter: {
          targets: ["cursor"],
          root: false,
          description: "Manual rule from rulesync",
          globs: [],
        },
        body: "Manual rule content",
        fileContent: "test content",
        validate: false,
      });

      const cursorRule = CursorRule.fromRulesyncRule({
        baseDir: ".",
        rulesyncRule,
        relativeDirPath: ".cursor/rules",
      });

      const frontmatter = cursorRule.getFrontmatter();
      expect(frontmatter.description).toBe("Manual rule from rulesync");
      expect(frontmatter.globs).toBe(undefined); // Empty globs should be undefined
      expect(frontmatter.alwaysApply).toBe(undefined);
    });
  });

  describe("validate", () => {
    it("should validate correct frontmatter", () => {
      const frontmatter: CursorRuleFrontmatter = {
        description: "Valid rule",
        globs: "**/*.ts",
        alwaysApply: false,
      };

      const rule = new CursorRule({
        baseDir: ".",
        relativeDirPath: ".cursor/rules",
        relativeFilePath: "valid-rule.mdc",
        frontmatter,
        body: "Valid rule content",
        fileContent: "test content",
        validate: false, // Skip validation in constructor
      });

      const result = rule.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });

    it("should fail validation for invalid frontmatter", () => {
      const invalidFrontmatter = {
        // missing description
        globs: "**/*.ts",
        alwaysApply: false,
      };

      const rule = new CursorRule({
        baseDir: ".",
        relativeDirPath: ".cursor/rules",
        relativeFilePath: "invalid-rule.mdc",
        frontmatter: invalidFrontmatter as any,
        body: "Invalid rule content",
        fileContent: "test content",
        validate: false, // Skip validation in constructor
      });

      const result = rule.validate();
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });
  });
});
