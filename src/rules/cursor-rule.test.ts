import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../utils/file.js";
import { stringifyFrontmatter } from "../utils/frontmatter.js";
import {
  CursorRule,
  type CursorRuleFrontmatter,
  CursorRuleFrontmatterSchema,
} from "./cursor-rule.js";
import { RulesyncRule, type RulesyncRuleFrontmatter } from "./rulesync-rule.js";

describe("CursorRule", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("constructor", () => {
    it("should create a CursorRule with valid frontmatter and body", () => {
      const frontmatter: CursorRuleFrontmatter = {
        description: "Test rule",
        globs: "*.ts,*.js",
        alwaysApply: true,
      };

      const rule = new CursorRule({
        baseDir: testDir,
        relativeDirPath: ".cursor/rules",
        relativeFilePath: "test.mdc",
        frontmatter,
        body: "This is a test rule body",
      });

      expect(rule.getFrontmatter()).toEqual(frontmatter);
      expect(rule.getBody()).toBe("This is a test rule body");
    });

    it("should validate frontmatter when validation is enabled", () => {
      const invalidFrontmatter = {
        description: 123, // Should be string
        globs: true, // Should be string
        alwaysApply: "invalid", // Should be boolean
      } as any;

      expect(() => {
        return new CursorRule({
          baseDir: testDir,
          relativeDirPath: ".cursor/rules",
          relativeFilePath: "test.mdc",
          frontmatter: invalidFrontmatter,
          body: "Test body",
          validate: true,
        });
      }).toThrow();
    });

    it("should skip validation when validate is false", () => {
      const invalidFrontmatter = {
        description: 123, // Should be string
      } as any;

      expect(() => {
        return new CursorRule({
          baseDir: testDir,
          relativeDirPath: ".cursor/rules",
          relativeFilePath: "test.mdc",
          frontmatter: invalidFrontmatter,
          body: "Test body",
          validate: false,
        });
      }).not.toThrow();
    });

    it("should work with minimal frontmatter", () => {
      const frontmatter: CursorRuleFrontmatter = {};

      const rule = new CursorRule({
        baseDir: testDir,
        relativeDirPath: ".cursor/rules",
        relativeFilePath: "test.mdc",
        frontmatter,
        body: "Minimal rule body",
      });

      expect(rule.getFrontmatter()).toEqual({});
      expect(rule.getBody()).toBe("Minimal rule body");
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert a CursorRule with all fields to RulesyncRule", () => {
      const frontmatter: CursorRuleFrontmatter = {
        description: "Test rule",
        globs: "*.ts,*.js",
        alwaysApply: true,
      };

      const cursorRule = new CursorRule({
        baseDir: testDir,
        relativeDirPath: ".cursor/rules",
        relativeFilePath: "test.mdc",
        frontmatter,
        body: "This is a test rule body",
      });

      const rulesyncRule = cursorRule.toRulesyncRule();

      const rulesyncFrontmatter = rulesyncRule.getFrontmatter();
      expect(rulesyncFrontmatter.targets).toEqual(["*"]);
      expect(rulesyncFrontmatter.root).toBe(false);
      expect(rulesyncFrontmatter.description).toBe("Test rule");
      expect(rulesyncFrontmatter.globs).toEqual(["*.ts", "*.js"]);
      expect(rulesyncFrontmatter.cursor).toEqual({
        alwaysApply: true,
        description: "Test rule",
        globs: ["*.ts", "*.js"],
      });
      expect(rulesyncRule.getBody()).toBe("This is a test rule body");
      expect(rulesyncRule.getRelativeFilePath()).toBe("test.md");
    });

    it("should handle alwaysApply=true without globs", () => {
      const frontmatter: CursorRuleFrontmatter = {
        description: "Always apply rule",
        alwaysApply: true,
      };

      const cursorRule = new CursorRule({
        baseDir: testDir,
        relativeDirPath: ".cursor/rules",
        relativeFilePath: "always.mdc",
        frontmatter,
        body: "Always apply this rule",
      });

      const rulesyncRule = cursorRule.toRulesyncRule();
      const rulesyncFrontmatter = rulesyncRule.getFrontmatter();

      expect(rulesyncFrontmatter.globs).toEqual(["**/*"]);
      expect(rulesyncFrontmatter.cursor?.globs).toEqual(["**/*"]);
    });

    it("should handle specific globs without alwaysApply", () => {
      const frontmatter: CursorRuleFrontmatter = {
        description: "TypeScript rule",
        globs: "*.ts, *.tsx",
      };

      const cursorRule = new CursorRule({
        baseDir: testDir,
        relativeDirPath: ".cursor/rules",
        relativeFilePath: "typescript.mdc",
        frontmatter,
        body: "TypeScript specific rule",
      });

      const rulesyncRule = cursorRule.toRulesyncRule();
      const rulesyncFrontmatter = rulesyncRule.getFrontmatter();

      expect(rulesyncFrontmatter.globs).toEqual(["*.ts", "*.tsx"]);
      expect(rulesyncFrontmatter.cursor?.globs).toEqual(["*.ts", "*.tsx"]);
    });

    it("should handle empty globs", () => {
      const frontmatter: CursorRuleFrontmatter = {
        description: "Rule with empty globs",
        globs: "",
      };

      const cursorRule = new CursorRule({
        baseDir: testDir,
        relativeDirPath: ".cursor/rules",
        relativeFilePath: "empty.mdc",
        frontmatter,
        body: "Rule body",
      });

      const rulesyncRule = cursorRule.toRulesyncRule();
      const rulesyncFrontmatter = rulesyncRule.getFrontmatter();

      expect(rulesyncFrontmatter.globs).toEqual([]);
      expect(rulesyncFrontmatter.cursor?.globs).toBeUndefined();
    });

    it("should handle minimal frontmatter", () => {
      const frontmatter: CursorRuleFrontmatter = {};

      const cursorRule = new CursorRule({
        baseDir: testDir,
        relativeDirPath: ".cursor/rules",
        relativeFilePath: "minimal.mdc",
        frontmatter,
        body: "Minimal rule",
      });

      const rulesyncRule = cursorRule.toRulesyncRule();
      const rulesyncFrontmatter = rulesyncRule.getFrontmatter();

      expect(rulesyncFrontmatter.targets).toEqual(["*"]);
      expect(rulesyncFrontmatter.root).toBe(false);
      expect(rulesyncFrontmatter.description).toBeUndefined();
      expect(rulesyncFrontmatter.globs).toEqual([]);
      expect(rulesyncFrontmatter.cursor).toEqual({
        alwaysApply: undefined,
        description: undefined,
        globs: undefined,
      });
    });
  });

  describe("fromRulesyncRule", () => {
    it("should convert a RulesyncRule to CursorRule", () => {
      const rulesyncFrontmatter: RulesyncRuleFrontmatter = {
        targets: ["copilot", "cursor"],
        root: false,
        description: "Test rule from rulesync",
        globs: ["*.ts", "*.js"],
        cursor: {
          alwaysApply: true,
          description: "Test rule from rulesync",
          globs: ["*.ts", "*.js"],
        },
      };

      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "test.md",
        frontmatter: rulesyncFrontmatter,
        body: "Rulesync rule body",
        validate: false,
      });

      const cursorRule = CursorRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule,
      });

      const cursorFrontmatter = cursorRule.getFrontmatter();
      expect(cursorFrontmatter.description).toBe("Test rule from rulesync");
      expect(cursorFrontmatter.globs).toBe("*.ts,*.js");
      expect(cursorFrontmatter.alwaysApply).toBe(true);
      expect(cursorRule.getBody()).toBe("Rulesync rule body");
      expect(cursorRule.getRelativeFilePath()).toBe("test.mdc");
    });

    it("should handle RulesyncRule without cursor-specific fields", () => {
      const rulesyncFrontmatter: RulesyncRuleFrontmatter = {
        targets: ["copilot"],
        root: false,
        description: "Generic rule",
        globs: ["*.py"],
      };

      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "generic.md",
        frontmatter: rulesyncFrontmatter,
        body: "Generic rule body",
        validate: false,
      });

      const cursorRule = CursorRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule,
      });

      const cursorFrontmatter = cursorRule.getFrontmatter();
      expect(cursorFrontmatter.description).toBe("Generic rule");
      expect(cursorFrontmatter.globs).toBe("*.py");
      expect(cursorFrontmatter.alwaysApply).toBeUndefined();
    });

    it("should handle RulesyncRule with empty globs", () => {
      const rulesyncFrontmatter: RulesyncRuleFrontmatter = {
        targets: ["cursor"],
        root: false,
        description: "No globs rule",
        globs: [],
      };

      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "noglobs.md",
        frontmatter: rulesyncFrontmatter,
        body: "No globs rule body",
        validate: false,
      });

      const cursorRule = CursorRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule,
      });

      const cursorFrontmatter = cursorRule.getFrontmatter();
      expect(cursorFrontmatter.globs).toBeUndefined();
    });
  });

  describe("fromFile", () => {
    it("should create CursorRule from file", async () => {
      const frontmatter: CursorRuleFrontmatter = {
        description: "File-based rule",
        globs: "*.ts",
        alwaysApply: false,
      };

      const fileContent = stringifyFrontmatter("File rule body", frontmatter);
      const rulesDir = join(testDir, ".cursor/rules");
      await ensureDir(rulesDir);
      await writeFileContent(join(rulesDir, "file-rule.mdc"), fileContent);

      const cursorRule = await CursorRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "file-rule.mdc",
      });

      expect(cursorRule.getFrontmatter()).toEqual(frontmatter);
      expect(cursorRule.getBody()).toBe("File rule body");
    });

    it("should throw error for invalid frontmatter in file", async () => {
      const invalidContent = `---
description: 123
globs: true
alwaysApply: "invalid"
---

Invalid rule body`;

      const rulesDir = join(testDir, ".cursor/rules");
      await ensureDir(rulesDir);
      await writeFileContent(join(rulesDir, "invalid.mdc"), invalidContent);

      await expect(
        CursorRule.fromFile({
          baseDir: testDir,
          relativeFilePath: "invalid.mdc",
        }),
      ).rejects.toThrow("Invalid frontmatter");
    });

    it("should handle file with minimal frontmatter", async () => {
      const fileContent = `---
---

Minimal file rule body`;

      const rulesDir = join(testDir, ".cursor/rules");
      await ensureDir(rulesDir);
      await writeFileContent(join(rulesDir, "minimal.mdc"), fileContent);

      const cursorRule = await CursorRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "minimal.mdc",
      });

      expect(cursorRule.getFrontmatter()).toEqual({});
      expect(cursorRule.getBody()).toBe("Minimal file rule body");
    });
  });

  describe("validate", () => {
    it("should return success for valid frontmatter", () => {
      const frontmatter: CursorRuleFrontmatter = {
        description: "Valid rule",
        globs: "*.ts",
        alwaysApply: true,
      };

      const rule = new CursorRule({
        baseDir: testDir,
        relativeDirPath: ".cursor/rules",
        relativeFilePath: "valid.mdc",
        frontmatter,
        body: "Valid rule body",
        validate: false, // Skip constructor validation to test validate method
      });

      const result = rule.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return error for invalid frontmatter", () => {
      const invalidFrontmatter = {
        description: 123, // Should be string
        globs: true, // Should be string
        alwaysApply: "invalid", // Should be boolean
      } as any;

      const rule = new CursorRule({
        baseDir: testDir,
        relativeDirPath: ".cursor/rules",
        relativeFilePath: "invalid.mdc",
        frontmatter: invalidFrontmatter,
        body: "Invalid rule body",
        validate: false, // Skip constructor validation
      });

      const result = rule.validate();
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it("should return success when frontmatter is undefined", () => {
      const rule = new CursorRule({
        baseDir: testDir,
        relativeDirPath: ".cursor/rules",
        relativeFilePath: "test.mdc",
        frontmatter: {} as CursorRuleFrontmatter,
        body: "Test body",
        validate: false,
      });

      // Simulate undefined frontmatter by creating rule with empty object
      // and then checking validation (the constructor validates but validate() method
      // has a special case for undefined frontmatter)
      const result = rule.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });

  describe("CursorRuleFrontmatterSchema", () => {
    it("should validate correct frontmatter", () => {
      const validFrontmatter = {
        description: "Test description",
        globs: "*.ts,*.js",
        alwaysApply: true,
      };

      const result = CursorRuleFrontmatterSchema.safeParse(validFrontmatter);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validFrontmatter);
      }
    });

    it("should validate frontmatter with optional fields missing", () => {
      const minimalFrontmatter = {};

      const result = CursorRuleFrontmatterSchema.safeParse(minimalFrontmatter);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({});
      }
    });

    it("should reject invalid field types", () => {
      const invalidFrontmatter = {
        description: 123,
        globs: true,
        alwaysApply: "yes",
      };

      const result = CursorRuleFrontmatterSchema.safeParse(invalidFrontmatter);
      expect(result.success).toBe(false);
    });

    it("should accept partial frontmatter", () => {
      const partialFrontmatter = {
        description: "Only description",
      };

      const result = CursorRuleFrontmatterSchema.safeParse(partialFrontmatter);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.description).toBe("Only description");
        expect(result.data.globs).toBeUndefined();
        expect(result.data.alwaysApply).toBeUndefined();
      }
    });
  });

  describe("getFrontmatter and getBody", () => {
    it("should return correct frontmatter and body", () => {
      const frontmatter: CursorRuleFrontmatter = {
        description: "Getter test",
        globs: "*.test.ts",
        alwaysApply: false,
      };

      const body = "Test body for getters";

      const rule = new CursorRule({
        baseDir: testDir,
        relativeDirPath: ".cursor/rules",
        relativeFilePath: "getter-test.mdc",
        frontmatter,
        body,
      });

      expect(rule.getFrontmatter()).toEqual(frontmatter);
      expect(rule.getBody()).toBe(body);
    });
  });
});
