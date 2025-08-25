import { promises as fs } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("RulesyncRule", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("build", () => {
    it("should build a rule from file path and content", () => {
      const filePath = join(testDir, "test-rule.md");
      const fileContent = `---
target: copilot
description: Test rule
---

# Test Rule Content

This is a test rule.`;

      const rule = RulesyncRule.build({ filePath, fileContent });

      expect(rule.getFilePath()).toBe(filePath);
      expect(rule.getContent()).toContain("# Test Rule Content");
      expect(rule.getFrontmatter()).toMatchObject({
        target: "copilot",
        description: "Test rule",
      });
    });

    it("should handle content without frontmatter", () => {
      const filePath = join(testDir, "test-rule.md");
      const fileContent = "# Simple Rule\n\nNo frontmatter here.";

      const rule = RulesyncRule.build({ filePath, fileContent });

      expect(rule.getFilePath()).toBe(filePath);
      expect(rule.getContent()).toBe("# Simple Rule\n\nNo frontmatter here.");
      expect(rule.getFrontmatter()).toEqual({});
    });
  });

  describe("fromFilePath", () => {
    it("should load a rule from file", async () => {
      const filePath = join(testDir, "test-rule.md");
      const fileContent = `---
target: cursor
glob: "**/*.ts"
---

# TypeScript Rules`;

      await fs.writeFile(filePath, fileContent, "utf-8");

      const rule = await RulesyncRule.fromFilePath(filePath);

      expect(rule.getContent()).toContain("# TypeScript Rules");
      expect(rule.getFrontmatter()).toMatchObject({
        target: "cursor",
        glob: "**/*.ts",
      });
    });
  });

  describe("writeFile", () => {
    it("should write rule to file system", async () => {
      const filePath = join(testDir, "output", "rule.md");
      const fileContent = `---
target: cline
---

# Cline Rule`;

      const rule = RulesyncRule.build({ filePath, fileContent });
      await rule.writeFile();

      const writtenContent = await fs.readFile(filePath, "utf-8");
      expect(writtenContent).toContain("target: cline");
      expect(writtenContent).toContain("# Cline Rule");
    });

    it("should create directories if they do not exist", async () => {
      const filePath = join(testDir, "deep", "nested", "dir", "rule.md");
      const fileContent = "# Test Rule";

      const rule = RulesyncRule.build({ filePath, fileContent });
      await rule.writeFile();

      const writtenContent = await fs.readFile(filePath, "utf-8");
      expect(writtenContent).toBe("# Test Rule");
    });
  });

  describe("validate", () => {
    it("should validate valid rule", () => {
      const filePath = join(testDir, "rule.md");
      const fileContent = `---
target: copilot
---

# Valid Rule`;

      const rule = RulesyncRule.build({ filePath, fileContent });
      const result = rule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });

    it("should reject empty content", () => {
      const filePath = join(testDir, "rule.md");
      const fileContent = `---
target: copilot
---

`;

      const rule = RulesyncRule.build({ filePath, fileContent });
      const result = rule.validate();

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("Rule content cannot be");
    });

    it("should reject invalid target", () => {
      const filePath = join(testDir, "rule.md");
      const fileContent = `---
target: invalid-tool
---

# Rule Content`;

      const rule = RulesyncRule.build({ filePath, fileContent });
      const result = rule.validate();

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("Invalid target: invalid-tool");
    });

    it("should accept multiple valid targets", () => {
      const filePath = join(testDir, "rule.md");
      const fileContent = `---
target:
  - copilot
  - cursor
  - cline
---

# Multi-target Rule`;

      const rule = RulesyncRule.build({ filePath, fileContent });
      const result = rule.validate();

      expect(result.success).toBe(true);
    });

    it("should validate glob patterns", () => {
      const filePath = join(testDir, "rule.md");
      const fileContent = `---
glob:
  - "**/*.ts"
  - "src/**/*.tsx"
---

# Rule with Globs`;

      const rule = RulesyncRule.build({ filePath, fileContent });
      const result = rule.validate();

      expect(result.success).toBe(true);
    });
  });

  describe("getters and setters", () => {
    it("should update frontmatter", () => {
      const filePath = join(testDir, "rule.md");
      const fileContent = "# Rule";

      const rule = RulesyncRule.build({ filePath, fileContent });

      rule.setFrontmatter({
        target: "claudecode",
        description: "Updated description",
      });

      expect(rule.getFrontmatter()).toEqual({
        target: "claudecode",
        description: "Updated description",
      });
    });

    it("should update content", () => {
      const filePath = join(testDir, "rule.md");
      const fileContent = "# Original";

      const rule = RulesyncRule.build({ filePath, fileContent });

      rule.setContent("# Updated Content");

      expect(rule.getContent()).toBe("# Updated Content");
    });

    it("should update file path", () => {
      const filePath = join(testDir, "rule.md");
      const fileContent = "# Rule";

      const rule = RulesyncRule.build({ filePath, fileContent });

      const newPath = join(testDir, "new-rule.md");
      rule.setFilePath(newPath);

      expect(rule.getFilePath()).toBe(newPath);
    });

    it("should generate file content with frontmatter", () => {
      const filePath = join(testDir, "rule.md");
      const fileContent = `---
target: all
description: Universal rule
---

# Universal Rule

This applies to all tools.`;

      const rule = RulesyncRule.build({ filePath, fileContent });
      const output = rule.getFileContent();

      expect(output).toContain("target: all");
      expect(output).toContain("description: Universal rule");
      expect(output).toContain("# Universal Rule");
    });
  });
});
