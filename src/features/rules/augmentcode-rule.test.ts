import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RULES_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { AugmentcodeRule, AugmentcodeRuleFrontmatterSchema } from "./augmentcode-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("AugmentcodeRule", () => {
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
    it("should create instance with typed frontmatter", () => {
      const augmentcodeRule = new AugmentcodeRule({
        relativeDirPath: join(".augment", "rules"),
        relativeFilePath: "test-rule.md",
        frontmatter: { type: "always_apply" },
        body: "# Test Rule\n\nThis is a test augment rule.",
      });

      expect(augmentcodeRule).toBeInstanceOf(AugmentcodeRule);
      expect(augmentcodeRule.getRelativeDirPath()).toBe(join(".augment", "rules"));
      expect(augmentcodeRule.getRelativeFilePath()).toBe("test-rule.md");
      expect(augmentcodeRule.getBody()).toBe("# Test Rule\n\nThis is a test augment rule.");
      expect(augmentcodeRule.getFrontmatter()).toEqual({ type: "always_apply" });
      expect(augmentcodeRule.getFileContent().trim()).toBe(`---
type: always_apply
---
# Test Rule

This is a test augment rule.`);
    });

    it("should emit a plain body when frontmatter is empty", () => {
      // Empty frontmatter is used for global/user rules, which Augment forces to
      // always_apply and emits without typed frontmatter.
      const augmentcodeRule = new AugmentcodeRule({
        relativeDirPath: join(".augment", "rules"),
        relativeFilePath: "global-rule.md",
        frontmatter: {},
        body: "# Global Rule",
      });

      expect(augmentcodeRule.getFileContent()).toBe("# Global Rule");
      expect(augmentcodeRule.getFrontmatter()).toEqual({});
    });

    it("should create instance with custom outputRoot", () => {
      const augmentcodeRule = new AugmentcodeRule({
        outputRoot: "/custom/path",
        relativeDirPath: join(".augment", "rules"),
        relativeFilePath: "custom-rule.md",
        frontmatter: { type: "always_apply" },
        body: "# Custom Rule",
      });

      expect(augmentcodeRule.getFilePath()).toBe(
        join("/custom/path", ".augment", "rules", "custom-rule.md"),
      );
    });

    it("should create instance with validation disabled", () => {
      const augmentcodeRule = new AugmentcodeRule({
        relativeDirPath: join(".augment", "rules"),
        relativeFilePath: "unvalidated-rule.md",
        frontmatter: { type: "manual" },
        body: "# Unvalidated Rule",
        validate: false,
      });

      expect(augmentcodeRule).toBeInstanceOf(AugmentcodeRule);
      expect(augmentcodeRule.getBody()).toBe("# Unvalidated Rule");
    });
  });

  describe("fromRulesyncRule", () => {
    it("should default to always_apply type when no augmentcode block is present", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "source-rule.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          globs: [],
        },
        body: "# Source Rule\n\nThis is a source rule.",
      });

      const augmentcodeRule = AugmentcodeRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(augmentcodeRule).toBeInstanceOf(AugmentcodeRule);
      expect(augmentcodeRule.getRelativeDirPath()).toBe(join(".augment", "rules"));
      expect(augmentcodeRule.getRelativeFilePath()).toBe("source-rule.md");
      expect(augmentcodeRule.getBody()).toBe("# Source Rule\n\nThis is a source rule.");
      expect(augmentcodeRule.getFrontmatter().type).toBe("always_apply");
    });

    it("should carry over the augmentcode type and description", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "typed-rule.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          augmentcode: {
            type: "agent_requested",
            description: "Use this when editing API handlers",
          },
        },
        body: "# Typed Rule",
      });

      const augmentcodeRule = AugmentcodeRule.fromRulesyncRule({ rulesyncRule });

      expect(augmentcodeRule.getFrontmatter()).toMatchObject({
        type: "agent_requested",
        description: "Use this when editing API handlers",
      });
      expect(augmentcodeRule.getFileContent()).toContain("type: agent_requested");
      expect(augmentcodeRule.getFileContent()).toContain(
        "description: Use this when editing API handlers",
      );
    });

    it("should prefer the top-level rulesync description over the augmentcode one", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "desc-rule.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "Top-level description",
          augmentcode: {
            type: "agent_requested",
            description: "Augment-specific description",
          },
        },
        body: "# Desc Rule",
      });

      const augmentcodeRule = AugmentcodeRule.fromRulesyncRule({ rulesyncRule });

      expect(augmentcodeRule.getFrontmatter().description).toBe("Top-level description");
    });

    it("should emit a plain body without frontmatter in global mode", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "global-rule.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          augmentcode: { type: "agent_requested", description: "ignored when global" },
        },
        body: "# Global Rule\n\nGlobal body.",
      });

      const augmentcodeRule = AugmentcodeRule.fromRulesyncRule({
        rulesyncRule,
        global: true,
      });

      expect(augmentcodeRule.getFrontmatter()).toEqual({});
      expect(augmentcodeRule.getFileContent()).toBe("# Global Rule\n\nGlobal body.");
    });

    it("should create AugmentcodeRule from RulesyncRule with custom outputRoot", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: "/source/path",
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "source-rule.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          globs: [],
        },
        body: "# Source Rule",
      });

      const augmentcodeRule = AugmentcodeRule.fromRulesyncRule({
        outputRoot: "/target/path",
        rulesyncRule,
      });

      expect(augmentcodeRule.getFilePath()).toBe(
        join("/target/path", ".augment", "rules", "source-rule.md"),
      );
    });
  });

  describe("fromFile", () => {
    it("should create AugmentcodeRule from file with typed frontmatter", async () => {
      const augmentRulesDir = join(testDir, ".augment", "rules");
      await ensureDir(augmentRulesDir);
      const testFilePath = join(augmentRulesDir, "test-rule.md");
      await writeFileContent(
        testFilePath,
        "---\ntype: always_apply\n---\n# Test Rule\n\nThis is a test rule from file.",
      );

      const augmentcodeRule = await AugmentcodeRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "test-rule.md",
      });

      expect(augmentcodeRule).toBeInstanceOf(AugmentcodeRule);
      expect(augmentcodeRule.getRelativeDirPath()).toBe(join(".augment", "rules"));
      expect(augmentcodeRule.getRelativeFilePath()).toBe("test-rule.md");
      expect(augmentcodeRule.getFrontmatter()).toEqual({ type: "always_apply" });
      expect(augmentcodeRule.getBody()).toBe("# Test Rule\n\nThis is a test rule from file.");
    });

    it("should create AugmentcodeRule from file with custom outputRoot", async () => {
      const customOutputRoot = join(testDir, "custom");
      const augmentRulesDir = join(customOutputRoot, ".augment", "rules");
      await ensureDir(augmentRulesDir);
      const testFilePath = join(augmentRulesDir, "custom-rule.md");
      await writeFileContent(testFilePath, "---\ntype: manual\n---\n# Custom Rule");

      const augmentcodeRule = await AugmentcodeRule.fromFile({
        outputRoot: customOutputRoot,
        relativeFilePath: "custom-rule.md",
      });

      expect(augmentcodeRule.getFilePath()).toBe(
        join(customOutputRoot, ".augment", "rules", "custom-rule.md"),
      );
      expect(augmentcodeRule.getBody()).toBe("# Custom Rule");
      expect(augmentcodeRule.getFrontmatter()).toEqual({ type: "manual" });
    });

    it("should handle file content without frontmatter", async () => {
      const augmentRulesDir = join(testDir, ".augment", "rules");
      await ensureDir(augmentRulesDir);
      const testFilePath = join(augmentRulesDir, "no-frontmatter.md");
      await writeFileContent(testFilePath, "# Simple Rule\n\nNo frontmatter here.");

      const augmentcodeRule = await AugmentcodeRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "no-frontmatter.md",
      });

      expect(augmentcodeRule.getBody()).toBe("# Simple Rule\n\nNo frontmatter here.");
      expect(augmentcodeRule.getFrontmatter()).toEqual({});
    });

    it("should trim surrounding whitespace from the body", async () => {
      const augmentRulesDir = join(testDir, ".augment", "rules");
      await ensureDir(augmentRulesDir);
      const testFilePath = join(augmentRulesDir, "whitespace-rule.md");
      await writeFileContent(
        testFilePath,
        "---\ntype: always_apply\n---\n\n# Whitespace Rule\n\nContent with whitespace.\n\n\n",
      );

      const augmentcodeRule = await AugmentcodeRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "whitespace-rule.md",
      });

      expect(augmentcodeRule.getBody()).toBe("# Whitespace Rule\n\nContent with whitespace.");
    });

    it("should throw error when file does not exist", async () => {
      await expect(
        AugmentcodeRule.fromFile({
          outputRoot: testDir,
          relativeFilePath: "nonexistent-rule.md",
        }),
      ).rejects.toThrow();
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert AugmentcodeRule to RulesyncRule preserving the augmentcode block", () => {
      const augmentcodeRule = new AugmentcodeRule({
        outputRoot: testDir,
        relativeDirPath: join(".augment", "rules"),
        relativeFilePath: "test-rule.md",
        frontmatter: { type: "agent_requested", description: "When editing tests" },
        body: "# Test Rule\n\nThis is a test rule.",
      });

      const rulesyncRule = augmentcodeRule.toRulesyncRule();

      expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
      expect(rulesyncRule.getRelativeDirPath()).toBe(RULESYNC_RULES_RELATIVE_DIR_PATH);
      expect(rulesyncRule.getRelativeFilePath()).toBe("test-rule.md");
      expect(rulesyncRule.getBody()).toBe("# Test Rule\n\nThis is a test rule.");
      expect(rulesyncRule.getFrontmatter().root).toBe(false);
      expect(rulesyncRule.getFrontmatter().description).toBe("When editing tests");
      expect(rulesyncRule.getFrontmatter().augmentcode).toMatchObject({
        type: "agent_requested",
        description: "When editing tests",
      });
    });

    it("should round-trip type/description through RulesyncRule", () => {
      const initialRulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "round-trip.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          augmentcode: { type: "manual" },
        },
        body: "# Round Trip\n\nContent",
      });

      const augmentcodeRule = AugmentcodeRule.fromRulesyncRule({
        rulesyncRule: initialRulesyncRule,
      });
      const finalRulesyncRule = augmentcodeRule.toRulesyncRule();

      expect(finalRulesyncRule.getRelativeFilePath()).toBe("round-trip.md");
      expect(finalRulesyncRule.getBody().trim()).toBe("# Round Trip\n\nContent");
      expect(finalRulesyncRule.getFrontmatter().augmentcode?.type).toBe("manual");
    });
  });

  describe("validate", () => {
    it("should return success for valid typed frontmatter", () => {
      const augmentcodeRule = new AugmentcodeRule({
        relativeDirPath: join(".augment", "rules"),
        relativeFilePath: "test-rule.md",
        frontmatter: { type: "always_apply" },
        body: "# Test Rule",
      });

      const validationResult = augmentcodeRule.validate();

      expect(validationResult.success).toBe(true);
      expect(validationResult.error).toBe(null);
    });

    it("should return success for empty frontmatter", () => {
      const augmentcodeRule = new AugmentcodeRule({
        relativeDirPath: join(".augment", "rules"),
        relativeFilePath: "empty-rule.md",
        frontmatter: {},
        body: "",
      });

      const validationResult = augmentcodeRule.validate();

      expect(validationResult.success).toBe(true);
      expect(validationResult.error).toBe(null);
    });
  });

  describe("getSettablePaths", () => {
    it("should return correct paths for nonRoot", () => {
      const paths = AugmentcodeRule.getSettablePaths();

      expect(paths.nonRoot).toEqual({
        relativeDirPath: join(".augment", "rules"),
      });
    });

    it("should have consistent paths structure", () => {
      const paths = AugmentcodeRule.getSettablePaths();

      expect(paths).toHaveProperty("nonRoot");
      expect(paths.nonRoot).toHaveProperty("relativeDirPath");
    });
  });

  describe("isTargetedByRulesyncRule", () => {
    it("should return true for rules targeting augmentcode", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: join(".augment", "rules"),
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["augmentcode"],
        },
        body: "Test content",
      });

      expect(AugmentcodeRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should return true for rules targeting all tools (*)", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: join(".augment", "rules"),
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["*"],
        },
        body: "Test content",
      });

      expect(AugmentcodeRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should return false for rules not targeting augmentcode", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: join(".augment", "rules"),
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["cursor", "copilot"],
        },
        body: "Test content",
      });

      expect(AugmentcodeRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(false);
    });
  });

  describe("AugmentcodeRuleFrontmatterSchema", () => {
    it("should accept typed frontmatter", () => {
      const result = AugmentcodeRuleFrontmatterSchema.safeParse({
        type: "agent_requested",
        description: "desc",
      });

      expect(result.success).toBe(true);
    });

    it("should accept empty frontmatter", () => {
      const result = AugmentcodeRuleFrontmatterSchema.safeParse({});

      expect(result.success).toBe(true);
    });

    it("should preserve unknown fields (loose object)", () => {
      const result = AugmentcodeRuleFrontmatterSchema.safeParse({
        type: "always_apply",
        unknownField: "value",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect((result.data as Record<string, unknown>).unknownField).toBe("value");
      }
    });
  });
});
