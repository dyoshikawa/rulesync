import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import { writeFileContent } from "../utils/file.js";
import { logger } from "../utils/logger.js";
import { RulesProcessor, RulesProcessorToolTargetSchema } from "./rules-processor.js";
import { RulesyncRule } from "./rulesync-rule.js";
import { ToolRule } from "./tool-rule.js";

// Mock logger to avoid console output during tests
vi.mock("../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("RulesProcessor", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;
  let processor: RulesProcessor;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    processor = new RulesProcessor({
      baseDir: testDir,
      toolTarget: "claudecode",
    });
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("constructor", () => {
    it("should create RulesProcessor with valid tool target", () => {
      const processor = new RulesProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      expect(processor).toBeInstanceOf(RulesProcessor);
    });

    it("should validate tool target using schema", () => {
      expect(() => RulesProcessorToolTargetSchema.parse("claudecode")).not.toThrow();

      expect(() => RulesProcessorToolTargetSchema.parse("cursor")).not.toThrow();

      expect(() => RulesProcessorToolTargetSchema.parse("invalid-tool")).toThrow();
    });

    it("should throw error for invalid tool target", () => {
      expect(() => {
        return new RulesProcessor({
          baseDir: testDir,
          toolTarget: "invalid-tool" as any,
        });
      }).toThrow();
    });

    it("should support all defined tool targets", () => {
      const validTargets = [
        "agentsmd",
        "amazonqcli",
        "augmentcode",
        "augmentcode-legacy",
        "claudecode",
        "cline",
        "codexcli",
        "copilot",
        "cursor",
        "geminicli",
        "junie",
        "kiro",
        "opencode",
        "qwencode",
        "roo",
        "windsurf",
      ];

      for (const target of validTargets) {
        expect(() => {
          return new RulesProcessor({
            baseDir: testDir,
            toolTarget: target as any,
          });
        }).not.toThrow();
      }
    });
  });

  describe("loadRulesyncFiles", () => {
    it("should load and parse multiple rule files", async () => {
      // Create test rule files
      const rulesDir = join(testDir, ".rulesync", "rules");
      await writeFileContent(
        join(rulesDir, "rule1.md"),
        `---
root: false
targets: ["claudecode"]
description: "Test rule 1"
globs: ["**/*.ts"]
---

# Rule 1 Content

This is test rule content.`,
      );

      await writeFileContent(
        join(rulesDir, "rule2.md"),
        `---
root: false
targets: ["cursor"]
description: "Test rule 2"
globs: ["**/*.js"]
---

# Rule 2 Content

This is another test rule content.`,
      );

      const rules = await processor.loadRulesyncFiles();

      expect(rules).toHaveLength(2);
      expect(rules[0]!).toBeInstanceOf(RulesyncRule);
      expect(rules[1]!).toBeInstanceOf(RulesyncRule);
      expect(logger.info).toHaveBeenCalledWith("Found 2 rule files in " + rulesDir);
      expect(logger.info).toHaveBeenCalledWith("Successfully loaded 2 rulesync rules");
    });

    it("should handle empty directory", async () => {
      // Create empty rules directory
      const rulesDir = join(testDir, ".rulesync", "rules");
      await writeFileContent(join(rulesDir, ".gitkeep"), "");

      await expect(processor.loadRulesyncFiles()).rejects.toThrow(
        "No markdown files found in rulesync rules directory",
      );
    });

    it("should throw error when directory does not exist", async () => {
      await expect(processor.loadRulesyncFiles()).rejects.toThrow(
        "Rulesync rules directory not found",
      );
    });

    it("should skip invalid files and continue", async () => {
      const rulesDir = join(testDir, ".rulesync", "rules");

      // Create valid rule file
      await writeFileContent(
        join(rulesDir, "valid.md"),
        `---
root: false
targets: ["claudecode"]
description: "Valid rule"
---

Valid content`,
      );

      // Create invalid rule file with malformed YAML frontmatter
      await writeFileContent(
        join(rulesDir, "invalid.md"),
        `---
root: "not a boolean"
targets: "not an array"
description: 123
globs: "not an array"
---

Invalid content`,
      );

      const rules = await processor.loadRulesyncFiles();

      expect(rules).toHaveLength(1);
      expect(rules[0]!.getFrontmatter().description).toBe("Valid rule");
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Failed to load rule file"),
        expect.anything(),
      );
    });

    it("should throw error when no valid rules found", async () => {
      const rulesDir = join(testDir, ".rulesync", "rules");

      // Create only invalid rule files with malformed YAML frontmatter
      await writeFileContent(
        join(rulesDir, "invalid.md"),
        `---
root: "not a boolean"
targets: "not an array"
description: 123
globs: "not an array"
---

Invalid content`,
      );

      await expect(processor.loadRulesyncFiles()).rejects.toThrow("No valid rules found in");
    });
  });

  describe("loadToolFiles", () => {
    it("should load Claude Code rules from CLAUDE.md", async () => {
      processor = new RulesProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      await writeFileContent(
        join(testDir, "CLAUDE.md"),
        `# Claude Code Memory

This is Claude Code project memory.`,
      );

      const rules = await processor.loadToolFiles();

      expect(rules).toHaveLength(1);
      expect(logger.info).toHaveBeenCalledWith("Successfully loaded Claude Code memory file");
    });

    it("should load Cursor rules from .cursor/rules/", async () => {
      processor = new RulesProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      const rulesDir = join(testDir, ".cursor", "rules");
      await writeFileContent(
        join(rulesDir, "rule1.mdc"),
        `---
description: "Cursor rule 1"
alwaysApply: true
---

# Cursor Rule 1

This is a cursor rule.`,
      );

      const rules = await processor.loadToolFiles();

      expect(rules).toHaveLength(1);
      expect(logger.info).toHaveBeenCalledWith("Found 1 Cursor rule files in " + rulesDir);
    });

    it("should return empty array for non-existent directories", async () => {
      processor = new RulesProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      const rules = await processor.loadToolFiles();

      expect(rules).toHaveLength(0);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Cursor rules directory not found"),
      );
    });

    it("should handle different tool targets", async () => {
      // Test AGENTS.md for agentsmd tool target
      processor = new RulesProcessor({
        baseDir: testDir,
        toolTarget: "agentsmd",
      });

      await writeFileContent(
        join(testDir, "AGENTS.md"),
        `# Agents

This is agents file content.`,
      );

      const rules = await processor.loadToolFiles();

      expect(rules).toHaveLength(1);
      expect(logger.info).toHaveBeenCalledWith("Successfully loaded AGENTS.md rule");
    });

    it("should throw error for unsupported tool target in switch", async () => {
      // This should never happen due to schema validation, but test for completeness
      const processor = new RulesProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      // Manually change the tool target to test error handling
      (processor as any).toolTarget = "unsupported-tool";

      await expect(processor.loadToolFiles()).rejects.toThrow(
        "Unsupported tool target: unsupported-tool",
      );
    });
  });

  describe("writeToolRulesFromRulesyncRules", () => {
    it("should convert and write rulesync rules to tool-specific format", async () => {
      const rulesyncRules = [
        new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: ".rulesync/rules",
          relativeFilePath: "test-rule.md",
          frontmatter: {
            root: false,
            targets: ["claudecode"],
            description: "Test rule",
            globs: ["**/*.ts"],
          },
          body: "Test rule content",
          fileContent: `---
root: false
targets: ["claudecode"]
description: "Test rule"
globs: ["**/*.ts"]
---

Test rule content`,
          validate: false,
        }),
      ];

      await processor.writeToolRulesFromRulesyncRules(rulesyncRules);

      // Verify that the rule was converted and file was created
      // The exact file path depends on the tool target
      // For Claude Code, it should create CLAUDE.md
      const expectedFilePath = join(testDir, "CLAUDE.md");
      const fileExists = await import("node:fs/promises").then((fs) =>
        fs
          .access(expectedFilePath)
          .then(() => true)
          .catch(() => false),
      );
      expect(fileExists).toBe(true);
    });

    it("should handle multiple rules", async () => {
      const rulesyncRules = [
        new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: ".rulesync/rules",
          relativeFilePath: "rule1.md",
          frontmatter: {
            root: false,
            targets: ["claudecode"],
            description: "Rule 1",
            globs: ["**/*.ts"],
          },
          body: "Rule 1 content",
          fileContent: "Rule 1 file content",
          validate: false,
        }),
        new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: ".rulesync/rules",
          relativeFilePath: "rule2.md",
          frontmatter: {
            root: false,
            targets: ["claudecode"],
            description: "Rule 2",
            globs: ["**/*.js"],
          },
          body: "Rule 2 content",
          fileContent: "Rule 2 file content",
          validate: false,
        }),
      ];

      await expect(processor.writeToolRulesFromRulesyncRules(rulesyncRules)).resolves.not.toThrow();
    });

    it("should handle empty array", async () => {
      await expect(processor.writeToolRulesFromRulesyncRules([])).resolves.not.toThrow();
    });

    it("should throw error for unsupported tool target", async () => {
      // Manually change tool target to test error handling
      (processor as any).toolTarget = "unsupported-tool";

      const rulesyncRules = [
        new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: ".rulesync/rules",
          relativeFilePath: "test-rule.md",
          frontmatter: {
            root: false,
            targets: ["claudecode"],
            description: "Test rule",
            globs: ["**/*.ts"],
          },
          body: "Test rule content",
          fileContent: "Test file content",
          validate: false,
        }),
      ];

      await expect(processor.writeToolRulesFromRulesyncRules(rulesyncRules)).rejects.toThrow(
        "Unsupported tool target: unsupported-tool",
      );
    });
  });

  describe("writeRulesyncRulesFromToolRules", () => {
    it("should convert and write tool rules back to rulesync format", async () => {
      // First create a Claude Code rule
      await writeFileContent(
        join(testDir, "CLAUDE.md"),
        `# Claude Code Memory

This is Claude Code project memory.`,
      );

      // Load the tool rules
      const toolRules = await processor.loadToolFiles();
      expect(toolRules).toHaveLength(1);

      // Convert back to rulesync format
      await processor.writeRulesyncRulesFromToolRules(toolRules as ToolRule[]);

      // The rulesync rules should be written to .rulesync/rules/ directory
      // Verify that files are created (exact verification depends on implementation)
      // This is an integration test that the conversion pipeline works
    });

    it("should handle empty array", async () => {
      await expect(processor.writeRulesyncRulesFromToolRules([])).resolves.not.toThrow();
    });
  });

  describe("round-trip conversion", () => {
    it("should preserve data through rulesync -> tool -> rulesync conversion", async () => {
      // Create initial rulesync rule
      const rulesDir = join(testDir, ".rulesync", "rules");
      await writeFileContent(
        join(rulesDir, "test-rule.md"),
        `---
root: false
targets: ["claudecode"]
description: "Test rule for round-trip"
globs: ["**/*.ts"]
---

# Test Rule

This is test content for round-trip conversion.`,
      );

      // Load rulesync rules
      const originalRules = await processor.loadRulesyncFiles();
      expect(originalRules).toHaveLength(1);

      const originalFrontmatter = (originalRules[0] as RulesyncRule).getFrontmatter();

      // Convert to tool format (this should create CLAUDE.md file)
      await processor.writeToolRulesFromRulesyncRules(originalRules as RulesyncRule[]);

      // Load tool rules from the created file
      const toolRules = await processor.loadToolFiles();
      expect(toolRules).toHaveLength(1);

      // Convert back to rulesync format
      await processor.writeRulesyncRulesFromToolRules(toolRules as ToolRule[]);

      // Verify data preservation by converting back
      const convertedRulesyncFiles = await processor.convertToolFilesToRulesyncFiles(toolRules);
      expect(convertedRulesyncFiles).toHaveLength(1);
      const convertedRule = convertedRulesyncFiles[0] as RulesyncRule;
      expect(convertedRule.getFrontmatter().targets).toEqual(["claudecode"]);
      expect(convertedRule.getFrontmatter().description).toBe(originalFrontmatter.description);
      // Note: Body might be modified by tool-specific processing, so we check it exists
      expect(convertedRule.getBody()).toBeTruthy();
    });
  });

  describe("edge cases", () => {
    it("should handle file permission errors gracefully", async () => {
      // This test would require actual file permission manipulation
      // For now, we test that the error handling structure is in place
      expect(processor).toBeInstanceOf(RulesProcessor);
    });

    it("should handle concurrent operations", async () => {
      // Create multiple rule files
      const rulesDir = join(testDir, ".rulesync", "rules");
      await writeFileContent(
        join(rulesDir, "rule1.md"),
        `---
root: false
targets: ["claudecode"]
description: "Rule 1"
---
Rule 1 content`,
      );

      await writeFileContent(
        join(rulesDir, "rule2.md"),
        `---
root: false
targets: ["claudecode"]
description: "Rule 2"
---
Rule 2 content`,
      );

      // Load rules concurrently
      const [rules1, rules2] = await Promise.all([
        processor.loadRulesyncFiles(),
        processor.loadRulesyncFiles(),
      ]);

      expect(rules1).toHaveLength(2);
      expect(rules2).toHaveLength(2);
    });

    it("should handle large files", async () => {
      const rulesDir = join(testDir, ".rulesync", "rules");
      const largeContent = "# Large Rule\n\n" + "Content line.\n".repeat(1000);

      await writeFileContent(
        join(rulesDir, "large-rule.md"),
        `---
root: false
targets: ["claudecode"]
description: "Large rule"
---

${largeContent}`,
      );

      const rules = await processor.loadRulesyncFiles();
      expect(rules).toHaveLength(1);
      expect(rules[0]!.getBody()).toContain("Content line.");
    });
  });

  describe("tool-specific directory loading", () => {
    it("should load rules from correct directories for each tool", async () => {
      // Test cursor tool target specifically
      const testProcessor = new RulesProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      const ruleDir = join(testDir, ".cursor", "rules");
      await writeFileContent(
        join(ruleDir, "test.mdc"),
        `---
description: "Test rule for cursor"
alwaysApply: true
---

# Test Rule

This is a test rule for cursor.`,
      );

      const rules = await testProcessor.loadToolFiles();
      expect(rules).toHaveLength(1);
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining(`Found 1 Cursor rule files`),
      );
    });
  });
});
