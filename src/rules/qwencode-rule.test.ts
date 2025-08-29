import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import type { RuleFrontmatter } from "../types/rules.js";
import { QwencodeRule } from "./qwencode-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("QwencodeRule", () => {
  let _testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir: _testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("fromFilePath", () => {
    it("should create QwencodeRule from file path", async () => {
      const filePath = join(_testDir, "qwencode-rule.md");
      const fileContent = `Use TypeScript strict mode
Focus on Qwen3-Coder optimization`;

      await writeFile(filePath, fileContent);

      const rule = await QwencodeRule.fromFilePath({
        baseDir: _testDir,
        relativeDirPath: ".",
        relativeFilePath: "qwencode-rule.md",
        filePath,
        validate: false,
      });

      expect(rule).toBeInstanceOf(QwencodeRule);
      expect(rule.getRelativeFilePath()).toBe("qwencode-rule.md");
      expect(rule.getFileContent()).toBe(fileContent);
    });

    it("should handle plain text content", async () => {
      const filePath = join(_testDir, "plain-rule.md");
      const fileContent = `Content without frontmatter`;

      await writeFile(filePath, fileContent);

      const rule = await QwencodeRule.fromFilePath({
        baseDir: _testDir,
        relativeDirPath: ".",
        relativeFilePath: "plain-rule.md",
        filePath,
        validate: false,
      });

      expect(rule).toBeInstanceOf(QwencodeRule);
      expect(rule.validate().success).toBe(true);
      expect(rule.getFileContent()).toBe(fileContent);
    });

    it("should identify QWEN.md as root file", async () => {
      const filePath = join(_testDir, "QWEN.md");
      const fileContent = `# Project Guidelines
Tech Stack: TypeScript`;

      await writeFile(filePath, fileContent);

      const rule = await QwencodeRule.fromFilePath({
        baseDir: _testDir,
        relativeDirPath: ".",
        relativeFilePath: "QWEN.md",
        filePath,
        validate: false,
      });

      expect(rule).toBeInstanceOf(QwencodeRule);
      expect(rule.getRelativeFilePath()).toBe("QWEN.md");
      expect(rule.getFileContent()).toBe(fileContent);
    });
  });

  describe("fromRulesyncRule", () => {
    it("should create QwencodeRule from RulesyncRule", () => {
      const rulesyncFrontmatter: RuleFrontmatter = {
        root: false,
        targets: ["qwencode"],
        description: "Test description",
        globs: ["**/*.ts"],
      };

      const rulesyncRule = new RulesyncRule({
        baseDir: _testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        frontmatter: rulesyncFrontmatter,
        body: "Test content",
        fileContent: "---\ndescription: Test description\n---\nTest content",
      });

      const rule = QwencodeRule.fromRulesyncRule({
        baseDir: _testDir,
        relativeDirPath: "rules",
        rulesyncRule,
        validate: false,
      });

      expect(rule).toBeInstanceOf(QwencodeRule);
      expect(rule.getRelativeFilePath()).toBe("test.md");
      expect(rule.getRelativeDirPath()).toBe(join(".qwen", "memories"));
      expect(rule.getFileContent()).toBe("Test content");
    });

    it("should create QwencodeRule with QWEN.md when root is true", () => {
      const rulesyncFrontmatter: RuleFrontmatter = {
        root: true,
        targets: ["qwencode"],
        description: "Root rule description",
        globs: ["**/*.ts"],
      };

      const rulesyncRule = new RulesyncRule({
        baseDir: _testDir,
        relativeDirPath: "rules",
        relativeFilePath: "root-rule.md",
        frontmatter: rulesyncFrontmatter,
        body: "Root test content",
        fileContent: "---\nroot: true\ndescription: Root rule description\n---\nRoot test content",
      });

      const rule = QwencodeRule.fromRulesyncRule({
        baseDir: _testDir,
        relativeDirPath: "rules",
        rulesyncRule,
        validate: false,
      });

      expect(rule).toBeInstanceOf(QwencodeRule);
      expect(rule.getRelativeFilePath()).toBe("QWEN.md");
      expect(rule.getRelativeDirPath()).toBe(".");
      expect(rule.getFileContent()).toBe("Root test content");
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert QwencodeRule to RulesyncRule", () => {
      const originalRule = new QwencodeRule({
        baseDir: _testDir,
        relativeDirPath: join(".qwen", "memories"),
        relativeFilePath: "test.md",
        fileContent: "Test content for Qwen Code",
        body: "Test content for Qwen Code",
        validate: false,
      });

      const rulesyncRule = originalRule.toRulesyncRule();

      expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
      expect(rulesyncRule.getRelativeDirPath()).toBe(".rulesync/rules");
      expect(rulesyncRule.getRelativeFilePath()).toBe("test.md");
      expect(rulesyncRule.getFrontmatter().targets).toContain("qwencode");
      expect(rulesyncRule.getBody()).toBe("Test content for Qwen Code");
    });
  });

  describe("validate", () => {
    it("should return success for valid content", () => {
      const rule = new QwencodeRule({
        baseDir: _testDir,
        relativeDirPath: ".",
        relativeFilePath: "test.md",
        fileContent: "Valid content",
        body: "Valid content",
        validate: false,
      });

      const result = rule.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });
});
