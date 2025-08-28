import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import matter from "gray-matter";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import type { ToolTargets } from "../types/tool-targets.js";
import { AugmentcodeRule, type AugmentcodeRuleFrontmatter } from "./augmentcode-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("AugmentcodeRule", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("constructor", () => {
    it("should create an instance with valid frontmatter", () => {
      const frontmatter: AugmentcodeRuleFrontmatter = {
        type: "always",
        description: "Test rule",
      };

      const rule = new AugmentcodeRule({
        relativeDirPath: ".augment/rules",
        relativeFilePath: "test-always.md",
        frontmatter,
        body: "This is a test rule",
        fileContent: matter.stringify("This is a test rule", frontmatter),
      });

      expect(rule).toBeInstanceOf(AugmentcodeRule);
      expect(rule.getFrontmatter()).toEqual(frontmatter);
      expect(rule.getBody()).toBe("This is a test rule");
    });

    it("should create an instance with tags", () => {
      const frontmatter: AugmentcodeRuleFrontmatter = {
        type: "auto",
        description: "Test rule with tags",
        tags: ["typescript", "testing"],
      };

      const rule = new AugmentcodeRule({
        relativeDirPath: ".augment/rules",
        relativeFilePath: "test-auto.md",
        frontmatter,
        body: "This is a test rule with tags",
        fileContent: matter.stringify("This is a test rule with tags", frontmatter),
      });

      expect(rule.getFrontmatter().tags).toEqual(["typescript", "testing"]);
    });

    it("should throw error with invalid frontmatter when validation enabled", () => {
      const invalidFrontmatter = {
        type: "invalid-type",
        description: "Test rule",
      } as any;

      expect(() => {
        return new AugmentcodeRule({
          relativeDirPath: ".augment/rules",
          relativeFilePath: "test.md",
          frontmatter: invalidFrontmatter,
          body: "This is a test rule",
          fileContent: "content",
        });
      }).toThrow();
    });

    it("should not throw error with invalid frontmatter when validation disabled", () => {
      const invalidFrontmatter = {
        type: "invalid-type",
        description: "Test rule",
      } as any;

      expect(() => {
        return new AugmentcodeRule({
          relativeDirPath: ".augment/rules",
          relativeFilePath: "test.md",
          frontmatter: invalidFrontmatter,
          body: "This is a test rule",
          fileContent: "content",
          validate: false,
        });
      }).not.toThrow();
    });
  });

  describe("validate", () => {
    it("should return success for valid frontmatter", () => {
      const frontmatter: AugmentcodeRuleFrontmatter = {
        type: "manual",
        description: "Test rule",
      };

      const rule = new AugmentcodeRule({
        relativeDirPath: ".augment/rules",
        relativeFilePath: "test.md",
        frontmatter,
        body: "This is a test rule",
        fileContent: matter.stringify("This is a test rule", frontmatter),
        validate: false,
      });

      const result = rule.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return error for invalid frontmatter", () => {
      const invalidFrontmatter = {
        type: "invalid-type",
        description: "Test rule",
      } as any;

      const rule = new AugmentcodeRule({
        relativeDirPath: ".augment/rules",
        relativeFilePath: "test.md",
        frontmatter: invalidFrontmatter,
        body: "This is a test rule",
        fileContent: "content",
        validate: false,
      });

      const result = rule.validate();
      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert AugmentcodeRule to RulesyncRule", () => {
      const frontmatter: AugmentcodeRuleFrontmatter = {
        type: "always",
        description: "Test rule for Rulesync conversion",
        tags: ["typescript", "testing"],
      };

      const rule = new AugmentcodeRule({
        relativeDirPath: ".augment/rules",
        relativeFilePath: "test-always.md",
        frontmatter,
        body: "This is a test rule",
        fileContent: matter.stringify("This is a test rule", frontmatter),
      });

      const rulesyncRule = rule.toRulesyncRule();

      expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
      expect(rulesyncRule.getFrontmatter().targets).toEqual(["augmentcode"]);
      expect(rulesyncRule.getFrontmatter().description).toBe("Test rule for Rulesync conversion");
      expect(rulesyncRule.getFrontmatter().tags).toEqual(["typescript", "testing"]);
      expect(rulesyncRule.getBody()).toBe("This is a test rule");
    });

    it("should convert AugmentcodeRule without tags to RulesyncRule", () => {
      const frontmatter: AugmentcodeRuleFrontmatter = {
        type: "manual",
        description: "Test rule without tags",
      };

      const rule = new AugmentcodeRule({
        relativeDirPath: ".augment/rules",
        relativeFilePath: "test-manual.md",
        frontmatter,
        body: "This is a test rule without tags",
        fileContent: matter.stringify("This is a test rule without tags", frontmatter),
      });

      const rulesyncRule = rule.toRulesyncRule();

      expect(rulesyncRule.getFrontmatter().tags).toBeUndefined();
    });
  });

  describe("fromRulesyncRule", () => {
    it("should convert RulesyncRule to AugmentcodeRule", () => {
      const rulesyncFrontmatter = {
        targets: ["augmentcode"] satisfies ToolTargets,
        root: false,
        description: "Test rule from Rulesync",
        globs: [],
        tags: ["typescript"],
      };

      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "test.md",
        frontmatter: rulesyncFrontmatter,
        body: "This is a test rule from Rulesync",
        fileContent: matter.stringify("This is a test rule from Rulesync", rulesyncFrontmatter),
      });

      const augmentcodeRule = AugmentcodeRule.fromRulesyncRule({
        rulesyncRule,
        relativeDirPath: ".augment/rules",
      });

      expect(augmentcodeRule).toBeInstanceOf(AugmentcodeRule);
      expect(augmentcodeRule.getFrontmatter().description).toBe("Test rule from Rulesync");
      expect(augmentcodeRule.getFrontmatter().tags).toEqual(["typescript"]);
      expect(augmentcodeRule.getBody()).toBe("This is a test rule from Rulesync");
    });

    it("should determine 'always' type for root rules", () => {
      const rulesyncFrontmatter = {
        targets: ["augmentcode"] satisfies ToolTargets,
        root: true,
        description: "Root rule",
        globs: [],
      };

      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "root.md",
        frontmatter: rulesyncFrontmatter,
        body: "This is a root rule",
        fileContent: matter.stringify("This is a root rule", rulesyncFrontmatter),
      });

      const augmentcodeRule = AugmentcodeRule.fromRulesyncRule({
        rulesyncRule,
        relativeDirPath: ".augment/rules",
      });

      expect(augmentcodeRule.getFrontmatter().type).toBe("always");
      expect(augmentcodeRule.getRelativeFilePath()).toBe("root-always.md");
    });

    it("should determine 'auto' type for rules with auto keywords", () => {
      const rulesyncFrontmatter = {
        targets: ["augmentcode"] satisfies ToolTargets,
        root: false,
        description: "Auto rule",
        globs: [],
      };

      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "auto.md",
        frontmatter: rulesyncFrontmatter,
        body: "This rule should be automatically applied",
        fileContent: matter.stringify(
          "This rule should be automatically applied",
          rulesyncFrontmatter,
        ),
      });

      const augmentcodeRule = AugmentcodeRule.fromRulesyncRule({
        rulesyncRule,
        relativeDirPath: ".augment/rules",
      });

      expect(augmentcodeRule.getFrontmatter().type).toBe("auto");
      expect(augmentcodeRule.getRelativeFilePath()).toBe("auto-auto.md");
    });

    it("should determine 'manual' type as default", () => {
      const rulesyncFrontmatter = {
        targets: ["augmentcode"] satisfies ToolTargets,
        root: false,
        description: "Manual rule",
        globs: [],
      };

      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "manual.md",
        frontmatter: rulesyncFrontmatter,
        body: "This is a manual rule",
        fileContent: matter.stringify("This is a manual rule", rulesyncFrontmatter),
      });

      const augmentcodeRule = AugmentcodeRule.fromRulesyncRule({
        rulesyncRule,
        relativeDirPath: ".augment/rules",
      });

      expect(augmentcodeRule.getFrontmatter().type).toBe("manual");
      expect(augmentcodeRule.getRelativeFilePath()).toBe("manual-manual.md");
    });
  });

  describe("fromFilePath", () => {
    it("should create AugmentcodeRule from file path", async () => {
      const frontmatter: AugmentcodeRuleFrontmatter = {
        type: "auto",
        description: "Test rule from file",
        tags: ["testing"],
      };

      const body = "This is a test rule loaded from file";
      const fileContent = matter.stringify(body, frontmatter);
      const filePath = join(testDir, "test-rule.md");

      await writeFile(filePath, fileContent, "utf-8");

      const rule = await AugmentcodeRule.fromFilePath({
        filePath,
        relativeDirPath: ".augment/rules",
        relativeFilePath: "test-rule.md",
      });

      expect(rule).toBeInstanceOf(AugmentcodeRule);
      expect(rule.getFrontmatter()).toEqual(frontmatter);
      expect(rule.getBody()).toBe(body);
    });

    it("should throw error for invalid frontmatter in file", async () => {
      const invalidFrontmatter = {
        type: "invalid-type",
        description: "Test rule",
      };

      const body = "This is a test rule with invalid frontmatter";
      const fileContent = matter.stringify(body, invalidFrontmatter);
      const filePath = join(testDir, "invalid-rule.md");

      await writeFile(filePath, fileContent, "utf-8");

      await expect(
        AugmentcodeRule.fromFilePath({
          filePath,
          relativeDirPath: ".augment/rules",
          relativeFilePath: "invalid-rule.md",
        }),
      ).rejects.toThrow();
    });

    it("should handle file with no frontmatter", async () => {
      const body = "This is a test rule without frontmatter";
      const filePath = join(testDir, "no-frontmatter.md");

      await writeFile(filePath, body, "utf-8");

      await expect(
        AugmentcodeRule.fromFilePath({
          filePath,
          relativeDirPath: ".augment/rules",
          relativeFilePath: "no-frontmatter.md",
        }),
      ).rejects.toThrow();
    });

    it("should handle empty description", async () => {
      const frontmatter: AugmentcodeRuleFrontmatter = {
        type: "manual",
        description: "",
      };

      const body = "This is a test rule with empty description";
      const fileContent = matter.stringify(body, frontmatter);
      const filePath = join(testDir, "empty-description.md");

      await writeFile(filePath, fileContent, "utf-8");

      const rule = await AugmentcodeRule.fromFilePath({
        filePath,
        relativeDirPath: ".augment/rules",
        relativeFilePath: "empty-description.md",
      });

      expect(rule.getFrontmatter().description).toBe("");
    });
  });

  describe("type determination logic", () => {
    it("should detect auto type from tags", () => {
      const rulesyncFrontmatter = {
        targets: ["augmentcode"] satisfies ToolTargets,
        root: false,
        description: "Rule with auto tag",
        globs: [],
        tags: ["auto-apply", "typescript"],
      };

      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "tagged-auto.md",
        frontmatter: rulesyncFrontmatter,
        body: "This is a rule with auto tag",
        fileContent: matter.stringify("This is a rule with auto tag", rulesyncFrontmatter),
      });

      const augmentcodeRule = AugmentcodeRule.fromRulesyncRule({
        rulesyncRule,
        relativeDirPath: ".augment/rules",
      });

      expect(augmentcodeRule.getFrontmatter().type).toBe("auto");
    });

    it("should detect always type from description", () => {
      const rulesyncFrontmatter = {
        targets: ["augmentcode"] satisfies ToolTargets,
        root: false,
        description: "Always apply this rule",
        globs: [],
      };

      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "always-desc.md",
        frontmatter: rulesyncFrontmatter,
        body: "This rule should always be applied",
        fileContent: matter.stringify("This rule should always be applied", rulesyncFrontmatter),
      });

      const augmentcodeRule = AugmentcodeRule.fromRulesyncRule({
        rulesyncRule,
        relativeDirPath: ".augment/rules",
      });

      expect(augmentcodeRule.getFrontmatter().type).toBe("always");
    });

    it("should detect auto type from body content", () => {
      const rulesyncFrontmatter = {
        targets: ["augmentcode"] satisfies ToolTargets,
        root: false,
        description: "Rule detection",
        globs: [],
      };

      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "auto-body.md",
        frontmatter: rulesyncFrontmatter,
        body: "This rule should be applied automatically when conditions are met",
        fileContent: matter.stringify(
          "This rule should be applied automatically when conditions are met",
          rulesyncFrontmatter,
        ),
      });

      const augmentcodeRule = AugmentcodeRule.fromRulesyncRule({
        rulesyncRule,
        relativeDirPath: ".augment/rules",
      });

      expect(augmentcodeRule.getFrontmatter().type).toBe("auto");
    });
  });

  describe("filename generation", () => {
    it("should generate correct filenames with type suffixes", () => {
      const testCases = [
        { type: "always", expected: "test-always.md" },
        { type: "manual", expected: "test-manual.md" },
        { type: "auto", expected: "test-auto.md" },
      ] as const;

      testCases.forEach(({ type, expected }) => {
        const rulesyncFrontmatter = {
          targets: ["augmentcode"] satisfies ToolTargets,
          root: type === "always",
          description: `Test ${type} rule`,
          globs: [],
        };

        const rulesyncRule = new RulesyncRule({
          relativeDirPath: ".rulesync/rules",
          relativeFilePath: "test.md",
          frontmatter: rulesyncFrontmatter,
          body: `This is a ${type} rule`,
          fileContent: matter.stringify(`This is a ${type} rule`, rulesyncFrontmatter),
        });

        const augmentcodeRule = AugmentcodeRule.fromRulesyncRule({
          rulesyncRule,
          relativeDirPath: ".augment/rules",
        });

        expect(augmentcodeRule.getRelativeFilePath()).toBe(expected);
      });
    });

    it("should handle filenames that already have extensions", () => {
      const rulesyncFrontmatter = {
        targets: ["augmentcode"] satisfies ToolTargets,
        root: false,
        description: "Test rule",
        globs: [],
      };

      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "complex-name.rule.md",
        frontmatter: rulesyncFrontmatter,
        body: "This is a complex filename",
        fileContent: matter.stringify("This is a complex filename", rulesyncFrontmatter),
      });

      const augmentcodeRule = AugmentcodeRule.fromRulesyncRule({
        rulesyncRule,
        relativeDirPath: ".augment/rules",
      });

      expect(augmentcodeRule.getRelativeFilePath()).toBe("complex-name.rule-manual.md");
    });
  });
});
