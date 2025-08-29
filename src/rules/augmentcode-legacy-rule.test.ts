import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import { AiFileFromFilePathParams } from "../types/ai-file.js";
import type { RuleFrontmatter } from "../types/rules.js";
import {
  AugmentcodeLegacyRule,
  AugmentcodeLegacyRuleFrontmatter,
} from "./augmentcode-legacy-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";
import { ToolRuleFromRulesyncRuleParams } from "./tool-rule.js";

describe("AugmentcodeLegacyRule", () => {
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
      const frontmatter: AugmentcodeLegacyRuleFrontmatter = {
        type: "always",
        description: "Test legacy rule",
        tags: ["test", "legacy"],
      };

      const rule = new AugmentcodeLegacyRule({
        baseDir: testDir,
        relativeDirPath: ".augment",
        relativeFilePath: ".augment-guidelines",
        frontmatter,
        body: "# Test Guidelines\n\nTest content for legacy rule.",
        fileContent: "# Test Guidelines\n\nTest content for legacy rule.",
      });

      expect(rule).toBeInstanceOf(AugmentcodeLegacyRule);
      expect(rule.getFrontmatter()).toEqual(frontmatter);
      expect(rule.getBody()).toBe("# Test Guidelines\n\nTest content for legacy rule.");
    });

    it("should create instance with minimal frontmatter", () => {
      const frontmatter: AugmentcodeLegacyRuleFrontmatter = {};

      const rule = new AugmentcodeLegacyRule({
        baseDir: testDir,
        relativeDirPath: ".augment",
        relativeFilePath: ".augment-guidelines",
        frontmatter,
        body: "Simple content",
        fileContent: "Simple content",
      });

      expect(rule.getFrontmatter()).toEqual({});
      expect(rule.getBody()).toBe("Simple content");
    });

    it("should throw error with invalid frontmatter type", () => {
      const frontmatter = {
        type: "invalid" as any,
        description: "Test",
      };

      expect(() => {
        const rule = new AugmentcodeLegacyRule({
          baseDir: testDir,
          relativeDirPath: ".augment",
          relativeFilePath: ".augment-guidelines",
          frontmatter,
          body: "Test content",
          fileContent: "Test content",
        });
        return rule; // Suppress no-new eslint rule
      }).toThrow();
    });

    it("should skip validation when validate is false", () => {
      const frontmatter = {
        type: "invalid" as any,
        description: "Test",
      };

      expect(() => {
        const rule = new AugmentcodeLegacyRule({
          baseDir: testDir,
          relativeDirPath: ".augment",
          relativeFilePath: ".augment-guidelines",
          frontmatter,
          body: "Test content",
          fileContent: "Test content",
          validate: false,
        });
        return rule; // Suppress no-new eslint rule
      }).not.toThrow();
    });
  });

  describe("fromFilePath", () => {
    it("should create instance from file with frontmatter", async () => {
      const rulesDir = join(testDir, ".augment");
      await mkdir(rulesDir, { recursive: true });

      const filePath = join(rulesDir, ".augment-guidelines");
      const fileContent = `---
type: always
description: "Legacy guidelines for the project"
tags: ["legacy", "guidelines"]
---

# Project Guidelines

## Coding Standards
- Use TypeScript
- Follow ESLint rules
- Write tests for all features

## Best Practices
- Keep functions small
- Use meaningful variable names
- Document complex logic`;

      await writeFile(filePath, fileContent, "utf-8");

      const params: AiFileFromFilePathParams = {
        baseDir: testDir,
        relativeDirPath: ".augment",
        relativeFilePath: ".augment-guidelines",
        filePath,
      };

      const rule = await AugmentcodeLegacyRule.fromFilePath(params);

      expect(rule).toBeInstanceOf(AugmentcodeLegacyRule);
      expect(rule.getFrontmatter().type).toBe("always");
      expect(rule.getFrontmatter().description).toBe("Legacy guidelines for the project");
      expect(rule.getFrontmatter().tags).toEqual(["legacy", "guidelines"]);
      expect(rule.getBody()).toContain("# Project Guidelines");
      expect(rule.getBody()).toContain("## Coding Standards");
    });

    it("should create instance from file without frontmatter", async () => {
      const rulesDir = join(testDir, ".augment");
      await mkdir(rulesDir, { recursive: true });

      const filePath = join(rulesDir, ".augment-guidelines");
      const fileContent = `# Simple Guidelines

Just some plain markdown content without frontmatter.

## Rules
1. Write clean code
2. Add tests
3. Document everything`;

      await writeFile(filePath, fileContent, "utf-8");

      const params: AiFileFromFilePathParams = {
        baseDir: testDir,
        relativeDirPath: ".augment",
        relativeFilePath: ".augment-guidelines",
        filePath,
      };

      const rule = await AugmentcodeLegacyRule.fromFilePath(params);

      expect(rule).toBeInstanceOf(AugmentcodeLegacyRule);
      expect(rule.getFrontmatter().type).toBe("always"); // default value
      expect(rule.getFrontmatter().description).toBe(""); // default value
      expect(rule.getFrontmatter().tags).toEqual([]); // default value
      expect(rule.getBody()).toContain("# Simple Guidelines");
      expect(rule.isRoot()).toBe(false);
    });

    it("should detect root file correctly", async () => {
      const rulesDir = join(testDir);
      await mkdir(rulesDir, { recursive: true });

      const filePath = join(rulesDir, ".augment-guidelines");
      const fileContent = `# Root Guidelines

This is a root guidelines file.

## Root Rules
- This should be marked as root`;

      await writeFile(filePath, fileContent, "utf-8");

      const params: AiFileFromFilePathParams = {
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".augment-guidelines",
        filePath,
      };

      const rule = await AugmentcodeLegacyRule.fromFilePath(params);

      expect(rule).toBeInstanceOf(AugmentcodeLegacyRule);
      expect(rule.getFrontmatter().type).toBe("always");
      expect(rule.isRoot()).toBe(true);
      expect(rule.getRelativeDirPath()).toBe(".");
      expect(rule.getRelativeFilePath()).toBe(".augment-guidelines");
    });

    it("should throw error with invalid frontmatter when validate is true", async () => {
      const rulesDir = join(testDir, ".augment");
      await mkdir(rulesDir, { recursive: true });

      const filePath = join(rulesDir, ".augment-guidelines");
      const fileContent = `---
type: invalid
description: "Test"
---

Content`;

      await writeFile(filePath, fileContent, "utf-8");

      const params: AiFileFromFilePathParams = {
        baseDir: testDir,
        relativeDirPath: ".augment",
        relativeFilePath: ".augment-guidelines",
        filePath,
        validate: true,
      };

      await expect(AugmentcodeLegacyRule.fromFilePath(params)).rejects.toThrow(
        "Invalid frontmatter",
      );
    });

    it("should not throw error with invalid frontmatter when validate is false", async () => {
      const rulesDir = join(testDir, ".augment");
      await mkdir(rulesDir, { recursive: true });

      const filePath = join(rulesDir, ".augment-guidelines");
      const fileContent = `---
type: invalid
description: "Test"
---

Content`;

      await writeFile(filePath, fileContent, "utf-8");

      const params: AiFileFromFilePathParams = {
        baseDir: testDir,
        relativeDirPath: ".augment",
        relativeFilePath: ".augment-guidelines",
        filePath,
        validate: false,
      };

      const rule = await AugmentcodeLegacyRule.fromFilePath(params);
      expect(rule).toBeInstanceOf(AugmentcodeLegacyRule);
    });
  });

  describe("fromRulesyncRule", () => {
    it("should create instance from RulesyncRule with root=false", () => {
      const rulesyncFrontmatter: RuleFrontmatter = {
        root: false,
        targets: ["augmentcode"],
        description: "Test rule from rulesync",
        globs: ["**/*.ts"],
        tags: ["test", "conversion"],
      };

      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "test-rule.md",
        frontmatter: rulesyncFrontmatter,
        body: "# Test Rule\n\nThis is a test rule content.",
        fileContent: "---\nroot: false\n---\n# Test Rule\n\nThis is a test rule content.",
      });

      const params: ToolRuleFromRulesyncRuleParams = {
        baseDir: testDir,
        relativeDirPath: ".augment",
        rulesyncRule,
      };

      const rule = AugmentcodeLegacyRule.fromRulesyncRule(params) as AugmentcodeLegacyRule;

      expect(rule).toBeInstanceOf(AugmentcodeLegacyRule);
      expect(rule.getFrontmatter().type).toBe("always");
      expect(rule.getFrontmatter().description).toBe("Test rule from rulesync");
      expect(rule.getFrontmatter().tags).toEqual(["test", "conversion"]);
      expect(rule.getBody()).toBe("# Test Rule\n\nThis is a test rule content.");
      expect(rule.getRelativeDirPath()).toBe(".augment/rules");
      expect(rule.isRoot()).toBe(false);
    });

    it("should create instance from RulesyncRule with root=true", () => {
      const rulesyncFrontmatter: RuleFrontmatter = {
        root: true,
        targets: ["augmentcode"],
        description: "Root rule from rulesync",
        globs: [],
      };

      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "test-rule.md",
        frontmatter: rulesyncFrontmatter,
        body: "# Root Rule\n\nThis is a root rule content.",
        fileContent: "---\nroot: true\n---\n# Root Rule\n\nThis is a root rule content.",
      });

      const params: ToolRuleFromRulesyncRuleParams = {
        baseDir: testDir,
        relativeDirPath: ".augment",
        rulesyncRule,
      };

      const rule = AugmentcodeLegacyRule.fromRulesyncRule(params) as AugmentcodeLegacyRule;

      expect(rule).toBeInstanceOf(AugmentcodeLegacyRule);
      expect(rule.getFrontmatter().description).toBe("Root rule from rulesync");
      expect(rule.getBody()).toBe("# Root Rule\n\nThis is a root rule content.");
      expect(rule.getRelativeDirPath()).toBe(".");
      expect(rule.getRelativeFilePath()).toBe(".augment-guidelines");
      expect(rule.isRoot()).toBe(true);
    });

    it("should handle RulesyncRule without tags", () => {
      const rulesyncFrontmatter: RuleFrontmatter = {
        root: false,
        targets: ["augmentcode"],
        description: "Rule without tags",
        globs: [],
      };

      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "test-rule.md",
        frontmatter: rulesyncFrontmatter,
        body: "Simple content",
        fileContent: "---\nroot: false\n---\nSimple content",
      });

      const params: ToolRuleFromRulesyncRuleParams = {
        baseDir: testDir,
        relativeDirPath: ".augment",
        rulesyncRule,
      };

      const rule = AugmentcodeLegacyRule.fromRulesyncRule(params) as AugmentcodeLegacyRule;

      expect(rule.getFrontmatter().tags).toBeUndefined();
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert to RulesyncRule", () => {
      const frontmatter: AugmentcodeLegacyRuleFrontmatter = {
        type: "manual",
        description: "Manual test rule",
        tags: ["manual", "test"],
      };

      const rule = new AugmentcodeLegacyRule({
        baseDir: testDir,
        relativeDirPath: ".augment",
        relativeFilePath: ".augment-guidelines",
        frontmatter,
        body: "# Manual Rule\n\nThis rule requires manual activation.",
        fileContent: "# Manual Rule\n\nThis rule requires manual activation.",
      });

      const rulesyncRule = rule.toRulesyncRule();

      expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
      expect(rulesyncRule.getFrontmatter().targets).toEqual(["augmentcode"]);
      expect(rulesyncRule.getFrontmatter().description).toBe("Manual test rule");
      expect(rulesyncRule.getFrontmatter().tags).toEqual(["manual", "test"]);
      expect(rulesyncRule.getBody()).toBe("# Manual Rule\n\nThis rule requires manual activation.");
    });

    it("should handle conversion without tags", () => {
      const frontmatter: AugmentcodeLegacyRuleFrontmatter = {
        type: "auto",
        description: "Auto rule without tags",
      };

      const rule = new AugmentcodeLegacyRule({
        baseDir: testDir,
        relativeDirPath: ".augment",
        relativeFilePath: ".augment-guidelines",
        frontmatter,
        body: "Auto content",
        fileContent: "Auto content",
      });

      const rulesyncRule = rule.toRulesyncRule();

      expect(rulesyncRule.getFrontmatter().tags).toBeUndefined();
    });
  });

  describe("validate", () => {
    it("should validate successfully with valid frontmatter", () => {
      const frontmatter: AugmentcodeLegacyRuleFrontmatter = {
        type: "always",
        description: "Valid rule",
        tags: ["valid"],
      };

      const rule = new AugmentcodeLegacyRule({
        baseDir: testDir,
        relativeDirPath: ".augment",
        relativeFilePath: ".augment-guidelines",
        frontmatter,
        body: "Valid content",
        fileContent: "Valid content",
        validate: false, // Skip validation in constructor to test validate method
      });

      const result = rule.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });

    it("should fail validation with invalid frontmatter", () => {
      const frontmatter = {
        type: "invalid" as any,
        description: "Invalid rule",
      };

      const rule = new AugmentcodeLegacyRule({
        baseDir: testDir,
        relativeDirPath: ".augment",
        relativeFilePath: ".augment-guidelines",
        frontmatter,
        body: "Invalid content",
        fileContent: "Invalid content",
        validate: false, // Skip validation in constructor
      });

      const result = rule.validate();
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it("should validate successfully with empty frontmatter", () => {
      const rule = new AugmentcodeLegacyRule({
        baseDir: testDir,
        relativeDirPath: ".augment",
        relativeFilePath: ".augment-guidelines",
        frontmatter: {},
        body: "Empty frontmatter content",
        fileContent: "Empty frontmatter content",
        validate: false, // Skip validation in constructor
      });

      const result = rule.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });
  });

  describe("roundtrip conversion", () => {
    it("should maintain data through RulesyncRule conversion", () => {
      const originalFrontmatter: AugmentcodeLegacyRuleFrontmatter = {
        type: "auto",
        description: "Roundtrip test rule",
        tags: ["roundtrip", "conversion", "test"],
      };

      const originalBody =
        "# Roundtrip Test\n\nThis content should be preserved through conversion.";

      const originalRule = new AugmentcodeLegacyRule({
        baseDir: testDir,
        relativeDirPath: ".augment",
        relativeFilePath: ".augment-guidelines",
        frontmatter: originalFrontmatter,
        body: originalBody,
        fileContent: originalBody,
      });

      // Convert to RulesyncRule
      const rulesyncRule = originalRule.toRulesyncRule();

      // Convert back to AugmentcodeLegacyRule
      const convertedRule = AugmentcodeLegacyRule.fromRulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".augment",
        rulesyncRule,
      }) as AugmentcodeLegacyRule;

      // Check that data is preserved
      expect(convertedRule.getFrontmatter().description).toBe(originalFrontmatter.description);
      expect(convertedRule.getFrontmatter().tags).toEqual(originalFrontmatter.tags);
      expect(convertedRule.getBody()).toBe(originalBody);
    });

    it("should maintain data through RulesyncRule conversion for root files", () => {
      const originalFrontmatter: AugmentcodeLegacyRuleFrontmatter = {
        type: "auto",
        description: "Root roundtrip test rule",
        tags: ["root", "roundtrip", "test"],
      };

      const originalBody =
        "# Root Roundtrip Test\n\nThis root content should be preserved through conversion.";

      const originalRule = new AugmentcodeLegacyRule({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".augment-guidelines",
        frontmatter: originalFrontmatter,
        body: originalBody,
        fileContent: originalBody,
        root: true,
      });

      expect(originalRule.isRoot()).toBe(true);

      // Convert to RulesyncRule
      const rulesyncRule = originalRule.toRulesyncRule();
      expect(rulesyncRule.getFrontmatter().root).toBe(true);

      // Convert back to AugmentcodeLegacyRule
      const convertedRule = AugmentcodeLegacyRule.fromRulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".",
        rulesyncRule,
      }) as AugmentcodeLegacyRule;

      // Check that data is preserved
      expect(convertedRule.getFrontmatter().description).toBe(originalFrontmatter.description);
      expect(convertedRule.getFrontmatter().tags).toEqual(originalFrontmatter.tags);
      expect(convertedRule.getBody()).toBe(originalBody);
      expect(convertedRule.isRoot()).toBe(true);
      expect(convertedRule.getRelativeFilePath()).toBe(".augment-guidelines");
      expect(convertedRule.getRelativeDirPath()).toBe(".");
    });
  });

  describe("inheritance and interface compliance", () => {
    it("should inherit from ToolRule", () => {
      const rule = new AugmentcodeLegacyRule({
        baseDir: testDir,
        relativeDirPath: ".augment",
        relativeFilePath: ".augment-guidelines",
        frontmatter: { type: "always" },
        body: "Test content",
        fileContent: "Test content",
      });

      expect(rule.getBaseDir()).toBe(testDir);
      expect(rule.getRelativeDirPath()).toBe(".augment");
      expect(rule.getRelativeFilePath()).toBe(".augment-guidelines");
    });

    it("should implement required abstract methods", () => {
      const rule = new AugmentcodeLegacyRule({
        baseDir: testDir,
        relativeDirPath: ".augment",
        relativeFilePath: ".augment-guidelines",
        frontmatter: { type: "always" },
        body: "Test content",
        fileContent: "Test content",
      });

      expect(typeof rule.toRulesyncRule).toBe("function");
      expect(typeof rule.validate).toBe("function");
      expect(rule.toRulesyncRule()).toBeInstanceOf(RulesyncRule);
    });
  });

  describe("edge cases", () => {
    it("should handle very long content", () => {
      const longContent = "# Very Long Rule\n\n" + "A".repeat(10000);

      const rule = new AugmentcodeLegacyRule({
        baseDir: testDir,
        relativeDirPath: ".augment",
        relativeFilePath: ".augment-guidelines",
        frontmatter: { type: "always", description: "Long content test" },
        body: longContent,
        fileContent: longContent,
      });

      expect(rule.getBody()).toBe(longContent);
      expect(rule.getBody().length).toBe(longContent.length);
    });

    it("should handle special characters in content", () => {
      const specialContent = "# Special Characters\n\n🚀 emojis and non-ASCII characters";

      const rule = new AugmentcodeLegacyRule({
        baseDir: testDir,
        relativeDirPath: ".augment",
        relativeFilePath: ".augment-guidelines",
        frontmatter: { type: "manual" },
        body: specialContent,
        fileContent: specialContent,
      });

      expect(rule.getBody()).toBe(specialContent);
    });

    it("should handle empty body content", () => {
      const rule = new AugmentcodeLegacyRule({
        baseDir: testDir,
        relativeDirPath: ".augment",
        relativeFilePath: ".augment-guidelines",
        frontmatter: { type: "always", description: "Empty body test" },
        body: "",
        fileContent: "",
      });

      expect(rule.getBody()).toBe("");
      expect(rule.getFrontmatter().description).toBe("Empty body test");
    });
  });
});
