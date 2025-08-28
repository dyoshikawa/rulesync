import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import { RuleFrontmatter } from "../types/rules.js";
import { KiroRule } from "./kiro-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("KiroRule", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("fromFilePath", () => {
    it("should create KiroRule from plain Markdown file", async () => {
      const content = `# Product Vision

## Target Users
- Software development teams
- DevOps engineers
- Technical leads

## Non-functional Requirements
- High availability (99.9% uptime)
- Fast response times (<200ms)
- Scalable to 10k+ users`;

      const filePath = join(testDir, "product.md");
      await writeFile(filePath, content, "utf-8");

      const rule = await KiroRule.fromFilePath({
        filePath,
        baseDir: testDir,
        relativeDirPath: "",
        relativeFilePath: "product.md",
      });

      expect(rule).toBeInstanceOf(KiroRule);
      expect(rule.getOutputContent()).toBe(content);
      expect(rule.getDocumentType()).toBe("product");
      expect(rule.getOutputFilePath()).toBe("product.md");
      expect(rule.isCoreSteeringDocument()).toBe(true);
    });

    it("should extract description from first heading", async () => {
      const content = `# Product Requirements

This document outlines the product requirements and vision.`;

      const filePath = join(testDir, "product.md");
      await writeFile(filePath, content, "utf-8");

      const rule = await KiroRule.fromFilePath({
        filePath,
        baseDir: testDir,
        relativeDirPath: "",
        relativeFilePath: "product.md",
      });

      const rulesyncRule = rule.toRulesyncRule();
      expect(rulesyncRule.getFrontmatter().description).toBe("Product Requirements");
    });

    it("should generate description from filename when no heading exists", async () => {
      const content = `This document describes the project structure and organization.`;

      const filePath = join(testDir, "structure.md");
      await writeFile(filePath, content, "utf-8");

      const rule = await KiroRule.fromFilePath({
        filePath,
        baseDir: testDir,
        relativeDirPath: "",
        relativeFilePath: "structure.md",
      });

      const rulesyncRule = rule.toRulesyncRule();
      expect(rulesyncRule.getFrontmatter().description).toBe("Structure");
    });

    it("should detect document types correctly", async () => {
      const testCases = [
        { filename: "product.md", expectedType: "product" },
        { filename: "structure.md", expectedType: "structure" },
        { filename: "tech.md", expectedType: "tech" },
        { filename: "project-structure.md", expectedType: "structure" },
        { filename: "product-vision.md", expectedType: "product" },
        { filename: "custom.md", expectedType: "tech" }, // default
      ];

      for (const testCase of testCases) {
        const content = `# ${testCase.filename}`;
        const filePath = join(testDir, testCase.filename);
        await writeFile(filePath, content, "utf-8");

        const rule = await KiroRule.fromFilePath({
          filePath,
          baseDir: testDir,
          relativeDirPath: "",
          relativeFilePath: testCase.filename,
        });

        expect(rule.getDocumentType()).toBe(testCase.expectedType);
      }
    });

    it("should identify core vs custom steering documents", async () => {
      const testCases = [
        { filename: "product.md", isCore: true },
        { filename: "structure.md", isCore: true },
        { filename: "tech.md", isCore: true },
        { filename: "security.md", isCore: false },
        { filename: "custom-rules.md", isCore: false },
      ];

      for (const testCase of testCases) {
        const content = `# ${testCase.filename}`;
        const filePath = join(testDir, testCase.filename);
        await writeFile(filePath, content, "utf-8");

        const rule = await KiroRule.fromFilePath({
          filePath,
          baseDir: testDir,
          relativeDirPath: "",
          relativeFilePath: testCase.filename,
        });

        expect(rule.isCoreSteeringDocument()).toBe(testCase.isCore);
      }
    });

    it("should handle .kiro/steering/ directory path", async () => {
      const content = `# Technical Stack

## Languages
- TypeScript 5.0+
- Python 3.11+

## Frameworks
- Next.js 14
- FastAPI`;

      const steeringDir = join(testDir, ".kiro", "steering");
      await mkdir(steeringDir, { recursive: true });

      const filePath = join(steeringDir, "tech.md");
      await writeFile(filePath, content, "utf-8");

      const rule = await KiroRule.fromFilePath({
        filePath,
        baseDir: testDir,
        relativeDirPath: ".kiro/steering",
        relativeFilePath: "tech.md",
      });

      expect(rule.getDocumentType()).toBe("tech");
      expect(rule.getOutputContent()).toBe(content);
      expect(rule.isCoreSteeringDocument()).toBe(true);
    });
  });

  describe("fromRulesyncRule", () => {
    it("should create KiroRule from RulesyncRule", async () => {
      const frontmatter: RuleFrontmatter = {
        root: false,
        targets: ["kiro"],
        description: "Product Vision Document",
        globs: ["**/*"],
      };

      const body = `# Product Vision

## Mission
Build the best AI-powered IDE for developers.

## Values
- User-centric design
- Performance excellence
- Security first`;

      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".kiro/steering",
        relativeFilePath: "product.md",
        frontmatter,
        body,
        fileContent: `---
root: false
targets:
  - kiro
description: Product Vision Document
globs:
  - "**/*"
---
${body}`,
      });

      const rule = KiroRule.fromRulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".kiro/steering",
        rulesyncRule,
      });

      expect(rule.getDocumentType()).toBe("product");
      expect(rule.getOutputContent()).toBe(body);

      const convertedBack = rule.toRulesyncRule();
      expect(convertedBack.getFrontmatter().targets).toEqual(["kiro"]);
      expect(convertedBack.getFrontmatter().description).toBe("Product Vision Document");
    });
  });

  describe("validation", () => {
    it("should validate successfully with valid data", () => {
      const rule = new KiroRule({
        baseDir: testDir,
        relativeDirPath: ".kiro/steering",
        relativeFilePath: "product.md",
        frontmatter: { description: "Product Vision" },
        body: "# Product Vision\n\nContent here",
        fileContent: "# Product Vision\n\nContent here",
        documentType: "product",
        validate: false, // Skip validation in constructor to test it separately
      });

      const result = rule.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should fail validation with invalid document type", () => {
      const rule = new KiroRule({
        baseDir: testDir,
        relativeDirPath: ".kiro/steering",
        relativeFilePath: "invalid.md",
        frontmatter: { description: "Invalid Document" },
        body: "# Invalid Document",
        fileContent: "# Invalid Document",
        documentType: "invalid" as any,
        validate: false, // Skip validation in constructor to test it separately
      });

      const result = rule.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("Invalid document type: invalid");
    });

    it("should fail validation with invalid frontmatter", () => {
      expect(() => {
        const _rule = new KiroRule({
          baseDir: testDir,
          relativeDirPath: ".kiro/steering",
          relativeFilePath: "product.md",
          frontmatter: {} as any, // Invalid frontmatter missing description
          body: "# Product",
          fileContent: "# Product",
          documentType: "product",
          validate: true,
        });
      }).toThrow();
    });
  });

  describe("utility methods", () => {
    it("should provide correct steering document info", () => {
      const productRule = new KiroRule({
        baseDir: testDir,
        relativeDirPath: ".kiro/steering",
        relativeFilePath: "product.md",
        frontmatter: { description: "Product Vision" },
        body: "# Product Vision",
        fileContent: "# Product Vision",
        documentType: "product",
      });

      const customRule = new KiroRule({
        baseDir: testDir,
        relativeDirPath: ".kiro/steering",
        relativeFilePath: "security-policies.md",
        frontmatter: { description: "Security Policies" },
        body: "# Security Policies",
        fileContent: "# Security Policies",
        documentType: "tech",
      });

      expect(productRule.getSteeringDocumentInfo()).toContain("type:product");
      expect(productRule.getSteeringDocumentInfo()).toContain("core");

      expect(customRule.getSteeringDocumentInfo()).toContain("type:tech");
      expect(customRule.getSteeringDocumentInfo()).toContain("custom");
    });
  });

  describe("extractDocumentTypeFromPath", () => {
    it("should extract document type from various file paths", () => {
      expect(KiroRule.extractDocumentTypeFromPath("product.md")).toBe("product");
      expect(KiroRule.extractDocumentTypeFromPath("structure.md")).toBe("structure");
      expect(KiroRule.extractDocumentTypeFromPath("tech.md")).toBe("tech");
      expect(KiroRule.extractDocumentTypeFromPath(".kiro/steering/product.md")).toBe("product");
      expect(KiroRule.extractDocumentTypeFromPath("product-vision.md")).toBe("product");
      expect(KiroRule.extractDocumentTypeFromPath("project-structure.md")).toBe("structure");
      expect(KiroRule.extractDocumentTypeFromPath("random.md")).toBe("tech"); // default
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert to RulesyncRule correctly", () => {
      const rule = new KiroRule({
        baseDir: testDir,
        relativeDirPath: ".kiro/steering",
        relativeFilePath: "product.md",
        frontmatter: { description: "Product Vision Document" },
        body: `# Product Vision

## Mission
Build amazing developer tools.`,
        fileContent: `# Product Vision

## Mission
Build amazing developer tools.`,
        documentType: "product",
      });

      const rulesyncRule = rule.toRulesyncRule();

      expect(rulesyncRule.getFrontmatter().targets).toEqual(["kiro"]);
      expect(rulesyncRule.getFrontmatter().description).toBe("Product Vision Document");
      expect(rulesyncRule.getFrontmatter().root).toBe(false);
      expect(rulesyncRule.getFrontmatter().globs).toEqual(["**/*"]);
      expect(rulesyncRule.getBody()).toContain("# Product Vision");
      expect(rulesyncRule.getBody()).toContain("Build amazing developer tools.");
    });
  });
});
