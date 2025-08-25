import { promises as fs } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../../test-utils/index.js";
import { RulesyncRule } from "../rulesync-rule.js";
import { CursorRule } from "./cursor-rule.js";

describe("CursorRule", () => {
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
      const filePath = join(testDir, ".cursor", "rules", "project-rules.mdc");
      const fileContent = `---
description: "Main project rules"
alwaysApply: true
---

# Cursor Rules

Use TypeScript strict mode.`;

      const rule = CursorRule.build({ filePath, fileContent });

      expect(rule.getFilePath()).toBe(filePath);
      expect(rule.getFileContent()).toBe(fileContent);
    });
  });

  describe("fromFilePath", () => {
    it("should load a rule from file", async () => {
      const filePath = join(testDir, ".cursor", "rules", "coding-standards.mdc");
      const fileContent = `---
description: "Coding standards"
globs: "**/*.ts"
alwaysApply: false
---

# Coding Guidelines

Follow clean architecture.`;

      await fs.mkdir(join(testDir, ".cursor", "rules"), { recursive: true });
      await fs.writeFile(filePath, fileContent, "utf-8");

      const rule = await CursorRule.fromFilePath(filePath);

      expect(rule.getFilePath()).toBe(filePath);
      expect(rule.getFileContent()).toBe(fileContent);
    });
  });

  describe("fromRulesyncRule", () => {
    it("should create CursorRule from RulesyncRule with root rule", () => {
      const rulesyncPath = join(testDir, "rules", "cursor-main.md");
      const rulesyncContent = `---
target: cursor
root: true
description: "Main project standards"
---

# Main Cursor Rules`;

      const rulesyncRule = RulesyncRule.build({
        filePath: rulesyncPath,
        fileContent: rulesyncContent,
      });

      const cursorRule = CursorRule.fromRulesyncRule(rulesyncRule);

      expect(cursorRule.getFilePath()).toBe(
        join(testDir, "rules", ".cursor", "rules", "project-rules.mdc"),
      );

      const content = cursorRule.getFileContent();
      expect(content).toContain('description: "Main project standards"');
      expect(content).toContain("alwaysApply: true");
      expect(content).toContain("# Main Cursor Rules");
    });

    it("should create CursorRule from RulesyncRule with detail rule", () => {
      const rulesyncPath = join(testDir, "rules", "api-patterns.md");
      const rulesyncContent = `---
target: cursor
description: "API development patterns"
glob: "src/api/**/*.ts"
---

# API Patterns`;

      const rulesyncRule = RulesyncRule.build({
        filePath: rulesyncPath,
        fileContent: rulesyncContent,
      });

      const cursorRule = CursorRule.fromRulesyncRule(rulesyncRule);

      expect(cursorRule.getFilePath()).toBe(
        join(testDir, "rules", ".cursor", "rules", "api-patterns.mdc"),
      );

      const content = cursorRule.getFileContent();
      expect(content).toContain('description: "API development patterns"');
      expect(content).toContain('globs: "src/api/**/*.ts"');
      expect(content).toContain("alwaysApply: false");
      expect(content).toContain("# API Patterns");
    });

    it("should handle multiple glob patterns", () => {
      const rulesyncPath = join(testDir, "testing.md");
      const rulesyncContent = `---
target: cursor
description: "Testing guidelines"
glob: ["**/*.test.ts", "**/*.spec.ts"]
---

# Testing Rules`;

      const rulesyncRule = RulesyncRule.build({
        filePath: rulesyncPath,
        fileContent: rulesyncContent,
      });

      const cursorRule = CursorRule.fromRulesyncRule(rulesyncRule);

      const content = cursorRule.getFileContent();
      expect(content).toContain('globs: "**/*.test.ts, **/*.spec.ts"');
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert CursorRule to RulesyncRule for root rule", () => {
      const filePath = join(testDir, ".cursor", "rules", "project-rules.mdc");
      const fileContent = `---
description: "Project standards"
alwaysApply: true
---

# Coding Standards

Test content.`;

      const cursorRule = CursorRule.build({ filePath, fileContent });
      const rulesyncRule = cursorRule.toRulesyncRule();

      expect(rulesyncRule.getFilePath()).toBe(join(testDir, "cursor-root-rule.md"));
      expect(rulesyncRule.getContent().trim()).toBe("# Coding Standards\n\nTest content.");

      const frontmatter = rulesyncRule.getFrontmatter();
      expect(frontmatter.target).toBe("cursor");
      expect(frontmatter.description).toBe("Project standards");
      expect(frontmatter.root).toBe(true);
    });

    it("should convert CursorRule to RulesyncRule for detail rule", () => {
      const filePath = join(testDir, ".cursor", "rules", "api-standards.mdc");
      const fileContent = `---
description: "API development guidelines"
globs: "src/api/**"
alwaysApply: false
---

# API Standards`;

      const cursorRule = CursorRule.build({ filePath, fileContent });
      const rulesyncRule = cursorRule.toRulesyncRule();

      expect(rulesyncRule.getFilePath()).toBe(join(testDir, "cursor-api-standards.md"));
      expect(rulesyncRule.getContent().trim()).toBe("# API Standards");

      const frontmatter = rulesyncRule.getFrontmatter();
      expect(frontmatter.target).toBe("cursor");
      expect(frontmatter.description).toBe("API development guidelines");
      expect(frontmatter.glob).toBe("src/api/**");
      expect(frontmatter.root).toBeUndefined();
    });

    it("should handle rules without frontmatter", () => {
      const filePath = join(testDir, ".cursor", "rules", "simple.mdc");
      const fileContent = "# Simple Rules\n\nNo frontmatter here.";

      const cursorRule = CursorRule.build({ filePath, fileContent });
      const rulesyncRule = cursorRule.toRulesyncRule();

      expect(rulesyncRule.getFilePath()).toBe(join(testDir, "cursor-simple.md"));
      expect(rulesyncRule.getContent().trim()).toBe("# Simple Rules\n\nNo frontmatter here.");

      const frontmatter = rulesyncRule.getFrontmatter();
      expect(frontmatter.description).toBe("Cursor rules - simple");
    });
  });

  describe("writeFile", () => {
    it("should write rule to file system", async () => {
      const filePath = join(testDir, ".cursor", "rules", "test-rule.mdc");
      const fileContent = `---
description: "Test rule"
alwaysApply: false
---

# Test Write

Content to write.`;

      const rule = CursorRule.build({ filePath, fileContent });
      await rule.writeFile();

      const writtenContent = await fs.readFile(filePath, "utf-8");
      expect(writtenContent).toBe(fileContent);
    });

    it("should create directories if they do not exist", async () => {
      const filePath = join(testDir, "nested", ".cursor", "rules", "deep.mdc");
      const fileContent = `---
description: "Deep nested rule"
globs: "**/*.tsx"
---

Deep nested content`;

      const rule = CursorRule.build({ filePath, fileContent });
      await rule.writeFile();

      const writtenContent = await fs.readFile(filePath, "utf-8");
      expect(writtenContent).toBe(fileContent);
    });
  });

  describe("validate", () => {
    it("should validate valid Cursor rule", () => {
      const filePath = join(testDir, ".cursor", "rules", "valid.mdc");
      const fileContent = `---
description: "Valid rule"
---

# Valid content`;

      const rule = CursorRule.build({ filePath, fileContent });
      const result = rule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should reject empty content", () => {
      const filePath = join(testDir, ".cursor", "rules", "empty.mdc");
      const fileContent = "";

      const rule = CursorRule.build({ filePath, fileContent });
      const result = rule.validate();

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("cannot be empty");
    });

    it("should reject invalid file path", () => {
      const filePath = join(testDir, "wrong-location.mdc");
      const fileContent = "# Content";

      const rule = CursorRule.build({ filePath, fileContent });
      const result = rule.validate();

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("must be in .cursor/rules/ directory");
    });

    it("should reject non-mdc files", () => {
      const filePath = join(testDir, ".cursor", "rules", "invalid.md");
      const fileContent = "# Content";

      const rule = CursorRule.build({ filePath, fileContent });
      const result = rule.validate();

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("have .mdc extension");
    });
  });
});
