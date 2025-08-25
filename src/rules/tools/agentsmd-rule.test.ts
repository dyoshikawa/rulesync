import { promises as fs } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../../test-utils/index.js";
import { RulesyncRule } from "../rulesync-rule.js";
import { AgentsmdRule } from "./agentsmd-rule.js";

describe("AgentsmdRule", () => {
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
      const filePath = join(testDir, "AGENTS.md");
      const fileContent = `# Project Rules

This is a test AGENTS.md file.`;

      const rule = AgentsmdRule.build({ filePath, fileContent });

      expect(rule.getFilePath()).toBe(filePath);
      expect(rule.getFileContent()).toBe(fileContent);
    });
  });

  describe("fromFilePath", () => {
    it("should load a rule from file", async () => {
      const filePath = join(testDir, "AGENTS.md");
      const fileContent = `# Test AGENTS.md

Content from file.`;

      await fs.writeFile(filePath, fileContent, "utf-8");

      const rule = await AgentsmdRule.fromFilePath(filePath);

      expect(rule.getFilePath()).toBe(filePath);
      expect(rule.getFileContent()).toBe(fileContent);
    });
  });

  describe("fromRulesyncRule", () => {
    it("should create AgentsmdRule from RulesyncRule with root rule", () => {
      const rulesyncPath = join(testDir, "rules", "test-rule.md");
      const rulesyncContent = `---
target: agentsmd
root: true
---

# Root Rule Content`;

      const rulesyncRule = RulesyncRule.build({
        filePath: rulesyncPath,
        fileContent: rulesyncContent,
      });

      const agentsmdRule = AgentsmdRule.fromRulesyncRule(rulesyncRule);

      expect(agentsmdRule.getFilePath()).toBe(join(testDir, "rules", "AGENTS.md"));
      expect(agentsmdRule.getFileContent()).toBe("# Root Rule Content");
    });

    it("should create AgentsmdRule from RulesyncRule with detail rule", () => {
      const rulesyncPath = join(testDir, "rules", "detail-rule.md");
      const rulesyncContent = `---
target: agentsmd
---

# Detail Rule Content`;

      const rulesyncRule = RulesyncRule.build({
        filePath: rulesyncPath,
        fileContent: rulesyncContent,
      });

      const agentsmdRule = AgentsmdRule.fromRulesyncRule(rulesyncRule);

      expect(agentsmdRule.getFilePath()).toBe(
        join(testDir, "rules", ".agents", "memories", "detail-rule.md"),
      );
      expect(agentsmdRule.getFileContent()).toBe("# Detail Rule Content");
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert AgentsmdRule to RulesyncRule", () => {
      const filePath = join(testDir, "AGENTS.md");
      const fileContent = `# AGENTS.md Content

Test content.`;

      const agentsmdRule = AgentsmdRule.build({ filePath, fileContent });
      const rulesyncRule = agentsmdRule.toRulesyncRule();

      expect(rulesyncRule.getFilePath()).toBe(join(testDir, "agentsmd-rule.md"));
      expect(rulesyncRule.getContent().trim()).toBe(fileContent);

      const frontmatter = rulesyncRule.getFrontmatter();
      expect(frontmatter.target).toBe("agentsmd");
      expect(frontmatter.description).toBe("Project-level instructions for AI agents");
    });
  });

  describe("writeFile", () => {
    it("should write rule to file system", async () => {
      const filePath = join(testDir, "output", "AGENTS.md");
      const fileContent = `# Test Write

Content to write.`;

      const rule = AgentsmdRule.build({ filePath, fileContent });
      await rule.writeFile();

      const writtenContent = await fs.readFile(filePath, "utf-8");
      expect(writtenContent).toBe(fileContent);
    });

    it("should create directories if they do not exist", async () => {
      const filePath = join(testDir, "nested", "deep", ".agents", "memories", "rule.md");
      const fileContent = "Deep nested content";

      const rule = AgentsmdRule.build({ filePath, fileContent });
      await rule.writeFile();

      const writtenContent = await fs.readFile(filePath, "utf-8");
      expect(writtenContent).toBe(fileContent);
    });
  });

  describe("validate", () => {
    it("should validate valid AGENTS.md rule", () => {
      const filePath = join(testDir, "AGENTS.md");
      const fileContent = "# Valid content";

      const rule = AgentsmdRule.build({ filePath, fileContent });
      const result = rule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should validate valid memory rule", () => {
      const filePath = join(testDir, ".agents", "memories", "test.md");
      const fileContent = "# Memory content";

      const rule = AgentsmdRule.build({ filePath, fileContent });
      const result = rule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should reject empty content", () => {
      const filePath = join(testDir, "AGENTS.md");
      const fileContent = "";

      const rule = AgentsmdRule.build({ filePath, fileContent });
      const result = rule.validate();

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("cannot be empty");
    });

    it("should reject invalid file path", () => {
      const filePath = join(testDir, "wrong-name.md");
      const fileContent = "# Content";

      const rule = AgentsmdRule.build({ filePath, fileContent });
      const result = rule.validate();

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("must be named AGENTS.md");
    });
  });
});
