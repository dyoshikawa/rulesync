import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { CodexcliRule } from "./codexcli-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("CodexcliRule", () => {
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

  describe("fromFile", () => {
    it("should load root rule from AGENTS.md file", async () => {
      const agentsContent = `# Project Agent Instructions

This is the main agent configuration for the project.

## Guidelines

- Use TypeScript
- Follow coding standards
- Write comprehensive tests`;

      const filePath = join(testDir, "AGENTS.md");
      await writeFileContent(filePath, agentsContent);

      const rule = await CodexcliRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "AGENTS.md",
      });

      expect(rule.getFileContent()).toBe(agentsContent);
      expect(rule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(rule.getRelativeDirPath()).toBe(".");
      expect(rule.getBaseDir()).toBe(testDir);
    });

    it("should load non-root rule from .codex/memories directory", async () => {
      const memoriesDir = join(testDir, ".codex", "memories");
      await ensureDir(memoriesDir);

      const memoryContent = `# Memory Instructions

This is a specific memory configuration.

- Handle errors gracefully
- Log important events`;

      const filePath = join(memoriesDir, "error-handling.md");
      await writeFileContent(filePath, memoryContent);

      const rule = await CodexcliRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "error-handling.md",
      });

      expect(rule.getFileContent()).toBe(memoryContent);
      expect(rule.getRelativeFilePath()).toBe("error-handling.md");
      expect(rule.getRelativeDirPath()).toBe(".codex/memories");
      expect(rule.getBaseDir()).toBe(testDir);
    });

    it("should handle empty content files", async () => {
      const filePath = join(testDir, "AGENTS.md");
      await writeFileContent(filePath, "");

      const rule = await CodexcliRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "AGENTS.md",
      });

      expect(rule.getFileContent()).toBe("");
      expect(rule.getRelativeFilePath()).toBe("AGENTS.md");
    });

    it("should respect baseDir parameter", async () => {
      const customBaseDir = join(testDir, "custom");
      await ensureDir(customBaseDir);

      const agentsContent = "Custom base directory content";
      const filePath = join(customBaseDir, "AGENTS.md");
      await writeFileContent(filePath, agentsContent);

      const rule = await CodexcliRule.fromFile({
        baseDir: customBaseDir,
        relativeFilePath: "AGENTS.md",
      });

      expect(rule.getFileContent()).toBe(agentsContent);
      expect(rule.getBaseDir()).toBe(customBaseDir);
    });

    it("should handle validation parameter", async () => {
      const agentsContent = "Test content for validation";
      const filePath = join(testDir, "AGENTS.md");
      await writeFileContent(filePath, agentsContent);

      const ruleWithValidation = await CodexcliRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "AGENTS.md",
        validate: true,
      });

      const ruleWithoutValidation = await CodexcliRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "AGENTS.md",
        validate: false,
      });

      expect(ruleWithValidation.getFileContent()).toBe(agentsContent);
      expect(ruleWithoutValidation.getFileContent()).toBe(agentsContent);
    });

    it("should determine root status correctly", async () => {
      // Test root file
      const rootContent = "Root agent instructions";
      const rootPath = join(testDir, "AGENTS.md");
      await writeFileContent(rootPath, rootContent);

      const rootRule = await CodexcliRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "AGENTS.md",
      });

      expect(rootRule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(rootRule.getRelativeDirPath()).toBe(".");

      // Test non-root file
      const memoriesDir = join(testDir, ".codex", "memories");
      await ensureDir(memoriesDir);

      const nonRootContent = "Non-root memory instructions";
      const nonRootPath = join(memoriesDir, "specific.md");
      await writeFileContent(nonRootPath, nonRootContent);

      const nonRootRule = await CodexcliRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "specific.md",
      });

      expect(nonRootRule.getRelativeFilePath()).toBe("specific.md");
      expect(nonRootRule.getRelativeDirPath()).toBe(".codex/memories");
    });
  });

  describe("fromRulesyncRule", () => {
    it("should create root CodexcliRule from root RulesyncRule", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "root.md",
        frontmatter: { root: true, targets: ["*"], description: "Root rule", globs: [] },
        body: "Root rule body content",
        validate: false,
      });

      const codexcliRule = CodexcliRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule,
      });

      expect(codexcliRule.getFileContent()).toBe("Root rule body content");
      expect(codexcliRule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(codexcliRule.getRelativeDirPath()).toBe(".");
      expect(codexcliRule.getBaseDir()).toBe(testDir);
    });

    it("should create non-root CodexcliRule from non-root RulesyncRule", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "specific.md",
        frontmatter: { root: false, targets: ["*"], description: "Non-root rule", globs: [] },
        body: "Non-root rule body content",
        validate: false,
      });

      const codexcliRule = CodexcliRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule,
      });

      expect(codexcliRule.getFileContent()).toBe("Non-root rule body content");
      expect(codexcliRule.getRelativeFilePath()).toBe("specific.md");
      expect(codexcliRule.getRelativeDirPath()).toBe(".codex/memories");
      expect(codexcliRule.getBaseDir()).toBe(testDir);
    });

    it("should handle empty body content", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "empty.md",
        frontmatter: { root: false, targets: ["*"], description: "Empty rule", globs: [] },
        body: "",
        validate: false,
      });

      const codexcliRule = CodexcliRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule,
      });

      expect(codexcliRule.getFileContent()).toBe("");
    });

    it("should handle complex body content", () => {
      const complexBody = `# Complex Rule

This is a complex rule with multiple sections.

## Section 1
- Item 1
- Item 2

## Section 2
\`\`\`typescript
interface Example {
  id: string;
  name: string;
}
\`\`\`

### Subsection
More detailed instructions here.`;

      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "complex.md",
        frontmatter: { root: true, targets: ["*"], description: "Complex rule", globs: [] },
        body: complexBody,
        validate: false,
      });

      const codexcliRule = CodexcliRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule,
      });

      expect(codexcliRule.getFileContent()).toBe(complexBody);
    });

    it("should handle subprojectPath from agentsmd field", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          root: false,
          targets: ["codexcli"],
          agentsmd: {
            subprojectPath: "packages/my-app",
          },
        },
        body: "# Subproject CodexCLI\n\nContent for subproject.",
      });

      const codexcliRule = CodexcliRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule,
      });

      expect(codexcliRule.getFileContent()).toBe(
        "# Subproject CodexCLI\n\nContent for subproject.",
      );
      expect(codexcliRule.getRelativeDirPath()).toBe("packages/my-app");
      expect(codexcliRule.getRelativeFilePath()).toBe("AGENTS.md");
    });

    it("should ignore subprojectPath for root rules", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          root: true,
          targets: ["codexcli"],
          agentsmd: {
            subprojectPath: "packages/my-app", // Should be ignored
          },
        },
        body: "# Root CodexCLI\n\nRoot content.",
      });

      const codexcliRule = CodexcliRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule,
      });

      expect(codexcliRule.getFileContent()).toBe("# Root CodexCLI\n\nRoot content.");
      expect(codexcliRule.getRelativeDirPath()).toBe(".");
      expect(codexcliRule.getRelativeFilePath()).toBe("AGENTS.md");
    });

    it("should handle empty subprojectPath", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          root: false,
          targets: ["codexcli"],
          agentsmd: {
            subprojectPath: "",
          },
        },
        body: "# Empty Subproject CodexCLI\n\nContent.",
      });

      const codexcliRule = CodexcliRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule,
      });

      expect(codexcliRule.getFileContent()).toBe("# Empty Subproject CodexCLI\n\nContent.");
      expect(codexcliRule.getRelativeDirPath()).toBe(".codex/memories");
      expect(codexcliRule.getRelativeFilePath()).toBe("test.md");
    });

    it("should handle complex nested subprojectPath", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "nested.md",
        frontmatter: {
          root: false,
          targets: ["codexcli"],
          agentsmd: {
            subprojectPath: "packages/apps/my-app/src",
          },
        },
        body: "# Nested Subproject CodexCLI\n\nDeeply nested content.",
      });

      const codexcliRule = CodexcliRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule,
      });

      expect(codexcliRule.getFileContent()).toBe(
        "# Nested Subproject CodexCLI\n\nDeeply nested content.",
      );
      expect(codexcliRule.getRelativeDirPath()).toBe("packages/apps/my-app/src");
      expect(codexcliRule.getRelativeFilePath()).toBe("AGENTS.md");
    });

    it("should handle undefined agentsmd field", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          root: false,
          targets: ["codexcli"],
        },
        body: "# No agentsmd\n\nContent without agentsmd.",
      });

      const codexcliRule = CodexcliRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule,
      });

      expect(codexcliRule.getFileContent()).toBe("# No agentsmd\n\nContent without agentsmd.");
      expect(codexcliRule.getRelativeDirPath()).toBe(".codex/memories");
      expect(codexcliRule.getRelativeFilePath()).toBe("test.md");
    });

    it("should respect validation parameter", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        frontmatter: { root: false, targets: ["*"], description: "Test rule", globs: [] },
        body: "Test body",
        validate: false,
      });

      const ruleWithValidation = CodexcliRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule,
        validate: true,
      });

      const ruleWithoutValidation = CodexcliRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule,
        validate: false,
      });

      expect(ruleWithValidation.getFileContent()).toBe("Test body");
      expect(ruleWithoutValidation.getFileContent()).toBe("Test body");
    });

    it("should handle custom baseDir", () => {
      const customBaseDir = join(testDir, "custom");

      const rulesyncRule = new RulesyncRule({
        baseDir: customBaseDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        frontmatter: { root: false, targets: ["*"], description: "Test rule", globs: [] },
        body: "Test body",
        validate: false,
      });

      const codexcliRule = CodexcliRule.fromRulesyncRule({
        baseDir: customBaseDir,
        rulesyncRule,
      });

      expect(codexcliRule.getBaseDir()).toBe(customBaseDir);
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert root CodexcliRule to RulesyncRule", async () => {
      const agentsContent = "Root agent instructions";
      const filePath = join(testDir, "AGENTS.md");
      await writeFileContent(filePath, agentsContent);

      const codexcliRule = await CodexcliRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "AGENTS.md",
      });

      const rulesyncRule = codexcliRule.toRulesyncRule();

      expect(rulesyncRule.getBody()).toBe(agentsContent);
      expect(rulesyncRule.getFrontmatter().root).toBe(true);
      expect(rulesyncRule.getFrontmatter().targets).toEqual(["*"]);
      expect(rulesyncRule.getFrontmatter().description).toBeUndefined();
      expect(rulesyncRule.getFrontmatter().globs).toEqual(["**/*"]);
    });

    it("should convert non-root CodexcliRule to RulesyncRule", async () => {
      const memoriesDir = join(testDir, ".codex", "memories");
      await ensureDir(memoriesDir);

      const memoryContent = "Non-root memory instructions";
      const filePath = join(memoriesDir, "specific.md");
      await writeFileContent(filePath, memoryContent);

      const codexcliRule = await CodexcliRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "specific.md",
      });

      const rulesyncRule = codexcliRule.toRulesyncRule();

      expect(rulesyncRule.getBody()).toBe(memoryContent);
      expect(rulesyncRule.getFrontmatter().root).toBe(false);
      expect(rulesyncRule.getFrontmatter().targets).toEqual(["*"]);
      expect(rulesyncRule.getFrontmatter().description).toBeUndefined();
      expect(rulesyncRule.getFrontmatter().globs).toEqual([]);
    });

    it("should handle empty content conversion", async () => {
      const filePath = join(testDir, "AGENTS.md");
      await writeFileContent(filePath, "");

      const codexcliRule = await CodexcliRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "AGENTS.md",
      });

      const rulesyncRule = codexcliRule.toRulesyncRule();

      expect(rulesyncRule.getBody()).toBe("");
      expect(rulesyncRule.getFrontmatter().root).toBe(true);
    });
  });

  describe("validate", () => {
    it("should always return success for any content", async () => {
      const testCases = [
        "",
        "Simple content",
        "# Complex Content\n\nWith multiple sections.",
        "Content with special characters: !@#$%^&*()",
        "\n\n\n   \n\n", // Only whitespace
        "Very long content ".repeat(1000),
      ];

      for (const content of testCases) {
        const filePath = join(testDir, "AGENTS.md");
        await writeFileContent(filePath, content);

        const rule = await CodexcliRule.fromFile({
          baseDir: testDir,
          relativeFilePath: "AGENTS.md",
        });

        const result = rule.validate();
        expect(result.success).toBe(true);
        expect(result.error).toBeNull();
      }
    });

    it("should return success for rule created from RulesyncRule", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        frontmatter: { root: false, targets: ["*"], description: "Test rule", globs: [] },
        body: "Any content here",
        validate: false,
      });

      const codexcliRule = CodexcliRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule,
      });

      const result = codexcliRule.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should validate consistently across different initialization methods", async () => {
      const content = "Test content for validation";

      // Create via fromFile
      const filePath = join(testDir, "AGENTS.md");
      await writeFileContent(filePath, content);

      const ruleFromFile = await CodexcliRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "AGENTS.md",
      });

      // Create via fromRulesyncRule
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "AGENTS.md",
        frontmatter: { root: true, targets: ["*"], description: "", globs: [] },
        body: content,
        validate: false,
      });

      const ruleFromRulesync = CodexcliRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule,
      });

      // Both should validate successfully
      const fileResult = ruleFromFile.validate();
      const rulesyncResult = ruleFromRulesync.validate();

      expect(fileResult.success).toBe(true);
      expect(fileResult.error).toBeNull();
      expect(rulesyncResult.success).toBe(true);
      expect(rulesyncResult.error).toBeNull();
    });
  });

  describe("getSettablePaths", () => {
    it("should return correct paths for root and nonRoot", () => {
      const paths = CodexcliRule.getSettablePaths();

      expect(paths.root).toEqual({
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
      });

      expect(paths.nonRoot).toEqual({
        relativeDirPath: ".codex/memories",
      });
    });

    it("should have consistent paths structure", () => {
      const paths = CodexcliRule.getSettablePaths();

      expect(paths).toHaveProperty("root");
      expect(paths).toHaveProperty("nonRoot");
      expect(paths.root).toHaveProperty("relativeDirPath");
      expect(paths.root).toHaveProperty("relativeFilePath");
      expect(paths.nonRoot).toHaveProperty("relativeDirPath");
    });
  });

  describe("getSettablePaths with global flag", () => {
    it("should return global-specific paths", () => {
      const paths = CodexcliRule.getSettablePaths({ global: true });

      expect(paths).toHaveProperty("root");
      expect(paths.root).toEqual({
        relativeDirPath: ".codex",
        relativeFilePath: "AGENTS.md",
      });
      expect(paths).not.toHaveProperty("nonRoot");
    });

    it("should have different paths than regular getSettablePaths", () => {
      const globalPaths = CodexcliRule.getSettablePaths({ global: true });
      const regularPaths = CodexcliRule.getSettablePaths();

      expect(globalPaths.root.relativeDirPath).not.toBe(regularPaths.root.relativeDirPath);
      expect(globalPaths.root.relativeFilePath).toBe(regularPaths.root.relativeFilePath);
    });
  });

  describe("fromFile with global flag", () => {
    it("should load root file from .codex/AGENTS.md when global=true", async () => {
      const globalDir = join(testDir, ".codex");
      await ensureDir(globalDir);
      const testContent = "# Global Codex CLI\n\nGlobal user configuration.";
      await writeFileContent(join(globalDir, "AGENTS.md"), testContent);

      const codexcliRule = await CodexcliRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "AGENTS.md",
        global: true,
      });

      expect(codexcliRule.getRelativeDirPath()).toBe(".codex");
      expect(codexcliRule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(codexcliRule.getFileContent()).toBe(testContent);
      expect(codexcliRule.getFilePath()).toBe(join(testDir, ".codex/AGENTS.md"));
    });

    it("should use global paths when global=true", async () => {
      const globalDir = join(testDir, ".codex");
      await ensureDir(globalDir);
      const testContent = "# Global Mode Test";
      await writeFileContent(join(globalDir, "AGENTS.md"), testContent);

      const codexcliRule = await CodexcliRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "AGENTS.md",
        global: true,
      });

      const globalPaths = CodexcliRule.getSettablePaths({ global: true });
      expect(codexcliRule.getRelativeDirPath()).toBe(globalPaths.root.relativeDirPath);
      expect(codexcliRule.getRelativeFilePath()).toBe(globalPaths.root.relativeFilePath);
    });

    it("should use regular paths when global=false", async () => {
      const testContent = "# Non-Global Mode Test";
      await writeFileContent(join(testDir, "AGENTS.md"), testContent);

      const codexcliRule = await CodexcliRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "AGENTS.md",
        global: false,
      });

      expect(codexcliRule.getRelativeDirPath()).toBe(".");
      expect(codexcliRule.getRelativeFilePath()).toBe("AGENTS.md");
    });
  });

  describe("fromRulesyncRule with global flag", () => {
    it("should use global paths when global=true for root rule", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: `${RULESYNC_RELATIVE_DIR_PATH}/rules`,
        relativeFilePath: "test-rule.md",
        frontmatter: {
          root: true,
          targets: ["*"],
          description: "Test root rule",
          globs: [],
        },
        body: "# Global Test RulesyncRule\n\nContent from rulesync.",
      });

      const codexcliRule = CodexcliRule.fromRulesyncRule({
        rulesyncRule,
        global: true,
      });

      expect(codexcliRule.getRelativeDirPath()).toBe(".codex");
      expect(codexcliRule.getRelativeFilePath()).toBe("AGENTS.md");
    });

    it("should use regular paths when global=false for root rule", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: `${RULESYNC_RELATIVE_DIR_PATH}/rules`,
        relativeFilePath: "test-rule.md",
        frontmatter: {
          root: true,
          targets: ["*"],
          description: "Test root rule",
          globs: [],
        },
        body: "# Regular Test RulesyncRule\n\nContent from rulesync.",
      });

      const codexcliRule = CodexcliRule.fromRulesyncRule({
        rulesyncRule,
        global: false,
      });

      expect(codexcliRule.getRelativeDirPath()).toBe(".");
      expect(codexcliRule.getRelativeFilePath()).toBe("AGENTS.md");
    });

    it("should default to regular paths when global is not specified", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: `${RULESYNC_RELATIVE_DIR_PATH}/rules`,
        relativeFilePath: "test-rule.md",
        frontmatter: {
          root: true,
          targets: ["*"],
          description: "Test root rule",
          globs: [],
        },
        body: "# Default Test RulesyncRule\n\nContent from rulesync.",
      });

      const codexcliRule = CodexcliRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(codexcliRule.getRelativeDirPath()).toBe(".");
      expect(codexcliRule.getRelativeFilePath()).toBe("AGENTS.md");
    });
  });

  describe("isTargetedByRulesyncRule", () => {
    it("should return true for rules targeting codexcli", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".codex/memories",
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["codexcli"],
        },
        body: "Test content",
      });

      expect(CodexcliRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should return true for rules targeting all tools (*)", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".codex/memories",
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["*"],
        },
        body: "Test content",
      });

      expect(CodexcliRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should return false for rules not targeting codexcli", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".codex/memories",
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["cursor", "copilot"],
        },
        body: "Test content",
      });

      expect(CodexcliRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(false);
    });

    it("should return false for empty targets", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".codex/memories",
        relativeFilePath: "test.md",
        frontmatter: {
          targets: [],
        },
        body: "Test content",
      });

      expect(CodexcliRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(false);
    });

    it("should handle mixed targets including codexcli", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".codex/memories",
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["cursor", "codexcli", "copilot"],
        },
        body: "Test content",
      });

      expect(CodexcliRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should handle undefined targets in frontmatter", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".codex/memories",
        relativeFilePath: "test.md",
        frontmatter: {},
        body: "Test content",
      });

      expect(CodexcliRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });
  });

  describe("integration", () => {
    it("should handle complete workflow: RulesyncRule -> CodexcliRule -> RulesyncRule", () => {
      // Create initial RulesyncRule
      const originalContent = `# OpenAI Codex CLI Instructions

This project uses OpenAI Codex CLI for AI assistance.

## Guidelines

- Write clean, readable code
- Use appropriate TypeScript types
- Follow the project's coding standards

## Examples

\`\`\`typescript
interface ApiResponse<T> {
  data: T;
  status: number;
  message?: string;
}
\`\`\``;

      const originalRulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "codex-rule.md",
        frontmatter: {
          root: true,
          targets: ["*"],
          description: "OpenAI Codex CLI configuration",
          globs: ["src/**/*.ts"],
        },
        body: originalContent,
        validate: false,
      });

      // Convert to CodexcliRule
      const codexcliRule = CodexcliRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule: originalRulesyncRule,
      });

      // Verify CodexcliRule properties
      expect(codexcliRule.getFileContent()).toBe(originalContent);
      expect(codexcliRule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(codexcliRule.getRelativeDirPath()).toBe(".");
      expect(codexcliRule.validate().success).toBe(true);

      // Convert back to RulesyncRule
      const finalRulesyncRule = codexcliRule.toRulesyncRule();

      // Verify round-trip conversion
      expect(finalRulesyncRule.getBody()).toBe(originalContent);
      expect(finalRulesyncRule.getFrontmatter().root).toBe(true);
      expect(finalRulesyncRule.getFrontmatter().targets).toEqual(["*"]);
      expect(finalRulesyncRule.getFrontmatter().description).toBe("OpenAI Codex CLI configuration");
      expect(finalRulesyncRule.getFrontmatter().globs).toEqual(["src/**/*.ts"]);
      expect(finalRulesyncRule.validate().success).toBe(true);
    });

    it("should handle file system operations correctly", async () => {
      // Setup directory structure
      const memoriesDir = join(testDir, ".codex", "memories");
      await ensureDir(memoriesDir);

      // Test multiple files
      const files = [
        { path: "AGENTS.md", content: "Main agent instructions", isRoot: true },
        {
          path: join("memories", "typescript.md"),
          content: "TypeScript guidelines",
          isRoot: false,
        },
        { path: join("memories", "testing.md"), content: "Testing best practices", isRoot: false },
      ];

      const rules: CodexcliRule[] = [];

      // Create and load all files
      for (const file of files) {
        const fullPath = file.isRoot
          ? join(testDir, file.path)
          : join(testDir, ".codex", file.path);
        await writeFileContent(fullPath, file.content);

        const fileName = file.isRoot ? file.path : file.path.split("/").pop()!;
        const rule = await CodexcliRule.fromFile({
          baseDir: testDir,
          relativeFilePath: fileName,
        });

        expect(rule.getFileContent()).toBe(file.content);
        expect(rule.validate().success).toBe(true);

        rules.push(rule);
      }

      // Verify each rule has correct properties
      expect(rules[0]?.getRelativeFilePath()).toBe("AGENTS.md");
      expect(rules[0]?.getRelativeDirPath()).toBe(".");

      expect(rules[1]?.getRelativeFilePath()).toBe("typescript.md");
      expect(rules[1]?.getRelativeDirPath()).toBe(".codex/memories");

      expect(rules[2]?.getRelativeFilePath()).toBe("testing.md");
      expect(rules[2]?.getRelativeDirPath()).toBe(".codex/memories");

      // Test conversion to RulesyncRule for all
      for (const rule of rules) {
        const rulesyncRule = rule.toRulesyncRule();
        expect(rulesyncRule.validate().success).toBe(true);
        expect(rulesyncRule.getBody()).toBe(rule.getFileContent());
      }
    });
  });
});
