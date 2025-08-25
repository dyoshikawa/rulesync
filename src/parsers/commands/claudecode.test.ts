import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../../test-utils/index.js";
import { ClaudeCodeCommandParser } from "./claudecode.js";

describe("ClaudeCodeCommandParser", () => {
  let parser: ClaudeCodeCommandParser;
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    parser = new ClaudeCodeCommandParser();
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  it("returns correct tool name", () => {
    expect(parser.getToolName()).toBe("claudecode");
  });

  it("returns correct commands directory", () => {
    expect(parser.getCommandsDirectory()).toBe(".claude/commands");
  });

  it("parses commands from .claude/commands directory", async () => {
    const commandsDir = join(testDir, ".claude", "commands");
    await mkdir(commandsDir, { recursive: true });

    await writeFile(join(commandsDir, "review.md"), "Please review this code");
    await writeFile(join(commandsDir, "optimize.md"), "Optimize this code");

    const results = await parser.parseCommands(testDir);

    expect(results).toHaveLength(2);
    expect(results[0]!.filename).toBe("optimize");
    expect(results[0]!.content).toBe("Optimize this code");
    expect(results[0]!.frontmatter.targets).toEqual(["claudecode"]);
    expect(results[1]!.filename).toBe("review");
    expect(results[1]!.content).toBe("Please review this code");
    expect(results[1]!.frontmatter.targets).toEqual(["claudecode"]);
  });

  it("handles commands with frontmatter", async () => {
    const commandsDir = join(testDir, ".claude", "commands");
    await mkdir(commandsDir, { recursive: true });

    const content = `---
description: "Custom code review command"
---

Perform a thorough code review focusing on:
1. Security vulnerabilities
2. Performance issues
3. Code quality`;

    await writeFile(join(commandsDir, "security-review.md"), content);

    const results = await parser.parseCommands(testDir);

    expect(results).toHaveLength(1);
    expect(results[0]!.filename).toBe("security-review");
    expect(results[0]!.frontmatter.description).toBe("Custom code review command");
    expect(results[0]!.content).toBe(`Perform a thorough code review focusing on:
1. Security vulnerabilities
2. Performance issues
3. Code quality`);
  });

  it("returns empty array when commands directory doesn't exist", async () => {
    const results = await parser.parseCommands(testDir);

    expect(results).toEqual([]);
  });

  it("ignores non-markdown files", async () => {
    const commandsDir = join(testDir, ".claude", "commands");
    await mkdir(commandsDir, { recursive: true });

    await writeFile(join(commandsDir, "command.md"), "Valid command");
    await writeFile(join(commandsDir, "config.json"), '{"setting": "value"}');
    await writeFile(join(commandsDir, "script.sh"), "#!/bin/bash\\necho hello");

    const results = await parser.parseCommands(testDir);

    expect(results).toHaveLength(1);
    expect(results[0]!.filename).toBe("command");
  });

  it("sets correct frontmatter for all commands", async () => {
    const commandsDir = join(testDir, ".claude", "commands");
    await mkdir(commandsDir, { recursive: true });

    await writeFile(join(commandsDir, "test-command.md"), "Test content");

    const results = await parser.parseCommands(testDir);

    expect(results).toHaveLength(1);
    expect(results[0]!.frontmatter).toEqual({
      root: false,
      targets: ["claudecode"],
      description: "Command: test-command",
      globs: ["**/*"],
    });
    expect(results[0]!.type).toBe("command");
  });

  it("filters out empty command files", async () => {
    const commandsDir = join(testDir, ".claude", "commands");
    await mkdir(commandsDir, { recursive: true });

    await writeFile(join(commandsDir, "valid.md"), "Valid content");
    await writeFile(join(commandsDir, "empty.md"), "");
    await writeFile(join(commandsDir, "whitespace.md"), "   \n  \t  ");

    const results = await parser.parseCommands(testDir);

    expect(results).toHaveLength(1);
    expect(results[0]!.filename).toBe("valid");
  });
});
