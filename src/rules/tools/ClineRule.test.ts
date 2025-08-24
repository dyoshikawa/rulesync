import { promises as fs } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../../test-utils/index.js";
import { RulesyncRule } from "../RulesyncRule.js";
import { ClineRule } from "./ClineRule.js";

describe("ClineRule", () => {
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
      const filePath = join(testDir, ".clinerules", "project-rules.md");
      const fileContent = `# Cline Rules

Use TypeScript strict mode.
Follow clean architecture.`;

      const rule = ClineRule.build({ filePath, fileContent });

      expect(rule.getFilePath()).toBe(filePath);
      expect(rule.getFileContent()).toBe(fileContent);
    });
  });

  describe("fromFilePath", () => {
    it("should load a rule from file", async () => {
      const filePath = join(testDir, ".clinerules", "coding-standards.md");
      const fileContent = `# Coding Guidelines

Follow clean architecture.
Use TypeScript.`;

      await fs.mkdir(join(testDir, ".clinerules"), { recursive: true });
      await fs.writeFile(filePath, fileContent, "utf-8");

      const rule = await ClineRule.fromFilePath(filePath);

      expect(rule.getFilePath()).toBe(filePath);
      expect(rule.getFileContent()).toBe(fileContent);
    });
  });

  describe("fromRulesyncRule", () => {
    it("should create ClineRule from RulesyncRule with root rule", () => {
      const rulesyncPath = join(testDir, "rules", "cline-main.md");
      const rulesyncContent = `---
target: cline
root: true
description: "Main project standards"
---

# Main Cline Rules`;

      const rulesyncRule = RulesyncRule.build({
        filePath: rulesyncPath,
        fileContent: rulesyncContent,
      });

      const clineRule = ClineRule.fromRulesyncRule(rulesyncRule);

      expect(clineRule.getFilePath()).toBe(
        join(testDir, "rules", ".clinerules", "project-rules.md"),
      );
      expect(clineRule.getFileContent()).toBe("# Main Cline Rules");
    });

    it("should create ClineRule from RulesyncRule with detail rule", () => {
      const rulesyncPath = join(testDir, "rules", "api-patterns.md");
      const rulesyncContent = `---
target: cline
description: "API development patterns"
glob: "src/api/**/*.ts"
---

# API Patterns`;

      const rulesyncRule = RulesyncRule.build({
        filePath: rulesyncPath,
        fileContent: rulesyncContent,
      });

      const clineRule = ClineRule.fromRulesyncRule(rulesyncRule);

      expect(clineRule.getFilePath()).toBe(
        join(testDir, "rules", ".clinerules", "api-patterns.md"),
      );
      expect(clineRule.getFileContent()).toBe("# API Patterns");
    });

    it("should handle rules without glob patterns", () => {
      const rulesyncPath = join(testDir, "testing.md");
      const rulesyncContent = `---
target: cline
description: "Testing guidelines"
---

# Testing Rules`;

      const rulesyncRule = RulesyncRule.build({
        filePath: rulesyncPath,
        fileContent: rulesyncContent,
      });

      const clineRule = ClineRule.fromRulesyncRule(rulesyncRule);

      expect(clineRule.getFilePath()).toBe(join(testDir, ".clinerules", "testing.md"));
      expect(clineRule.getFileContent()).toBe("# Testing Rules");
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert ClineRule to RulesyncRule for root rule", () => {
      const filePath = join(testDir, ".clinerules", "project-rules.md");
      const fileContent = `# Coding Standards

Test content.`;

      const clineRule = ClineRule.build({ filePath, fileContent });
      const rulesyncRule = clineRule.toRulesyncRule();

      expect(rulesyncRule.getFilePath()).toBe(join(testDir, "cline-root-rule.md"));
      expect(rulesyncRule.getContent().trim()).toBe("# Coding Standards\n\nTest content.");

      const frontmatter = rulesyncRule.getFrontmatter();
      expect(frontmatter.target).toBe("cline");
      expect(frontmatter.description).toBe("Cline project rules");
      expect(frontmatter.root).toBe(true);
    });

    it("should convert ClineRule to RulesyncRule for detail rule", () => {
      const filePath = join(testDir, ".clinerules", "api-standards.md");
      const fileContent = `# API Standards

RESTful APIs only.`;

      const clineRule = ClineRule.build({ filePath, fileContent });
      const rulesyncRule = clineRule.toRulesyncRule();

      expect(rulesyncRule.getFilePath()).toBe(join(testDir, "cline-api-standards.md"));
      expect(rulesyncRule.getContent().trim()).toBe("# API Standards\n\nRESTful APIs only.");

      const frontmatter = rulesyncRule.getFrontmatter();
      expect(frontmatter.target).toBe("cline");
      expect(frontmatter.description).toBe("Cline rules - api-standards");
      expect(frontmatter.root).toBeUndefined();
    });

    it("should handle numeric prefixed filenames", () => {
      const filePath = join(testDir, ".clinerules", "01-coding-style.md");
      const fileContent = `# Style Guide`;

      const clineRule = ClineRule.build({ filePath, fileContent });
      const rulesyncRule = clineRule.toRulesyncRule();

      expect(rulesyncRule.getFilePath()).toBe(join(testDir, "cline-01-coding-style.md"));
      expect(rulesyncRule.getContent().trim()).toBe("# Style Guide");
    });
  });

  describe("writeFile", () => {
    it("should write rule to file system", async () => {
      const filePath = join(testDir, ".clinerules", "test-rule.md");
      const fileContent = `# Test Write

Content to write.`;

      const rule = ClineRule.build({ filePath, fileContent });
      await rule.writeFile();

      const writtenContent = await fs.readFile(filePath, "utf-8");
      expect(writtenContent).toBe(fileContent);
    });

    it("should create directories if they do not exist", async () => {
      const filePath = join(testDir, "nested", ".clinerules", "deep.md");
      const fileContent = `# Deep nested content`;

      const rule = ClineRule.build({ filePath, fileContent });
      await rule.writeFile();

      const writtenContent = await fs.readFile(filePath, "utf-8");
      expect(writtenContent).toBe(fileContent);
    });
  });

  describe("validate", () => {
    it("should validate valid Cline rule", () => {
      const filePath = join(testDir, ".clinerules", "valid.md");
      const fileContent = `# Valid content`;

      const rule = ClineRule.build({ filePath, fileContent });
      const result = rule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should reject empty content", () => {
      const filePath = join(testDir, ".clinerules", "empty.md");
      const fileContent = "";

      const rule = ClineRule.build({ filePath, fileContent });
      const result = rule.validate();

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("cannot be empty");
    });

    it("should reject invalid file path", () => {
      const filePath = join(testDir, "wrong-location.md");
      const fileContent = "# Content";

      const rule = ClineRule.build({ filePath, fileContent });
      const result = rule.validate();

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("must be in .clinerules/ directory");
    });

    it("should accept .mdx files", () => {
      const filePath = join(testDir, ".clinerules", "component.mdx");
      const fileContent = "# MDX Content";

      const rule = ClineRule.build({ filePath, fileContent });
      const result = rule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });
});
