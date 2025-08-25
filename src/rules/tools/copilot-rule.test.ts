import { promises as fs } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../../test-utils/index.js";
import { RulesyncRule } from "../rulesync-rule.js";
import { CopilotRule } from "./copilot-rule.js";

describe("CopilotRule", () => {
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
      const filePath = join(testDir, ".github", "copilot-instructions.md");
      const fileContent = "# GitHub Copilot Instructions\n\nUse TypeScript strict mode.";

      const rule = CopilotRule.build({ filePath, fileContent });

      expect(rule.getFilePath()).toBe(filePath);
      expect(rule.getFileContent()).toBe(fileContent);
    });
  });

  describe("fromFilePath", () => {
    it("should load a rule from file", async () => {
      const filePath = join(testDir, ".github", "copilot-instructions.md");
      const fileContent = "# Copilot Guidelines\n\nFollow clean architecture.";

      await fs.mkdir(join(testDir, ".github"), { recursive: true });
      await fs.writeFile(filePath, fileContent, "utf-8");

      const rule = await CopilotRule.fromFilePath(filePath);

      expect(rule.getFilePath()).toBe(filePath);
      expect(rule.getFileContent()).toBe(fileContent);
    });
  });

  describe("fromRulesyncRule", () => {
    it("should create CopilotRule from RulesyncRule with root rule", () => {
      const rulesyncPath = join(testDir, "rules", "copilot-main.md");
      const rulesyncContent = `---
target: copilot
root: true
description: "Main Copilot instructions"
---

# Main Project Rules`;

      const rulesyncRule = RulesyncRule.build({
        filePath: rulesyncPath,
        fileContent: rulesyncContent,
      });

      const copilotRule = CopilotRule.fromRulesyncRule(rulesyncRule);

      expect(copilotRule.getFilePath()).toBe(
        join(testDir, "rules", ".github", "copilot-instructions.md"),
      );
      expect(copilotRule.getFileContent()).toBe("# Main Project Rules");
    });

    it("should create CopilotRule from RulesyncRule with detail rule", () => {
      const rulesyncPath = join(testDir, "rules", "backend.md");
      const rulesyncContent = `---
target: copilot
description: "Backend development guidelines"
glob: "src/backend/**"
---

# Backend Guidelines`;

      const rulesyncRule = RulesyncRule.build({
        filePath: rulesyncPath,
        fileContent: rulesyncContent,
      });

      const copilotRule = CopilotRule.fromRulesyncRule(rulesyncRule);

      expect(copilotRule.getFilePath()).toBe(
        join(testDir, "rules", ".github", "instructions", "backend.instructions.md"),
      );

      const content = copilotRule.getFileContent();
      expect(content).toContain('description: "Backend development guidelines"');
      expect(content).toContain('applyTo: "src/backend/**"');
      expect(content).toContain("# Backend Guidelines");
    });

    it("should handle detail rule without glob pattern", () => {
      const rulesyncPath = join(testDir, "testing.md");
      const rulesyncContent = `---
target: copilot
description: "Testing guidelines"
---

# Testing Rules`;

      const rulesyncRule = RulesyncRule.build({
        filePath: rulesyncPath,
        fileContent: rulesyncContent,
      });

      const copilotRule = CopilotRule.fromRulesyncRule(rulesyncRule);

      const content = copilotRule.getFileContent();
      expect(content).toContain('applyTo: "**"');
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert CopilotRule to RulesyncRule for root rule", () => {
      const filePath = join(testDir, ".github", "copilot-instructions.md");
      const fileContent = "# Coding Standards\n\nTest content.";

      const copilotRule = CopilotRule.build({ filePath, fileContent });
      const rulesyncRule = copilotRule.toRulesyncRule();

      expect(rulesyncRule.getFilePath()).toBe(join(testDir, "copilot-root-rule.md"));
      expect(rulesyncRule.getContent().trim()).toBe("# Coding Standards\n\nTest content.");

      const frontmatter = rulesyncRule.getFrontmatter();
      expect(frontmatter.target).toBe("copilot");
      expect(frontmatter.description).toBe("GitHub Copilot custom instructions");
      expect(frontmatter.root).toBe(true);
    });

    it("should convert CopilotRule to RulesyncRule for detail rule", () => {
      const filePath = join(testDir, ".github", "instructions", "api.instructions.md");
      const fileContent = `---
description: "API development guidelines"
applyTo: "src/api/**"
---

# API Standards`;

      const copilotRule = CopilotRule.build({ filePath, fileContent });
      const rulesyncRule = copilotRule.toRulesyncRule();

      expect(rulesyncRule.getFilePath()).toBe(join(testDir, "copilot-api.md"));
      expect(rulesyncRule.getContent().trim()).toBe("# API Standards");

      const frontmatter = rulesyncRule.getFrontmatter();
      expect(frontmatter.target).toBe("copilot");
      expect(frontmatter.description).toBe("API development guidelines");
      expect(frontmatter.glob).toBe("src/api/**");
      expect(frontmatter.root).toBeUndefined();
    });

    it("should handle detail rule without frontmatter", () => {
      const filePath = join(testDir, ".github", "instructions", "simple.instructions.md");
      const fileContent = "# Simple Rules\n\nNo frontmatter here.";

      const copilotRule = CopilotRule.build({ filePath, fileContent });
      const rulesyncRule = copilotRule.toRulesyncRule();

      expect(rulesyncRule.getFilePath()).toBe(join(testDir, "copilot-simple.md"));
      expect(rulesyncRule.getContent().trim()).toBe("# Simple Rules\n\nNo frontmatter here.");

      const frontmatter = rulesyncRule.getFrontmatter();
      expect(frontmatter.description).toBe("GitHub Copilot instructions - simple");
    });
  });

  describe("writeFile", () => {
    it("should write rule to file system", async () => {
      const filePath = join(testDir, ".github", "copilot-instructions.md");
      const fileContent = "# Test Write\n\nContent to write.";

      const rule = CopilotRule.build({ filePath, fileContent });
      await rule.writeFile();

      const writtenContent = await fs.readFile(filePath, "utf-8");
      expect(writtenContent).toBe(fileContent);
    });

    it("should create directories if they do not exist", async () => {
      const filePath = join(testDir, "nested", ".github", "instructions", "deep.instructions.md");
      const fileContent = `---
description: "Deep nested rule"
applyTo: "**/*.ts"
---

Deep nested content`;

      const rule = CopilotRule.build({ filePath, fileContent });
      await rule.writeFile();

      const writtenContent = await fs.readFile(filePath, "utf-8");
      expect(writtenContent).toBe(fileContent);
    });
  });

  describe("validate", () => {
    it("should validate valid Copilot root rule", () => {
      const filePath = join(testDir, ".github", "copilot-instructions.md");
      const fileContent = "# Valid content";

      const rule = CopilotRule.build({ filePath, fileContent });
      const result = rule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should validate valid Copilot detail rule", () => {
      const filePath = join(testDir, ".github", "instructions", "test.instructions.md");
      const fileContent = "# Test content";

      const rule = CopilotRule.build({ filePath, fileContent });
      const result = rule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should reject empty content", () => {
      const filePath = join(testDir, ".github", "copilot-instructions.md");
      const fileContent = "";

      const rule = CopilotRule.build({ filePath, fileContent });
      const result = rule.validate();

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("cannot be empty");
    });

    it("should reject invalid file path", () => {
      const filePath = join(testDir, "wrong-location.md");
      const fileContent = "# Content";

      const rule = CopilotRule.build({ filePath, fileContent });
      const result = rule.validate();

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain(
        "must be copilot-instructions.md or in .github/instructions/",
      );
    });
  });
});
