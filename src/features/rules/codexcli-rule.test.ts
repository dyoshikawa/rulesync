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
        outputRoot: testDir,
        relativeFilePath: "AGENTS.md",
      });

      expect(rule.getFileContent()).toBe(agentsContent);
      expect(rule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(rule.getRelativeDirPath()).toBe(".");
      expect(rule.getOutputRoot()).toBe(testDir);
    });

    it("should read the root AGENTS.md even when given a non-root relativeFilePath", async () => {
      const content = `# Root Agent Configuration

This is the single source of truth for Codex CLI.`;
      await writeFileContent(join(testDir, "AGENTS.md"), content);

      const rule = await CodexcliRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "error-handling.md",
      });

      expect(rule.getFileContent()).toBe(content);
      expect(rule.getRelativeDirPath()).toBe(".");
      expect(rule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(rule.isRoot()).toBe(true);
    });

    it("should handle empty content files", async () => {
      const filePath = join(testDir, "AGENTS.md");
      await writeFileContent(filePath, "");

      const rule = await CodexcliRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "AGENTS.md",
      });

      expect(rule.getFileContent()).toBe("");
      expect(rule.getRelativeFilePath()).toBe("AGENTS.md");
    });

    it("should respect outputRoot parameter", async () => {
      const customOutputRoot = join(testDir, "custom");
      await ensureDir(customOutputRoot);

      const agentsContent = "Custom base directory content";
      const filePath = join(customOutputRoot, "AGENTS.md");
      await writeFileContent(filePath, agentsContent);

      const rule = await CodexcliRule.fromFile({
        outputRoot: customOutputRoot,
        relativeFilePath: "AGENTS.md",
      });

      expect(rule.getFileContent()).toBe(agentsContent);
      expect(rule.getOutputRoot()).toBe(customOutputRoot);
    });

    it("should handle validation parameter", async () => {
      const agentsContent = "Test content for validation";
      const filePath = join(testDir, "AGENTS.md");
      await writeFileContent(filePath, agentsContent);

      const ruleWithValidation = await CodexcliRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "AGENTS.md",
        validate: true,
      });

      const ruleWithoutValidation = await CodexcliRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "AGENTS.md",
        validate: false,
      });

      expect(ruleWithValidation.getFileContent()).toBe(agentsContent);
      expect(ruleWithoutValidation.getFileContent()).toBe(agentsContent);
    });

    it("should always read from the root AGENTS.md", async () => {
      const rootContent = "Root agent instructions";
      const rootPath = join(testDir, "AGENTS.md");
      await writeFileContent(rootPath, rootContent);

      const rootRule = await CodexcliRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "AGENTS.md",
      });

      expect(rootRule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(rootRule.getRelativeDirPath()).toBe(".");
      expect(rootRule.isRoot()).toBe(true);

      const nonRootRule = await CodexcliRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "specific.md",
      });

      expect(nonRootRule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(nonRootRule.getRelativeDirPath()).toBe(".");
      expect(nonRootRule.isRoot()).toBe(true);
    });
  });

  describe("fromRulesyncRule", () => {
    it("should create root CodexcliRule from root RulesyncRule", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "root.md",
        frontmatter: { root: true, targets: ["*"], description: "Root rule", globs: [] },
        body: "Root rule body content",
        validate: false,
      });

      const codexcliRule = CodexcliRule.fromRulesyncRule({
        outputRoot: testDir,
        rulesyncRule,
      });

      expect(codexcliRule.getFileContent()).toBe("Root rule body content");
      expect(codexcliRule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(codexcliRule.getRelativeDirPath()).toBe(".");
      expect(codexcliRule.getOutputRoot()).toBe(testDir);
    });

    it("should create non-root CodexcliRule from non-root RulesyncRule", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "specific.md",
        frontmatter: { root: false, targets: ["*"], description: "Non-root rule", globs: [] },
        body: "Non-root rule body content",
        validate: false,
      });

      const codexcliRule = CodexcliRule.fromRulesyncRule({
        outputRoot: testDir,
        rulesyncRule,
      });

      expect(codexcliRule.getFileContent()).toBe("Non-root rule body content");
      expect(codexcliRule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(codexcliRule.getRelativeDirPath()).toBe(".");
      expect(codexcliRule.getOutputRoot()).toBe(testDir);
      expect(codexcliRule.isRoot()).toBe(false);
    });

    it("should handle empty body content", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "empty.md",
        frontmatter: { root: false, targets: ["*"], description: "Empty rule", globs: [] },
        body: "",
        validate: false,
      });

      const codexcliRule = CodexcliRule.fromRulesyncRule({
        outputRoot: testDir,
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
        outputRoot: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "complex.md",
        frontmatter: { root: true, targets: ["*"], description: "Complex rule", globs: [] },
        body: complexBody,
        validate: false,
      });

      const codexcliRule = CodexcliRule.fromRulesyncRule({
        outputRoot: testDir,
        rulesyncRule,
      });

      expect(codexcliRule.getFileContent()).toBe(complexBody);
    });

    it("should ignore subprojectPath and target root AGENTS.md (folding)", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
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
        outputRoot: testDir,
        rulesyncRule,
      });

      expect(codexcliRule.getFileContent()).toBe(
        "# Subproject CodexCLI\n\nContent for subproject.",
      );
      expect(codexcliRule.getRelativeDirPath()).toBe(".");
      expect(codexcliRule.getRelativeFilePath()).toBe("AGENTS.md");
    });

    it("should ignore subprojectPath for root rules", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          root: true,
          targets: ["codexcli"],
          agentsmd: {
            subprojectPath: "packages/my-app",
          },
        },
        body: "# Root CodexCLI\n\nRoot content.",
      });

      const codexcliRule = CodexcliRule.fromRulesyncRule({
        outputRoot: testDir,
        rulesyncRule,
      });

      expect(codexcliRule.getFileContent()).toBe("# Root CodexCLI\n\nRoot content.");
      expect(codexcliRule.getRelativeDirPath()).toBe(".");
      expect(codexcliRule.getRelativeFilePath()).toBe("AGENTS.md");
    });

    it("should target root AGENTS.md even with empty subprojectPath", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
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
        outputRoot: testDir,
        rulesyncRule,
      });

      expect(codexcliRule.getFileContent()).toBe("# Empty Subproject CodexCLI\n\nContent.");
      expect(codexcliRule.getRelativeDirPath()).toBe(".");
      expect(codexcliRule.getRelativeFilePath()).toBe("AGENTS.md");
    });

    it("should target root AGENTS.md even with complex nested subprojectPath", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
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
        outputRoot: testDir,
        rulesyncRule,
      });

      expect(codexcliRule.getFileContent()).toBe(
        "# Nested Subproject CodexCLI\n\nDeeply nested content.",
      );
      expect(codexcliRule.getRelativeDirPath()).toBe(".");
      expect(codexcliRule.getRelativeFilePath()).toBe("AGENTS.md");
    });

    it("should target root AGENTS.md when agentsmd field is undefined", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          root: false,
          targets: ["codexcli"],
        },
        body: "# No agentsmd\n\nContent without agentsmd.",
      });

      const codexcliRule = CodexcliRule.fromRulesyncRule({
        outputRoot: testDir,
        rulesyncRule,
      });

      expect(codexcliRule.getFileContent()).toBe("# No agentsmd\n\nContent without agentsmd.");
      expect(codexcliRule.getRelativeDirPath()).toBe(".");
      expect(codexcliRule.getRelativeFilePath()).toBe("AGENTS.md");
    });

    it("should respect validation parameter", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        frontmatter: { root: false, targets: ["*"], description: "Test rule", globs: [] },
        body: "Test body",
        validate: false,
      });

      const ruleWithValidation = CodexcliRule.fromRulesyncRule({
        outputRoot: testDir,
        rulesyncRule,
        validate: true,
      });

      const ruleWithoutValidation = CodexcliRule.fromRulesyncRule({
        outputRoot: testDir,
        rulesyncRule,
        validate: false,
      });

      expect(ruleWithValidation.getFileContent()).toBe("Test body");
      expect(ruleWithoutValidation.getFileContent()).toBe("Test body");
    });

    it("should handle custom outputRoot", () => {
      const customOutputRoot = join(testDir, "custom");

      const rulesyncRule = new RulesyncRule({
        outputRoot: customOutputRoot,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        frontmatter: { root: false, targets: ["*"], description: "Test rule", globs: [] },
        body: "Test body",
        validate: false,
      });

      const codexcliRule = CodexcliRule.fromRulesyncRule({
        outputRoot: customOutputRoot,
        rulesyncRule,
      });

      expect(codexcliRule.getOutputRoot()).toBe(customOutputRoot);
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert root CodexcliRule to RulesyncRule", async () => {
      const agentsContent = "Root agent instructions";
      const filePath = join(testDir, "AGENTS.md");
      await writeFileContent(filePath, agentsContent);

      const codexcliRule = await CodexcliRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "AGENTS.md",
      });

      const rulesyncRule = codexcliRule.toRulesyncRule();

      expect(rulesyncRule.getBody()).toBe(agentsContent);
      expect(rulesyncRule.getFrontmatter().root).toBe(true);
      expect(rulesyncRule.getFrontmatter().targets).toEqual(["*"]);
      expect(rulesyncRule.getFrontmatter().description).toBeUndefined();
      expect(rulesyncRule.getFrontmatter().globs).toEqual(["**/*"]);
    });

    it("should convert non-root CodexcliRule to RulesyncRule", () => {
      const rulesyncRuleInput = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "specific.md",
        frontmatter: { root: false, targets: ["*"], description: "Test rule", globs: [] },
        body: "Non-root rule body content",
        validate: false,
      });

      const codexcliRule = CodexcliRule.fromRulesyncRule({
        outputRoot: testDir,
        rulesyncRule: rulesyncRuleInput,
      });

      const rulesyncRule = codexcliRule.toRulesyncRule();

      expect(rulesyncRule.getBody()).toBe("Non-root rule body content");
      expect(rulesyncRule.getFrontmatter().root).toBe(false);
      expect(rulesyncRule.getFrontmatter().targets).toEqual(["*"]);
      expect(rulesyncRule.getFrontmatter().globs).toEqual([]);
    });

    it("should handle empty content conversion", async () => {
      const filePath = join(testDir, "AGENTS.md");
      await writeFileContent(filePath, "");

      const codexcliRule = await CodexcliRule.fromFile({
        outputRoot: testDir,
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
          outputRoot: testDir,
          relativeFilePath: "AGENTS.md",
        });

        const result = rule.validate();
        expect(result.success).toBe(true);
        expect(result.error).toBeNull();
      }
    });

    it("should return success for rule created from RulesyncRule", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        frontmatter: { root: false, targets: ["*"], description: "Test rule", globs: [] },
        body: "Any content here",
        validate: false,
      });

      const codexcliRule = CodexcliRule.fromRulesyncRule({
        outputRoot: testDir,
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
        outputRoot: testDir,
        relativeFilePath: "AGENTS.md",
      });

      // Create via fromRulesyncRule
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "AGENTS.md",
        frontmatter: { root: true, targets: ["*"], description: "", globs: [] },
        body: content,
        validate: false,
      });

      const ruleFromRulesync = CodexcliRule.fromRulesyncRule({
        outputRoot: testDir,
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
    it("should return only the root AGENTS.md path (no nonRoot)", () => {
      const paths = CodexcliRule.getSettablePaths();

      expect(paths.root).toEqual({
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
      });

      expect(paths.nonRoot).toBeUndefined();
    });

    it("should have consistent paths structure", () => {
      const paths = CodexcliRule.getSettablePaths();

      expect(paths).toHaveProperty("root");
      expect(paths.root).toHaveProperty("relativeDirPath");
      expect(paths.root).toHaveProperty("relativeFilePath");
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
        outputRoot: testDir,
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
        outputRoot: testDir,
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
        outputRoot: testDir,
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
        outputRoot: testDir,
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
        outputRoot: testDir,
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
        outputRoot: testDir,
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
        outputRoot: testDir,
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
        outputRoot: testDir,
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
        outputRoot: testDir,
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
        outputRoot: testDir,
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
        outputRoot: testDir,
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
      expect(finalRulesyncRule.validate().success).toBe(true);
    });

    it("should handle file system operations correctly", async () => {
      // CodexcliRule always reads from the root AGENTS.md
      const rootContent = "Main agent instructions";
      await writeFileContent(join(testDir, "AGENTS.md"), rootContent);

      const rule = await CodexcliRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "AGENTS.md",
      });

      expect(rule.getFileContent()).toBe(rootContent);
      expect(rule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(rule.getRelativeDirPath()).toBe(".");
      expect(rule.validate().success).toBe(true);

      // toRulesyncRule round-trip
      const rulesyncRule = rule.toRulesyncRule();
      expect(rulesyncRule.validate().success).toBe(true);
      expect(rulesyncRule.getBody()).toBe(rootContent);
    });
  });
});
