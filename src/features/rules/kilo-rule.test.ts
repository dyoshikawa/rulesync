import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RULES_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { KiloRule } from "./kilo-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("KiloRule", () => {
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
      const kiloRule = new KiloRule({
        relativeDirPath: ".kilocode/rules",
        relativeFilePath: "test-rule.md",
        fileContent: "# Test Rule\n\nThis is a test rule.",
      });

      expect(kiloRule).toBeInstanceOf(KiloRule);
      expect(kiloRule.getRelativeDirPath()).toBe(".kilocode/rules");
      expect(kiloRule.getRelativeFilePath()).toBe("test-rule.md");
      expect(kiloRule.getFileContent()).toBe("# Test Rule\n\nThis is a test rule.");
    });

    it("should create instance with custom baseDir", () => {
      const kiloRule = new KiloRule({
        baseDir: "/custom/path",
        relativeDirPath: ".kilocode/rules",
        relativeFilePath: "custom-rule.md",
        fileContent: "# Custom Rule",
      });

      expect(kiloRule.getFilePath()).toBe("/custom/path/.kilocode/rules/custom-rule.md");
    });

    it("should create instance with validation enabled", () => {
      const kiloRule = new KiloRule({
        relativeDirPath: ".kilocode/rules",
        relativeFilePath: "validated-rule.md",
        fileContent: "# Validated Rule\n\nThis is a validated rule.",
        validate: true,
      });

      expect(kiloRule).toBeInstanceOf(KiloRule);
    });

    it("should create instance with validation disabled", () => {
      const kiloRule = new KiloRule({
        relativeDirPath: ".kilocode/rules",
        relativeFilePath: "unvalidated-rule.md",
        fileContent: "# Unvalidated Rule",
        validate: false,
      });

      expect(kiloRule).toBeInstanceOf(KiloRule);
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert KiloRule to RulesyncRule", () => {
      const kiloRule = new KiloRule({
        relativeDirPath: ".kilocode/rules",
        relativeFilePath: "conversion-test.md",
        fileContent: "# Conversion Test\n\nThis rule will be converted.",
      });

      const rulesyncRule = kiloRule.toRulesyncRule();

      expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
      expect(rulesyncRule.getFileContent()).toContain("# Conversion Test");
      expect(rulesyncRule.getFileContent()).toContain("This rule will be converted.");
    });

    it("should preserve file path information in conversion", () => {
      const kiloRule = new KiloRule({
        baseDir: testDir,
        relativeDirPath: ".kilocode/rules",
        relativeFilePath: "path-test.md",
        fileContent: "# Path Test",
      });

      const rulesyncRule = kiloRule.toRulesyncRule();

      expect(rulesyncRule.getRelativeFilePath()).toBe("path-test.md");
    });

    it("should convert back to a RulesyncRule with correct frontmatter", () => {
      const kiloRule = new KiloRule({
        baseDir: testDir,
        relativeDirPath: ".kilocode/rules",
        relativeFilePath: "team.md",
        fileContent: "# Team Rules",
      });

      const rulesyncRule = kiloRule.toRulesyncRule();

      expect(rulesyncRule.getRelativeDirPath()).toBe(RULESYNC_RULES_RELATIVE_DIR_PATH);
      expect(rulesyncRule.getRelativeFilePath()).toBe("team.md");
      expect(rulesyncRule.getBody()).toBe("# Team Rules");
      expect(rulesyncRule.getFrontmatter().targets).toEqual(["*"]);
    });
  });

  describe("fromRulesyncRule", () => {
    it("should create KiloRule from RulesyncRule with default parameters", () => {
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

      const kiloRule = KiloRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(kiloRule).toBeInstanceOf(KiloRule);
      expect(kiloRule.getRelativeDirPath()).toBe(".kilocode/rules");
      expect(kiloRule.getRelativeFilePath()).toBe("source-rule.md");
      expect(kiloRule.getFileContent()).toContain("# Source Rule\n\nThis is from RulesyncRule.");
    });

    it("should create KiloRule from RulesyncRule with custom baseDir", () => {
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

      const kiloRule = KiloRule.fromRulesyncRule({
        baseDir: "/custom/base",
        rulesyncRule,
      });

      expect(kiloRule.getFilePath()).toBe("/custom/base/.kilocode/rules/custom-base-rule.md");
    });

    it("should create KiloRule from RulesyncRule with validation enabled", () => {
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

      const kiloRule = KiloRule.fromRulesyncRule({
        rulesyncRule,
        validate: true,
      });

      expect(kiloRule).toBeInstanceOf(KiloRule);
    });

    it("should create KiloRule from RulesyncRule with validation disabled", () => {
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

      const kiloRule = KiloRule.fromRulesyncRule({
        rulesyncRule,
        validate: false,
      });

      expect(kiloRule).toBeInstanceOf(KiloRule);
    });
  });

  describe("validate", () => {
    it("should always return successful validation", () => {
      const kiloRule = new KiloRule({
        relativeDirPath: ".kilocode/rules",
        relativeFilePath: "validation-test.md",
        fileContent: "# Validation Test",
      });

      const result = kiloRule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return successful validation even with empty content", () => {
      const kiloRule = new KiloRule({
        relativeDirPath: ".kilocode/rules",
        relativeFilePath: "empty.md",
        fileContent: "",
      });

      const result = kiloRule.validate();

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

      const kiloRule = new KiloRule({
        relativeDirPath: ".kilocode/rules",
        relativeFilePath: "complex.md",
        fileContent: complexContent,
      });

      const result = kiloRule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });

  describe("fromFile", () => {
    it("should create KiloRule from file with default parameters", async () => {
      const kilorulesDir = join(testDir, ".kilocode/rules");
      await ensureDir(kilorulesDir);

      const testFileContent = "# File Test\n\nThis is loaded from file.";
      await writeFileContent(join(kilorulesDir, "file-test.md"), testFileContent);

      const kiloRule = await KiloRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "file-test.md",
      });

      expect(kiloRule).toBeInstanceOf(KiloRule);
      expect(kiloRule.getRelativeDirPath()).toBe(".kilocode/rules");
      expect(kiloRule.getRelativeFilePath()).toBe("file-test.md");
      expect(kiloRule.getFileContent()).toBe(testFileContent);
      expect(kiloRule.getFilePath()).toBe(join(testDir, ".kilocode/rules", "file-test.md"));
    });

    it("should create KiloRule from file with custom baseDir", async () => {
      const customBaseDir = join(testDir, "custom");
      const kilorulesDir = join(customBaseDir, ".kilocode/rules");
      await ensureDir(kilorulesDir);

      const testFileContent = "# Custom Base File Test";
      await writeFileContent(join(kilorulesDir, "custom-base.md"), testFileContent);

      const kiloRule = await KiloRule.fromFile({
        baseDir: customBaseDir,
        relativeFilePath: "custom-base.md",
      });

      expect(kiloRule.getFilePath()).toBe(join(customBaseDir, ".kilocode/rules", "custom-base.md"));
      expect(kiloRule.getFileContent()).toBe(testFileContent);
    });

    it("should create KiloRule from file with validation enabled", async () => {
      const kilorulesDir = join(testDir, ".kilocode/rules");
      await ensureDir(kilorulesDir);

      const testFileContent = "# Validated File Test";
      await writeFileContent(join(kilorulesDir, "validated-file.md"), testFileContent);

      const kiloRule = await KiloRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "validated-file.md",
        validate: true,
      });

      expect(kiloRule).toBeInstanceOf(KiloRule);
      expect(kiloRule.getFileContent()).toBe(testFileContent);
    });

    it("should create KiloRule from file with validation disabled", async () => {
      const kilorulesDir = join(testDir, ".kilocode/rules");
      await ensureDir(kilorulesDir);

      const testFileContent = "# Unvalidated File Test";
      await writeFileContent(join(kilorulesDir, "unvalidated-file.md"), testFileContent);

      const kiloRule = await KiloRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "unvalidated-file.md",
        validate: false,
      });

      expect(kiloRule).toBeInstanceOf(KiloRule);
      expect(kiloRule.getFileContent()).toBe(testFileContent);
    });

    it("should load file with frontmatter correctly", async () => {
      const kilorulesDir = join(testDir, ".kilocode/rules");
      await ensureDir(kilorulesDir);

      const testFileContent = `---
description: This is a rule with frontmatter
---

# Rule with Frontmatter

This rule has YAML frontmatter.`;

      await writeFileContent(join(kilorulesDir, "frontmatter-test.md"), testFileContent);

      const kiloRule = await KiloRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "frontmatter-test.md",
      });

      expect(kiloRule.getFileContent()).toBe(testFileContent);
    });

    it("should handle nested directory structure", async () => {
      const nestedDir = join(testDir, ".kilocode/rules", "category", "subcategory");
      await ensureDir(nestedDir);

      const testFileContent = "# Nested Rule\n\nThis is in a nested directory.";
      const relativeFilePath = join("category", "subcategory", "nested.md");
      await writeFileContent(join(testDir, ".kilocode/rules", relativeFilePath), testFileContent);

      const kiloRule = await KiloRule.fromFile({
        baseDir: testDir,
        relativeFilePath,
      });

      expect(kiloRule.getRelativeFilePath()).toBe(relativeFilePath);
      expect(kiloRule.getFileContent()).toBe(testFileContent);
    });
  });

  describe("forDeletion", () => {
    it("should create a non-validated rule for cleanup", () => {
      const rule = KiloRule.forDeletion({
        baseDir: testDir,
        relativeDirPath: ".kilocode/rules",
        relativeFilePath: "obsolete.md",
      });

      expect(rule.isDeletable()).toBe(true);
      expect(rule.getFilePath()).toBe(join(testDir, ".kilocode/rules/obsolete.md"));
    });
  });

  describe("integration with ToolRule base class", () => {
    it("should inherit ToolRule functionality", () => {
      const kiloRule = new KiloRule({
        relativeDirPath: ".kilocode/rules",
        relativeFilePath: "integration-test.md",
        fileContent: "# Integration Test",
      });

      // Test inherited methods
      expect(typeof kiloRule.getRelativeDirPath).toBe("function");
      expect(typeof kiloRule.getRelativeFilePath).toBe("function");
      expect(typeof kiloRule.getFileContent).toBe("function");
      expect(typeof kiloRule.getFilePath).toBe("function");
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

      const kiloRule = KiloRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(kiloRule).toBeInstanceOf(KiloRule);
      expect(kiloRule.getRelativeDirPath()).toBe(".kilocode/rules");
    });
  });

  describe("isTargetedByRulesyncRule", () => {
    it("should return true for rules targeting kilo", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["kilo"],
        },
        body: "Test content",
      });

      expect(KiloRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
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

      expect(KiloRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should return false for rules not targeting kilo", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["cursor", "copilot"],
        },
        body: "Test content",
      });

      expect(KiloRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(false);
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

      expect(KiloRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(false);
    });

    it("should handle mixed targets including kilo", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["cursor", "kilo", "copilot"],
        },
        body: "Test content",
      });

      expect(KiloRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should handle undefined targets in frontmatter", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {},
        body: "Test content",
      });

      expect(KiloRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });
  });

  describe("getSettablePaths", () => {
    it("should return the same paths for both project and global mode", () => {
      const projectPaths = KiloRule.getSettablePaths();
      const globalPaths = KiloRule.getSettablePaths({ global: true });

      expect(projectPaths.nonRoot.relativeDirPath).toBe(".kilocode/rules");
      expect(globalPaths.nonRoot.relativeDirPath).toBe(".kilocode/rules");
    });
  });
});
