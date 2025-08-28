import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import matter from "gray-matter";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import { OpenCodeRule } from "./opencode-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("OpenCodeRule", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("constructor", () => {
    it("should create instance with valid body content", () => {
      const body = "# Project Guidelines\n\nUse TypeScript for all projects.";
      const rule = new OpenCodeRule({
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
        body,
        validate: false,
      });

      expect(rule.getBody()).toBe(body);
      expect(rule.getRelativeFilePath()).toBe("AGENTS.md");
    });

    it("should validate content when validate=true", () => {
      const body = "# Project Guidelines\n\nUse TypeScript for all projects.";

      expect(
        () =>
          new OpenCodeRule({
            relativeDirPath: ".",
            relativeFilePath: "AGENTS.md",
            body,
            validate: true,
          }),
      ).not.toThrow();
    });

    it("should accept empty content when validate=true", () => {
      expect(
        () =>
          new OpenCodeRule({
            relativeDirPath: ".",
            relativeFilePath: "AGENTS.md",
            body: "",
            validate: true,
          }),
      ).not.toThrow();
    });
  });

  describe("fromFilePath", () => {
    it("should create instance from plain markdown file", async () => {
      const agentsPath = join(testDir, "AGENTS.md");
      const content = "# Project Guidelines\n\nUse TypeScript for all projects.";
      await writeFile(agentsPath, content);

      const rule = await OpenCodeRule.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
        filePath: agentsPath,
      });

      expect(rule.getBody()).toBe(content);
      expect(rule.getOutputFilePath()).toBe("AGENTS.md");
      expect(rule.getOutputContent()).toBe(content);
    });

    it("should create instance from file with frontmatter", async () => {
      const agentsPath = join(testDir, "AGENTS.md");
      const frontmatter = { description: "Project guidelines" };
      const body = "# Project Guidelines\n\nUse TypeScript for all projects.";
      const content = matter.stringify(body, frontmatter);
      await writeFile(agentsPath, content);

      const rule = await OpenCodeRule.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
        filePath: agentsPath,
      });

      // Should extract only the body content, ignoring frontmatter
      expect(rule.getBody()).toBe(body);
      expect(rule.getOutputContent()).toBe(body);
    });

    it("should handle empty file", async () => {
      const agentsPath = join(testDir, "AGENTS.md");
      await writeFile(agentsPath, "");

      const rule = await OpenCodeRule.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
        filePath: agentsPath,
      });

      expect(rule.getBody()).toBe("");
      expect(rule.getOutputContent()).toBe("");
    });
  });

  describe("fromRulesyncRule", () => {
    it("should create OpenCodeRule from RulesyncRule", () => {
      const body = "# Project Guidelines\n\nUse TypeScript for all projects.";
      const frontmatter = {
        root: true,
        targets: ["opencode" as const],
        description: "OpenCode AGENTS.md instructions",
        globs: ["**/*"],
      };
      const fileContent = matter.stringify(body, frontmatter);

      const rulesyncRule = new RulesyncRule({
        baseDir: ".",
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "opencode.md",
        frontmatter,
        body,
        fileContent,
        validate: false,
      });

      const openCodeRule = OpenCodeRule.fromRulesyncRule({
        baseDir: ".",
        relativeDirPath: ".",
        rulesyncRule,
      });

      expect(openCodeRule.getBody()).toBe(body);
      expect(openCodeRule.getRelativeFilePath()).toBe("opencode.md");
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert to RulesyncRule with correct frontmatter", () => {
      const body = "# Project Guidelines\n\nUse TypeScript for all projects.";
      const openCodeRule = new OpenCodeRule({
        baseDir: ".",
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
        body,
        validate: false,
      });

      const rulesyncRule = openCodeRule.toRulesyncRule();

      expect(rulesyncRule.getBody()).toBe(body);
      expect(rulesyncRule.getFrontmatter()).toEqual({
        root: true,
        targets: ["opencode"],
        description: "OpenCode AGENTS.md instructions",
        globs: ["**/*"],
      });
    });
  });

  describe("validate", () => {
    it("should always return success", () => {
      const rule = new OpenCodeRule({
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
        body: "# Project Guidelines",
        validate: false,
      });

      const result = rule.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return success even with empty content", () => {
      const rule = new OpenCodeRule({
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
        body: "",
        validate: false,
      });

      const result = rule.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });

  describe("getOutputFilePath", () => {
    it("should return AGENTS.md", () => {
      const rule = new OpenCodeRule({
        relativeDirPath: ".",
        relativeFilePath: "test.md",
        body: "# Project Guidelines",
        validate: false,
      });

      expect(rule.getOutputFilePath()).toBe("AGENTS.md");
    });
  });

  describe("getOutputContent", () => {
    it("should return plain markdown content", () => {
      const body = "# Project Guidelines\n\nUse TypeScript for all projects.";
      const rule = new OpenCodeRule({
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
        body,
        validate: false,
      });

      expect(rule.getOutputContent()).toBe(body);
    });
  });

  describe("round-trip conversion", () => {
    it("should maintain content through OpenCodeRule → RulesyncRule → OpenCodeRule conversion", () => {
      const body = "# Project Guidelines\n\nUse TypeScript for all projects.";

      // Create original OpenCodeRule
      const original = new OpenCodeRule({
        baseDir: ".",
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
        body,
        validate: false,
      });

      // Convert to RulesyncRule
      const rulesyncRule = original.toRulesyncRule();

      // Convert back to OpenCodeRule
      const converted = OpenCodeRule.fromRulesyncRule({
        baseDir: ".",
        relativeDirPath: ".",
        rulesyncRule,
      });

      // Verify content is preserved
      expect(converted.getBody()).toBe(original.getBody());
      expect(converted.getOutputContent()).toBe(original.getOutputContent());
    });
  });

  describe("integration tests", () => {
    it("should handle file path → OpenCodeRule → RulesyncRule → OpenCodeRule", async () => {
      const agentsPath = join(testDir, "AGENTS.md");
      const originalContent = "# Project Guidelines\n\nUse TypeScript for all projects.";
      await writeFile(agentsPath, originalContent);

      // Load from file
      const fromFile = await OpenCodeRule.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
        filePath: agentsPath,
      });

      // Convert through RulesyncRule
      const rulesyncRule = fromFile.toRulesyncRule();
      const converted = OpenCodeRule.fromRulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".",
        rulesyncRule,
      });

      // Verify content preservation
      expect(converted.getBody()).toBe(originalContent);
      expect(converted.getOutputContent()).toBe(originalContent);
    });
  });
});
