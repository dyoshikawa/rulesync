import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import type { RuleFrontmatter } from "../types/rules.js";
import { ClaudecodeRule } from "./claudecode-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("ClaudecodeRule", () => {
  let _testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir: _testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("fromFilePath", () => {
    it("should create ClaudecodeRule from file path", async () => {
      const filePath = join(_testDir, "claudecode-rule.md");
      const fileContent = `Use TypeScript strict mode
Always write tests`;

      await writeFile(filePath, fileContent);

      const rule = await ClaudecodeRule.fromFilePath({
        baseDir: _testDir,
        relativeDirPath: ".",
        relativeFilePath: "claudecode-rule.md",
        filePath,
        validate: false,
      });

      expect(rule).toBeInstanceOf(ClaudecodeRule);
      expect(rule.getRelativeFilePath()).toBe("claudecode-rule.md");
      expect(rule.getFileContent()).toBe(fileContent);
    });

    it("should handle plain text content", async () => {
      const filePath = join(_testDir, "plain-rule.md");
      const fileContent = `Content without frontmatter`;

      await writeFile(filePath, fileContent);

      const rule = await ClaudecodeRule.fromFilePath({
        baseDir: _testDir,
        relativeDirPath: ".",
        relativeFilePath: "plain-rule.md",
        filePath,
        validate: false,
      });

      expect(rule).toBeInstanceOf(ClaudecodeRule);
      expect(rule.validate().success).toBe(true);
      expect(rule.getFileContent()).toBe(fileContent);
    });
  });

  describe("fromRulesyncRule", () => {
    it("should create ClaudecodeRule from RulesyncRule", () => {
      const rulesyncFrontmatter: RuleFrontmatter = {
        root: false,
        targets: ["claudecode"],
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

      const rule = ClaudecodeRule.fromRulesyncRule({
        baseDir: _testDir,
        relativeDirPath: "rules",
        rulesyncRule,
        validate: false,
      });

      expect(rule).toBeInstanceOf(ClaudecodeRule);
      expect(rule.getRelativeFilePath()).toBe("test.md");
      expect(rule.getRelativeDirPath()).toBe(join(".claude", "memories"));
      expect(rule.getFileContent()).toBe("Test content");
    });

    it("should create ClaudecodeRule with CLAUDE.md when root is true", () => {
      const rulesyncFrontmatter: RuleFrontmatter = {
        root: true,
        targets: ["claudecode"],
        description: "Root rule description",
        globs: ["**/*.ts"],
      };

      const rulesyncRule = new RulesyncRule({
        baseDir: _testDir,
        relativeDirPath: "rules",
        relativeFilePath: "root-test.md",
        frontmatter: rulesyncFrontmatter,
        body: "Root test content",
        fileContent: "---\ndescription: Root rule description\nroot: true\n---\nRoot test content",
      });

      const rule = ClaudecodeRule.fromRulesyncRule({
        baseDir: _testDir,
        relativeDirPath: "rules",
        rulesyncRule,
        validate: false,
      });

      expect(rule).toBeInstanceOf(ClaudecodeRule);
      expect(rule.getRelativeFilePath()).toBe("CLAUDE.md");
      expect(rule.getRelativeDirPath()).toBe("rules");
      expect(rule.getFileContent()).toBe("Root test content");
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert ClaudecodeRule to RulesyncRule", () => {
      const rule = new ClaudecodeRule({
        baseDir: _testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        fileContent: "Content",
        body: "Content",
        validate: false,
      });

      const rulesyncRule = rule.toRulesyncRule();

      expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
      expect(rulesyncRule.getFrontmatter().targets).toEqual(["claudecode"]);
      expect(rulesyncRule.getFrontmatter().description).toBe("");
      expect(rulesyncRule.getBody()).toBe("Content");
    });
  });

  describe("validate", () => {
    it("should always validate successfully", () => {
      const rule = new ClaudecodeRule({
        baseDir: _testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        fileContent: "Content",
        body: "Content",
        validate: false,
      });

      const result = rule.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });
  });


  describe("getFilePath", () => {
    it("should return correct file path", () => {
      const rule = new ClaudecodeRule({
        baseDir: _testDir,
        relativeDirPath: ".claude/memories",
        relativeFilePath: "test.md",
        fileContent: "Content",
        body: "Content",
        validate: false,
      });

      expect(rule.getFilePath()).toContain("test.md");
    });
  });


  describe("inheritance", () => {
    it("should inherit from ToolRule", () => {
      const rule = new ClaudecodeRule({
        baseDir: _testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        fileContent: "Content",
        body: "Content",
        validate: false,
      });

      expect(rule.getRelativeFilePath()).toBe("test.md");
      expect(rule.getRelativeDirPath()).toBe("rules");
      expect(rule.getFilePath()).toBe(join(_testDir, "rules", "test.md"));
    });
  });


  describe("complex scenarios", () => {
    it("should handle multiline content with markdown formatting", () => {
      const content = "# Coding Standards\n\n- Use TypeScript\n- Write tests\n\n## Security\n\n- Validate inputs";
      const rule = new ClaudecodeRule({
        baseDir: _testDir,
        relativeDirPath: "rules",
        relativeFilePath: "complex.md",
        fileContent: content,
        body: content,
        validate: false,
      });

      expect(rule.getRelativeFilePath()).toBe("complex.md");
      expect(rule.getFileContent()).toBe(content);
    });

    it("should handle rule with special characters in path", () => {
      const rule = new ClaudecodeRule({
        baseDir: _testDir,
        relativeDirPath: "special-rules",
        relativeFilePath: "rule-with-spaces and symbols.md",
        fileContent: "Content",
        body: "Content",
        validate: false,
      });

      expect(rule.getRelativeFilePath()).toBe("rule-with-spaces and symbols.md");
    });
  });
});
