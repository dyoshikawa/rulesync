import { promises as fs } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../../test-utils/index.js";
import { RulesyncRule } from "../RulesyncRule.js";
import { AugmentcodeRule } from "./AugmentcodeRule.js";

describe("AugmentcodeRule", () => {
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
      const filePath = join(testDir, ".augment", "rules", "coding-standards-always.md");
      const fileContent = `---
type: always
description: ""
---

# Coding Standards

Use TypeScript strict mode.`;

      const rule = AugmentcodeRule.build({ filePath, fileContent });

      expect(rule.getFilePath()).toBe(filePath);
      expect(rule.getFileContent()).toBe(fileContent);
    });
  });

  describe("fromFilePath", () => {
    it("should load a rule from file", async () => {
      const filePath = join(testDir, ".augment", "rules", "project-guidelines-manual.md");
      const fileContent = `---
type: manual
description: "Project guidelines"
---

# Project Guidelines

Follow clean architecture.`;

      await fs.mkdir(join(testDir, ".augment", "rules"), { recursive: true });
      await fs.writeFile(filePath, fileContent, "utf-8");

      const rule = await AugmentcodeRule.fromFilePath(filePath);

      expect(rule.getFilePath()).toBe(filePath);
      expect(rule.getFileContent()).toBe(fileContent);
    });
  });

  describe("fromRulesyncRule", () => {
    it("should create AugmentcodeRule from RulesyncRule with root rule", () => {
      const rulesyncPath = join(testDir, "rules", "main-rule.md");
      const rulesyncContent = `---
target: augmentcode
root: true
description: "Main project standards"
---

# Main Project Rules`;

      const rulesyncRule = RulesyncRule.build({
        filePath: rulesyncPath,
        fileContent: rulesyncContent,
      });

      const augmentcodeRule = AugmentcodeRule.fromRulesyncRule(rulesyncRule);

      expect(augmentcodeRule.getFilePath()).toBe(
        join(testDir, "rules", ".augment", "rules", "main-rule-always.md"),
      );

      const content = augmentcodeRule.getFileContent();
      expect(content).toContain("type: always");
      expect(content).toContain('description: ""');
      expect(content).toContain("# Main Project Rules");
    });

    it("should create AugmentcodeRule from RulesyncRule with auto rule", () => {
      const rulesyncPath = join(testDir, "rules", "onboarding.md");
      const rulesyncContent = `---
target: augmentcode
auto: true
description: "Onboarding checklist"
tags: [onboarding, documentation]
---

# Onboarding Guide`;

      const rulesyncRule = RulesyncRule.build({
        filePath: rulesyncPath,
        fileContent: rulesyncContent,
      });

      const augmentcodeRule = AugmentcodeRule.fromRulesyncRule(rulesyncRule);

      expect(augmentcodeRule.getFilePath()).toBe(
        join(testDir, "rules", ".augment", "rules", "onboarding-auto.md"),
      );

      const content = augmentcodeRule.getFileContent();
      expect(content).toContain("type: auto");
      expect(content).toContain("description: Onboarding checklist");
      expect(content).toContain("tags: [onboarding, documentation]");
      expect(content).toContain("# Onboarding Guide");
    });

    it("should create AugmentcodeRule from RulesyncRule with manual rule", () => {
      const rulesyncPath = join(testDir, "rules", "security.md");
      const rulesyncContent = `---
target: augmentcode
description: "Security guidelines"
---

# Security Rules`;

      const rulesyncRule = RulesyncRule.build({
        filePath: rulesyncPath,
        fileContent: rulesyncContent,
      });

      const augmentcodeRule = AugmentcodeRule.fromRulesyncRule(rulesyncRule);

      expect(augmentcodeRule.getFilePath()).toBe(
        join(testDir, "rules", ".augment", "rules", "security-manual.md"),
      );

      const content = augmentcodeRule.getFileContent();
      expect(content).toContain("type: manual");
      expect(content).toContain("description: Security guidelines");
      expect(content).toContain("# Security Rules");
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert AugmentcodeRule to RulesyncRule for always rule", () => {
      const filePath = join(testDir, ".augment", "rules", "standards-always.md");
      const fileContent = `---
type: always
description: ""
---

# Coding Standards

Test content.`;

      const augmentcodeRule = AugmentcodeRule.build({ filePath, fileContent });
      const rulesyncRule = augmentcodeRule.toRulesyncRule();

      expect(rulesyncRule.getFilePath()).toBe(join(testDir, "augmentcode-standards-root.md"));
      expect(rulesyncRule.getContent().trim()).toBe("# Coding Standards\n\nTest content.");

      const frontmatter = rulesyncRule.getFrontmatter();
      expect(frontmatter.target).toBe("augmentcode");
      expect(frontmatter.description).toBe("Project-level rules for AugmentCode");
      expect(frontmatter.root).toBe(true);
    });

    it("should convert AugmentcodeRule to RulesyncRule for auto rule", () => {
      const filePath = join(testDir, ".augment", "rules", "api-auto.md");
      const fileContent = `---
type: auto
description: "API documentation"
tags: [api, docs]
---

# API Standards`;

      const augmentcodeRule = AugmentcodeRule.build({ filePath, fileContent });
      const rulesyncRule = augmentcodeRule.toRulesyncRule();

      expect(rulesyncRule.getFilePath()).toBe(join(testDir, "augmentcode-api.md"));
      expect(rulesyncRule.getContent().trim()).toBe("# API Standards");

      const frontmatter = rulesyncRule.getFrontmatter();
      expect(frontmatter.target).toBe("augmentcode");
      expect(frontmatter.description).toBe("API documentation");
      expect(frontmatter.auto).toBe(true);
      expect(frontmatter.tags).toEqual(["api", "docs"]);
    });

    it("should convert AugmentcodeRule to RulesyncRule for manual rule", () => {
      const filePath = join(testDir, ".augment", "rules", "testing-manual.md");
      const fileContent = `---
type: manual
description: "Testing guidelines"
---

# Testing Rules`;

      const augmentcodeRule = AugmentcodeRule.build({ filePath, fileContent });
      const rulesyncRule = augmentcodeRule.toRulesyncRule();

      expect(rulesyncRule.getFilePath()).toBe(join(testDir, "augmentcode-testing.md"));
      expect(rulesyncRule.getContent().trim()).toBe("# Testing Rules");

      const frontmatter = rulesyncRule.getFrontmatter();
      expect(frontmatter.target).toBe("augmentcode");
      expect(frontmatter.description).toBe("Testing guidelines");
      expect(frontmatter.root).toBeUndefined();
      expect(frontmatter.auto).toBeUndefined();
    });
  });

  describe("writeFile", () => {
    it("should write rule to file system", async () => {
      const filePath = join(testDir, ".augment", "rules", "test-rule-manual.md");
      const fileContent = `---
type: manual
description: "Test rule"
---

# Test Write

Content to write.`;

      const rule = AugmentcodeRule.build({ filePath, fileContent });
      await rule.writeFile();

      const writtenContent = await fs.readFile(filePath, "utf-8");
      expect(writtenContent).toBe(fileContent);
    });

    it("should create directories if they do not exist", async () => {
      const filePath = join(testDir, "nested", ".augment", "rules", "deep-rule-auto.md");
      const fileContent = `---
type: auto
description: "Deep nested rule"
---

Deep nested content`;

      const rule = AugmentcodeRule.build({ filePath, fileContent });
      await rule.writeFile();

      const writtenContent = await fs.readFile(filePath, "utf-8");
      expect(writtenContent).toBe(fileContent);
    });
  });

  describe("validate", () => {
    it("should validate valid AugmentCode rule", () => {
      const filePath = join(testDir, ".augment", "rules", "valid-always.md");
      const fileContent = `---
type: always
description: ""
---

# Valid content`;

      const rule = AugmentcodeRule.build({ filePath, fileContent });
      const result = rule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should reject empty content", () => {
      const filePath = join(testDir, ".augment", "rules", "empty.md");
      const fileContent = "";

      const rule = AugmentcodeRule.build({ filePath, fileContent });
      const result = rule.validate();

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("cannot be empty");
    });

    it("should reject invalid file path", () => {
      const filePath = join(testDir, "wrong-location.md");
      const fileContent = "# Content";

      const rule = AugmentcodeRule.build({ filePath, fileContent });
      const result = rule.validate();

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("must be in .augment/rules/ directory");
    });

    it("should reject non-markdown files", () => {
      const filePath = join(testDir, ".augment", "rules", "invalid.txt");
      const fileContent = "# Content";

      const rule = AugmentcodeRule.build({ filePath, fileContent });
      const result = rule.validate();

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("have .md extension");
    });
  });
});
