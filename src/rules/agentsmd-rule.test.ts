import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import matter from "gray-matter";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
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
    it("should create instance with valid body content", () => {
      const body = "# Project Guidelines\n\nUse TypeScript for all projects.";
      const rule = new AgentsMdRule({
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
          new AgentsMdRule({
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
          new AgentsMdRule({
            relativeDirPath: ".",
            relativeFilePath: "AGENTS.md",
            body: "",
            validate: true,
          }),
      ).not.toThrow();
    });

    it("should accept fileContent parameter", () => {
      const body = "# Project Guidelines";
      const fileContent = body;

      const rule = new AgentsMdRule({
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
        body,
        fileContent,
        validate: false,
      });

      expect(rule.getFileContent()).toBe(fileContent);
    });
  });

  describe("fromFilePath", () => {
    it("should read and parse AGENTS.md file", async () => {
      const agentsPath = join(testDir, "AGENTS.md");
      const content = "# Project Guidelines\n\nUse TypeScript for all projects.";
      await writeFile(agentsPath, content);

      const rule = await AgentsMdRule.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
        filePath: agentsPath,
      });

      expect(rule.getBody()).toBe(content);
      expect(rule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(rule.getFileContent()).toBe(content);
    });

    it("should handle file with frontmatter", async () => {
      const agentsPath = join(testDir, "AGENTS.md");
      const body = "Use TypeScript for all projects.";
      const content = matter.stringify(body, { title: "Project Guidelines" });
      await writeFile(agentsPath, content);

      const rule = await AgentsMdRule.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
        filePath: agentsPath,
      });

      expect(rule.getBody()).toBe(body);
      expect(rule.getFileContent()).toBe(content);
    });

    it("should trim whitespace from body content", async () => {
      const agentsPath = join(testDir, "AGENTS.md");
      const content = "\n\n  # Project Guidelines  \n\n  Use TypeScript.  \n\n  ";
      await writeFile(agentsPath, content);

      const rule = await AgentsMdRule.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
        filePath: agentsPath,
      });

      expect(rule.getBody()).toBe("# Project Guidelines  \n\n  Use TypeScript.");
    });

    it("should handle empty file", async () => {
      const agentsPath = join(testDir, "AGENTS.md");
      await writeFile(agentsPath, "");

      const rule = await AgentsMdRule.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
        filePath: agentsPath,
        validate: true,
      });

      expect(rule.getBody()).toBe("");
      expect(rule.validate().success).toBe(true);
    });

    it("should create instance from subdirectory", async () => {
      const subDir = join(testDir, "subdir");
      await mkdir(subDir, { recursive: true });
      const agentsPath = join(subDir, "AGENTS.md");
      const content = "# Subdir Guidelines\n\nSpecific rules for this module.";
      await writeFile(agentsPath, content);

      const rule = await AgentsMdRule.fromFilePath({
        baseDir: testDir,
        relativeDirPath: "subdir",
        relativeFilePath: "AGENTS.md",
        filePath: agentsPath,
      });

      expect(rule.getBody()).toBe(content);
      expect(rule.getRelativeDirPath()).toBe("subdir");
    });
  });

  describe("fromRulesyncRule", () => {
    it("should convert from RulesyncRule with root=true", () => {
      const body = "# Project Guidelines\n\nUse TypeScript for all projects.";
      const frontmatter = {
        root: true,
        targets: ["agentsmd" as const],
        description: "AGENTS.md instructions",
        globs: ["**/*"],
      };
      const fileContent = matter.stringify(body, frontmatter);

      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
        frontmatter,
        body,
        fileContent,
        validate: false,
      });

      const rule = AgentsMdRule.fromRulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".",
        rulesyncRule,
      });

      expect(rule.getBody()).toBe(body);
      expect(rule.getRelativeFilePath()).toBe("AGENTS.md");
    });

    it("should convert from RulesyncRule with root=false", () => {
      const body = "# Module Guidelines\n\nModule-specific rules.";
      const frontmatter = {
        root: false,
        targets: ["agentsmd" as const],
        description: "Directory-specific AGENTS.md",
        globs: ["src/**/*"],
      };
      const fileContent = matter.stringify(body, frontmatter);

      const rulesyncRule = new RulesyncRule({
        relativeDirPath: "src",
        relativeFilePath: "AGENTS.md",
        frontmatter,
        body,
        fileContent,
        validate: false,
      });

      const rule = AgentsMdRule.fromRulesyncRule({
        baseDir: testDir,
        relativeDirPath: "src",
        rulesyncRule,
      });

      expect(rule.getBody()).toBe(body);
      expect(rule.getRelativeDirPath()).toBe("src");
      expect(rule.getRelativeFilePath()).toBe("AGENTS.md");
    });

    it("should handle custom base directory", () => {
      const body = "# Guidelines";
      const frontmatter = {
        root: true,
        targets: ["agentsmd" as const],
        description: "AGENTS.md instructions",
        globs: ["**/*"],
      };
      const fileContent = matter.stringify(body, frontmatter);

      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
        frontmatter,
        body,
        fileContent,
        validate: false,
      });

      const customBaseDir = "/custom/base";
      const rule = AgentsMdRule.fromRulesyncRule({
        baseDir: customBaseDir,
        relativeDirPath: ".",
        rulesyncRule,
      });

      expect(rule.getBaseDir()).toBe(customBaseDir);
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert to RulesyncRule with proper frontmatter", () => {
      const body = "# Project Guidelines\n\nUse TypeScript for all projects.";
      const rule = new AgentsMdRule({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
        body,
        validate: false,
      });

      const rulesyncRule = rule.toRulesyncRule();

      expect(rulesyncRule.getBody()).toBe(body);
      expect(rulesyncRule.getFrontmatter()).toEqual({
        root: true,
        targets: ["agentsmd"],
        description: "AGENTS.md instructions",
        globs: ["**/*"],
      });
      expect(rulesyncRule.getRelativeFilePath()).toBe("AGENTS.md");
    });

    it("should preserve base directory and paths", () => {
      const body = "# Module Guidelines";
      const rule = new AgentsMdRule({
        baseDir: testDir,
        relativeDirPath: "src/components",
        relativeFilePath: "AGENTS.md",
        body,
        validate: false,
      });

      const rulesyncRule = rule.toRulesyncRule();

      expect(rulesyncRule.getRelativeDirPath()).toBe("src/components");
      expect(rulesyncRule.getRelativeFilePath()).toBe("AGENTS.md");
      // RulesyncRule should have baseDir accessible via inheritance but let's verify using alternative approach
      expect(rule.getBaseDir()).toBe(testDir);
    });

    it("should generate proper file content with frontmatter", () => {
      const body = "# Project Guidelines\n\nUse TypeScript.";
      const rule = new AgentsMdRule({
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
        body,
        validate: false,
      });

      const rulesyncRule = rule.toRulesyncRule();
      const fileContent = rulesyncRule.getFileContent();
      const { data: parsedFrontmatter, content: parsedBody } = matter(fileContent);

      expect(parsedFrontmatter).toEqual({
        root: true,
        targets: ["agentsmd"],
        description: "AGENTS.md instructions",
        globs: ["**/*"],
      });
      expect(parsedBody.trim()).toBe(body);
    });
  });

  describe("validate", () => {
    it("should pass validation for valid content", () => {
      const rule = new AgentsMdRule({
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
        body: "# Valid content",
        validate: false,
      });

      const result = rule.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });

    it("should pass validation for empty content", () => {
      const rule = new AgentsMdRule({
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
        body: "",
        validate: false,
      });

      const result = rule.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });

    it("should pass validation for whitespace-only content", () => {
      const rule = new AgentsMdRule({
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
        body: "   \n\n  \t  ",
        validate: false,
      });

      const result = rule.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });
  });

  describe("integration tests", () => {
    it("should handle round-trip conversion: AgentsMdRule → RulesyncRule → AgentsMdRule", () => {
      const originalBody =
        "# Project Guidelines\n\n## Tech Stack\n- TypeScript\n- React\n\n## Standards\n- Use hooks\n- Write tests";

      // Create initial AgentsMdRule
      const originalRule = new AgentsMdRule({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
        body: originalBody,
        validate: false,
      });

      // Convert to RulesyncRule
      const rulesyncRule = originalRule.toRulesyncRule();

      // Convert back to AgentsMdRule
      const convertedRule = AgentsMdRule.fromRulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".",
        rulesyncRule,
        validate: false,
      });

      // Verify content integrity
      expect(convertedRule.getBody()).toBe(originalBody);
      expect(convertedRule.getBaseDir()).toBe(testDir);
      expect(convertedRule.getRelativeDirPath()).toBe(".");
      expect(convertedRule.getRelativeFilePath()).toBe("AGENTS.md");
    });

    it("should handle file path → AgentsMdRule → RulesyncRule → AgentsMdRule", async () => {
      const agentsPath = join(testDir, "AGENTS.md");
      const originalContent =
        "# My Project\n\n## Guidelines\n- Follow conventions\n- Write documentation";
      await writeFile(agentsPath, originalContent);

      // Read from file
      const fileRule = await AgentsMdRule.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
        filePath: agentsPath,
      });

      // Convert to RulesyncRule
      const rulesyncRule = fileRule.toRulesyncRule();

      // Convert back to AgentsMdRule
      const finalRule = AgentsMdRule.fromRulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".",
        rulesyncRule,
      });

      expect(finalRule.getBody()).toBe(originalContent);
      expect(finalRule.getBaseDir()).toBe(testDir);
    });

    it("should preserve content through complex file operations", async () => {
      // Create nested directory structure
      const subDir = join(testDir, "src", "components");
      await mkdir(subDir, { recursive: true });

      const agentsPath = join(subDir, "AGENTS.md");
      const content =
        "# Component Guidelines\n\n## React Standards\n- Use functional components\n- Implement TypeScript interfaces\n- Write unit tests";
      await writeFile(agentsPath, content);

      // Load from nested path
      const rule = await AgentsMdRule.fromFilePath({
        baseDir: testDir,
        relativeDirPath: "src/components",
        relativeFilePath: "AGENTS.md",
        filePath: agentsPath,
      });

      // Convert and verify
      const rulesyncRule = rule.toRulesyncRule();
      expect(rulesyncRule.getBody()).toBe(content);
      expect(rulesyncRule.getRelativeDirPath()).toBe("src/components");

      // Convert back and verify
      const convertedRule = AgentsMdRule.fromRulesyncRule({
        baseDir: testDir,
        relativeDirPath: "src/components",
        rulesyncRule,
      });
      expect(convertedRule.getBody()).toBe(content);
    });
  });

  describe("error handling", () => {
    it("should handle non-existent file path gracefully", async () => {
      const nonExistentPath = join(testDir, "nonexistent", "AGENTS.md");

      await expect(
        AgentsMdRule.fromFilePath({
          baseDir: testDir,
          relativeDirPath: "nonexistent",
          relativeFilePath: "AGENTS.md",
          filePath: nonExistentPath,
        }),
      ).rejects.toThrow();
    });

    it("should maintain file path information for error reporting", () => {
      const rule = new AgentsMdRule({
        baseDir: testDir,
        relativeDirPath: "src",
        relativeFilePath: "AGENTS.md",
        body: "# Guidelines",
        validate: false,
      });

      const expectedPath = join(testDir, "src", "AGENTS.md");
      expect(rule.getFilePath()).toBe(expectedPath);
    });
  });

  describe("edge cases", () => {
    it("should handle very large content", () => {
      const largeContent = "# Large File\n\n" + "Lorem ipsum ".repeat(1000);

      const rule = new AgentsMdRule({
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
        body: largeContent,
        validate: false,
      });

      expect(rule.getBody()).toBe(largeContent);
      expect(rule.validate().success).toBe(true);
    });

    it("should handle content with special characters", () => {
      const specialContent =
        "# Project 🚀\n\n## Guidelines\n- Use emojis ✅\n- Handle unicode 中文\n- Escape chars: `code` & [links](./file.md)";

      const rule = new AgentsMdRule({
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
        body: specialContent,
        validate: false,
      });

      expect(rule.getBody()).toBe(specialContent);
    });

    it("should handle Windows-style line endings", async () => {
      const agentsPath = join(testDir, "AGENTS.md");
      const content = "# Project Guidelines\r\n\r\nUse TypeScript for all projects.\r\n";
      await writeFile(agentsPath, content);

      const rule = await AgentsMdRule.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
        filePath: agentsPath,
      });

      // Should preserve original content including line endings
      expect(rule.getBody()).toContain("Use TypeScript for all projects.");
    });
  });

  describe("method accessibility", () => {
    it("should provide access to inherited AiFile methods", () => {
      const rule = new AgentsMdRule({
        baseDir: testDir,
        relativeDirPath: "docs",
        relativeFilePath: "AGENTS.md",
        body: "# Documentation Guidelines",
        validate: false,
      });

      expect(rule.getBaseDir()).toBe(testDir);
      expect(rule.getRelativeDirPath()).toBe("docs");
      expect(rule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(typeof rule.getFileContent).toBe("function");
      expect(typeof rule.getFilePath).toBe("function");
    });
  });
});
