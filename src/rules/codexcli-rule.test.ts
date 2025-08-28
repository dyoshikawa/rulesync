import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import { CodexcliRule } from "./codexcli-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("CodexcliRule", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("constructor", () => {
    it("should create an instance with valid parameters", () => {
      const rule = new CodexcliRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "coding-standards.md",
        body: "# Coding Standards\n\nUse TypeScript strict mode.",
      });

      expect(rule.getBody()).toBe("# Coding Standards\n\nUse TypeScript strict mode.");
      expect(rule.getRelativeFilePath()).toBe("coding-standards.md");
    });

    it("should use provided fileContent when given", () => {
      const body = "# Test";
      const fileContent = "# Different Content";

      const rule = new CodexcliRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        body,
        fileContent,
      });

      expect(rule.getBody()).toBe(body);
      expect(rule.getFileContent()).toBe(fileContent);
    });

    it("should use body as fileContent when fileContent is not provided", () => {
      const body = "# Test Content";

      const rule = new CodexcliRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        body,
      });

      expect(rule.getBody()).toBe(body);
      expect(rule.getFileContent()).toBe(body);
    });
  });

  describe("fromFilePath", () => {
    it("should create instance from plain markdown file", async () => {
      const rulesDir = join(testDir, "rules");
      await mkdir(rulesDir, { recursive: true });

      const filePath = join(rulesDir, "coding-standards.md");
      const content = "# Coding Standards\n\nAlways use TypeScript.";
      await writeFile(filePath, content);

      const rule = await CodexcliRule.fromFilePath({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "coding-standards.md",
        filePath,
      });

      expect(rule.getBody()).toBe(content);
      expect(rule.getRelativeFilePath()).toBe("coding-standards.md");
    });

    it("should handle file with frontmatter correctly", async () => {
      const rulesDir = join(testDir, "rules");
      await mkdir(rulesDir, { recursive: true });

      const filePath = join(rulesDir, "with-frontmatter.md");
      const content = `---
title: "Test Rule"
---
# Content

This is the actual content.`;
      await writeFile(filePath, content);

      const rule = await CodexcliRule.fromFilePath({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "with-frontmatter.md",
        filePath,
      });

      expect(rule.getBody()).toBe("# Content\n\nThis is the actual content.");
      expect(rule.getFileContent()).toBe(content);
    });

    it("should handle empty file", async () => {
      const rulesDir = join(testDir, "rules");
      await mkdir(rulesDir, { recursive: true });

      const filePath = join(rulesDir, "empty.md");
      await writeFile(filePath, "");

      const rule = await CodexcliRule.fromFilePath({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "empty.md",
        filePath,
      });

      expect(rule.getBody()).toBe("");
    });

    it("should handle file with only whitespace", async () => {
      const rulesDir = join(testDir, "rules");
      await mkdir(rulesDir, { recursive: true });

      const filePath = join(rulesDir, "whitespace.md");
      const content = "   \n\n  \t  \n   ";
      await writeFile(filePath, content);

      const rule = await CodexcliRule.fromFilePath({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "whitespace.md",
        filePath,
      });

      expect(rule.getBody()).toBe("");
    });
  });

  describe("fromRulesyncRule", () => {
    it("should create CodexcliRule from RulesyncRule", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "test.md",
        frontmatter: {
          root: false,
          targets: ["codexcli"],
          description: "Test rule",
          globs: ["**/*"],
        },
        body: "# Test Rule\n\nThis is a test.",
        fileContent:
          "---\nroot: false\ntargets:\n  - codexcli\n---\n# Test Rule\n\nThis is a test.",
      });

      const codexcliRule = CodexcliRule.fromRulesyncRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        rulesyncRule,
      });

      expect(codexcliRule.getBody()).toBe("# Test Rule\n\nThis is a test.");
      expect(codexcliRule.getRelativeFilePath()).toBe("test.md");
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert to RulesyncRule with correct frontmatter", () => {
      const codexcliRule = new CodexcliRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        body: "# Test Rule\n\nThis is a test.",
      });

      const rulesyncRule = codexcliRule.toRulesyncRule();
      const frontmatter = rulesyncRule.getFrontmatter();

      expect(frontmatter.root).toBe(false);
      expect(frontmatter.targets).toEqual(["codexcli"]);
      expect(frontmatter.description).toBe("OpenAI Codex CLI instructions");
      expect(frontmatter.globs).toEqual(["**/*"]);
      expect(rulesyncRule.getBody()).toBe("# Test Rule\n\nThis is a test.");
    });
  });

  describe("validate", () => {
    it("should always return success", () => {
      const rule = new CodexcliRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        body: "# Test",
      });

      const result = rule.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });

    it("should return success even for empty body", () => {
      const rule = new CodexcliRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "empty.md",
        body: "",
      });

      const result = rule.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });
  });

  describe("getBody", () => {
    it("should return the body content", () => {
      const body = "# Test Rule\n\nThis is the content.";
      const rule = new CodexcliRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        body,
      });

      expect(rule.getBody()).toBe(body);
    });
  });

  describe("generateAgentsFile", () => {
    it("should generate AGENTS.md content with body", () => {
      const body = "# Development Guidelines\n\nUse strict TypeScript mode.";
      const rule = new CodexcliRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        body,
      });

      const content = rule.generateAgentsFile();
      expect(content).toContain("# Project Instructions");
      expect(content).toContain("Use strict TypeScript mode.");
    });

    it("should generate default content for empty body", () => {
      const rule = new CodexcliRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        body: "",
      });

      const content = rule.generateAgentsFile();
      expect(content).toContain("# Project Instructions");
      expect(content).toContain("## Development Guidelines");
      expect(content).toContain("Add your coding standards");
    });
  });

  describe("getOutputFilePath", () => {
    it("should return AGENTS.md", () => {
      const rule = new CodexcliRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        body: "# Test",
      });

      expect(rule.getOutputFilePath()).toBe("AGENTS.md");
    });
  });

  describe("getOutputContent", () => {
    it("should return generated AGENTS.md content", () => {
      const body = "# My Guidelines\n\nFollow these rules.";
      const rule = new CodexcliRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        body,
      });

      const outputContent = rule.getOutputContent();
      expect(outputContent).toContain("# Project Instructions");
      expect(outputContent).toContain("Follow these rules.");
    });
  });

  describe("round-trip conversion", () => {
    it("should maintain content through CodexcliRule -> RulesyncRule -> CodexcliRule conversion", () => {
      const originalBody = "# Codex CLI Rules\n\n- Use TypeScript\n- Write comprehensive tests";

      // Create original rule
      const originalRule = new CodexcliRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "standards.md",
        body: originalBody,
      });

      // Convert to RulesyncRule
      const rulesyncRule = originalRule.toRulesyncRule();

      // Convert back to CodexcliRule
      const convertedRule = CodexcliRule.fromRulesyncRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        rulesyncRule,
      });

      // Verify content is preserved
      expect(convertedRule.getBody()).toBe(originalBody);
      expect(convertedRule.getRelativeFilePath()).toBe("standards.md");
    });
  });

  describe("edge cases", () => {
    it("should handle special characters in content", () => {
      const body = "# Test\n\n`code` **bold** *italic* [link](url) > quote\n\n- list\n1. numbered";

      const rule = new CodexcliRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "special.md",
        body,
      });

      expect(rule.getBody()).toBe(body);
    });

    it("should handle unicode characters", () => {
      const body = "# テスト\n\n日本語のコンテンツ 🚀 ✨ 📝";

      const rule = new CodexcliRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "unicode.md",
        body,
      });

      expect(rule.getBody()).toBe(body);
    });

    it("should handle very long content", () => {
      const body = "# Large Rule\n\n" + "This is a very long line. ".repeat(1000);

      const rule = new CodexcliRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "large.md",
        body,
      });

      expect(rule.getBody()).toBe(body);
      expect(rule.getBody().length).toBeGreaterThan(20000);
    });
  });
});
