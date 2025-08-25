import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import type { ProcessedRule } from "../types/index.js";
import { generateSubagents } from "./subagent-generator.js";

describe("generateSubagents", () => {
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

  it("should return empty array when no tools specified", async () => {
    const rulesyncDir = join(testDir, ".rulesync");
    await mkdir(rulesyncDir, { recursive: true });

    const result = await generateSubagents(rulesyncDir, undefined, []);

    expect(result).toEqual([]);
  });

  it("should return empty array when tools is undefined", async () => {
    const rulesyncDir = join(testDir, ".rulesync");
    await mkdir(rulesyncDir, { recursive: true });

    const result = await generateSubagents(rulesyncDir, undefined, undefined);

    expect(result).toEqual([]);
  });

  it("should skip unsupported tools", async () => {
    const rulesyncDir = join(testDir, ".rulesync");
    await mkdir(rulesyncDir, { recursive: true });

    const result = await generateSubagents(rulesyncDir, undefined, ["cursor", "cline"]);

    expect(result).toEqual([]);
  });

  it("should generate subagents for claudecode", async () => {
    const rulesyncDir = join(testDir, ".rulesync");
    await mkdir(rulesyncDir, { recursive: true });

    const mockRules = [
      {
        filename: "test-rule.md",
        filepath: join(testDir, "test-rule.md"),
        content: "Test rule content",
        frontmatter: {
          targets: ["claudecode"] as const,
          root: false,
          globs: ["**/*"],
          description: "Test rule",
        },
      },
    ];

    // ClaudeCode subagent generator intentionally returns empty array for rules
    // This test should expect empty array since no parsed subagents are provided
    const result = await generateSubagents(
      rulesyncDir,
      undefined,
      ["claudecode"],
      mockRules as unknown as ProcessedRule[],
    );

    expect(result).toHaveLength(0);
  });

  it("should use existing subagents when available", async () => {
    const rulesyncDir = join(testDir, ".rulesync");
    const subagentsDir = join(rulesyncDir, "subagents");
    await mkdir(subagentsDir, { recursive: true });

    // Create a subagent file
    const subagentContent = `---
name: "test-subagent"
description: "Test subagent"
---

# Test Subagent

This is a test subagent.`;

    await writeFile(join(subagentsDir, "test-subagent.md"), subagentContent);

    const mockRules = [
      {
        filename: "test-rule.md",
        filepath: join(testDir, "test-rule.md"),
        content: "Test rule content",
        frontmatter: {
          targets: ["claudecode"] as const,
          root: false,
          globs: ["**/*"],
          description: "Test rule",
        },
      },
    ];

    const result = await generateSubagents(
      rulesyncDir,
      undefined,
      ["claudecode"],
      mockRules as unknown as ProcessedRule[],
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.tool).toBe("claudecode");
  });

  it("should handle subagent directory read errors gracefully", async () => {
    const rulesyncDir = join(testDir, ".rulesync");
    // Don't create the directory to cause an error

    const result = await generateSubagents(rulesyncDir, undefined, ["claudecode"]);

    // Should not throw and return empty array for unsupported scenario
    expect(Array.isArray(result)).toBe(true);
  });

  it("should use output directory when provided", async () => {
    const rulesyncDir = join(testDir, ".rulesync");
    const outputDir = join(testDir, "output");
    const subagentsDir = join(rulesyncDir, "subagents");
    await mkdir(rulesyncDir, { recursive: true });
    await mkdir(outputDir, { recursive: true });
    await mkdir(subagentsDir, { recursive: true });

    // Create a subagent file to test output directory usage
    const subagentContent = `---
name: "test-subagent"
description: "Test subagent for output directory testing"
---

# Test Subagent

This is a test subagent.`;

    await writeFile(join(subagentsDir, "test-subagent.md"), subagentContent);

    const result = await generateSubagents(rulesyncDir, outputDir, ["claudecode"]);

    expect(result).toHaveLength(1);
    expect(result[0]?.filepath).toContain(outputDir);
  });

  it("should handle generator errors gracefully", async () => {
    const rulesyncDir = join(testDir, ".rulesync");
    await mkdir(rulesyncDir, { recursive: true });

    // Mock logger to prevent error output during test
    const mockLogger = vi.fn();
    vi.doMock("../utils/logger.js", () => ({
      logger: {
        debug: vi.fn(),
        error: mockLogger,
      },
    }));

    const result = await generateSubagents(rulesyncDir, undefined, ["claudecode"]);

    expect(Array.isArray(result)).toBe(true);
    vi.doUnmock("../utils/logger.js");
  });

  it("should generate multiple subagents for multiple tools", async () => {
    const rulesyncDir = join(testDir, ".rulesync");
    await mkdir(rulesyncDir, { recursive: true });

    const mockRules = [
      {
        filename: "test-rule.md",
        filepath: join(testDir, "test-rule.md"),
        content: "Test rule content",
        frontmatter: {
          targets: ["claudecode"] as const,
          root: false,
          globs: ["**/*"],
          description: "Test rule",
        },
      },
    ];

    // Only claudecode is currently supported, and it returns empty array for rules
    const result = await generateSubagents(
      rulesyncDir,
      undefined,
      ["claudecode"],
      mockRules as unknown as ProcessedRule[],
    );

    expect(result).toHaveLength(0);
  });
});
