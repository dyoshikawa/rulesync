import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseRuleFile, parseRulesFromDirectory } from "../../src/core/parser.js";
import { setupTestDirectory } from "../test-utils/index.js";

describe("parser", () => {
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

  describe("parseRuleFile", () => {
    it("should parse valid rule file", async () => {
      const ruleContent = `---
root: true
targets: ["copilot", "cursor"]
description: "Test rule"
globs: ["**/*.ts"]
---

# Test Rule

This is a test rule content.
`;

      const filepath = join(testDir, "test-rule.md");
      writeFileSync(filepath, ruleContent);

      const rule = await parseRuleFile(filepath);

      expect(rule.frontmatter.root).toBe(true);
      expect(rule.frontmatter.targets).toEqual(["copilot", "cursor"]);
      expect(rule.frontmatter.description).toBe("Test rule");
      expect(rule.frontmatter.globs).toEqual(["**/*.ts"]);
      expect(rule.content.trim()).toBe("# Test Rule\n\nThis is a test rule content.");
      expect(rule.filename).toBe("test-rule");
      expect(rule.filepath).toBe(filepath);
    });

    it("should handle wildcard targets", async () => {
      const ruleContent = `---
root: false
targets: ["*"]
description: "Test rule with wildcard"
globs: ["**/*.js"]
---

# Wildcard Rule
`;

      const filepath = join(testDir, "wildcard-rule.md");
      writeFileSync(filepath, ruleContent);

      const rule = await parseRuleFile(filepath);

      expect(rule.frontmatter.targets).toEqual(["*"]);
    });

    it("should throw error for invalid root", async () => {
      const ruleContent = `---
root: invalid
targets: ["copilot"]
description: "Test rule"
globs: ["**/*.ts"]
---

# Invalid Rule
`;

      const filepath = join(testDir, "invalid-rule.md");
      writeFileSync(filepath, ruleContent);

      await expect(parseRuleFile(filepath)).rejects.toThrow("Invalid frontmatter");
    });

    it("should throw error for invalid targets", async () => {
      const ruleContent = `---
priority: high
targets: ["invalid-tool"]
description: "Test rule"
globs: ["**/*.ts"]
---

# Invalid Rule
`;

      const filepath = join(testDir, "invalid-targets.md");
      writeFileSync(filepath, ruleContent);

      await expect(parseRuleFile(filepath)).rejects.toThrow("Invalid frontmatter");
    });

    it("should apply default value for missing description", async () => {
      const ruleContent = `---
root: true
targets: ["copilot"]
globs: ["**/*.ts"]
---

# Missing Description
`;

      const filepath = join(testDir, "missing-desc.md");
      writeFileSync(filepath, ruleContent);

      const rule = await parseRuleFile(filepath);

      expect(rule.frontmatter.description).toBe("");
      expect(rule.frontmatter.root).toBe(true);
      expect(rule.frontmatter.targets).toEqual(["copilot"]);
      expect(rule.frontmatter.globs).toEqual(["**/*.ts"]);
    });

    it("should apply default value for missing globs", async () => {
      const ruleContent = `---
root: true
targets: ["copilot"]
description: "Test rule"
---

# Missing Globs
`;

      const filepath = join(testDir, "missing-globs.md");
      writeFileSync(filepath, ruleContent);

      const rule = await parseRuleFile(filepath);

      expect(rule.frontmatter.globs).toEqual([]);
      expect(rule.frontmatter.root).toBe(true);
      expect(rule.frontmatter.targets).toEqual(["copilot"]);
      expect(rule.frontmatter.description).toBe("Test rule");
    });

    it("should throw error for invalid globs type", async () => {
      const ruleContent = `---
root: true
targets: ["copilot"]
description: "Test rule"
globs: "not-an-array"
---

# Invalid Globs Type
`;

      const filepath = join(testDir, "invalid-globs-type.md");
      writeFileSync(filepath, ruleContent);

      await expect(parseRuleFile(filepath)).rejects.toThrow("Invalid frontmatter");
    });

    it("should handle empty globs array", async () => {
      const ruleContent = `---
root: false
targets: ["copilot"]
description: "Test rule"
globs: []
---

# Empty Globs
`;

      const filepath = join(testDir, "empty-globs.md");
      writeFileSync(filepath, ruleContent);

      const rule = await parseRuleFile(filepath);

      expect(rule.frontmatter.globs).toEqual([]);
    });

    it("should apply all default values for file without frontmatter", async () => {
      const ruleContent = `# No Frontmatter

This file has no frontmatter.
`;

      const filepath = join(testDir, "no-frontmatter.md");
      writeFileSync(filepath, ruleContent);

      const rule = await parseRuleFile(filepath);

      expect(rule.frontmatter.root).toBe(false);
      expect(rule.frontmatter.targets).toEqual(["*"]);
      expect(rule.frontmatter.description).toBe("");
      expect(rule.frontmatter.globs).toEqual([]);
    });

    it("should apply all default values for completely empty frontmatter", async () => {
      const ruleContent = `---
---

# Empty Frontmatter
`;

      const filepath = join(testDir, "empty-frontmatter.md");
      writeFileSync(filepath, ruleContent);

      const rule = await parseRuleFile(filepath);

      expect(rule.frontmatter.root).toBe(false);
      expect(rule.frontmatter.targets).toEqual(["*"]);
      expect(rule.frontmatter.description).toBe("");
      expect(rule.frontmatter.globs).toEqual([]);
    });

    it("should throw error for string targets", async () => {
      const ruleContent = `---
root: true
targets: "*"
description: "Test rule with string target"
globs: ["**/*.ts"]
---

# String Target
`;

      const filepath = join(testDir, "string-target.md");
      writeFileSync(filepath, ruleContent);

      await expect(parseRuleFile(filepath)).rejects.toThrow("Invalid frontmatter");
    });

    it("should accept claudecode as valid target", async () => {
      const ruleContent = `---
root: false
targets: ["claudecode"]
description: "Test rule for Claude Code"
globs: ["**/*.ts"]
---

# Claude Code Rule
`;

      const filepath = join(testDir, "claudecode-rule.md");
      writeFileSync(filepath, ruleContent);

      const rule = await parseRuleFile(filepath);

      expect(rule.frontmatter.targets).toEqual(["claudecode"]);
      expect(rule.frontmatter.description).toBe("Test rule for Claude Code");
    });

    it("should accept mixed targets including claudecode", async () => {
      const ruleContent = `---
root: false
targets: ["copilot", "claudecode", "cursor"]
description: "Test rule for multiple tools including Claude Code"
globs: ["**/*.ts"]
---

# Mixed Targets with Claude Code
`;

      const filepath = join(testDir, "mixed-claudecode-rule.md");
      writeFileSync(filepath, ruleContent);

      const rule = await parseRuleFile(filepath);

      expect(rule.frontmatter.targets).toEqual(["copilot", "claudecode", "cursor"]);
    });
  });

  describe("parseRulesFromDirectory", () => {
    it("should parse multiple rule files from directory", async () => {
      const rule1Content = `---
root: true
targets: ["*"]
description: "Rule 1"
globs: ["**/*.ts"]
---

# Rule 1
`;

      const rule2Content = `---
root: false
targets: ["copilot"]
description: "Rule 2"
globs: ["**/*.js"]
---

# Rule 2
`;

      writeFileSync(join(testDir, "rule1.md"), rule1Content);
      writeFileSync(join(testDir, "rule2.md"), rule2Content);

      const rules = await parseRulesFromDirectory(testDir);

      expect(rules).toHaveLength(2);
      expect(rules[0]!.filename).toBe("rule1");
      expect(rules[1]!.filename).toBe("rule2");
    });

    it("should ignore non-markdown files", async () => {
      const ruleContent = `---
root: true
targets: ["*"]
description: "Rule"
globs: ["**/*.ts"]
---

# Rule
`;

      writeFileSync(join(testDir, "rule.md"), ruleContent);
      writeFileSync(join(testDir, "not-markdown.txt"), "This is not markdown");
      writeFileSync(join(testDir, "config.json"), '{"test": true}');

      const rules = await parseRulesFromDirectory(testDir);

      expect(rules).toHaveLength(1);
      expect(rules[0]!.filename).toBe("rule");
    });

    it("should return empty array for non-existent directory", async () => {
      const rules = await parseRulesFromDirectory(join(testDir, "non-existent"));

      expect(rules).toEqual([]);
    });

    it("should handle directory with no markdown files", async () => {
      writeFileSync(join(testDir, "test.txt"), "Not markdown");

      const rules = await parseRulesFromDirectory(testDir);

      expect(rules).toEqual([]);
    });

    it("should throw error when directory contains invalid rule files", async () => {
      const validRule = `---
root: true
targets: ["*"]
description: "Valid rule"
globs: ["**/*.ts"]
---

# Valid Rule
`;

      const invalidRule = `---
root: invalid
targets: ["copilot"]
description: "Invalid rule"
globs: ["**/*.ts"]
---

# Invalid Rule
`;

      writeFileSync(join(testDir, "valid.md"), validRule);
      writeFileSync(join(testDir, "invalid.md"), invalidRule);

      await expect(parseRulesFromDirectory(testDir)).rejects.toThrow("Validation errors found:");
    });

    it("should throw error when multiple root rules exist", async () => {
      const rootRule1 = `---
root: true
targets: ["*"]
description: "Root rule 1"
globs: ["**/*.ts"]
---

# Root Rule 1
`;

      const rootRule2 = `---
root: true
targets: ["copilot", "cursor"]
description: "Root rule 2"
globs: ["**/*.js"]
---

# Root Rule 2
`;

      const nonRootRule = `---
root: false
targets: ["cline"]
description: "Non-root rule"
globs: ["**/*.md"]
---

# Non-root Rule
`;

      writeFileSync(join(testDir, "root1.md"), rootRule1);
      writeFileSync(join(testDir, "root2.md"), rootRule2);
      writeFileSync(join(testDir, "nonroot.md"), nonRootRule);

      await expect(parseRulesFromDirectory(testDir)).rejects.toThrow("Multiple root rules found:");
    });
  });
});
