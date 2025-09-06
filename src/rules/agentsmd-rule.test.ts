import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../utils/file.js";
import { AgentsMdRule } from "./agentsmd-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("AgentsMdRule", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("constructor", () => {
    it("should create an AgentsMdRule with valid parameters", () => {
      const rule = new AgentsMdRule({
        baseDir: testDir,
        relativeDirPath: ".agents/memories",
        relativeFilePath: "test.md",
        fileContent: "# Test Agent\n\nThis is a test agent configuration.",
      });

      expect(rule.getFileContent()).toBe("# Test Agent\n\nThis is a test agent configuration.");
    });

    it("should create an AgentsMdRule with root flag", () => {
      const rule = new AgentsMdRule({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
        fileContent: "# Root Agent\n\nThis is a root agent configuration.",
        root: true,
      });

      expect(rule.getFileContent()).toBe("# Root Agent\n\nThis is a root agent configuration.");
    });

    it("should default root to false when not specified", () => {
      const rule = new AgentsMdRule({
        baseDir: testDir,
        relativeDirPath: ".agents/memories",
        relativeFilePath: "test.md",
        fileContent: "# Test Agent\n\nContent",
      });

      expect(rule.getFileContent()).toBe("# Test Agent\n\nContent");
    });
  });

  describe("fromFile", () => {
    it("should create AgentsMdRule from root AGENTS.md file", async () => {
      const content = "# Root Agent Configuration\n\nThis is the main agent file.";
      await writeFileContent(join(testDir, "AGENTS.md"), content);

      const rule = await AgentsMdRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "AGENTS.md",
      });

      expect(rule.getFileContent()).toBe(content);
    });

    it("should create AgentsMdRule from memory file in .agents/memories", async () => {
      const memoriesDir = join(testDir, ".agents", "memories");
      await ensureDir(memoriesDir);

      const content = "# Memory Agent\n\nThis is a memory agent configuration.";
      await writeFileContent(join(memoriesDir, "memory.md"), content);

      const rule = await AgentsMdRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "memory.md",
      });

      expect(rule.getFileContent()).toBe(content);
    });

    it("should handle validation parameter", async () => {
      const content = "# Test Agent\n\nContent";
      await writeFileContent(join(testDir, "AGENTS.md"), content);

      const rule = await AgentsMdRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "AGENTS.md",
        validate: false,
      });

      expect(rule.getFileContent()).toBe(content);
    });

    it("should determine root status from file path", async () => {
      // Test root file
      const rootContent = "# Root Agent";
      await writeFileContent(join(testDir, "AGENTS.md"), rootContent);

      const rootRule = await AgentsMdRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "AGENTS.md",
      });

      expect(rootRule.getFileContent()).toBe(rootContent);

      // Test memory file
      const memoriesDir = join(testDir, ".agents", "memories");
      await ensureDir(memoriesDir);
      const memoryContent = "# Memory Agent";
      await writeFileContent(join(memoriesDir, "memory.md"), memoryContent);

      const memoryRule = await AgentsMdRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "memory.md",
      });

      expect(memoryRule.getFileContent()).toBe(memoryContent);
    });
  });

  describe("fromRulesyncRule", () => {
    it("should create AgentsMdRule from RulesyncRule", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".agents/memories",
        relativeFilePath: "test.md",
        frontmatter: {},
        body: "# Test Agent\n\nAgent configuration content.",
      });

      const rule = AgentsMdRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule,
      });

      expect(rule.getFileContent()).toBe("# Test Agent\n\nAgent configuration content.");
    });

    it("should handle validation parameter", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".agents/memories",
        relativeFilePath: "test.md",
        frontmatter: {},
        body: "# Test Agent\n\nContent",
      });

      const rule = AgentsMdRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule,
        validate: false,
      });

      expect(rule.getFileContent()).toBe("# Test Agent\n\nContent");
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert AgentsMdRule to RulesyncRule", () => {
      const rule = new AgentsMdRule({
        baseDir: testDir,
        relativeDirPath: ".agents/memories",
        relativeFilePath: "test.md",
        fileContent: "# Test Agent\n\nAgent configuration.",
      });

      const rulesyncRule = rule.toRulesyncRule();

      expect(rulesyncRule.getBody()).toBe("# Test Agent\n\nAgent configuration.");
      expect(rulesyncRule.getFrontmatter()).toEqual({});
    });

    it("should handle root agent file conversion", () => {
      const rule = new AgentsMdRule({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
        fileContent: "# Root Agent\n\nRoot configuration.",
        root: true,
      });

      const rulesyncRule = rule.toRulesyncRule();

      expect(rulesyncRule.getBody()).toBe("# Root Agent\n\nRoot configuration.");
      expect(rulesyncRule.getFrontmatter()).toEqual({});
    });
  });

  describe("validate", () => {
    it("should always return success for any content", () => {
      const rule = new AgentsMdRule({
        baseDir: testDir,
        relativeDirPath: ".agents/memories",
        relativeFilePath: "test.md",
        fileContent: "# Test Agent\n\nValid content.",
      });

      const result = rule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });

    it("should return success for empty content", () => {
      const rule = new AgentsMdRule({
        baseDir: testDir,
        relativeDirPath: ".agents/memories",
        relativeFilePath: "test.md",
        fileContent: "",
      });

      const result = rule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });

    it("should return success for malformed markdown", () => {
      const rule = new AgentsMdRule({
        baseDir: testDir,
        relativeDirPath: ".agents/memories",
        relativeFilePath: "test.md",
        fileContent: "# Unclosed heading\nSome text without proper structure\n### Random heading",
      });

      const result = rule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });

    it("should return success for very long content", () => {
      const longContent = "# Long Agent\n\n" + "A".repeat(10000);
      const rule = new AgentsMdRule({
        baseDir: testDir,
        relativeDirPath: ".agents/memories",
        relativeFilePath: "test.md",
        fileContent: longContent,
      });

      const result = rule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });
  });

  describe("file operations", () => {
    it("should handle files with special characters", async () => {
      const memoriesDir = join(testDir, ".agents", "memories");
      await ensureDir(memoriesDir);

      const content = "# Special Agent\n\nContent with special chars: éñüñ";
      await writeFileContent(join(memoriesDir, "special-char.md"), content);

      const rule = await AgentsMdRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "special-char.md",
      });

      expect(rule.getFileContent()).toBe(content);
    });

    it("should handle nested directory structure", async () => {
      const nestedDir = join(testDir, ".agents", "memories", "nested");
      await ensureDir(nestedDir);

      const content = "# Nested Agent\n\nNested configuration.";
      await writeFileContent(join(nestedDir, "nested.md"), content);

      const rule = await AgentsMdRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "nested/nested.md",
      });

      expect(rule.getFileContent()).toBe(content);
    });
  });

  describe("edge cases", () => {
    it("should handle empty file content", async () => {
      const memoriesDir = join(testDir, ".agents", "memories");
      await ensureDir(memoriesDir);

      await writeFileContent(join(memoriesDir, "empty.md"), "");

      const rule = await AgentsMdRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "empty.md",
      });

      expect(rule.getFileContent()).toBe("");
      expect(rule.validate().success).toBe(true);
    });

    it("should handle file with only whitespace", async () => {
      const memoriesDir = join(testDir, ".agents", "memories");
      await ensureDir(memoriesDir);

      const content = "   \n\n\t  \n";
      await writeFileContent(join(memoriesDir, "whitespace.md"), content);

      const rule = await AgentsMdRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "whitespace.md",
      });

      expect(rule.getFileContent()).toBe(content);
      expect(rule.validate().success).toBe(true);
    });

    it("should handle very large file content", () => {
      const largeContent = "# Large Agent\n\n" + "Content ".repeat(100000);
      const rule = new AgentsMdRule({
        baseDir: testDir,
        relativeDirPath: ".agents/memories",
        relativeFilePath: "large.md",
        fileContent: largeContent,
      });

      expect(rule.getFileContent()).toBe(largeContent);
      expect(rule.validate().success).toBe(true);
    });
  });
});
