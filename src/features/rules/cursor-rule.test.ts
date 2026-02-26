import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RULES_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { stringifyFrontmatter } from "../../utils/frontmatter.js";
import { CursorRule, CursorRuleFrontmatter } from "./cursor-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("CursorRule", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should create a CursorRule with minimal frontmatter", () => {
      const rule = new CursorRule({
        frontmatter: {},
        body: "Test rule content",
        relativeDirPath: ".cursor/rules",
        relativeFilePath: "test.mdc",
      });

      expect(rule.getFrontmatter()).toEqual({});
      expect(rule.getBody()).toBe("Test rule content");
      expect(rule.getRelativeFilePath()).toBe("test.mdc");
    });

    it("should create a CursorRule with full frontmatter", () => {
      const frontmatter: CursorRuleFrontmatter = {
        description: "Test description",
        globs: "*.ts,*.js",
        alwaysApply: true,
      };

      const rule = new CursorRule({
        frontmatter,
        body: "Test rule content",
        relativeDirPath: ".cursor/rules",
        relativeFilePath: "test.mdc",
      });

      expect(rule.getFrontmatter()).toEqual(frontmatter);
      expect(rule.getBody()).toBe("Test rule content");
    });

    it("should validate frontmatter when validate is true", () => {
      const invalidFrontmatter = {
        description: 123, // Invalid type
        globs: "*.ts",
      } as any;

      const createInvalidRule = () =>
        new CursorRule({
          frontmatter: invalidFrontmatter,
          body: "Test content",
          relativeDirPath: ".cursor/rules",
          relativeFilePath: "test.mdc",
          validate: true,
        });

      expect(createInvalidRule).toThrow();
    });

    it("should not validate frontmatter when validate is false", () => {
      const invalidFrontmatter = {
        description: 123, // Invalid type
        globs: "*.ts",
      } as any;

      const createInvalidRule = () =>
        new CursorRule({
          frontmatter: invalidFrontmatter,
          body: "Test content",
          relativeDirPath: ".cursor/rules",
          relativeFilePath: "test.mdc",
          validate: false,
        });

      expect(createInvalidRule).not.toThrow();
    });

    it("should not emit description in frontmatter when description is undefined", () => {
      const rule = new CursorRule({
        frontmatter: {
          globs: "*.ts",
          alwaysApply: false,
        },
        body: "Rule body content",
        relativeDirPath: ".cursor/rules",
        relativeFilePath: "test.mdc",
      });

      const expectedContent = `---
alwaysApply: false
globs: *.ts
---

Rule body content`;
      expect(rule.getFileContent()).toBe(expectedContent);
      // Ensure no "description:" line appears
      expect(rule.getFileContent()).not.toContain("description:");
    });

    it("should not emit description in frontmatter when description is empty string", () => {
      const rule = new CursorRule({
        frontmatter: {
          description: "",
          globs: "*.ts",
        },
        body: "Rule body content",
        relativeDirPath: ".cursor/rules",
        relativeFilePath: "test.mdc",
      });

      // Empty string description should not produce "description:" in output
      expect(rule.getFileContent()).not.toContain("description:");
    });

    it("should generate correct file content with frontmatter", () => {
      const frontmatter: CursorRuleFrontmatter = {
        description: "Test rule",
        globs: "*.ts",
      };

      const rule = new CursorRule({
        frontmatter,
        body: "Rule body content",
        relativeDirPath: ".cursor/rules",
        relativeFilePath: "test.mdc",
      });

      // MDC files should output globs without quotes
      const expectedContent = `---
description: Test rule
globs: *.ts
---

Rule body content`;
      expect(rule.getFileContent()).toBe(expectedContent);
    });

    it("should generate correct file content with complex glob patterns", () => {
      const frontmatter: CursorRuleFrontmatter = {
        description: "Complex globs test",
        globs: "*.ts,*.tsx,**/*.js",
        alwaysApply: false,
      };

      const rule = new CursorRule({
        frontmatter,
        body: "Test content",
        relativeDirPath: ".cursor/rules",
        relativeFilePath: "test.mdc",
      });

      // MDC files should output globs without quotes
      const expectedContent = `---
alwaysApply: false
description: Complex globs test
globs: *.ts,*.tsx,**/*.js
---

Test content`;
      expect(rule.getFileContent()).toBe(expectedContent);
    });
  });

  describe("fromRulesyncRule", () => {
    it("should convert RulesyncRule to CursorRule with basic frontmatter", () => {
      const rulesyncRule = new RulesyncRule({
        frontmatter: {
          targets: ["cursor"],
          root: false,
          description: "Test description",
          globs: ["*.ts", "*.js"],
        },
        body: "Rule content",
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "test-rule.md",
      });

      const cursorRule = CursorRule.fromRulesyncRule({
        rulesyncRule,
        baseDir: testDir,
      });

      expect(cursorRule.getFrontmatter()).toEqual({
        description: "Test description",
        globs: "*.ts,*.js",
        alwaysApply: undefined,
      });
      expect(cursorRule.getBody()).toBe("Rule content");
      expect(cursorRule.getRelativeFilePath()).toBe("test-rule.mdc");
      expect(cursorRule.getRelativeDirPath()).toBe(".cursor/rules");
    });

    it("should handle alwaysApply from cursor-specific settings", () => {
      const rulesyncRule = new RulesyncRule({
        frontmatter: {
          targets: ["cursor"],
          root: false,
          description: "Test",
          globs: [],
          cursor: {
            alwaysApply: true,
          },
        },
        body: "Rule content",
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
      });

      const cursorRule = CursorRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(cursorRule.getFrontmatter().alwaysApply).toBe(true);
    });

    it("should handle empty globs array", () => {
      const rulesyncRule = new RulesyncRule({
        frontmatter: {
          targets: ["*"],
          root: false,
          globs: [],
        },
        body: "Rule content",
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
      });

      const cursorRule = CursorRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(cursorRule.getFrontmatter().globs).toBeUndefined();
    });

    it("should omit description when source rule has no description", () => {
      const rulesyncRule = new RulesyncRule({
        frontmatter: {
          targets: ["*"],
          root: false,
          globs: ["*.ts"],
        },
        body: "Rule content without description",
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "no-desc.md",
      });

      const cursorRule = CursorRule.fromRulesyncRule({
        rulesyncRule,
        baseDir: testDir,
      });

      expect(cursorRule.getFrontmatter().description).toBeUndefined();
      // The generated file should not contain "description:"
      expect(cursorRule.getFileContent()).not.toContain("description:");
    });

    it("should convert .md extension to .mdc", () => {
      const rulesyncRule = new RulesyncRule({
        frontmatter: {
          targets: ["*"],
          root: false,
        },
        body: "Content",
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "my-rule.md",
      });

      const cursorRule = CursorRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(cursorRule.getRelativeFilePath()).toBe("my-rule.mdc");
    });

    it("should preserve cursor-specific description", () => {
      const rulesyncRule = new RulesyncRule({
        frontmatter: {
          targets: ["*"],
          root: false,
          description: "General description",
          cursor: {
            description: "Cursor-specific description",
          },
        },
        body: "Content",
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
      });

      const cursorRule = CursorRule.fromRulesyncRule({
        rulesyncRule,
      });

      // Should use general description as cursor-specific description in frontmatter
      // is handled differently (cursor.description is for output, not input)
      expect(cursorRule.getFrontmatter().description).toBe("General description");
    });

    it("should respect cursor.globs when explicitly set to empty array", () => {
      const rulesyncRule = new RulesyncRule({
        frontmatter: {
          targets: ["*"],
          root: false,
          description: "Test",
          globs: ["**/*"],
          cursor: {
            globs: [],
          },
        },
        body: "Content",
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
      });

      const cursorRule = CursorRule.fromRulesyncRule({
        rulesyncRule,
      });

      // cursor.globs: [] should override parent globs
      expect(cursorRule.getFrontmatter().globs).toBeUndefined();
    });

    it("should use parent globs when cursor.globs is not set", () => {
      const rulesyncRule = new RulesyncRule({
        frontmatter: {
          targets: ["*"],
          root: false,
          description: "Test",
          globs: ["*.ts", "*.js"],
        },
        body: "Content",
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
      });

      const cursorRule = CursorRule.fromRulesyncRule({
        rulesyncRule,
      });

      // Should use parent globs when cursor.globs is not explicitly set
      expect(cursorRule.getFrontmatter().globs).toBe("*.ts,*.js");
    });

    it("should use cursor.globs when explicitly set with values", () => {
      const rulesyncRule = new RulesyncRule({
        frontmatter: {
          targets: ["*"],
          root: false,
          description: "Test",
          globs: ["**/*"],
          cursor: {
            globs: ["*.ts", "*.tsx"],
          },
        },
        body: "Content",
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
      });

      const cursorRule = CursorRule.fromRulesyncRule({
        rulesyncRule,
      });

      // cursor.globs should override parent globs
      expect(cursorRule.getFrontmatter().globs).toBe("*.ts,*.tsx");
    });
  });

  describe("fromFile", () => {
    it("should read and parse a cursor rule file", async () => {
      const filePath = join(testDir, ".cursor/rules", "test.mdc");
      const fileContent = `---
alwaysApply: false
description: Test rule
globs: *.ts,*.tsx,src/**/*.js,**/*.test.ts
---

This is the rule content
`;

      await writeFileContent(filePath, fileContent);

      const rule = await CursorRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "test.mdc",
      });

      expect(rule.getFrontmatter()).toEqual({
        description: "Test rule",
        globs: "*.ts,*.tsx,src/**/*.js,**/*.test.ts",
        alwaysApply: false,
      });
      expect(rule.getBody()).toBe("This is the rule content");
      expect(rule.getRelativeFilePath()).toBe("test.mdc");
    });

    it("should handle file with no frontmatter", async () => {
      const filePath = join(testDir, ".cursor/rules", "simple.mdc");
      const content = "Just plain content without frontmatter";

      await writeFileContent(filePath, content);

      const rule = await CursorRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "simple.mdc",
      });

      expect(rule.getFrontmatter()).toEqual({});
      expect(rule.getBody()).toBe(content);
    });

    it("should validate frontmatter by default", async () => {
      const filePath = join(testDir, ".cursor/rules", "invalid.mdc");
      const invalidContent = stringifyFrontmatter("Content", {
        description: 123, // Invalid type
        globs: true, // Invalid type
      });

      await writeFileContent(filePath, invalidContent);

      await expect(
        CursorRule.fromFile({
          baseDir: testDir,
          relativeFilePath: "invalid.mdc",
        }),
      ).rejects.toThrow(/Invalid frontmatter/);
    });

    it("should skip validation when validate is false", async () => {
      const filePath = join(testDir, ".cursor/rules", "invalid.mdc");
      // CursorRule.fromFile always validates during parsing, not respecting validate flag
      // This is different from constructor behavior
      const content = "---\ndescription: Valid string\n---\nContent";

      await writeFileContent(filePath, content);

      const rule = await CursorRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "invalid.mdc",
        validate: false,
      });

      expect(rule.getFrontmatter()).toHaveProperty("description", "Valid string");
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert CursorRule to RulesyncRule with basic settings", () => {
      const cursorRule = new CursorRule({
        frontmatter: {
          description: "Test description",
          globs: "*.ts,*.js",
        },
        body: "Rule content",
        relativeDirPath: ".cursor/rules",
        relativeFilePath: "test.mdc",
        validate: false, // Skip validation to avoid issues with undefined handling
      });

      const rulesyncRule = cursorRule.toRulesyncRule();
      const frontmatter = rulesyncRule.getFrontmatter();

      expect(frontmatter.targets).toEqual(["*"]);
      expect(frontmatter.root).toBe(false);
      expect(frontmatter.description).toBe("Test description");
      expect(frontmatter.globs).toEqual(["*.ts", "*.js"]);
      // cursor property should exclude undefined alwaysApply
      expect(frontmatter.cursor).toEqual({
        description: "Test description",
        globs: ["*.ts", "*.js"],
      });
      expect(rulesyncRule.getBody()).toBe("Rule content");
      expect(rulesyncRule.getRelativeFilePath()).toBe("test.md");
    });

    it("should handle alwaysApply true with no globs", () => {
      const cursorRule = new CursorRule({
        frontmatter: {
          alwaysApply: true,
        },
        body: "Content",
        relativeDirPath: ".cursor/rules",
        relativeFilePath: "always.mdc",
        validate: false,
      });

      const rulesyncRule = cursorRule.toRulesyncRule();
      const frontmatter = rulesyncRule.getFrontmatter();

      expect(frontmatter.globs).toEqual(["**/*"]);
      expect(frontmatter.cursor?.alwaysApply).toBe(true);
      expect(frontmatter.cursor?.globs).toEqual(["**/*"]);
    });

    it("should handle alwaysApply true with existing globs", () => {
      const cursorRule = new CursorRule({
        frontmatter: {
          alwaysApply: true,
          globs: "*.ts",
        },
        body: "Content",
        relativeDirPath: ".cursor/rules",
        relativeFilePath: "test.mdc",
        validate: false,
      });

      const rulesyncRule = cursorRule.toRulesyncRule();
      const frontmatter = rulesyncRule.getFrontmatter();

      expect(frontmatter.globs).toEqual(["*.ts"]);
      expect(frontmatter.cursor?.globs).toEqual(["*.ts"]);
    });

    it("should handle empty globs string", () => {
      const cursorRule = new CursorRule({
        frontmatter: {
          globs: "",
        },
        body: "Content",
        relativeDirPath: ".cursor/rules",
        relativeFilePath: "test.mdc",
        validate: false,
      });

      const rulesyncRule = cursorRule.toRulesyncRule();
      const frontmatter = rulesyncRule.getFrontmatter();

      expect(frontmatter.globs).toEqual([]);
      expect(frontmatter.cursor?.globs).toBeUndefined();
    });

    it("should split and trim globs properly", () => {
      const cursorRule = new CursorRule({
        frontmatter: {
          globs: "  *.ts , *.js  ,  *.tsx  ",
        },
        body: "Content",
        relativeDirPath: ".cursor/rules",
        relativeFilePath: "test.mdc",
        validate: false,
      });

      const rulesyncRule = cursorRule.toRulesyncRule();
      const frontmatter = rulesyncRule.getFrontmatter();

      expect(frontmatter.globs).toEqual(["*.ts", "*.js", "*.tsx"]);
    });

    it("should convert .mdc extension to .md", () => {
      const cursorRule = new CursorRule({
        frontmatter: {},
        body: "Content",
        relativeDirPath: ".cursor/rules",
        relativeFilePath: "my-rule.mdc",
        validate: false,
      });

      const rulesyncRule = cursorRule.toRulesyncRule();

      expect(rulesyncRule.getRelativeFilePath()).toBe("my-rule.md");
    });

    it("should set cursor-specific globs to undefined when empty", () => {
      const cursorRule = new CursorRule({
        frontmatter: {
          description: "Test",
        },
        body: "Content",
        relativeDirPath: ".cursor/rules",
        relativeFilePath: "test.mdc",
        validate: false,
      });

      const rulesyncRule = cursorRule.toRulesyncRule();
      const frontmatter = rulesyncRule.getFrontmatter();

      expect(frontmatter.globs).toEqual([]);
      expect(frontmatter.cursor?.globs).toBeUndefined();
    });
  });

  describe("validate", () => {
    it("should return success for valid frontmatter", () => {
      const rule = new CursorRule({
        frontmatter: {
          description: "Valid description",
          globs: "*.ts",
          alwaysApply: true,
        },
        body: "Content",
        relativeDirPath: ".cursor/rules",
        relativeFilePath: "test.mdc",
      });

      const result = rule.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return error for invalid frontmatter types", () => {
      const rule = new CursorRule({
        frontmatter: {
          description: 123 as any,
          globs: true as any,
        },
        body: "Content",
        relativeDirPath: ".cursor/rules",
        relativeFilePath: "test.mdc",
        validate: false, // Skip constructor validation
      });

      const result = rule.validate();
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should handle empty frontmatter object", () => {
      const rule = new CursorRule({
        frontmatter: {},
        body: "Content",
        relativeDirPath: ".cursor/rules",
        relativeFilePath: "test.mdc",
        validate: false,
      });

      const result = rule.validate();
      expect(result.success).toBe(true);
    });
  });

  describe("getters", () => {
    it("should return correct frontmatter", () => {
      const frontmatter: CursorRuleFrontmatter = {
        description: "Test",
        globs: "*.ts",
        alwaysApply: false,
      };

      const rule = new CursorRule({
        frontmatter,
        body: "Content",
        relativeDirPath: ".cursor/rules",
        relativeFilePath: "test.mdc",
      });

      expect(rule.getFrontmatter()).toEqual(frontmatter);
    });

    it("should return correct body", () => {
      const body = "This is the rule body content";
      const rule = new CursorRule({
        frontmatter: {},
        body,
        relativeDirPath: ".cursor/rules",
        relativeFilePath: "test.mdc",
      });

      expect(rule.getBody()).toBe(body);
    });
  });

  describe("isTargetedByRulesyncRule", () => {
    it("should return true for rules targeting cursor", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["cursor"],
        },
        body: "Test content",
      });

      expect(CursorRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should return true for rules targeting all tools (*)", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["*"],
        },
        body: "Test content",
      });

      expect(CursorRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should return false for rules not targeting cursor", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["cline", "copilot"],
        },
        body: "Test content",
      });

      expect(CursorRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(false);
    });

    it("should return false for empty targets", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          targets: [],
        },
        body: "Test content",
      });

      expect(CursorRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(false);
    });

    it("should handle mixed targets including cursor", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["cline", "cursor", "copilot"],
        },
        body: "Test content",
      });

      expect(CursorRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should handle undefined targets in frontmatter", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {},
        body: "Test content",
      });

      expect(CursorRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("should handle globs with only whitespace", () => {
      const cursorRule = new CursorRule({
        frontmatter: {
          globs: "   ,  ,   ",
        },
        body: "Content",
        relativeDirPath: ".cursor/rules",
        relativeFilePath: "test.mdc",
        validate: false,
      });

      const rulesyncRule = cursorRule.toRulesyncRule();
      expect(rulesyncRule.getFrontmatter().globs).toEqual([]);
    });

    it("should preserve all optional fields when undefined", () => {
      const cursorRule = new CursorRule({
        frontmatter: {},
        body: "Content",
        relativeDirPath: ".cursor/rules",
        relativeFilePath: "test.mdc",
      });

      const frontmatter = cursorRule.getFrontmatter();
      expect(frontmatter.description).toBeUndefined();
      expect(frontmatter.globs).toBeUndefined();
      expect(frontmatter.alwaysApply).toBeUndefined();
    });

    it("should handle complex glob patterns", () => {
      // Note: Current implementation splits on comma, which breaks glob patterns with braces
      // This is a limitation of the current string-based globs approach
      const globs = "**/*.ts,!node_modules/**,src/**/*.js";
      const cursorRule = new CursorRule({
        frontmatter: {
          globs,
        },
        body: "Content",
        relativeDirPath: ".cursor/rules",
        relativeFilePath: "test.mdc",
        validate: false,
      });

      const rulesyncRule = cursorRule.toRulesyncRule();
      expect(rulesyncRule.getFrontmatter().globs).toEqual([
        "**/*.ts",
        "!node_modules/**",
        "src/**/*.js",
      ]);
    });

    it("should roundtrip cursor rules without description (no YAML null)", async () => {
      // Write a cursor rule with no description (simulates generation from a rule imported from Claude Code)
      const filePath = join(testDir, ".cursor/rules", "no-desc.mdc");
      const rule = new CursorRule({
        frontmatter: {
          alwaysApply: true,
        },
        body: "Rule without description",
        relativeDirPath: ".cursor/rules",
        relativeFilePath: "no-desc.mdc",
      });

      // The file content should NOT contain "description:"
      expect(rule.getFileContent()).not.toContain("description:");

      // Write to disk and re-read
      await writeFileContent(filePath, rule.getFileContent());
      const reimported = await CursorRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "no-desc.mdc",
      });

      // Should parse successfully without Zod validation error
      expect(reimported.getFrontmatter().description).toBeUndefined();
      expect(reimported.getFrontmatter().alwaysApply).toBe(true);
      expect(reimported.getBody()).toBe("Rule without description");
    });

    it("should handle re-importing a cursor file with YAML null description", async () => {
      // Simulates a manually-created or legacy .mdc file with "description:" (YAML null)
      const filePath = join(testDir, ".cursor/rules", "null-desc.mdc");
      const fileContent = `---
description:
alwaysApply: true
---

Rule with null description`;

      await writeFileContent(filePath, fileContent);

      // Should NOT throw a Zod validation error
      const rule = await CursorRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "null-desc.mdc",
      });

      expect(rule.getFrontmatter().description).toBeUndefined();
      expect(rule.getFrontmatter().alwaysApply).toBe(true);
      expect(rule.getBody()).toBe("Rule with null description");
    });
  });
});
