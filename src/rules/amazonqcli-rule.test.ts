import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import { AmazonQCliRule } from "./amazonqcli-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("AmazonQCliRule", () => {
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
      const body = "# Coding Standards\n\nUse TypeScript strict mode.";
      const rule = new AmazonQCliRule({
        baseDir: testDir,
        relativeDirPath: ".amazonq/rules",
        relativeFilePath: "coding-standards.md",
        body,
        fileContent: body,
      });

      expect(rule.getBody()).toBe("# Coding Standards\n\nUse TypeScript strict mode.");
      expect(rule.getRelativeFilePath()).toBe("coding-standards.md");
    });

    it("should use provided fileContent when given", () => {
      const body = "# Test";
      const fileContent = "# Different Content";

      const rule = new AmazonQCliRule({
        baseDir: testDir,
        relativeDirPath: ".amazonq/rules",
        relativeFilePath: "test.md",
        body,
        fileContent,
      });

      expect(rule.getBody()).toBe(body);
      expect(rule.getFileContent()).toBe(fileContent);
    });

    it("should use body as fileContent when fileContent is not provided", () => {
      const body = "# Test Content";

      const rule = new AmazonQCliRule({
        baseDir: testDir,
        relativeDirPath: ".amazonq/rules",
        relativeFilePath: "test.md",
        body,
        fileContent: body,
      });

      expect(rule.getBody()).toBe(body);
      expect(rule.getFileContent()).toBe(body);
    });

    it("should handle root rule creation", () => {
      const body = "# Root Rule";

      const rule = new AmazonQCliRule({
        baseDir: testDir,
        relativeDirPath: ".amazonq/rules",
        relativeFilePath: "main.md",
        body,
        fileContent: body,
        root: true,
      });

      expect(rule.getBody()).toBe(body);
      expect(rule.isRoot()).toBe(true);
    });
  });

  describe("fromFilePath", () => {
    it("should create instance from plain markdown file", async () => {
      const rulesDir = join(testDir, ".amazonq", "rules");
      await mkdir(rulesDir, { recursive: true });

      const filePath = join(rulesDir, "coding-standards.md");
      const content = "# Coding Standards\n\nAlways use TypeScript.";
      await writeFile(filePath, content);

      const rule = await AmazonQCliRule.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".amazonq/rules",
        relativeFilePath: "coding-standards.md",
        filePath,
      });

      expect(rule.getBody()).toBe(content);
      expect(rule.getRelativeFilePath()).toBe("coding-standards.md");
    });

    it("should handle file with frontmatter correctly", async () => {
      const rulesDir = join(testDir, ".amazonq", "rules");
      await mkdir(rulesDir, { recursive: true });

      const filePath = join(rulesDir, "with-frontmatter.md");
      const content = `---
title: "Test Rule"
---
# Content

This is the actual content.`;
      await writeFile(filePath, content);

      const rule = await AmazonQCliRule.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".amazonq/rules",
        relativeFilePath: "with-frontmatter.md",
        filePath,
      });

      expect(rule.getBody()).toBe("# Content\n\nThis is the actual content.");
      expect(rule.getFileContent()).toBe(content);
    });

    it("should handle empty file", async () => {
      const rulesDir = join(testDir, ".amazonq", "rules");
      await mkdir(rulesDir, { recursive: true });

      const filePath = join(rulesDir, "empty.md");
      await writeFile(filePath, "");

      const rule = await AmazonQCliRule.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".amazonq/rules",
        relativeFilePath: "empty.md",
        filePath,
      });

      expect(rule.getBody()).toBe("");
    });

    it("should handle file with only whitespace", async () => {
      const rulesDir = join(testDir, ".amazonq", "rules");
      await mkdir(rulesDir, { recursive: true });

      const filePath = join(rulesDir, "whitespace.md");
      const content = "   \n\n  \t  \n   ";
      await writeFile(filePath, content);

      const rule = await AmazonQCliRule.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".amazonq/rules",
        relativeFilePath: "whitespace.md",
        filePath,
      });

      expect(rule.getBody()).toBe("");
    });

    it("should detect root rule from main.md file path", async () => {
      const rulesDir = join(testDir, ".amazonq", "rules");
      await mkdir(rulesDir, { recursive: true });

      const filePath = join(rulesDir, "main.md");
      const content = "# Main Rule\n\nThis is a root rule.";
      await writeFile(filePath, content);

      const rule = await AmazonQCliRule.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".amazonq/rules",
        relativeFilePath: "main.md",
        filePath,
      });

      expect(rule.getBody()).toBe(content);
      expect(rule.isRoot()).toBe(true);
      expect(rule.getRelativeFilePath()).toBe("main.md");
    });

    it("should not detect root rule for non-main.md files", async () => {
      const rulesDir = join(testDir, ".amazonq", "rules");
      await mkdir(rulesDir, { recursive: true });

      const filePath = join(rulesDir, "other.md");
      const content = "# Other Rule";
      await writeFile(filePath, content);

      const rule = await AmazonQCliRule.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".amazonq/rules",
        relativeFilePath: "other.md",
        filePath,
      });

      expect(rule.getBody()).toBe(content);
      expect(rule.isRoot()).toBe(false);
      expect(rule.getRelativeFilePath()).toBe("other.md");
    });
  });

  describe("fromRulesyncRule", () => {
    it("should create AmazonQCliRule from RulesyncRule", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "test.md",
        frontmatter: {
          root: false,
          targets: ["amazonqcli"],
          description: "Test rule",
          globs: ["**/*"],
        },
        body: "# Test Rule\n\nThis is a test.",
        fileContent:
          "---\nroot: false\ntargets:\n  - amazonqcli\n---\n# Test Rule\n\nThis is a test.",
      });

      const amazonqcliRule = AmazonQCliRule.fromRulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".amazonq/rules",
        rulesyncRule,
      });

      expect(amazonqcliRule.getBody()).toBe("# Test Rule\n\nThis is a test.");
      expect(amazonqcliRule.getRelativeFilePath()).toBe("test.md");
    });

    it("should create root AmazonQCliRule from root RulesyncRule", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "root-rule.md",
        frontmatter: {
          root: true,
          targets: ["amazonqcli"],
          description: "Root test rule",
          globs: ["**/*"],
        },
        body: "# Root Rule\n\nThis is a root test.",
        fileContent:
          "---\nroot: true\ntargets:\n  - amazonqcli\n---\n# Root Rule\n\nThis is a root test.",
      });

      const amazonqcliRule = AmazonQCliRule.fromRulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".amazonq/rules",
        rulesyncRule,
      });

      expect(amazonqcliRule.getBody()).toBe("# Root Rule\n\nThis is a root test.");
      expect(amazonqcliRule.getRelativeFilePath()).toBe("main.md");
      expect(amazonqcliRule.isRoot()).toBe(true);
    });

    it("should create non-root AmazonQCliRule from non-root RulesyncRule", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "non-root.md",
        frontmatter: {
          root: false,
          targets: ["amazonqcli"],
          description: "Non-root test rule",
          globs: ["**/*"],
        },
        body: "# Non-Root Rule\n\nThis is a non-root test.",
        fileContent:
          "---\nroot: false\ntargets:\n  - amazonqcli\n---\n# Non-Root Rule\n\nThis is a non-root test.",
      });

      const amazonqcliRule = AmazonQCliRule.fromRulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".amazonq/rules",
        rulesyncRule,
      });

      expect(amazonqcliRule.getBody()).toBe("# Non-Root Rule\n\nThis is a non-root test.");
      expect(amazonqcliRule.getRelativeFilePath()).toBe("non-root.md");
      expect(amazonqcliRule.getRelativeDirPath()).toBe(".amazonq/rules");
      expect(amazonqcliRule.isRoot()).toBe(false);
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert to RulesyncRule with correct frontmatter", () => {
      const amazonqcliRule = new AmazonQCliRule({
        baseDir: testDir,
        relativeDirPath: ".amazonq/rules",
        relativeFilePath: "test.md",
        body: "# Test Rule\n\nThis is a test.",
        fileContent: "# Test Rule\n\nThis is a test.",
      });

      const rulesyncRule = amazonqcliRule.toRulesyncRule();
      const frontmatter = rulesyncRule.getFrontmatter();

      expect(frontmatter.root).toBe(false);
      expect(frontmatter.targets).toEqual(["amazonqcli"]);
      expect(frontmatter.description).toBe("Amazon Q Developer CLI rules");
      expect(frontmatter.globs).toEqual(["**/*"]);
      expect(rulesyncRule.getBody()).toBe("# Test Rule\n\nThis is a test.");
      expect(rulesyncRule.getRelativeDirPath()).toBe(".rulesync/rules");
      expect(rulesyncRule.getRelativeFilePath()).toBe("test.md");
    });

    it("should convert root rule to RulesyncRule with root=true", () => {
      const amazonqcliRule = new AmazonQCliRule({
        baseDir: testDir,
        relativeDirPath: ".amazonq/rules",
        relativeFilePath: "main.md",
        body: "# Root Rule\n\nThis is a root rule.",
        fileContent: "# Root Rule\n\nThis is a root rule.",
        root: true,
      });

      const rulesyncRule = amazonqcliRule.toRulesyncRule();
      const frontmatter = rulesyncRule.getFrontmatter();

      expect(frontmatter.root).toBe(true);
      expect(frontmatter.targets).toEqual(["amazonqcli"]);
      expect(frontmatter.description).toBe("Amazon Q Developer CLI rules");
      expect(frontmatter.globs).toEqual(["**/*"]);
      expect(rulesyncRule.getBody()).toBe("# Root Rule\n\nThis is a root rule.");
      expect(rulesyncRule.getRelativeDirPath()).toBe(".rulesync/rules");
      expect(rulesyncRule.getRelativeFilePath()).toBe("main.md");
    });
  });

  describe("validate", () => {
    it("should always return success", () => {
      const rule = new AmazonQCliRule({
        baseDir: testDir,
        relativeDirPath: ".amazonq/rules",
        relativeFilePath: "test.md",
        body: "# Test",
        fileContent: "# Test",
      });

      const result = rule.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });

    it("should return success even for empty body", () => {
      const rule = new AmazonQCliRule({
        baseDir: testDir,
        relativeDirPath: ".amazonq/rules",
        relativeFilePath: "empty.md",
        body: "",
        fileContent: "",
      });

      const result = rule.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });
  });

  describe("getBody", () => {
    it("should return the body content", () => {
      const body = "# Test Rule\n\nThis is the content.";
      const rule = new AmazonQCliRule({
        baseDir: testDir,
        relativeDirPath: ".amazonq/rules",
        relativeFilePath: "test.md",
        body,
        fileContent: body,
      });

      expect(rule.getBody()).toBe(body);
    });
  });

  describe("round-trip conversion", () => {
    it("should maintain content through AmazonQCliRule -> RulesyncRule -> AmazonQCliRule conversion", () => {
      const originalBody = "# Amazon Q Rules\n\n- Use TypeScript\n- Write tests";

      // Create original rule
      const originalRule = new AmazonQCliRule({
        baseDir: testDir,
        relativeDirPath: ".amazonq/rules",
        relativeFilePath: "standards.md",
        body: originalBody,
        fileContent: originalBody,
      });

      // Convert to RulesyncRule
      const rulesyncRule = originalRule.toRulesyncRule();

      // Convert back to AmazonQCliRule
      const convertedRule = AmazonQCliRule.fromRulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".amazonq/rules",
        rulesyncRule,
      });

      // Verify content is preserved
      expect(convertedRule.getBody()).toBe(originalBody);
      expect(convertedRule.getRelativeFilePath()).toBe("standards.md");
    });

    it("should maintain content through root rule round-trip conversion", () => {
      const originalBody = "# Main Amazon Q Rules\n\n- Root level guidelines\n- Apply to all files";

      // Create original root rule
      const originalRule = new AmazonQCliRule({
        baseDir: testDir,
        relativeDirPath: ".amazonq/rules",
        relativeFilePath: "main.md",
        body: originalBody,
        fileContent: originalBody,
        root: true,
      });

      // Convert to RulesyncRule
      const rulesyncRule = originalRule.toRulesyncRule();
      expect(rulesyncRule.getFrontmatter().root).toBe(true);

      // Convert back to AmazonQCliRule
      const convertedRule = AmazonQCliRule.fromRulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".amazonq/rules",
        rulesyncRule,
      });

      // Verify content and root property are preserved
      expect(convertedRule.getBody()).toBe(originalBody);
      expect(convertedRule.getRelativeFilePath()).toBe("main.md");
      expect(convertedRule.isRoot()).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("should handle special characters in content", () => {
      const body = "# Test\n\n`code` **bold** *italic* [link](url) > quote\n\n- list\n1. numbered";

      const rule = new AmazonQCliRule({
        baseDir: testDir,
        relativeDirPath: ".amazonq/rules",
        relativeFilePath: "special.md",
        body,
        fileContent: body,
      });

      expect(rule.getBody()).toBe(body);
    });

    it("should handle unicode characters", () => {
      const body = "# テスト\n\n日本語のコンテンツ 🚀 ✨ 📝";

      const rule = new AmazonQCliRule({
        baseDir: testDir,
        relativeDirPath: ".amazonq/rules",
        relativeFilePath: "unicode.md",
        body,
        fileContent: body,
      });

      expect(rule.getBody()).toBe(body);
    });

    it("should handle very long content", () => {
      const body = "# Large Rule\n\n" + "This is a very long line. ".repeat(1000);

      const rule = new AmazonQCliRule({
        baseDir: testDir,
        relativeDirPath: ".amazonq/rules",
        relativeFilePath: "large.md",
        body,
        fileContent: body,
      });

      expect(rule.getBody()).toBe(body);
      expect(rule.getBody().length).toBeGreaterThan(20000);
    });
  });
});
