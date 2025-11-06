import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../utils/file.js";
import { ClineRule, ClineRuleFrontmatterSchema } from "./cline-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("ClineRule", () => {
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
      const clineRule = new ClineRule({
        relativeDirPath: ".clinerules",
        relativeFilePath: "test-rule.md",
        fileContent: "# Test Rule\n\nThis is a test rule.",
      });

      expect(clineRule).toBeInstanceOf(ClineRule);
      expect(clineRule.getRelativeDirPath()).toBe(".clinerules");
      expect(clineRule.getRelativeFilePath()).toBe("test-rule.md");
      expect(clineRule.getFileContent()).toBe("# Test Rule\n\nThis is a test rule.");
    });

    it("should create instance with custom baseDir", () => {
      const clineRule = new ClineRule({
        baseDir: "/custom/path",
        relativeDirPath: ".clinerules",
        relativeFilePath: "custom-rule.md",
        fileContent: "# Custom Rule",
      });

      expect(clineRule.getFilePath()).toBe("/custom/path/.clinerules/custom-rule.md");
    });

    it("should create instance with validation enabled", () => {
      const clineRule = new ClineRule({
        relativeDirPath: ".clinerules",
        relativeFilePath: "validated-rule.md",
        fileContent: "# Validated Rule\n\nThis is a validated rule.",
        validate: true,
      });

      expect(clineRule).toBeInstanceOf(ClineRule);
    });

    it("should create instance with validation disabled", () => {
      const clineRule = new ClineRule({
        relativeDirPath: ".clinerules",
        relativeFilePath: "unvalidated-rule.md",
        fileContent: "# Unvalidated Rule",
        validate: false,
      });

      expect(clineRule).toBeInstanceOf(ClineRule);
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert ClineRule to RulesyncRule", () => {
      const clineRule = new ClineRule({
        relativeDirPath: ".clinerules",
        relativeFilePath: "conversion-test.md",
        fileContent: "# Conversion Test\n\nThis rule will be converted.",
      });

      const rulesyncRule = clineRule.toRulesyncRule();

      expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
      expect(rulesyncRule.getFileContent()).toContain("# Conversion Test");
      expect(rulesyncRule.getFileContent()).toContain("This rule will be converted.");
    });

    it("should preserve file path information in conversion", () => {
      const clineRule = new ClineRule({
        baseDir: testDir,
        relativeDirPath: ".clinerules",
        relativeFilePath: "path-test.md",
        fileContent: "# Path Test",
      });

      const rulesyncRule = clineRule.toRulesyncRule();

      expect(rulesyncRule.getRelativeFilePath()).toBe("path-test.md");
    });
  });

  describe("fromRulesyncRule", () => {
    it("should create ClineRule from RulesyncRule with default parameters", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".",
        relativeFilePath: "source-rule.md",
        frontmatter: {
          description: "Source rule description",
          targets: ["*"],
          root: false,
          globs: [],
        },
        body: "# Source Rule\n\nThis is from RulesyncRule.",
      });

      const clineRule = ClineRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(clineRule).toBeInstanceOf(ClineRule);
      expect(clineRule.getRelativeDirPath()).toBe(".clinerules");
      expect(clineRule.getRelativeFilePath()).toBe("source-rule.md");
      expect(clineRule.getFileContent()).toContain("# Source Rule\n\nThis is from RulesyncRule.");
    });

    it("should create ClineRule from RulesyncRule with custom baseDir", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".",
        relativeFilePath: "custom-base-rule.md",
        frontmatter: {
          description: "Custom base rule description",
          targets: ["*"],
          root: false,
          globs: [],
        },
        body: "# Custom Base Rule",
      });

      const clineRule = ClineRule.fromRulesyncRule({
        baseDir: "/custom/base",
        rulesyncRule,
      });

      expect(clineRule.getFilePath()).toBe("/custom/base/.clinerules/custom-base-rule.md");
    });

    it("should create ClineRule from RulesyncRule with validation enabled", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".",
        relativeFilePath: "validated-conversion.md",
        frontmatter: {
          description: "Validated conversion description",
          targets: ["*"],
          root: false,
          globs: [],
        },
        body: "# Validated Conversion",
      });

      const clineRule = ClineRule.fromRulesyncRule({
        rulesyncRule,
        validate: true,
      });

      expect(clineRule).toBeInstanceOf(ClineRule);
    });

    it("should create ClineRule from RulesyncRule with validation disabled", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".",
        relativeFilePath: "unvalidated-conversion.md",
        frontmatter: {
          description: "Unvalidated conversion description",
          targets: ["*"],
          root: false,
          globs: [],
        },
        body: "# Unvalidated Conversion",
      });

      const clineRule = ClineRule.fromRulesyncRule({
        rulesyncRule,
        validate: false,
      });

      expect(clineRule).toBeInstanceOf(ClineRule);
    });
  });

  describe("validate", () => {
    it("should always return successful validation", () => {
      const clineRule = new ClineRule({
        relativeDirPath: ".clinerules",
        relativeFilePath: "validation-test.md",
        fileContent: "# Validation Test",
      });

      const result = clineRule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return successful validation even with empty content", () => {
      const clineRule = new ClineRule({
        relativeDirPath: ".clinerules",
        relativeFilePath: "empty.md",
        fileContent: "",
      });

      const result = clineRule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return successful validation with complex content", () => {
      const complexContent = `# Complex Rule

---
description: This is a complex rule with frontmatter
---

## Section 1

Some content here.

## Section 2

- Item 1
- Item 2
- Item 3

\`\`\`javascript
console.log("Code example");
\`\`\`
`;

      const clineRule = new ClineRule({
        relativeDirPath: ".clinerules",
        relativeFilePath: "complex.md",
        fileContent: complexContent,
      });

      const result = clineRule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });

  describe("fromFile", () => {
    it("should create ClineRule from file with default parameters", async () => {
      const clinerulesDir = join(testDir, ".clinerules");
      await ensureDir(clinerulesDir);

      const testFileContent = "# File Test\n\nThis is loaded from file.";
      await writeFileContent(join(clinerulesDir, "file-test.md"), testFileContent);

      const clineRule = await ClineRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "file-test.md",
      });

      expect(clineRule).toBeInstanceOf(ClineRule);
      expect(clineRule.getRelativeDirPath()).toBe(".clinerules");
      expect(clineRule.getRelativeFilePath()).toBe("file-test.md");
      expect(clineRule.getFileContent()).toBe(testFileContent);
      expect(clineRule.getFilePath()).toBe(join(testDir, ".clinerules", "file-test.md"));
    });

    it("should create ClineRule from file with custom baseDir", async () => {
      const customBaseDir = join(testDir, "custom");
      const clinerulesDir = join(customBaseDir, ".clinerules");
      await ensureDir(clinerulesDir);

      const testFileContent = "# Custom Base File Test";
      await writeFileContent(join(clinerulesDir, "custom-base.md"), testFileContent);

      const clineRule = await ClineRule.fromFile({
        baseDir: customBaseDir,
        relativeFilePath: "custom-base.md",
      });

      expect(clineRule.getFilePath()).toBe(join(customBaseDir, ".clinerules", "custom-base.md"));
      expect(clineRule.getFileContent()).toBe(testFileContent);
    });

    it("should create ClineRule from file with validation enabled", async () => {
      const clinerulesDir = join(testDir, ".clinerules");
      await ensureDir(clinerulesDir);

      const testFileContent = "# Validated File Test";
      await writeFileContent(join(clinerulesDir, "validated-file.md"), testFileContent);

      const clineRule = await ClineRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "validated-file.md",
        validate: true,
      });

      expect(clineRule).toBeInstanceOf(ClineRule);
      expect(clineRule.getFileContent()).toBe(testFileContent);
    });

    it("should create ClineRule from file with validation disabled", async () => {
      const clinerulesDir = join(testDir, ".clinerules");
      await ensureDir(clinerulesDir);

      const testFileContent = "# Unvalidated File Test";
      await writeFileContent(join(clinerulesDir, "unvalidated-file.md"), testFileContent);

      const clineRule = await ClineRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "unvalidated-file.md",
        validate: false,
      });

      expect(clineRule).toBeInstanceOf(ClineRule);
      expect(clineRule.getFileContent()).toBe(testFileContent);
    });

    it("should load file with frontmatter correctly", async () => {
      const clinerulesDir = join(testDir, ".clinerules");
      await ensureDir(clinerulesDir);

      const testFileContent = `---
description: This is a rule with frontmatter
---

# Rule with Frontmatter

This rule has YAML frontmatter.`;

      await writeFileContent(join(clinerulesDir, "frontmatter-test.md"), testFileContent);

      const clineRule = await ClineRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "frontmatter-test.md",
      });

      expect(clineRule.getFileContent()).toBe(testFileContent);
    });

    it("should handle nested directory structure", async () => {
      const nestedDir = join(testDir, ".clinerules", "category", "subcategory");
      await ensureDir(nestedDir);

      const testFileContent = "# Nested Rule\n\nThis is in a nested directory.";
      const relativeFilePath = join("category", "subcategory", "nested.md");
      await writeFileContent(join(testDir, ".clinerules", relativeFilePath), testFileContent);

      const clineRule = await ClineRule.fromFile({
        baseDir: testDir,
        relativeFilePath,
      });

      expect(clineRule.getRelativeFilePath()).toBe(relativeFilePath);
      expect(clineRule.getFileContent()).toBe(testFileContent);
    });
  });

  describe("ClineRuleFrontmatterSchema", () => {
    it("should validate valid frontmatter", () => {
      const validFrontmatter = {
        description: "This is a valid description",
      };

      const result = ClineRuleFrontmatterSchema.safeParse(validFrontmatter);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.description).toBe("This is a valid description");
      }
    });

    it("should reject frontmatter without description", () => {
      const invalidFrontmatter = {};

      const result = ClineRuleFrontmatterSchema.safeParse(invalidFrontmatter);

      expect(result.success).toBe(false);
    });

    it("should reject frontmatter with non-string description", () => {
      const invalidFrontmatter = {
        description: 123,
      };

      const result = ClineRuleFrontmatterSchema.safeParse(invalidFrontmatter);

      expect(result.success).toBe(false);
    });

    it("should reject frontmatter with null description", () => {
      const invalidFrontmatter = {
        description: null,
      };

      const result = ClineRuleFrontmatterSchema.safeParse(invalidFrontmatter);

      expect(result.success).toBe(false);
    });

    it("should allow additional properties beyond description", () => {
      const frontmatterWithExtra = {
        description: "Valid description",
        category: "test",
        priority: 1,
      };

      const result = ClineRuleFrontmatterSchema.safeParse(frontmatterWithExtra);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.description).toBe("Valid description");
        // Additional properties are allowed but not included in the parsed result
      }
    });
  });

  describe("integration with ToolRule base class", () => {
    it("should inherit ToolRule functionality", () => {
      const clineRule = new ClineRule({
        relativeDirPath: ".clinerules",
        relativeFilePath: "integration-test.md",
        fileContent: "# Integration Test",
      });

      // Test inherited methods
      expect(typeof clineRule.getRelativeDirPath).toBe("function");
      expect(typeof clineRule.getRelativeFilePath).toBe("function");
      expect(typeof clineRule.getFileContent).toBe("function");
      expect(typeof clineRule.getFilePath).toBe("function");
    });

    it("should work with ToolRule static methods", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".",
        relativeFilePath: "toolrule-test.md",
        frontmatter: {
          description: "ToolRule test description",
          targets: ["*"],
          root: false,
          globs: [],
        },
        body: "# ToolRule Test",
      });

      const clineRule = ClineRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(clineRule).toBeInstanceOf(ClineRule);
      expect(clineRule.getRelativeDirPath()).toBe(".clinerules");
    });
  });

  describe("isTargetedByRulesyncRule", () => {
    it("should return true for rules targeting cline", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".agents/memories",
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["cline"],
        },
        body: "Test content",
      });

      expect(ClineRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should return true for rules targeting all tools (*)", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".agents/memories",
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["*"],
        },
        body: "Test content",
      });

      expect(ClineRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should return false for rules not targeting cline", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".agents/memories",
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["cursor", "copilot"],
        },
        body: "Test content",
      });

      expect(ClineRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(false);
    });

    it("should return false for empty targets", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".agents/memories",
        relativeFilePath: "test.md",
        frontmatter: {
          targets: [],
        },
        body: "Test content",
      });

      expect(ClineRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(false);
    });

    it("should handle mixed targets including cline", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".agents/memories",
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["cursor", "cline", "copilot"],
        },
        body: "Test content",
      });

      expect(ClineRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should handle undefined targets in frontmatter", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".agents/memories",
        relativeFilePath: "test.md",
        frontmatter: {},
        body: "Test content",
      });

      expect(ClineRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });
  });
});
