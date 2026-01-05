import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RULESYNC_RULES_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { GooseRule } from "./goose-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("GooseRule", () => {
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
      const gooseRule = new GooseRule({
        relativeDirPath: ".",
        relativeFilePath: ".goosehints",
        fileContent: "Use TypeScript.",
      });

      expect(gooseRule).toBeInstanceOf(GooseRule);
      expect(gooseRule.getRelativeDirPath()).toBe(".");
      expect(gooseRule.getRelativeFilePath()).toBe(".goosehints");
      expect(gooseRule.getFileContent()).toBe("Use TypeScript.");
    });

    it("should create instance with custom baseDir", () => {
      const gooseRule = new GooseRule({
        baseDir: "/custom/path",
        relativeDirPath: ".",
        relativeFilePath: ".goosehints",
        fileContent: "Custom content",
      });

      expect(gooseRule.getFilePath()).toBe("/custom/path/.goosehints");
    });

    it("should create instance with validation enabled", () => {
      const gooseRule = new GooseRule({
        relativeDirPath: ".",
        relativeFilePath: ".goosehints",
        fileContent: "Validated content",
        validate: true,
      });

      expect(gooseRule).toBeInstanceOf(GooseRule);
    });

    it("should create instance with validation disabled", () => {
      const gooseRule = new GooseRule({
        relativeDirPath: ".",
        relativeFilePath: ".goosehints",
        fileContent: "Unvalidated content",
        validate: false,
      });

      expect(gooseRule).toBeInstanceOf(GooseRule);
    });

    it("should create instance with root flag", () => {
      const gooseRule = new GooseRule({
        relativeDirPath: ".",
        relativeFilePath: ".goosehints",
        fileContent: "Root content",
        root: true,
      });

      expect(gooseRule.isRoot()).toBe(true);
    });

    it("should create instance for nested directory", () => {
      const gooseRule = new GooseRule({
        relativeDirPath: join("frontend", "src"),
        relativeFilePath: ".goosehints",
        fileContent: "Nested content",
        root: false,
      });

      expect(gooseRule.getRelativeDirPath()).toBe(join("frontend", "src"));
      expect(gooseRule.isRoot()).toBe(false);
    });
  });

  describe("validate", () => {
    it("should always return successful validation", () => {
      const gooseRule = new GooseRule({
        relativeDirPath: ".",
        relativeFilePath: ".goosehints",
        fileContent: "Validation test",
      });

      const result = gooseRule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return successful validation even with empty content", () => {
      const gooseRule = new GooseRule({
        relativeDirPath: ".",
        relativeFilePath: ".goosehints",
        fileContent: "",
      });

      const result = gooseRule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return successful validation with complex content", () => {
      const complexContent = `# Complex goose hints

## Section 1

Some content here with various formatting.

## Section 2

- Item 1
- Item 2
- Item 3

\`\`\`javascript
console.log("Code example");
\`\`\`
`;

      const gooseRule = new GooseRule({
        relativeDirPath: ".",
        relativeFilePath: ".goosehints",
        fileContent: complexContent,
      });

      const result = gooseRule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });

  describe("fromFile", () => {
    it("should load root file from project root", async () => {
      const testContent = "Root goose hints";
      await writeFileContent(join(testDir, ".goosehints"), testContent);

      const gooseRule = await GooseRule.fromFile({
        baseDir: testDir,
        relativeFilePath: ".goosehints",
      });

      expect(gooseRule.getRelativeDirPath()).toBe(".");
      expect(gooseRule.getRelativeFilePath()).toBe(".goosehints");
      expect(gooseRule.getFileContent()).toBe(testContent);
      expect(gooseRule.isRoot()).toBe(true);
    });

    it("should create GooseRule from file with custom baseDir", async () => {
      const customBaseDir = join(testDir, "custom");
      await ensureDir(customBaseDir);
      const testContent = "Custom base file test";
      await writeFileContent(join(customBaseDir, ".goosehints"), testContent);

      const gooseRule = await GooseRule.fromFile({
        baseDir: customBaseDir,
        relativeFilePath: ".goosehints",
      });

      expect(gooseRule.getFilePath()).toBe(join(customBaseDir, ".goosehints"));
      expect(gooseRule.getFileContent()).toBe(testContent);
    });

    it("should create GooseRule from file with validation enabled", async () => {
      const testContent = "Validated file test";
      await writeFileContent(join(testDir, ".goosehints"), testContent);

      const gooseRule = await GooseRule.fromFile({
        baseDir: testDir,
        relativeFilePath: ".goosehints",
        validate: true,
      });

      expect(gooseRule).toBeInstanceOf(GooseRule);
      expect(gooseRule.getFileContent()).toBe(testContent);
    });

    it("should create GooseRule from file with validation disabled", async () => {
      const testContent = "Unvalidated file test";
      await writeFileContent(join(testDir, ".goosehints"), testContent);

      const gooseRule = await GooseRule.fromFile({
        baseDir: testDir,
        relativeFilePath: ".goosehints",
        validate: false,
      });

      expect(gooseRule).toBeInstanceOf(GooseRule);
      expect(gooseRule.getFileContent()).toBe(testContent);
    });

    it("should load file from nested directory", async () => {
      const nestedDir = join(testDir, "frontend", "src");
      await ensureDir(nestedDir);
      const testContent = "Nested directory hints";
      await writeFileContent(join(nestedDir, ".goosehints"), testContent);

      const gooseRule = await GooseRule.fromFile({
        baseDir: testDir,
        relativeFilePath: join("frontend", "src", ".goosehints"),
      });

      expect(gooseRule.getRelativeDirPath()).toBe(join("frontend", "src"));
      expect(gooseRule.getRelativeFilePath()).toBe(".goosehints");
      expect(gooseRule.getFileContent()).toBe(testContent);
      expect(gooseRule.isRoot()).toBe(false);
    });

    it("should handle deeply nested directory structure", async () => {
      const deepNestedDir = join(testDir, "packages", "core", "lib");
      await ensureDir(deepNestedDir);
      const testContent = "Deep nested hints";
      await writeFileContent(join(deepNestedDir, ".goosehints"), testContent);

      const gooseRule = await GooseRule.fromFile({
        baseDir: testDir,
        relativeFilePath: join("packages", "core", "lib", ".goosehints"),
      });

      expect(gooseRule.getRelativeDirPath()).toBe(join("packages", "core", "lib"));
      expect(gooseRule.getFileContent()).toBe(testContent);
    });
  });

  describe("fromFile with global flag", () => {
    it("should load file from .config/goose when global=true", async () => {
      const globalDir = join(testDir, ".config", "goose");
      await ensureDir(globalDir);
      const testContent = "Global goose hints";
      await writeFileContent(join(globalDir, ".goosehints"), testContent);

      const gooseRule = await GooseRule.fromFile({
        baseDir: testDir,
        relativeFilePath: ".goosehints",
        global: true,
      });

      expect(gooseRule.getRelativeDirPath()).toBe(join(".config", "goose"));
      expect(gooseRule.getRelativeFilePath()).toBe(".goosehints");
      expect(gooseRule.getFileContent()).toBe(testContent);
      expect(gooseRule.getFilePath()).toBe(join(testDir, ".config", "goose", ".goosehints"));
    });

    it("should use global paths when global=true", async () => {
      const globalDir = join(testDir, ".config", "goose");
      await ensureDir(globalDir);
      const testContent = "Global mode test";
      await writeFileContent(join(globalDir, ".goosehints"), testContent);

      const gooseRule = await GooseRule.fromFile({
        baseDir: testDir,
        relativeFilePath: ".goosehints",
        global: true,
      });

      const globalPaths = GooseRule.getSettablePaths({ global: true });
      expect(gooseRule.getRelativeDirPath()).toBe(globalPaths.nonRoot.relativeDirPath);
    });

    it("should use regular paths when global=false", async () => {
      const testContent = "Non-global mode test";
      await writeFileContent(join(testDir, ".goosehints"), testContent);

      const gooseRule = await GooseRule.fromFile({
        baseDir: testDir,
        relativeFilePath: ".goosehints",
        global: false,
      });

      expect(gooseRule.getRelativeDirPath()).toBe(".");
      expect(gooseRule.getRelativeFilePath()).toBe(".goosehints");
    });

    it("should not be root when global=true", async () => {
      const globalDir = join(testDir, ".config", "goose");
      await ensureDir(globalDir);
      const testContent = "Global non-root test";
      await writeFileContent(join(globalDir, ".goosehints"), testContent);

      const gooseRule = await GooseRule.fromFile({
        baseDir: testDir,
        relativeFilePath: ".goosehints",
        global: true,
      });

      expect(gooseRule.isRoot()).toBe(false);
    });
  });

  describe("fromRulesyncRule", () => {
    it("should create GooseRule from RulesyncRule with root=true", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "goosehints.md",
        frontmatter: {
          root: true,
          targets: ["goose"],
        },
        body: "Use TypeScript.",
      });

      const gooseRule = GooseRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule,
        validate: true,
      });

      expect(gooseRule.getRelativeDirPath()).toBe(".");
      expect(gooseRule.getRelativeFilePath()).toBe(".goosehints");
      expect(gooseRule.getFileContent()).toBe("Use TypeScript.");
      expect(gooseRule.isRoot()).toBe(true);
    });

    it("should create GooseRule from RulesyncRule with root=false", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: join("frontend", "preferences.md"),
        frontmatter: {
          targets: ["goose"],
        },
        body: "Use Tailwind for UI work.",
      });

      const gooseRule = GooseRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule,
      });

      expect(gooseRule.getRelativeDirPath()).toBe(join("frontend"));
      expect(gooseRule.getRelativeFilePath()).toBe(".goosehints");
      expect(gooseRule.isRoot()).toBe(false);
    });

    it("should create GooseRule from RulesyncRule with custom baseDir", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "goosehints.md",
        frontmatter: {
          root: true,
          targets: ["goose"],
        },
        body: "Custom base content",
      });

      const gooseRule = GooseRule.fromRulesyncRule({
        baseDir: "/custom/base",
        rulesyncRule,
      });

      expect(gooseRule.getFilePath()).toBe("/custom/base/.goosehints");
    });

    it("should create GooseRule from RulesyncRule with validation enabled", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "goosehints.md",
        frontmatter: {
          root: true,
          targets: ["goose"],
        },
        body: "Validated conversion",
      });

      const gooseRule = GooseRule.fromRulesyncRule({
        rulesyncRule,
        validate: true,
      });

      expect(gooseRule).toBeInstanceOf(GooseRule);
    });

    it("should create GooseRule from RulesyncRule with validation disabled", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "goosehints.md",
        frontmatter: {
          root: true,
          targets: ["goose"],
        },
        body: "Unvalidated conversion",
      });

      const gooseRule = GooseRule.fromRulesyncRule({
        rulesyncRule,
        validate: false,
      });

      expect(gooseRule).toBeInstanceOf(GooseRule);
    });

    it("should infer root from directory path when frontmatter.root is not set", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "goosehints.md",
        frontmatter: {
          targets: ["goose"],
        },
        body: "Inferred root",
      });

      const gooseRule = GooseRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(gooseRule.isRoot()).toBe(true);
    });
  });

  describe("fromRulesyncRule with global flag", () => {
    it("should use global paths when global=true", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "goosehints.md",
        frontmatter: {
          root: true,
          targets: ["goose"],
        },
        body: "Global rule content",
      });

      const gooseRule = GooseRule.fromRulesyncRule({
        rulesyncRule,
        global: true,
      });

      expect(gooseRule.getRelativeDirPath()).toBe(join(".config", "goose"));
      expect(gooseRule.getRelativeFilePath()).toBe(".goosehints");
    });

    it("should use regular paths when global=false", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "goosehints.md",
        frontmatter: {
          root: true,
          targets: ["goose"],
        },
        body: "Regular rule content",
      });

      const gooseRule = GooseRule.fromRulesyncRule({
        rulesyncRule,
        global: false,
      });

      expect(gooseRule.getRelativeDirPath()).toBe(".");
      expect(gooseRule.getRelativeFilePath()).toBe(".goosehints");
    });

    it("should not be root when global=true even if frontmatter.root=true", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "goosehints.md",
        frontmatter: {
          root: true,
          targets: ["goose"],
        },
        body: "Global non-root content",
      });

      const gooseRule = GooseRule.fromRulesyncRule({
        rulesyncRule,
        global: true,
      });

      expect(gooseRule.isRoot()).toBe(false);
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert root GooseRule to RulesyncRule", () => {
      const gooseRule = new GooseRule({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".goosehints",
        fileContent: "Root content",
        root: true,
      });

      const rulesyncRule = gooseRule.toRulesyncRule();

      expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
      expect(rulesyncRule.getRelativeDirPath()).toBe(RULESYNC_RULES_RELATIVE_DIR_PATH);
      expect(rulesyncRule.getRelativeFilePath()).toBe("goosehints.md");
      expect(rulesyncRule.getBody()).toBe("Root content");
      expect(rulesyncRule.getFrontmatter().root).toBe(true);
      expect(rulesyncRule.getFrontmatter().targets).toEqual(["*"]);
    });

    it("should convert non-root GooseRule to RulesyncRule", () => {
      const gooseRule = new GooseRule({
        baseDir: testDir,
        relativeDirPath: join("frontend"),
        relativeFilePath: ".goosehints",
        fileContent: "Review PR templates.",
      });

      const rulesyncRule = gooseRule.toRulesyncRule();

      expect(rulesyncRule.getRelativeDirPath()).toBe(RULESYNC_RULES_RELATIVE_DIR_PATH);
      expect(rulesyncRule.getRelativeFilePath()).toBe(join("frontend", "goosehints.md"));
      expect(rulesyncRule.getBody()).toBe("Review PR templates.");
      expect(rulesyncRule.getFrontmatter().root).toBe(false);
    });

    it("should preserve file content in conversion", () => {
      const complexContent = `# Complex Content

This is a test with multiple sections.

- Item 1
- Item 2`;

      const gooseRule = new GooseRule({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".goosehints",
        fileContent: complexContent,
        root: true,
      });

      const rulesyncRule = gooseRule.toRulesyncRule();

      expect(rulesyncRule.getBody()).toBe(complexContent);
    });

    it("should handle deeply nested directory in conversion", () => {
      const gooseRule = new GooseRule({
        baseDir: testDir,
        relativeDirPath: join("packages", "core", "lib"),
        relativeFilePath: ".goosehints",
        fileContent: "Deep nested content",
      });

      const rulesyncRule = gooseRule.toRulesyncRule();

      expect(rulesyncRule.getRelativeFilePath()).toBe(
        join("packages", "core", "lib", "goosehints.md"),
      );
    });
  });

  describe("forDeletion", () => {
    it("should create a non-validated rule for cleanup from root", () => {
      const rule = GooseRule.forDeletion({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".goosehints",
      });

      expect(rule.isDeletable()).toBe(true);
      expect(rule.getFilePath()).toBe(join(testDir, ".goosehints"));
      expect(rule.isRoot()).toBe(true);
    });

    it("should create a non-validated rule for cleanup from nested directory", () => {
      const rule = GooseRule.forDeletion({
        baseDir: testDir,
        relativeDirPath: join("frontend"),
        relativeFilePath: ".goosehints",
      });

      expect(rule.isDeletable()).toBe(true);
      expect(rule.getFilePath()).toBe(join(testDir, "frontend", ".goosehints"));
      expect(rule.isRoot()).toBe(false);
    });

    it("should have empty file content", () => {
      const rule = GooseRule.forDeletion({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".goosehints",
      });

      expect(rule.getFileContent()).toBe("");
    });

    it("should use default baseDir when not specified", () => {
      const rule = GooseRule.forDeletion({
        relativeDirPath: ".",
        relativeFilePath: ".goosehints",
      });

      expect(rule.getFilePath()).toBe(join(testDir, ".goosehints"));
    });
  });

  describe("isTargetedByRulesyncRule", () => {
    it("should return true for rules targeting goose", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["goose"],
        },
        body: "Test content",
      });

      expect(GooseRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
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

      expect(GooseRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should return false for rules not targeting goose", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["cursor", "copilot"],
        },
        body: "Test content",
      });

      expect(GooseRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(false);
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

      expect(GooseRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(false);
    });

    it("should handle mixed targets including goose", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["cursor", "goose", "copilot"],
        },
        body: "Test content",
      });

      expect(GooseRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should handle undefined targets in frontmatter", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {},
        body: "Test content",
      });

      expect(GooseRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });
  });

  describe("getSettablePaths", () => {
    it("should return project paths for project mode", () => {
      const paths = GooseRule.getSettablePaths();

      expect(paths.nonRoot.relativeDirPath).toBe(".");
    });

    it("should return global paths for global mode", () => {
      const paths = GooseRule.getSettablePaths({ global: true });

      expect(paths.nonRoot.relativeDirPath).toBe(join(".config", "goose"));
    });

    it("should return different paths for project and global mode", () => {
      const projectPaths = GooseRule.getSettablePaths();
      const globalPaths = GooseRule.getSettablePaths({ global: true });

      expect(projectPaths.nonRoot.relativeDirPath).not.toBe(globalPaths.nonRoot.relativeDirPath);
    });
  });

  describe("integration with ToolRule base class", () => {
    it("should inherit ToolRule functionality", () => {
      const gooseRule = new GooseRule({
        relativeDirPath: ".",
        relativeFilePath: ".goosehints",
        fileContent: "Integration test",
      });

      expect(typeof gooseRule.getRelativeDirPath).toBe("function");
      expect(typeof gooseRule.getRelativeFilePath).toBe("function");
      expect(typeof gooseRule.getFileContent).toBe("function");
      expect(typeof gooseRule.getFilePath).toBe("function");
    });

    it("should work with ToolRule static methods", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".",
        relativeFilePath: "toolrule-test.md",
        frontmatter: {
          description: "ToolRule test description",
          targets: ["*"],
          root: true,
          globs: [],
        },
        body: "ToolRule test content",
      });

      const gooseRule = GooseRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(gooseRule).toBeInstanceOf(GooseRule);
      expect(gooseRule.getRelativeDirPath()).toBe(".");
    });
  });
});
