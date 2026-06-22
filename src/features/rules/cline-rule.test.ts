import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
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

    it("should create instance with custom outputRoot", () => {
      const clineRule = new ClineRule({
        outputRoot: "/custom/path",
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

  describe("getSettablePaths", () => {
    it("should return the .clinerules non-root directory in project mode", () => {
      const paths = ClineRule.getSettablePaths();

      expect(paths).toEqual({ nonRoot: { relativeDirPath: ".clinerules" } });
    });

    it("should return the cross-tool ~/.agents/AGENTS.md root path in global mode", () => {
      const paths = ClineRule.getSettablePaths({ global: true });

      expect(paths).toEqual({
        root: {
          relativeDirPath: ".agents",
          relativeFilePath: "AGENTS.md",
        },
      });
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
        outputRoot: testDir,
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

    it("should create ClineRule from RulesyncRule with custom outputRoot", () => {
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
        outputRoot: "/custom/base",
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

    it("should emit paths frontmatter for a non-root rule with specific globs", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".",
        relativeFilePath: "coding-guidelines.md",
        frontmatter: {
          description: "Coding guidelines",
          targets: ["*"],
          root: false,
          globs: ["src/**/*.ts"],
        },
        body: "# Coding Guidelines",
      });

      const clineRule = ClineRule.fromRulesyncRule({ rulesyncRule });

      const content = clineRule.getFileContent();
      expect(content).toContain("paths:");
      expect(content).toContain("src/**/*.ts");
      expect(content).toContain("description: Coding guidelines");
      expect(content).not.toContain("alwaysApply");
      expect(content).toContain("# Coding Guidelines");
    });

    it("should keep all globs in paths when universal and specific globs are mixed", () => {
      // A mix of universal and specific globs is not "universal" overall, so the
      // whole list is emitted as conditional paths (matches the qwencode pattern).
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".",
        relativeFilePath: "mixed.md",
        frontmatter: {
          targets: ["*"],
          root: false,
          globs: ["**/*", "src/**/*.ts"],
        },
        body: "# Mixed",
      });

      const clineRule = ClineRule.fromRulesyncRule({ rulesyncRule });

      const content = clineRule.getFileContent();
      expect(content).toContain("paths:");
      expect(content).toContain("src/**/*.ts");
      expect(content).not.toContain("alwaysApply");
    });

    it("should emit alwaysApply for a non-root rule with universal globs", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".",
        relativeFilePath: "conventions.md",
        frontmatter: {
          description: "Conventions",
          targets: ["*"],
          root: false,
          globs: ["**/*"],
        },
        body: "# Conventions",
      });

      const clineRule = ClineRule.fromRulesyncRule({ rulesyncRule });

      const content = clineRule.getFileContent();
      expect(content).toContain("alwaysApply: true");
      expect(content).not.toContain("paths:");
    });

    it("should emit plain Markdown for a non-root rule without globs or description", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".",
        relativeFilePath: "freeform.md",
        frontmatter: {
          targets: ["*"],
          root: false,
          globs: [],
        },
        body: "# Freeform",
      });

      const clineRule = ClineRule.fromRulesyncRule({ rulesyncRule });

      expect(clineRule.getFileContent()).toBe("# Freeform");
    });

    it("should write a project root rule to AGENTS.md as plain Markdown", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".",
        relativeFilePath: "overview.md",
        frontmatter: {
          root: true,
          targets: ["*"],
          description: "Root rule",
          globs: ["**/*"],
        },
        body: "# Project Root Rule",
      });

      const clineRule = ClineRule.fromRulesyncRule({ rulesyncRule });

      expect(clineRule.isRoot()).toBe(true);
      expect(clineRule.getRelativeDirPath()).toBe(".");
      expect(clineRule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(clineRule.getFileContent()).toBe("# Project Root Rule");
    });

    it("should write a global root AGENTS.md under .agents in global mode", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".",
        relativeFilePath: "overview.md",
        frontmatter: {
          root: true,
          targets: ["*"],
          description: "Global overview",
          globs: ["**/*"],
        },
        body: "# Global Cline Rule",
      });

      const clineRule = ClineRule.fromRulesyncRule({
        outputRoot: "/home/user",
        rulesyncRule,
        global: true,
      });

      expect(clineRule).toBeInstanceOf(ClineRule);
      expect(clineRule.isRoot()).toBe(true);
      expect(clineRule.getRelativeDirPath()).toBe(".agents");
      expect(clineRule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(clineRule.getFilePath()).toBe(join("/home/user", ".agents", "AGENTS.md"));
      expect(clineRule.getFileContent()).toContain("# Global Cline Rule");
    });

    it("should throw for a non-root rule in global mode", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".",
        relativeFilePath: "detail.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "Detail rule",
          globs: [],
        },
        body: "# Detail",
      });

      expect(() =>
        ClineRule.fromRulesyncRule({
          rulesyncRule,
          global: true,
        }),
      ).toThrow(/does not support non-root rules in global mode/);
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
        outputRoot: testDir,
        relativeFilePath: "file-test.md",
      });

      expect(clineRule).toBeInstanceOf(ClineRule);
      expect(clineRule.getRelativeDirPath()).toBe(".clinerules");
      expect(clineRule.getRelativeFilePath()).toBe("file-test.md");
      expect(clineRule.getFileContent()).toBe(testFileContent);
      expect(clineRule.getFilePath()).toBe(join(testDir, ".clinerules", "file-test.md"));
    });

    it("should create ClineRule from file with custom outputRoot", async () => {
      const customOutputRoot = join(testDir, "custom");
      const clinerulesDir = join(customOutputRoot, ".clinerules");
      await ensureDir(clinerulesDir);

      const testFileContent = "# Custom Base File Test";
      await writeFileContent(join(clinerulesDir, "custom-base.md"), testFileContent);

      const clineRule = await ClineRule.fromFile({
        outputRoot: customOutputRoot,
        relativeFilePath: "custom-base.md",
      });

      expect(clineRule.getFilePath()).toBe(join(customOutputRoot, ".clinerules", "custom-base.md"));
      expect(clineRule.getFileContent()).toBe(testFileContent);
    });

    it("should create ClineRule from file with validation enabled", async () => {
      const clinerulesDir = join(testDir, ".clinerules");
      await ensureDir(clinerulesDir);

      const testFileContent = "# Validated File Test";
      await writeFileContent(join(clinerulesDir, "validated-file.md"), testFileContent);

      const clineRule = await ClineRule.fromFile({
        outputRoot: testDir,
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
        outputRoot: testDir,
        relativeFilePath: "unvalidated-file.md",
        validate: false,
      });

      expect(clineRule).toBeInstanceOf(ClineRule);
      expect(clineRule.getFileContent()).toBe(testFileContent);
    });

    it("should parse paths/description frontmatter on load", async () => {
      const clinerulesDir = join(testDir, ".clinerules");
      await ensureDir(clinerulesDir);

      const testFileContent = `---
description: This is a rule with frontmatter
paths:
  - "src/**/*.ts"
---

# Rule with Frontmatter

This rule has YAML frontmatter.`;

      await writeFileContent(join(clinerulesDir, "frontmatter-test.md"), testFileContent);

      const clineRule = await ClineRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "frontmatter-test.md",
      });

      expect(clineRule.getFrontmatter()?.description).toBe("This is a rule with frontmatter");
      expect(clineRule.getFrontmatter()?.paths).toEqual(["src/**/*.ts"]);
      expect(clineRule.getBody()).toContain("# Rule with Frontmatter");
      // The body is round-tripped back to globs via paths.
      const rulesyncRule = clineRule.toRulesyncRule();
      expect(rulesyncRule.getFrontmatter().globs).toEqual(["src/**/*.ts"]);
    });

    it("should round-trip a single-string paths value into a globs array", async () => {
      const clinerulesDir = join(testDir, ".clinerules");
      await ensureDir(clinerulesDir);

      const testFileContent = `---
paths: "src/**/*.ts"
---

# Single Path Rule`;
      await writeFileContent(join(clinerulesDir, "single-path.md"), testFileContent);

      const clineRule = await ClineRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "single-path.md",
      });

      expect(clineRule.toRulesyncRule().getFrontmatter().globs).toEqual(["src/**/*.ts"]);
    });

    it("should round-trip alwaysApply: true into universal globs on import", async () => {
      const clinerulesDir = join(testDir, ".clinerules");
      await ensureDir(clinerulesDir);

      const testFileContent = `---
description: Always on
alwaysApply: true
---

# Always Rule`;
      await writeFileContent(join(clinerulesDir, "always.md"), testFileContent);

      const clineRule = await ClineRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "always.md",
      });

      const rulesyncFrontmatter = clineRule.toRulesyncRule().getFrontmatter();
      expect(rulesyncFrontmatter.globs).toEqual(["**/*"]);
      expect(rulesyncFrontmatter.description).toBe("Always on");
    });

    it("should parse a frontmatter-less file as an always-active rule", async () => {
      const clinerulesDir = join(testDir, ".clinerules");
      await ensureDir(clinerulesDir);

      await writeFileContent(join(clinerulesDir, "plain.md"), "# Plain Rule\n\nNo frontmatter.");

      const clineRule = await ClineRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "plain.md",
      });

      expect(clineRule.toRulesyncRule().getFrontmatter().globs).toEqual([]);
    });

    it("should handle nested directory structure", async () => {
      const nestedDir = join(testDir, ".clinerules", "category", "subcategory");
      await ensureDir(nestedDir);

      const testFileContent = "# Nested Rule\n\nThis is in a nested directory.";
      const relativeFilePath = join("category", "subcategory", "nested.md");
      await writeFileContent(join(testDir, ".clinerules", relativeFilePath), testFileContent);

      const clineRule = await ClineRule.fromFile({
        outputRoot: testDir,
        relativeFilePath,
      });

      expect(clineRule.getRelativeFilePath()).toBe(relativeFilePath);
      expect(clineRule.getFileContent()).toBe(testFileContent);
    });
  });

  describe("ClineRuleFrontmatterSchema", () => {
    it("should validate frontmatter with paths, alwaysApply, and description", () => {
      const validFrontmatter = {
        description: "This is a valid description",
        paths: ["src/**/*.ts"],
        alwaysApply: true,
      };

      const result = ClineRuleFrontmatterSchema.safeParse(validFrontmatter);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.description).toBe("This is a valid description");
        expect(result.data.paths).toEqual(["src/**/*.ts"]);
        expect(result.data.alwaysApply).toBe(true);
      }
    });

    it("should accept empty frontmatter (all fields optional)", () => {
      const result = ClineRuleFrontmatterSchema.safeParse({});

      expect(result.success).toBe(true);
    });

    it("should accept paths as a single string", () => {
      const result = ClineRuleFrontmatterSchema.safeParse({ paths: "src/**/*.ts" });

      expect(result.success).toBe(true);
    });

    it("should reject frontmatter with non-string description", () => {
      const result = ClineRuleFrontmatterSchema.safeParse({ description: 123 });

      expect(result.success).toBe(false);
    });

    it("should reject frontmatter with non-boolean alwaysApply", () => {
      const result = ClineRuleFrontmatterSchema.safeParse({ alwaysApply: "yes" });

      expect(result.success).toBe(false);
    });

    it("should preserve additional properties (looseObject)", () => {
      const frontmatterWithExtra = {
        description: "Valid description",
        category: "test",
      };

      const result = ClineRuleFrontmatterSchema.safeParse(frontmatterWithExtra);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.description).toBe("Valid description");
        expect((result.data as Record<string, unknown>).category).toBe("test");
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
        outputRoot: testDir,
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
        outputRoot: testDir,
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
        outputRoot: testDir,
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
        outputRoot: testDir,
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
        outputRoot: testDir,
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
        outputRoot: testDir,
        relativeDirPath: ".agents/memories",
        relativeFilePath: "test.md",
        frontmatter: {},
        body: "Test content",
      });

      expect(ClineRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });
  });
});
