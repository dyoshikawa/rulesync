import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RULESYNC_OVERVIEW_FILE_NAME,
  RULESYNC_RELATIVE_DIR_PATH,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { ClaudecodeRule } from "./claudecode-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("ClaudecodeRule", () => {
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
      const claudecodeRule = new ClaudecodeRule({
        relativeDirPath: ".claude/rules",
        relativeFilePath: "test-rule.md",
        frontmatter: { paths: "src/**/*.ts" },
        body: "# Test Rule\n\nThis is a test rule.",
      });

      expect(claudecodeRule).toBeInstanceOf(ClaudecodeRule);
      expect(claudecodeRule.getRelativeDirPath()).toBe(".claude/rules");
      expect(claudecodeRule.getRelativeFilePath()).toBe("test-rule.md");
      expect(claudecodeRule.getBody()).toBe("# Test Rule\n\nThis is a test rule.");
      expect(claudecodeRule.getFrontmatter()).toEqual({ paths: "src/**/*.ts" });
    });

    it("should create instance with custom baseDir", () => {
      const claudecodeRule = new ClaudecodeRule({
        baseDir: "/custom/path",
        relativeDirPath: ".claude/rules",
        relativeFilePath: "custom-rule.md",
        frontmatter: {},
        body: "# Custom Rule",
      });

      expect(claudecodeRule.getFilePath()).toBe("/custom/path/.claude/rules/custom-rule.md");
    });

    it("should create instance for root .claude/CLAUDE.md file", () => {
      const claudecodeRule = new ClaudecodeRule({
        relativeDirPath: ".claude",
        relativeFilePath: "CLAUDE.md",
        frontmatter: {},
        body: "# Project Overview\n\nThis is the main Claude Code memory.",
        root: true,
      });

      expect(claudecodeRule.getRelativeDirPath()).toBe(".claude");
      expect(claudecodeRule.getRelativeFilePath()).toBe("CLAUDE.md");
      expect(claudecodeRule.getBody()).toBe(
        "# Project Overview\n\nThis is the main Claude Code memory.",
      );
      expect(claudecodeRule.isRoot()).toBe(true);
    });

    it("should include frontmatter in file content for non-root files", () => {
      const claudecodeRule = new ClaudecodeRule({
        relativeDirPath: ".claude/rules",
        relativeFilePath: "api-rules.md",
        frontmatter: { paths: "src/api/**/*.ts" },
        body: "# API Rules",
        root: false,
      });

      const fileContent = claudecodeRule.getFileContent();
      expect(fileContent).toContain("---");
      expect(fileContent).toContain("paths: src/api/**/*.ts");
      expect(fileContent).toContain("# API Rules");
    });

    it("should not include frontmatter in file content for root files", () => {
      const claudecodeRule = new ClaudecodeRule({
        relativeDirPath: ".claude",
        relativeFilePath: "CLAUDE.md",
        frontmatter: {},
        body: "# Root Content",
        root: true,
      });

      const fileContent = claudecodeRule.getFileContent();
      expect(fileContent).toBe("# Root Content");
      expect(fileContent).not.toContain("---");
    });

    it("should validate content by default", () => {
      expect(() => {
        const _instance = new ClaudecodeRule({
          relativeDirPath: ".claude/rules",
          relativeFilePath: "test.md",
          frontmatter: {},
          body: "",
        });
      }).not.toThrow();
    });

    it("should skip validation when requested", () => {
      expect(() => {
        const _instance = new ClaudecodeRule({
          relativeDirPath: ".claude/rules",
          relativeFilePath: "test.md",
          frontmatter: {},
          body: "",
          validate: false,
        });
      }).not.toThrow();
    });

    it("should handle root rule parameter", () => {
      const claudecodeRule = new ClaudecodeRule({
        relativeDirPath: ".claude",
        relativeFilePath: "CLAUDE.md",
        frontmatter: {},
        body: "# Root Rule",
        root: true,
      });

      expect(claudecodeRule.getBody()).toBe("# Root Rule");
      expect(claudecodeRule.isRoot()).toBe(true);
    });
  });

  describe("fromFile", () => {
    it("should create instance from root .claude/CLAUDE.md file", async () => {
      // Setup test file - for root, the file should be at baseDir/.claude/CLAUDE.md
      const claudeDir = join(testDir, ".claude");
      await ensureDir(claudeDir);
      const testContent = "# Claude Code Project\n\nProject overview and instructions.";
      await writeFileContent(join(claudeDir, "CLAUDE.md"), testContent);

      const claudecodeRule = await ClaudecodeRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "CLAUDE.md",
      });

      expect(claudecodeRule.getRelativeDirPath()).toBe(".claude");
      expect(claudecodeRule.getRelativeFilePath()).toBe("CLAUDE.md");
      expect(claudecodeRule.getBody()).toBe(testContent);
      expect(claudecodeRule.getFilePath()).toBe(join(testDir, ".claude/CLAUDE.md"));
      expect(claudecodeRule.isRoot()).toBe(true);
    });

    it("should create instance from rules file with frontmatter", async () => {
      // Setup test file
      const rulesDir = join(testDir, ".claude/rules");
      await ensureDir(rulesDir);
      const testContent = `---
paths: src/**/*.ts
---

# TypeScript Rules

Content from rules file.`;
      await writeFileContent(join(rulesDir, "typescript-rules.md"), testContent);

      const claudecodeRule = await ClaudecodeRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "typescript-rules.md",
      });

      expect(claudecodeRule.getRelativeDirPath()).toBe(".claude/rules");
      expect(claudecodeRule.getRelativeFilePath()).toBe("typescript-rules.md");
      expect(claudecodeRule.getBody()).toBe("# TypeScript Rules\n\nContent from rules file.");
      expect(claudecodeRule.getFrontmatter()).toEqual({ paths: "src/**/*.ts" });
      expect(claudecodeRule.getFilePath()).toBe(join(testDir, ".claude/rules/typescript-rules.md"));
      expect(claudecodeRule.isRoot()).toBe(false);
    });

    it("should create instance from rules file without frontmatter paths", async () => {
      const rulesDir = join(testDir, ".claude/rules");
      await ensureDir(rulesDir);
      const testContent = `---
---

# General Rules

Content applies to all files.`;
      await writeFileContent(join(rulesDir, "general.md"), testContent);

      const claudecodeRule = await ClaudecodeRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "general.md",
      });

      expect(claudecodeRule.getBody()).toBe("# General Rules\n\nContent applies to all files.");
      expect(claudecodeRule.getFrontmatter()).toEqual({});
    });

    it("should use default baseDir when not provided", async () => {
      // Setup test file in test directory
      const claudeDir = join(testDir, ".claude");
      await ensureDir(claudeDir);
      const testContent = "# Default BaseDir Test";
      await writeFileContent(join(claudeDir, "CLAUDE.md"), testContent);

      const claudecodeRule = await ClaudecodeRule.fromFile({
        relativeFilePath: "CLAUDE.md",
      });

      expect(claudecodeRule.getRelativeDirPath()).toBe(".claude");
      expect(claudecodeRule.getRelativeFilePath()).toBe("CLAUDE.md");
      expect(claudecodeRule.getBody()).toBe(testContent);
    });

    it("should handle validation parameter", async () => {
      const claudeDir = join(testDir, ".claude");
      await ensureDir(claudeDir);
      const testContent = "# Validation Test";
      await writeFileContent(join(claudeDir, "CLAUDE.md"), testContent);

      const claudecodeRuleWithValidation = await ClaudecodeRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "CLAUDE.md",
        validate: true,
      });

      const claudecodeRuleWithoutValidation = await ClaudecodeRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "CLAUDE.md",
        validate: false,
      });

      expect(claudecodeRuleWithValidation.getBody()).toBe(testContent);
      expect(claudecodeRuleWithoutValidation.getBody()).toBe(testContent);
    });

    it("should throw error when file does not exist", async () => {
      await expect(
        ClaudecodeRule.fromFile({
          baseDir: testDir,
          relativeFilePath: "nonexistent.md",
        }),
      ).rejects.toThrow();
    });

    it("should detect root vs non-root files correctly", async () => {
      // Setup root .claude/CLAUDE.md file and rules files
      const claudeDir = join(testDir, ".claude");
      const rulesDir = join(testDir, ".claude/rules");
      await ensureDir(claudeDir);
      await ensureDir(rulesDir);

      const rootContent = "# Root Project Overview";
      const ruleContent = `---
paths: "**/*.md"
---

# Markdown Rules`;

      // Root file goes in .claude/CLAUDE.md
      await writeFileContent(join(claudeDir, "CLAUDE.md"), rootContent);
      // Rules file goes in .claude/rules/
      await writeFileContent(join(rulesDir, "markdown.md"), ruleContent);

      const rootRule = await ClaudecodeRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "CLAUDE.md",
      });

      const markdownRule = await ClaudecodeRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "markdown.md",
      });

      expect(rootRule.isRoot()).toBe(true);
      expect(rootRule.getRelativeDirPath()).toBe(".claude");
      expect(markdownRule.isRoot()).toBe(false);
      expect(markdownRule.getRelativeDirPath()).toBe(".claude/rules");
    });
  });

  describe("fromRulesyncRule", () => {
    it("should create instance from RulesyncRule for root rule", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "test-rule.md",
        frontmatter: {
          root: true,
          targets: ["*"],
          description: "Test root rule",
          globs: [],
        },
        body: "# Test RulesyncRule\n\nContent from rulesync.",
      });

      const claudecodeRule = ClaudecodeRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(claudecodeRule).toBeInstanceOf(ClaudecodeRule);
      expect(claudecodeRule.getRelativeDirPath()).toBe(".claude");
      expect(claudecodeRule.getRelativeFilePath()).toBe("CLAUDE.md");
      expect(claudecodeRule.getBody()).toBe("# Test RulesyncRule\n\nContent from rulesync.");
      expect(claudecodeRule.isRoot()).toBe(true);
    });

    it("should create instance from RulesyncRule for non-root rule", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "detail-rule.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "Test detail rule",
          globs: ["src/**/*.ts"],
        },
        body: "# Detail RulesyncRule\n\nContent from detail rulesync.",
      });

      const claudecodeRule = ClaudecodeRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(claudecodeRule).toBeInstanceOf(ClaudecodeRule);
      expect(claudecodeRule.getRelativeDirPath()).toBe(".claude/rules");
      expect(claudecodeRule.getRelativeFilePath()).toBe("detail-rule.md");
      expect(claudecodeRule.getBody()).toBe(
        "# Detail RulesyncRule\n\nContent from detail rulesync.",
      );
      expect(claudecodeRule.isRoot()).toBe(false);
    });

    it("should convert globs to paths field", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "api-rules.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          globs: ["src/api/**/*.ts", "src/routes/**/*.ts"],
        },
        body: "# API Rules",
      });

      const claudecodeRule = ClaudecodeRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(claudecodeRule.getFrontmatter().paths).toBe("src/api/**/*.ts, src/routes/**/*.ts");
    });

    it("should prefer claudecode.paths over globs", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          globs: ["src/**/*.ts"],
          claudecode: { paths: "custom/path/**/*.ts" },
        },
        body: "# Test",
      });

      const claudecodeRule = ClaudecodeRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(claudecodeRule.getFrontmatter().paths).toBe("custom/path/**/*.ts");
    });

    it("should use custom baseDir", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "custom-base.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "",
          globs: [],
        },
        body: "# Custom Base Directory",
      });

      const claudecodeRule = ClaudecodeRule.fromRulesyncRule({
        baseDir: "/custom/base",
        rulesyncRule,
      });

      expect(claudecodeRule.getFilePath()).toBe("/custom/base/.claude/rules/custom-base.md");
    });

    it("should handle validation parameter", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "validation.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "",
          globs: [],
        },
        body: "# Validation Test",
      });

      const claudecodeRuleWithValidation = ClaudecodeRule.fromRulesyncRule({
        rulesyncRule,
        validate: true,
      });

      const claudecodeRuleWithoutValidation = ClaudecodeRule.fromRulesyncRule({
        rulesyncRule,
        validate: false,
      });

      expect(claudecodeRuleWithValidation.getBody()).toBe("# Validation Test");
      expect(claudecodeRuleWithoutValidation.getBody()).toBe("# Validation Test");
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert ClaudecodeRule to RulesyncRule for root rule", () => {
      const claudecodeRule = new ClaudecodeRule({
        baseDir: testDir,
        relativeDirPath: ".claude",
        relativeFilePath: "CLAUDE.md",
        frontmatter: {},
        body: "# Convert Test\n\nThis will be converted.",
        root: true,
      });

      const rulesyncRule = claudecodeRule.toRulesyncRule();

      expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
      expect(rulesyncRule.getRelativeDirPath()).toBe(RULESYNC_RULES_RELATIVE_DIR_PATH);
      expect(rulesyncRule.getRelativeFilePath()).toBe(RULESYNC_OVERVIEW_FILE_NAME);
      expect(rulesyncRule.getBody()).toBe("# Convert Test\n\nThis will be converted.");
    });

    it("should convert ClaudecodeRule to RulesyncRule for rules file", () => {
      const claudecodeRule = new ClaudecodeRule({
        baseDir: testDir,
        relativeDirPath: ".claude/rules",
        relativeFilePath: "rule-convert.md",
        frontmatter: { paths: "src/**/*.ts" },
        body: "# Rule Convert Test\n\nThis rule will be converted.",
        root: false,
      });

      const rulesyncRule = claudecodeRule.toRulesyncRule();

      expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
      expect(rulesyncRule.getRelativeDirPath()).toBe(RULESYNC_RULES_RELATIVE_DIR_PATH);
      expect(rulesyncRule.getRelativeFilePath()).toBe("rule-convert.md");
      expect(rulesyncRule.getBody()).toBe("# Rule Convert Test\n\nThis rule will be converted.");
      expect(rulesyncRule.getFrontmatter().globs).toEqual(["src/**/*.ts"]);
      expect(rulesyncRule.getFrontmatter().claudecode?.paths).toBe("src/**/*.ts");
    });

    it("should preserve metadata in conversion", () => {
      const claudecodeRule = new ClaudecodeRule({
        baseDir: testDir,
        relativeDirPath: ".claude",
        relativeFilePath: "CLAUDE.md",
        frontmatter: {},
        body: "# Metadata Test\n\nWith metadata preserved.",
        root: true,
      });

      const rulesyncRule = claudecodeRule.toRulesyncRule();

      expect(rulesyncRule.getFilePath()).toBe(
        join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, RULESYNC_OVERVIEW_FILE_NAME),
      );
      expect(rulesyncRule.getBody()).toBe("# Metadata Test\n\nWith metadata preserved.");
    });
  });

  describe("validate", () => {
    it("should always return success for valid frontmatter", () => {
      const claudecodeRule = new ClaudecodeRule({
        relativeDirPath: ".claude",
        relativeFilePath: "CLAUDE.md",
        frontmatter: {},
        body: "# Any content is valid",
      });

      const result = claudecodeRule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return success for empty body", () => {
      const claudecodeRule = new ClaudecodeRule({
        relativeDirPath: ".claude/rules",
        relativeFilePath: "empty.md",
        frontmatter: {},
        body: "",
      });

      const result = claudecodeRule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return success for any content format", () => {
      const contents = [
        "# Markdown content",
        "Plain text content",
        "/* Code comments */",
        "Invalid markdown ### ###",
        "Special characters: éñ中文🎉",
        "Multi-line\ncontent\nwith\nbreaks",
      ];

      for (const content of contents) {
        const claudecodeRule = new ClaudecodeRule({
          relativeDirPath: ".claude",
          relativeFilePath: "CLAUDE.md",
          frontmatter: {},
          body: content,
        });

        const result = claudecodeRule.validate();
        expect(result.success).toBe(true);
        expect(result.error).toBeNull();
      }
    });
  });

  describe("integration tests", () => {
    it("should handle complete workflow from file to rulesync rule", async () => {
      // Create original file
      const claudeDir = join(testDir, ".claude");
      await ensureDir(claudeDir);
      const originalContent = "# Integration Test\n\nComplete workflow test.";
      await writeFileContent(join(claudeDir, "CLAUDE.md"), originalContent);

      // Load from file
      const claudecodeRule = await ClaudecodeRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "CLAUDE.md",
      });

      // Convert to rulesync rule
      const rulesyncRule = claudecodeRule.toRulesyncRule();

      // Verify conversion
      expect(rulesyncRule.getBody()).toBe(originalContent);
      expect(rulesyncRule.getRelativeDirPath()).toBe(RULESYNC_RULES_RELATIVE_DIR_PATH);
      expect(rulesyncRule.getRelativeFilePath()).toBe(RULESYNC_OVERVIEW_FILE_NAME);
    });

    it("should handle complete workflow from rules file to rulesync rule", async () => {
      // Create rules file
      const rulesDir = join(testDir, ".claude/rules");
      await ensureDir(rulesDir);
      const originalContent = `---
paths: "src/**/*.ts"
---

# Rules Integration Test

Rules workflow test.`;
      await writeFileContent(join(rulesDir, "rules-integration.md"), originalContent);

      // Load from file
      const claudecodeRule = await ClaudecodeRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "rules-integration.md",
      });

      // Convert to rulesync rule
      const rulesyncRule = claudecodeRule.toRulesyncRule();

      // Verify conversion
      expect(rulesyncRule.getBody()).toBe("# Rules Integration Test\n\nRules workflow test.");
      expect(rulesyncRule.getRelativeDirPath()).toBe(RULESYNC_RULES_RELATIVE_DIR_PATH);
      expect(rulesyncRule.getRelativeFilePath()).toBe("rules-integration.md");
      expect(rulesyncRule.getFrontmatter().globs).toEqual(["src/**/*.ts"]);
    });

    it("should handle roundtrip conversion rulesync -> claudecode -> rulesync", () => {
      const originalBody = "# Roundtrip Test\n\nContent should remain the same.";

      // Start with rulesync rule (root)
      const originalRulesync = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "roundtrip.md",
        frontmatter: {
          root: true,
          targets: ["*"],
          description: "Roundtrip test",
          globs: [],
        },
        body: originalBody,
      });

      // Convert to claudecode rule
      const claudecodeRule = ClaudecodeRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule: originalRulesync,
      });

      // Convert back to rulesync rule
      const finalRulesync = claudecodeRule.toRulesyncRule();

      // Verify content preservation
      expect(finalRulesync.getBody()).toBe(originalBody);
      expect(finalRulesync.getRelativeFilePath()).toBe(RULESYNC_OVERVIEW_FILE_NAME);
    });

    it("should handle roundtrip conversion rulesync -> claudecode -> rulesync for detail rule", () => {
      const originalBody = "# Detail Roundtrip Test\n\nDetail content should remain the same.";

      // Start with rulesync rule (non-root)
      const originalRulesync = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "detail-roundtrip.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "Detail roundtrip test",
          globs: ["src/**/*.ts"],
        },
        body: originalBody,
      });

      // Convert to claudecode rule
      const claudecodeRule = ClaudecodeRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule: originalRulesync,
      });

      // Convert back to rulesync rule
      const finalRulesync = claudecodeRule.toRulesyncRule();

      // Verify content preservation
      expect(finalRulesync.getBody()).toBe(originalBody);
      expect(finalRulesync.getRelativeFilePath()).toBe("detail-roundtrip.md");
      expect(finalRulesync.getFrontmatter().globs).toEqual(["src/**/*.ts"]);
    });

    it("should preserve directory structure in file paths", async () => {
      // Test nested directory structure
      const nestedDir = join(testDir, ".claude/rules/nested");
      await ensureDir(nestedDir);
      const content = `---
paths: "nested/**/*.ts"
---

# Nested Rule

In a nested directory.`;
      await writeFileContent(join(nestedDir, "nested-rule.md"), content);

      const claudecodeRule = await ClaudecodeRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "nested/nested-rule.md",
      });

      expect(claudecodeRule.getRelativeDirPath()).toBe(".claude/rules");
      expect(claudecodeRule.getRelativeFilePath()).toBe("nested/nested-rule.md");
      expect(claudecodeRule.getBody()).toBe("# Nested Rule\n\nIn a nested directory.");
    });
  });

  describe("getSettablePaths", () => {
    it("should return project paths by default", () => {
      const paths = ClaudecodeRule.getSettablePaths();

      expect(paths.root).toEqual({
        relativeDirPath: ".claude",
        relativeFilePath: "CLAUDE.md",
      });
      expect(paths.nonRoot).toEqual({
        relativeDirPath: ".claude/rules",
      });
    });

    it("should return global paths when global=true", () => {
      const paths = ClaudecodeRule.getSettablePaths({ global: true });

      expect(paths).toHaveProperty("root");
      expect(paths.root).toEqual({
        relativeDirPath: ".claude",
        relativeFilePath: "CLAUDE.md",
      });
      expect(paths).not.toHaveProperty("nonRoot");
    });
  });

  describe("fromFile with global flag", () => {
    it("should load root file from .claude/CLAUDE.md when global=true", async () => {
      const globalDir = join(testDir, ".claude");
      await ensureDir(globalDir);
      const testContent = "# Global Claude Code\n\nGlobal user configuration.";
      await writeFileContent(join(globalDir, "CLAUDE.md"), testContent);

      const claudecodeRule = await ClaudecodeRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "CLAUDE.md",
        global: true,
      });

      expect(claudecodeRule.getRelativeDirPath()).toBe(".claude");
      expect(claudecodeRule.getRelativeFilePath()).toBe("CLAUDE.md");
      expect(claudecodeRule.getBody()).toBe(testContent);
      expect(claudecodeRule.getFilePath()).toBe(join(testDir, ".claude/CLAUDE.md"));
      expect(claudecodeRule.isRoot()).toBe(true);
    });

    it("should use global paths when global=true", async () => {
      const globalDir = join(testDir, ".claude");
      await ensureDir(globalDir);
      const testContent = "# Global Mode Test";
      await writeFileContent(join(globalDir, "CLAUDE.md"), testContent);

      const claudecodeRule = await ClaudecodeRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "CLAUDE.md",
        global: true,
      });

      const globalPaths = ClaudecodeRule.getSettablePaths({ global: true });
      expect(claudecodeRule.getRelativeDirPath()).toBe(globalPaths.root.relativeDirPath);
      expect(claudecodeRule.getRelativeFilePath()).toBe(globalPaths.root.relativeFilePath);
    });

    it("should use regular paths when global=false", async () => {
      const claudeDir = join(testDir, ".claude");
      await ensureDir(claudeDir);
      const testContent = "# Non-Global Mode Test";
      await writeFileContent(join(claudeDir, "CLAUDE.md"), testContent);

      const claudecodeRule = await ClaudecodeRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "CLAUDE.md",
        global: false,
      });

      expect(claudecodeRule.getRelativeDirPath()).toBe(".claude");
      expect(claudecodeRule.getRelativeFilePath()).toBe("CLAUDE.md");
    });
  });

  describe("fromRulesyncRule with global flag", () => {
    it("should use global paths when global=true for root rule", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "test-rule.md",
        frontmatter: {
          root: true,
          targets: ["*"],
          description: "Test root rule",
          globs: [],
        },
        body: "# Global Test RulesyncRule\n\nContent from rulesync.",
      });

      const claudecodeRule = ClaudecodeRule.fromRulesyncRule({
        rulesyncRule,
        global: true,
      });

      expect(claudecodeRule.getRelativeDirPath()).toBe(".claude");
      expect(claudecodeRule.getRelativeFilePath()).toBe("CLAUDE.md");
      expect(claudecodeRule.isRoot()).toBe(true);
    });

    it("should use regular paths when global=false for root rule", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "test-rule.md",
        frontmatter: {
          root: true,
          targets: ["*"],
          description: "Test root rule",
          globs: [],
        },
        body: "# Regular Test RulesyncRule\n\nContent from rulesync.",
      });

      const claudecodeRule = ClaudecodeRule.fromRulesyncRule({
        rulesyncRule,
        global: false,
      });

      expect(claudecodeRule.getRelativeDirPath()).toBe(".claude");
      expect(claudecodeRule.getRelativeFilePath()).toBe("CLAUDE.md");
      expect(claudecodeRule.isRoot()).toBe(true);
    });

    it("should default to regular paths when global is not specified", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "test-rule.md",
        frontmatter: {
          root: true,
          targets: ["*"],
          description: "Test root rule",
          globs: [],
        },
        body: "# Default Test RulesyncRule\n\nContent from rulesync.",
      });

      const claudecodeRule = ClaudecodeRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(claudecodeRule.getRelativeDirPath()).toBe(".claude");
      expect(claudecodeRule.getRelativeFilePath()).toBe("CLAUDE.md");
    });
  });

  describe("isTargetedByRulesyncRule", () => {
    it("should return true for rules targeting claudecode", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["claudecode"],
        },
        body: "Test content",
      });

      expect(ClaudecodeRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
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

      expect(ClaudecodeRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should return false for rules not targeting claudecode", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["cursor", "copilot"],
        },
        body: "Test content",
      });

      expect(ClaudecodeRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(false);
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

      expect(ClaudecodeRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(false);
    });

    it("should handle mixed targets including claudecode", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["cursor", "claudecode", "copilot"],
        },
        body: "Test content",
      });

      expect(ClaudecodeRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should handle undefined targets in frontmatter", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {},
        body: "Test content",
      });

      expect(ClaudecodeRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("should handle files with special characters in names", () => {
      const claudecodeRule = new ClaudecodeRule({
        relativeDirPath: ".claude/rules",
        relativeFilePath: "special-chars@#$.md",
        frontmatter: {},
        body: "# Special chars in filename",
      });

      expect(claudecodeRule.getRelativeFilePath()).toBe("special-chars@#$.md");
    });

    it("should handle very long content", () => {
      const longContent = "# Long Content\n\n" + "A".repeat(10000);
      const claudecodeRule = new ClaudecodeRule({
        relativeDirPath: ".claude/rules",
        relativeFilePath: "long-content.md",
        frontmatter: {},
        body: longContent,
      });

      expect(claudecodeRule.getBody()).toBe(longContent);
      expect(claudecodeRule.validate().success).toBe(true);
    });

    it("should handle content with various line endings", () => {
      const contentVariations = [
        "Line 1\nLine 2\nLine 3", // Unix
        "Line 1\r\nLine 2\r\nLine 3", // Windows
        "Line 1\rLine 2\rLine 3", // Old Mac
        "Mixed\nLine\r\nEndings\rHere", // Mixed
      ];

      for (const content of contentVariations) {
        const claudecodeRule = new ClaudecodeRule({
          relativeDirPath: ".claude/rules",
          relativeFilePath: "line-endings.md",
          frontmatter: {},
          body: content,
        });

        expect(claudecodeRule.validate().success).toBe(true);
        expect(claudecodeRule.getBody()).toBe(content);
      }
    });

    it("should handle Unicode content", () => {
      const unicodeContent =
        "# Unicode Test 🚀\n\nEmojis: 😀🎉\nChinese: 你好世界\nArabic: مرحبا بالعالم\nRussian: Привет мир";
      const claudecodeRule = new ClaudecodeRule({
        relativeDirPath: ".claude/rules",
        relativeFilePath: "unicode.md",
        frontmatter: {},
        body: unicodeContent,
      });

      expect(claudecodeRule.getBody()).toBe(unicodeContent);
      expect(claudecodeRule.validate().success).toBe(true);
    });

    it("should handle multiple comma-separated paths in paths field", () => {
      const claudecodeRule = new ClaudecodeRule({
        relativeDirPath: ".claude/rules",
        relativeFilePath: "multi-paths.md",
        frontmatter: { paths: "src/**/*.ts, tests/**/*.test.ts, lib/**/*.js" },
        body: "# Multi-path rule",
      });

      const rulesyncRule = claudecodeRule.toRulesyncRule();
      expect(rulesyncRule.getFrontmatter().globs).toEqual([
        "src/**/*.ts",
        "tests/**/*.test.ts",
        "lib/**/*.js",
      ]);
    });
  });
});
