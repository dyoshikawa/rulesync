import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import type { Config, ParsedRule, ToolTarget } from "../types/index.js";
import { generateConfigurations } from "./generator.js";

// Mock the logger
vi.mock("../utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    log: vi.fn(),
  },
}));

describe("Generator with RulesProcessor Integration", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;
  let mockConfig: Config;
  let mockRules: ParsedRule[];

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());

    // Create basic test config
    mockConfig = {
      defaultTargets: ["claudecode", "cursor"],
      aiRulesDir: join(testDir, ".rulesync"),
      outputPaths: {
        claudecode: "CLAUDE.md",
        cursor: ".cursor/rules",
        copilot: ".github/copilot-instructions.md",
        cline: ".clinerules",
        augmentcode: ".augment/rules",
        "augmentcode-legacy": ".augment-guidelines",
        amazonqcli: ".amazonq/rules",
        agentsmd: "AGENTS.md",
        codexcli: "AGENTS.md",
        geminicli: "GEMINI.md",
        junie: ".junie/guidelines.md",
        kiro: ".kiro/steering",
        opencode: "AGENTS.md",
        qwencode: "QWEN.md",
        roo: ".roo/rules",
        windsurf: ".windsurf/rules",
      },
      watchEnabled: false,
    };

    // Create test rules
    mockRules = [
      {
        filename: "rule1",
        content: "# Test Rule 1\n\nThis is a test rule for coding standards.",
        frontmatter: {
          targets: ["claudecode", "cursor"],
          description: "Test rule for coding standards",
          globs: ["**/*.ts", "**/*.js"],
          root: true,
        },
        filepath: join(testDir, ".rulesync", "rules", "rule1.md"),
      },
      {
        filename: "rule2",
        content: "# Test Rule 2\n\nThis is another test rule for documentation.",
        frontmatter: {
          targets: ["claudecode"],
          description: "Test rule for documentation",
          globs: ["**/*.md"],
          root: false,
        },
        filepath: join(testDir, ".rulesync", "rules", "rule2.md"),
      },
    ];

    // Create test directories and files
    await mkdir(join(testDir, ".rulesync", "rules"), { recursive: true });

    for (const rule of mockRules) {
      await writeFile(rule.filepath, rule.content, "utf-8");
    }
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("generateConfigurations with RulesProcessor", () => {
    it("should generate configurations using RulesProcessor factory", async () => {
      const outputs = await generateConfigurations(mockRules, mockConfig, ["claudecode"], testDir);

      expect(outputs).toBeDefined();
      expect(Array.isArray(outputs)).toBe(true);

      // Should have generated outputs for claudecode
      const claudecodeOutputs = outputs.filter((output) => output.tool === "claudecode");
      expect(claudecodeOutputs.length).toBeGreaterThan(0);
    });

    it("should generate configurations for multiple tools", async () => {
      const targetTools: ToolTarget[] = ["claudecode", "cursor", "copilot"];
      const outputs = await generateConfigurations(mockRules, mockConfig, targetTools, testDir);

      expect(outputs).toBeDefined();
      expect(Array.isArray(outputs)).toBe(true);

      // Should have outputs for each target tool (where rules apply)
      const toolsWithOutputs = [...new Set(outputs.map((output) => output.tool))];
      expect(toolsWithOutputs.length).toBeGreaterThan(0);

      // Should include claudecode (has matching rules)
      expect(toolsWithOutputs).toContain("claudecode");
    });

    it("should handle tools with no matching rules", async () => {
      // Create a rule that only targets a specific tool
      const specificRules: ParsedRule[] = [
        {
          filename: "specific",
          content: "# Specific Rule\n\nThis rule only applies to one tool.",
          frontmatter: {
            targets: ["copilot"],
            description: "Specific rule for copilot only",
            globs: ["**/*.ts"],
            root: true,
          },
          filepath: join(testDir, ".rulesync", "rules", "specific.md"),
        },
      ];

      // Try to generate for a tool not targeted by any rule
      const outputs = await generateConfigurations(
        specificRules,
        mockConfig,
        ["claudecode"], // claudecode not targeted by the specific rule
        testDir,
      );

      expect(outputs).toBeDefined();
      expect(Array.isArray(outputs)).toBe(true);
      // Should have no outputs for claudecode since no rules target it
      const claudecodeOutputs = outputs.filter((output) => output.tool === "claudecode");
      expect(claudecodeOutputs.length).toBe(0);
    });

    it("should use correct base directory for processing", async () => {
      const customBaseDir = join(testDir, "custom");
      await mkdir(customBaseDir, { recursive: true });

      const outputs = await generateConfigurations(
        mockRules,
        mockConfig,
        ["claudecode"],
        customBaseDir,
      );

      expect(outputs).toBeDefined();
      // Outputs should reference the custom base directory
      for (const output of outputs) {
        expect(output.filepath).toContain(customBaseDir);
      }
    });

    it("should handle root rules properly", async () => {
      // Test with rules where some have root: true and others don't
      const outputs = await generateConfigurations(mockRules, mockConfig, ["claudecode"], testDir);

      expect(outputs).toBeDefined();
      expect(outputs.length).toBeGreaterThan(0);

      // Should successfully generate outputs despite having mixed root/non-root rules
      const claudecodeOutputs = outputs.filter((output) => output.tool === "claudecode");
      expect(claudecodeOutputs.length).toBeGreaterThan(0);
    });

    it("should generate with default config when no baseDir specified", async () => {
      const outputs = await generateConfigurations(
        mockRules,
        mockConfig,
        ["claudecode"],
        // No baseDir parameter
      );

      expect(outputs).toBeDefined();
      expect(Array.isArray(outputs)).toBe(true);
    });
  });

  describe("RulesProcessor integration logging", () => {
    it("should log when RulesProcessor is used", async () => {
      const { logger } = await import("../utils/logger.js");
      const debugSpy = vi.mocked(logger.debug);

      await generateConfigurations(mockRules, mockConfig, ["claudecode"], testDir);

      // Should have logged debug messages about using RulesProcessor
      expect(debugSpy).toHaveBeenCalledWith(
        expect.stringContaining("Generating configuration for tool: claudecode"),
      );
      expect(debugSpy).toHaveBeenCalledWith(
        expect.stringContaining("Using RulesProcessor for tool: claudecode"),
      );
    });

    it("should log when legacy generator is used", async () => {
      const { logger } = await import("../utils/logger.js");
      const debugSpy = vi.mocked(logger.debug);

      await generateConfigurations(mockRules, mockConfig, ["claudecode"], testDir);

      // Should have logged about the tool being processed
      expect(debugSpy).toHaveBeenCalledWith(
        expect.stringContaining("Generating configuration for tool: claudecode"),
      );
    });
  });

  describe("error handling", () => {
    it("should handle invalid base directories gracefully", async () => {
      const invalidBaseDir = "\0invalid\0path";

      // Should not throw an error
      const outputs = await generateConfigurations(
        mockRules,
        mockConfig,
        ["claudecode"],
        invalidBaseDir,
      );

      expect(outputs).toBeDefined();
      expect(Array.isArray(outputs)).toBe(true);
    });

    it("should handle empty rules array", async () => {
      const outputs = await generateConfigurations([], mockConfig, ["claudecode"], testDir);

      expect(outputs).toBeDefined();
      expect(Array.isArray(outputs)).toBe(true);
      expect(outputs.length).toBe(0); // No rules means no outputs
    });

    it("should handle empty target tools array", async () => {
      const outputs = await generateConfigurations(mockRules, mockConfig, [], testDir);

      expect(outputs).toBeDefined();
      expect(Array.isArray(outputs)).toBe(true);
      expect(outputs.length).toBe(0); // No target tools means no outputs
    });
  });
});
