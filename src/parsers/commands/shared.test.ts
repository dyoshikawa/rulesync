import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../../test-utils/index.js";
import { parseCommandFile, parseCommandsFromDirectory } from "./shared.js";

describe("parseCommandFile", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  it("parses a simple markdown command file", async () => {
    const filePath = join(testDir, "test-command.md");
    await writeFile(filePath, "This is a test command content");

    const result = await parseCommandFile(filePath, "claudecode");

    expect(result).toEqual({
      frontmatter: {
        root: false,
        targets: ["claudecode"],
        description: "Command: test-command",
        globs: ["**/*"],
      },
      content: "This is a test command content",
      filename: "test-command",
      filepath: filePath,
      type: "command",
    });
  });

  it("parses a command file with frontmatter", async () => {
    const content = `---
description: "Custom description"
---

This is command content with frontmatter`;

    const filePath = join(testDir, "frontmatter-command.md");
    await writeFile(filePath, content);

    const result = await parseCommandFile(filePath, "claudecode");

    expect(result).toEqual({
      frontmatter: {
        root: false,
        targets: ["claudecode"],
        description: "Custom description",
        globs: ["**/*"],
      },
      content: "This is command content with frontmatter",
      filename: "frontmatter-command",
      filepath: filePath,
      type: "command",
    });
  });

  it("uses default description when none provided", async () => {
    const filePath = join(testDir, "no-description.md");
    await writeFile(filePath, "Content without description");

    const result = await parseCommandFile(filePath, "geminicli", "Default: no-description");

    expect(result?.frontmatter.description).toBe("Default: no-description");
  });

  it("returns null for empty files", async () => {
    const filePath = join(testDir, "empty.md");
    await writeFile(filePath, "");

    const result = await parseCommandFile(filePath, "claudecode");

    expect(result).toBeNull();
  });

  it("returns null for whitespace-only files", async () => {
    const filePath = join(testDir, "whitespace.md");
    await writeFile(filePath, "   \n  \t  \n");

    const result = await parseCommandFile(filePath, "claudecode");

    expect(result).toBeNull();
  });

  it("handles invalid frontmatter gracefully", async () => {
    const content = `---
invalid yaml content
---

Command content`;

    const filePath = join(testDir, "invalid-frontmatter.md");
    await writeFile(filePath, content);

    const result = await parseCommandFile(filePath, "claudecode");

    expect(result).toEqual({
      frontmatter: {
        root: false,
        targets: ["claudecode"],
        description: "Command: invalid-frontmatter",
        globs: ["**/*"],
      },
      content: "Command content",
      filename: "invalid-frontmatter",
      filepath: filePath,
      type: "command",
    });
  });
});

describe("parseCommandsFromDirectory", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  it("parses all markdown files from directory", async () => {
    const commandsDir = join(testDir, "commands");
    await mkdir(commandsDir, { recursive: true });

    await writeFile(join(commandsDir, "command1.md"), "First command");
    await writeFile(join(commandsDir, "command2.md"), "Second command");
    await writeFile(join(commandsDir, "not-a-command.txt"), "Not a command");

    const results = await parseCommandsFromDirectory(commandsDir, "claudecode");

    expect(results).toHaveLength(2);
    expect(results[0]!.filename).toBe("command1");
    expect(results[0]!.content).toBe("First command");
    expect(results[1]!.filename).toBe("command2");
    expect(results[1]!.content).toBe("Second command");
  });

  it("handles custom file extensions", async () => {
    const commandsDir = join(testDir, "commands");
    await mkdir(commandsDir, { recursive: true });

    await writeFile(join(commandsDir, "command.toml"), "TOML command");
    await writeFile(join(commandsDir, "command.md"), "MD command");

    const results = await parseCommandsFromDirectory(commandsDir, "geminicli", ".toml");

    expect(results).toHaveLength(1);
    expect(results[0]!.filename).toBe("command");
    expect(results[0]!.content).toBe("TOML command");
  });

  it("uses custom description prefix", async () => {
    const commandsDir = join(testDir, "commands");
    await mkdir(commandsDir, { recursive: true });

    await writeFile(join(commandsDir, "test.md"), "Test content");

    const results = await parseCommandsFromDirectory(
      commandsDir,
      "claudecode",
      ".md",
      "Custom Command",
    );

    expect(results).toHaveLength(1);
    expect(results[0]!.frontmatter.description).toBe("Custom Command: test");
  });

  it("returns empty array for non-existent directory", async () => {
    const nonExistentDir = join(testDir, "non-existent");

    const results = await parseCommandsFromDirectory(nonExistentDir, "claudecode");

    expect(results).toEqual([]);
  });

  it("filters out empty files", async () => {
    const commandsDir = join(testDir, "commands");
    await mkdir(commandsDir, { recursive: true });

    await writeFile(join(commandsDir, "valid.md"), "Valid content");
    await writeFile(join(commandsDir, "empty.md"), "");
    await writeFile(join(commandsDir, "whitespace.md"), "   \n  ");

    const results = await parseCommandsFromDirectory(commandsDir, "claudecode");

    expect(results).toHaveLength(1);
    expect(results[0]!.filename).toBe("valid");
  });

  it("handles directory read errors gracefully", async () => {
    // Use a path that doesn't exist but won't cause permission errors
    const invalidDir = join(testDir, "invalid/nested/path");

    const results = await parseCommandsFromDirectory(invalidDir, "claudecode");

    expect(results).toEqual([]);
  });
});
