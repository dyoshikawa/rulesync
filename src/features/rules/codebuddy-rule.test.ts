import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_RELATIVE_DIR_PATH,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { CodebuddyRule } from "./codebuddy-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("CodebuddyRule", () => {
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
    it("should create instance with default parameters", () => {
      const codebuddyRule = new CodebuddyRule({
        relativeDirPath: ".codebuddy/rules",
        relativeFilePath: "test-rule.md",
        frontmatter: {},
        body: "# Test Rule\n\nThis is a test rule.",
      });

      expect(codebuddyRule).toBeInstanceOf(CodebuddyRule);
      expect(codebuddyRule.getRelativeDirPath()).toBe(".codebuddy/rules");
      expect(codebuddyRule.getRelativeFilePath()).toBe("test-rule.md");
      expect(codebuddyRule.getBody()).toBe("# Test Rule\n\nThis is a test rule.");
    });

    it("should create instance with paths frontmatter", () => {
      const codebuddyRule = new CodebuddyRule({
        relativeDirPath: ".codebuddy/rules",
        relativeFilePath: "typescript-rules.md",
        frontmatter: { paths: ["src/**/*.ts"] },
        body: "# TypeScript Rules\n\nRules for TypeScript files.",
      });

      expect(codebuddyRule.getFrontmatter().paths).toEqual(["src/**/*.ts"]);
      expect(codebuddyRule.getFileContent()).toContain("paths:");
      expect(codebuddyRule.getFileContent()).toContain("- src/**/*.ts");
    });

    it("should create instance with description and alwaysApply frontmatter", () => {
      const codebuddyRule = new CodebuddyRule({
        relativeDirPath: ".codebuddy/rules",
        relativeFilePath: "always.md",
        frontmatter: { description: "Always-on rule", alwaysApply: true },
        body: "# Always Rule",
      });

      expect(codebuddyRule.getFrontmatter().description).toBe("Always-on rule");
      expect(codebuddyRule.getFrontmatter().alwaysApply).toBe(true);
      expect(codebuddyRule.getFileContent()).toContain("description: Always-on rule");
      expect(codebuddyRule.getFileContent()).toContain("alwaysApply: true");
    });

    it("should create instance for root CODEBUDDY.md file", () => {
      const codebuddyRule = new CodebuddyRule({
        relativeDirPath: ".",
        relativeFilePath: "CODEBUDDY.md",
        frontmatter: {},
        body: "# Project Overview\n\nThis is the main CodeBuddy memory.",
        root: true,
      });

      expect(codebuddyRule.getRelativeDirPath()).toBe(".");
      expect(codebuddyRule.getRelativeFilePath()).toBe("CODEBUDDY.md");
      expect(codebuddyRule.getFileContent()).toBe(
        "# Project Overview\n\nThis is the main CodeBuddy memory.",
      );
      expect(codebuddyRule.isRoot()).toBe(true);
    });

    it("should not include frontmatter for root file", () => {
      const codebuddyRule = new CodebuddyRule({
        relativeDirPath: ".",
        relativeFilePath: "CODEBUDDY.md",
        frontmatter: { paths: ["**/*"] }, // This should be ignored for root
        body: "# Root Content",
        root: true,
      });

      expect(codebuddyRule.getFileContent()).toBe("# Root Content");
      expect(codebuddyRule.getFileContent()).not.toContain("---");
    });

    it("should not include frontmatter when no frontmatter fields are set", () => {
      const codebuddyRule = new CodebuddyRule({
        relativeDirPath: ".codebuddy/rules",
        relativeFilePath: "general.md",
        frontmatter: {},
        body: "# General Rules",
        root: false,
      });

      expect(codebuddyRule.getFileContent()).toBe("# General Rules");
      expect(codebuddyRule.getFileContent()).not.toContain("---");
    });

    it("should throw for invalid frontmatter when validate is true", () => {
      expect(
        () =>
          new CodebuddyRule({
            relativeDirPath: ".codebuddy/rules",
            relativeFilePath: "bad.md",
            // @ts-expect-error intentionally invalid for the test
            frontmatter: { paths: "not-an-array" },
            body: "# Bad Rule",
            validate: true,
          }),
      ).toThrow();
    });
  });

  describe("getSettablePaths", () => {
    it("should return modular rules paths for project mode", () => {
      const paths = CodebuddyRule.getSettablePaths();

      expect(paths.root).toEqual({
        relativeDirPath: ".",
        relativeFilePath: "CODEBUDDY.md",
      });
      expect(paths.nonRoot).toEqual({
        relativeDirPath: ".codebuddy/rules",
      });
    });

    it("should return alternativeRoots for project mode", () => {
      const paths = CodebuddyRule.getSettablePaths();

      expect(paths.alternativeRoots).toEqual([
        {
          relativeDirPath: ".codebuddy",
          relativeFilePath: "CODEBUDDY.md",
        },
      ]);
    });

    it("should return global paths for global mode", () => {
      const paths = CodebuddyRule.getSettablePaths({ global: true });

      expect(paths.root).toEqual({
        relativeDirPath: ".codebuddy",
        relativeFilePath: "CODEBUDDY.md",
      });
      expect(paths.nonRoot).toEqual({
        relativeDirPath: ".codebuddy/rules",
      });
    });

    it("should not return alternativeRoots for global mode", () => {
      const paths = CodebuddyRule.getSettablePaths({ global: true });

      expect(paths).not.toHaveProperty("alternativeRoots");
    });
  });

  describe("fromFile", () => {
    it("should create instance from root CODEBUDDY.md in .codebuddy/ directory with relativeDirPath override", async () => {
      const codebuddyDir = join(testDir, ".codebuddy");
      await ensureDir(codebuddyDir);
      const testContent = "# CodeBuddy Project from .codebuddy dir";
      await writeFileContent(join(codebuddyDir, "CODEBUDDY.md"), testContent);

      const codebuddyRule = await CodebuddyRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "CODEBUDDY.md",
        relativeDirPath: ".codebuddy",
      });

      expect(codebuddyRule.getRelativeDirPath()).toBe(".codebuddy");
      expect(codebuddyRule.getRelativeFilePath()).toBe("CODEBUDDY.md");
      expect(codebuddyRule.getBody()).toBe(testContent);
      expect(codebuddyRule.getFilePath()).toBe(join(testDir, ".codebuddy/CODEBUDDY.md"));
      expect(codebuddyRule.isRoot()).toBe(true);
    });

    it("should create instance from root CODEBUDDY.md file", async () => {
      const testContent = "# CodeBuddy Project\n\nProject overview and instructions.";
      await writeFileContent(join(testDir, "CODEBUDDY.md"), testContent);

      const codebuddyRule = await CodebuddyRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "CODEBUDDY.md",
      });

      expect(codebuddyRule.getRelativeDirPath()).toBe(".");
      expect(codebuddyRule.getRelativeFilePath()).toBe("CODEBUDDY.md");
      expect(codebuddyRule.getBody()).toBe(testContent);
      expect(codebuddyRule.getFilePath()).toBe(join(testDir, "CODEBUDDY.md"));
      expect(codebuddyRule.isRoot()).toBe(true);
    });

    it("should create instance from rules file with paths and alwaysApply frontmatter", async () => {
      const rulesDir = join(testDir, ".codebuddy/rules");
      await ensureDir(rulesDir);
      const testContent = `---
description: TypeScript rules
paths:
  - src/**/*.ts
alwaysApply: false
---

# TypeScript Rules

Rules for TypeScript files.`;
      await writeFileContent(join(rulesDir, "typescript.md"), testContent);

      const codebuddyRule = await CodebuddyRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "typescript.md",
      });

      expect(codebuddyRule.getRelativeDirPath()).toBe(".codebuddy/rules");
      expect(codebuddyRule.getRelativeFilePath()).toBe("typescript.md");
      expect(codebuddyRule.getFrontmatter().description).toBe("TypeScript rules");
      expect(codebuddyRule.getFrontmatter().paths).toEqual(["src/**/*.ts"]);
      expect(codebuddyRule.getFrontmatter().alwaysApply).toBe(false);
      expect(codebuddyRule.getBody()).toBe("# TypeScript Rules\n\nRules for TypeScript files.");
      expect(codebuddyRule.isRoot()).toBe(false);
    });

    it("should create instance from rules file without frontmatter", async () => {
      const rulesDir = join(testDir, ".codebuddy/rules");
      await ensureDir(rulesDir);
      const testContent = "# General Rules\n\nApplies to all files.";
      await writeFileContent(join(rulesDir, "general.md"), testContent);

      const codebuddyRule = await CodebuddyRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "general.md",
      });

      expect(codebuddyRule.getFrontmatter().paths).toBeUndefined();
      expect(codebuddyRule.getBody()).toBe(testContent);
    });

    it("should throw error when file does not exist", async () => {
      await expect(
        CodebuddyRule.fromFile({
          outputRoot: testDir,
          relativeFilePath: "nonexistent.md",
        }),
      ).rejects.toThrow();
    });
  });

  describe("forDeletion", () => {
    it("should create a root instance marked for deletion", () => {
      const codebuddyRule = CodebuddyRule.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "CODEBUDDY.md",
      });

      expect(codebuddyRule.isRoot()).toBe(true);
      expect(codebuddyRule.getBody()).toBe("");
    });

    it("should create a non-root instance marked for deletion", () => {
      const codebuddyRule = CodebuddyRule.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".codebuddy/rules",
        relativeFilePath: "typescript.md",
      });

      expect(codebuddyRule.isRoot()).toBe(false);
      expect(codebuddyRule.getBody()).toBe("");
    });
  });

  describe("fromRulesyncRule", () => {
    it("should create instance from RulesyncRule for root rule", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "overview.md",
        frontmatter: {
          root: true,
          targets: ["*"],
          description: "Test root rule",
          globs: ["**/*"],
        },
        body: "# Test RulesyncRule\n\nContent from rulesync.",
      });

      const codebuddyRule = CodebuddyRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(codebuddyRule).toBeInstanceOf(CodebuddyRule);
      expect(codebuddyRule.getRelativeDirPath()).toBe(".");
      expect(codebuddyRule.getRelativeFilePath()).toBe("CODEBUDDY.md");
      expect(codebuddyRule.getBody()).toBe("# Test RulesyncRule\n\nContent from rulesync.");
      expect(codebuddyRule.isRoot()).toBe(true);
    });

    it("should create instance from RulesyncRule for non-root rule with globs", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "typescript-rules.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "TypeScript rules",
          globs: ["src/**/*.ts", "tests/**/*.ts"],
        },
        body: "# TypeScript Rules\n\nContent for TS files.",
      });

      const codebuddyRule = CodebuddyRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(codebuddyRule).toBeInstanceOf(CodebuddyRule);
      expect(codebuddyRule.getRelativeDirPath()).toBe(".codebuddy/rules");
      expect(codebuddyRule.getRelativeFilePath()).toBe("typescript-rules.md");
      expect(codebuddyRule.getFrontmatter().paths).toEqual(["src/**/*.ts", "tests/**/*.ts"]);
      expect(codebuddyRule.getFrontmatter().description).toBe("TypeScript rules");
      expect(codebuddyRule.isRoot()).toBe(false);
    });

    it("should use codebuddy.paths over globs when both are specified", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "custom-paths.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          globs: ["src/**/*.ts"],
          codebuddy: { paths: ["custom/**/*.{ts,tsx}"] },
        },
        body: "# Custom Paths Rule",
      });

      const codebuddyRule = CodebuddyRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(codebuddyRule.getFrontmatter().paths).toEqual(["custom/**/*.{ts,tsx}"]);
    });

    it("should prefer codebuddy.description over the shared description", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "custom-description.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "Shared description",
          globs: ["**/*"],
          codebuddy: { description: "CodeBuddy-specific description" },
        },
        body: "# Custom Description Rule",
      });

      const codebuddyRule = CodebuddyRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(codebuddyRule.getFrontmatter().description).toBe("CodeBuddy-specific description");
    });

    it("should set alwaysApply from the codebuddy passthrough block and drop the redundant universal glob", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "always.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          globs: ["**/*"],
          codebuddy: { alwaysApply: true },
        },
        body: "# Always Apply Rule",
      });

      const codebuddyRule = CodebuddyRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(codebuddyRule.getFrontmatter().alwaysApply).toBe(true);
      // alwaysApply already applies the rule everywhere, so the universal
      // glob carried over from the canonical `globs` would be redundant
      // and, on a later import/generate round-trip, misleading.
      expect(codebuddyRule.getFrontmatter().paths).toBeUndefined();
    });

    it("should drop an explicit universal codebuddy.paths when alwaysApply is true", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "always-explicit.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          globs: ["**/*"],
          codebuddy: { alwaysApply: true, paths: ["**/*"] },
        },
        body: "# Always Apply Rule With Explicit Universal Path",
      });

      const codebuddyRule = CodebuddyRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(codebuddyRule.getFrontmatter().alwaysApply).toBe(true);
      expect(codebuddyRule.getFrontmatter().paths).toBeUndefined();
    });

    it("should keep non-universal paths even when alwaysApply is true", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "always-scoped.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          globs: ["**/*"],
          codebuddy: { alwaysApply: true, paths: ["src/**/*.ts"] },
        },
        body: "# Always Apply Rule With Scoped Path",
      });

      const codebuddyRule = CodebuddyRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(codebuddyRule.getFrontmatter().alwaysApply).toBe(true);
      expect(codebuddyRule.getFrontmatter().paths).toEqual(["src/**/*.ts"]);
    });

    it("should not set paths for root rule", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "root.md",
        frontmatter: {
          root: true,
          targets: ["*"],
          globs: ["**/*"],
        },
        body: "# Root Rule",
      });

      const codebuddyRule = CodebuddyRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(codebuddyRule.getFrontmatter().paths).toBeUndefined();
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert CodebuddyRule to RulesyncRule for root rule", () => {
      const codebuddyRule = new CodebuddyRule({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "CODEBUDDY.md",
        frontmatter: {},
        body: "# Convert Test\n\nThis will be converted.",
        root: true,
      });

      const rulesyncRule = codebuddyRule.toRulesyncRule();

      expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
      expect(rulesyncRule.getRelativeDirPath()).toBe(RULESYNC_RULES_RELATIVE_DIR_PATH);
      expect(rulesyncRule.getRelativeFilePath()).toBe("CODEBUDDY.md");
      expect(rulesyncRule.getBody()).toBe("# Convert Test\n\nThis will be converted.");
      expect(rulesyncRule.getFrontmatter().root).toBe(true);
      expect(rulesyncRule.getFrontmatter().globs).toEqual(["**/*"]);
    });

    it("should convert CodebuddyRule to RulesyncRule for non-root rule with paths", () => {
      const codebuddyRule = new CodebuddyRule({
        outputRoot: testDir,
        relativeDirPath: ".codebuddy/rules",
        relativeFilePath: "typescript.md",
        frontmatter: { paths: ["src/**/*.ts", "tests/**/*.ts"] },
        body: "# TypeScript Convert Test",
        root: false,
      });

      const rulesyncRule = codebuddyRule.toRulesyncRule();

      expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
      expect(rulesyncRule.getRelativeDirPath()).toBe(RULESYNC_RULES_RELATIVE_DIR_PATH);
      expect(rulesyncRule.getRelativeFilePath()).toBe("typescript.md");
      expect(rulesyncRule.getFrontmatter().root).toBe(false);
      expect(rulesyncRule.getFrontmatter().globs).toEqual(["src/**/*.ts", "tests/**/*.ts"]);
      expect(rulesyncRule.getFrontmatter().codebuddy?.paths).toEqual([
        "src/**/*.ts",
        "tests/**/*.ts",
      ]);
    });

    it("should collapse an alwaysApply rule with no explicit paths to the universal glob", () => {
      const codebuddyRule = new CodebuddyRule({
        outputRoot: testDir,
        relativeDirPath: ".codebuddy/rules",
        relativeFilePath: "always.md",
        frontmatter: { alwaysApply: true },
        body: "# Always Apply Rule",
        root: false,
      });

      const rulesyncRule = codebuddyRule.toRulesyncRule();

      expect(rulesyncRule.getFrontmatter().globs).toEqual(["**/*"]);
      expect(rulesyncRule.getFrontmatter().codebuddy?.alwaysApply).toBe(true);
    });

    it("should not include the codebuddy passthrough block when no codebuddy-specific fields are set", () => {
      const codebuddyRule = new CodebuddyRule({
        outputRoot: testDir,
        relativeDirPath: ".codebuddy/rules",
        relativeFilePath: "plain.md",
        frontmatter: {},
        body: "# Plain Rule",
        root: false,
      });

      const rulesyncRule = codebuddyRule.toRulesyncRule();

      expect(rulesyncRule.getFrontmatter().codebuddy).toBeUndefined();
    });
  });

  describe("validate", () => {
    it("should always return success for valid frontmatter", () => {
      const codebuddyRule = new CodebuddyRule({
        relativeDirPath: ".",
        relativeFilePath: "CODEBUDDY.md",
        frontmatter: {},
        body: "# Any content is valid",
      });

      const result = codebuddyRule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return success for valid paths frontmatter", () => {
      const codebuddyRule = new CodebuddyRule({
        relativeDirPath: ".codebuddy/rules",
        relativeFilePath: "test.md",
        frontmatter: { paths: ["src/**/*.ts"] },
        body: "# Test content",
      });

      const result = codebuddyRule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });

  describe("isTargetedByRulesyncRule", () => {
    it("should return true for rules targeting codebuddy", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["codebuddy"],
        },
        body: "Test content",
      });

      expect(CodebuddyRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should return true for rules targeting all tools (*)", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["*"],
        },
        body: "Test content",
      });

      expect(CodebuddyRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should return false for rules targeting a different tool", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["cursor"],
        },
        body: "Test content",
      });

      expect(CodebuddyRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(false);
    });
  });
});
