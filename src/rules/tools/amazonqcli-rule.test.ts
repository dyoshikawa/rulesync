import { promises as fs } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../../test-utils/index.js";
import { RulesyncRule } from "../rulesync-rule.js";
import { AmazonqcliRule } from "./amazonqcli-rule.js";

describe("AmazonqcliRule", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const testSetup = await setupTestDirectory();
    testDir = testSetup.testDir;
    cleanup = testSetup.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("build", () => {
    it("should build a rule from file path and content", () => {
      const filePath = join(testDir, ".amazonq", "rules", "project-rules.md");
      const fileContent = `# Project Rules

This is a test Amazon Q CLI rule file.`;

      const rule = AmazonqcliRule.build({ filePath, fileContent });

      expect(rule.getFilePath()).toBe(filePath);
      expect(rule.getFileContent()).toBe(fileContent);
    });
  });

  describe("fromFilePath", () => {
    it("should load a rule from file", async () => {
      const filePath = join(testDir, ".amazonq", "rules", "coding-standards.md");
      const fileContent = `# Coding Standards

Use TypeScript strict mode.`;

      await fs.mkdir(join(testDir, ".amazonq", "rules"), { recursive: true });
      await fs.writeFile(filePath, fileContent, "utf-8");

      const rule = await AmazonqcliRule.fromFilePath(filePath);

      expect(rule.getFilePath()).toBe(filePath);
      expect(rule.getFileContent()).toBe(fileContent);
    });
  });

  describe("fromRulesyncRule", () => {
    it("should create AmazonqcliRule from RulesyncRule with root rule", () => {
      const rulesyncPath = join(testDir, "rules", "main-rule.md");
      const rulesyncContent = `---
target: amazonqcli
root: true
---

# Main Project Rules`;

      const rulesyncRule = RulesyncRule.build({
        filePath: rulesyncPath,
        fileContent: rulesyncContent,
      });

      const amazonqcliRule = AmazonqcliRule.fromRulesyncRule(rulesyncRule);

      expect(amazonqcliRule.getFilePath()).toBe(
        join(testDir, "rules", ".amazonq", "rules", "project-rules.md"),
      );
      expect(amazonqcliRule.getFileContent()).toBe("# Main Project Rules");
    });

    it("should create AmazonqcliRule from RulesyncRule with detail rule", () => {
      const rulesyncPath = join(testDir, "rules", "security-rules.md");
      const rulesyncContent = `---
target: amazonqcli
---

# Security Guidelines`;

      const rulesyncRule = RulesyncRule.build({
        filePath: rulesyncPath,
        fileContent: rulesyncContent,
      });

      const amazonqcliRule = AmazonqcliRule.fromRulesyncRule(rulesyncRule);

      expect(amazonqcliRule.getFilePath()).toBe(
        join(testDir, "rules", ".amazonq", "rules", "security-rules.md"),
      );
      expect(amazonqcliRule.getFileContent()).toBe("# Security Guidelines");
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert AmazonqcliRule to RulesyncRule for root rule", () => {
      const filePath = join(testDir, ".amazonq", "rules", "project-rules.md");
      const fileContent = `# Amazon Q Rules

Test content.`;

      const amazonqcliRule = AmazonqcliRule.build({ filePath, fileContent });
      const rulesyncRule = amazonqcliRule.toRulesyncRule();

      expect(rulesyncRule.getFilePath()).toBe(join(testDir, "amazonqcli-root-rule.md"));
      expect(rulesyncRule.getContent().trim()).toBe(fileContent);

      const frontmatter = rulesyncRule.getFrontmatter();
      expect(frontmatter.target).toBe("amazonqcli");
      expect(frontmatter.description).toBe("Project-level rules for Amazon Q CLI");
      expect(frontmatter.root).toBe(true);
    });

    it("should convert AmazonqcliRule to RulesyncRule for detail rule", () => {
      const filePath = join(testDir, ".amazonq", "rules", "api-standards.md");
      const fileContent = `# API Standards

REST conventions.`;

      const amazonqcliRule = AmazonqcliRule.build({ filePath, fileContent });
      const rulesyncRule = amazonqcliRule.toRulesyncRule();

      expect(rulesyncRule.getFilePath()).toBe(join(testDir, "amazonqcli-api-standards.md"));
      expect(rulesyncRule.getContent().trim()).toBe(fileContent);

      const frontmatter = rulesyncRule.getFrontmatter();
      expect(frontmatter.target).toBe("amazonqcli");
      expect(frontmatter.description).toBe("Amazon Q CLI rules - api-standards");
      expect(frontmatter.root).toBeUndefined();
    });
  });

  describe("writeFile", () => {
    it("should write rule to file system", async () => {
      const filePath = join(testDir, ".amazonq", "rules", "test-rule.md");
      const fileContent = `# Test Write

Content to write.`;

      const rule = AmazonqcliRule.build({ filePath, fileContent });
      await rule.writeFile();

      const writtenContent = await fs.readFile(filePath, "utf-8");
      expect(writtenContent).toBe(fileContent);
    });

    it("should create directories if they do not exist", async () => {
      const filePath = join(testDir, "nested", ".amazonq", "rules", "deep-rule.md");
      const fileContent = "Deep nested content";

      const rule = AmazonqcliRule.build({ filePath, fileContent });
      await rule.writeFile();

      const writtenContent = await fs.readFile(filePath, "utf-8");
      expect(writtenContent).toBe(fileContent);
    });
  });

  describe("validate", () => {
    it("should validate valid Amazon Q CLI rule", () => {
      const filePath = join(testDir, ".amazonq", "rules", "valid.md");
      const fileContent = "# Valid content";

      const rule = AmazonqcliRule.build({ filePath, fileContent });
      const result = rule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should reject empty content", () => {
      const filePath = join(testDir, ".amazonq", "rules", "empty.md");
      const fileContent = "";

      const rule = AmazonqcliRule.build({ filePath, fileContent });
      const result = rule.validate();

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("cannot be empty");
    });

    it("should reject invalid file path", () => {
      const filePath = join(testDir, "wrong-location.md");
      const fileContent = "# Content";

      const rule = AmazonqcliRule.build({ filePath, fileContent });
      const result = rule.validate();

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("must be in .amazonq/rules/ directory");
    });

    it("should reject non-markdown files", () => {
      const filePath = join(testDir, ".amazonq", "rules", "invalid.txt");
      const fileContent = "# Content";

      const rule = AmazonqcliRule.build({ filePath, fileContent });
      const result = rule.validate();

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("have .md extension");
    });
  });
});
