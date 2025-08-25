import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import { generateCommands } from "./command-generator.js";

describe("generateCommands", () => {
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

  it("should return empty array when commands directory does not exist", async () => {
    const result = await generateCommands(testDir, undefined, ["claudecode"]);

    expect(result).toEqual([]);
  });

  it("should return empty array when commands directory is empty", async () => {
    const commandsDir = join(testDir, ".rulesync", "commands");
    await mkdir(commandsDir, { recursive: true });

    const result = await generateCommands(testDir, undefined, ["claudecode"]);

    expect(result).toEqual([]);
  });

  it("should generate commands for supported targets", async () => {
    const commandsDir = join(testDir, ".rulesync", "commands");
    await mkdir(commandsDir, { recursive: true });

    // Create a command file
    const commandContent = `---
description: "Test command for code review"
---

# Code Review Command

Please review the following code:
{{args}}`;

    await writeFile(join(commandsDir, "review.md"), commandContent);

    const result = await generateCommands(testDir, undefined, ["claudecode"]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      tool: "claudecode",
      content: expect.stringContaining("# Code Review Command"),
    });
    expect(result[0]?.filepath).toContain(".claude/commands");
    expect(result[0]?.content).toContain("# Code Review Command");
  });

  it("should generate commands for multiple supported targets", async () => {
    const commandsDir = join(testDir, ".rulesync", "commands");
    await mkdir(commandsDir, { recursive: true });

    const commandContent = `---
description: "Multi-target command"
---

# Multi-Target Command

Test command for multiple tools.`;

    await writeFile(join(commandsDir, "multi.md"), commandContent);

    const result = await generateCommands(testDir, undefined, ["claudecode", "geminicli", "roo"]);

    expect(result).toHaveLength(3);
    expect(result.map((r) => r.tool)).toContain("claudecode");
    expect(result.map((r) => r.tool)).toContain("geminicli");
    expect(result.map((r) => r.tool)).toContain("roo");
  });

  it("should skip unsupported targets", async () => {
    const commandsDir = join(testDir, ".rulesync", "commands");
    await mkdir(commandsDir, { recursive: true });

    const commandContent = `---
description: "Test command"
---

# Test Command

Test command content.`;

    await writeFile(join(commandsDir, "test.md"), commandContent);

    const result = await generateCommands(testDir, undefined, ["cursor", "cline"]);

    expect(result).toEqual([]);
  });

  it("should use baseDir when provided", async () => {
    const commandsDir = join(testDir, ".rulesync", "commands");
    await mkdir(commandsDir, { recursive: true });

    const baseDir = join(testDir, "output");
    await mkdir(baseDir, { recursive: true });

    const commandContent = `---
description: "Test command with baseDir"
---

# BaseDir Command

Test command with custom baseDir.`;

    await writeFile(join(commandsDir, "basedir.md"), commandContent);

    const result = await generateCommands(testDir, baseDir, ["claudecode"]);

    expect(result).toHaveLength(1);
    expect(result[0]?.filepath).toContain(baseDir);
  });

  it("should generate multiple commands from multiple files", async () => {
    const commandsDir = join(testDir, ".rulesync", "commands");
    await mkdir(commandsDir, { recursive: true });

    const reviewCommand = `---
description: "Code review command"
---

# Review Command

Review code: {{args}}`;

    const analyzeCommand = `---
description: "Code analysis command"
---

# Analyze Command

Analyze code: {{args}}`;

    await writeFile(join(commandsDir, "review.md"), reviewCommand);
    await writeFile(join(commandsDir, "analyze.md"), analyzeCommand);

    const result = await generateCommands(testDir, undefined, ["claudecode"]);

    expect(result).toHaveLength(2);
    expect(result.some((r) => r.filepath.includes("review.md"))).toBe(true);
    expect(result.some((r) => r.filepath.includes("analyze.md"))).toBe(true);
  });

  it("should handle command generation errors gracefully", async () => {
    const commandsDir = join(testDir, ".rulesync", "commands");
    await mkdir(commandsDir, { recursive: true });

    // Create an invalid command file (missing frontmatter)
    await writeFile(join(commandsDir, "invalid.md"), "Just plain text without frontmatter");

    const result = await generateCommands(testDir, undefined, ["claudecode"]);

    // Should not throw and may return empty array or handle gracefully
    expect(Array.isArray(result)).toBe(true);
  });
});
