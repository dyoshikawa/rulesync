import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../../test-utils/index.js";
import { GeminiCommandParser } from "./geminicli.js";

describe("GeminiCommandParser", () => {
  let parser: GeminiCommandParser;
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    parser = new GeminiCommandParser();
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  it("returns correct tool name", () => {
    expect(parser.getToolName()).toBe("geminicli");
  });

  it("returns correct commands directory", () => {
    expect(parser.getCommandsDirectory()).toBe(".gemini/commands");
  });

  it("parses valid TOML command files", async () => {
    const commandsDir = join(testDir, ".gemini", "commands");
    await mkdir(commandsDir, { recursive: true });

    const tomlContent = `description = "Generate code review"
prompt = "Please review the following code for potential issues and improvements."`;

    await writeFile(join(commandsDir, "review.toml"), tomlContent);

    const results = await parser.parseCommands(testDir);

    expect(results).toHaveLength(1);
    expect(results[0]!.filename).toBe("review");
    expect(results[0]!.content).toBe(
      "Please review the following code for potential issues and improvements.",
    );
    expect(results[0]!.frontmatter.description).toBe("Generate code review");
    expect(results[0]!.frontmatter.targets).toEqual(["geminicli"]);
    expect(results[0]!.type).toBe("command");
  });

  it("uses filename as description when description is missing", async () => {
    const commandsDir = join(testDir, ".gemini", "commands");
    await mkdir(commandsDir, { recursive: true });

    const tomlContent = `prompt = "Optimize this code for better performance."`;

    await writeFile(join(commandsDir, "optimize.toml"), tomlContent);

    const results = await parser.parseCommands(testDir);

    expect(results).toHaveLength(1);
    expect(results[0]!.frontmatter.description).toBe("Command: optimize");
  });

  it("ignores files without prompt field", async () => {
    const commandsDir = join(testDir, ".gemini", "commands");
    await mkdir(commandsDir, { recursive: true });

    const invalidToml = `description = "Missing prompt field"
setting = "value"`;

    await writeFile(join(commandsDir, "invalid.toml"), invalidToml);

    const results = await parser.parseCommands(testDir);

    expect(results).toHaveLength(0);
  });

  it("handles multiple command files", async () => {
    const commandsDir = join(testDir, ".gemini", "commands");
    await mkdir(commandsDir, { recursive: true });

    const reviewToml = `description = "Code review"
prompt = "Review this code"`;

    const planToml = `description = "Create plan"
prompt = "Create a development plan"`;

    await writeFile(join(commandsDir, "review.toml"), reviewToml);
    await writeFile(join(commandsDir, "plan.toml"), planToml);

    const results = await parser.parseCommands(testDir);

    expect(results).toHaveLength(2);

    // Sort by filename for consistent testing
    results.sort((a, b) => a.filename.localeCompare(b.filename));

    expect(results[0]!.filename).toBe("plan");
    expect(results[0]!.content).toBe("Create a development plan");
    expect(results[1]!.filename).toBe("review");
    expect(results[1]!.content).toBe("Review this code");
  });

  it("ignores non-TOML files", async () => {
    const commandsDir = join(testDir, ".gemini", "commands");
    await mkdir(commandsDir, { recursive: true });

    const tomlContent = `prompt = "Valid TOML command"`;

    await writeFile(join(commandsDir, "valid.toml"), tomlContent);
    await writeFile(join(commandsDir, "invalid.md"), "Markdown file");
    await writeFile(join(commandsDir, "config.json"), '{"key": "value"}');

    const results = await parser.parseCommands(testDir);

    expect(results).toHaveLength(1);
    expect(results[0]!.filename).toBe("valid");
  });

  it("handles invalid TOML gracefully", async () => {
    const commandsDir = join(testDir, ".gemini", "commands");
    await mkdir(commandsDir, { recursive: true });

    const invalidToml = `[invalid toml structure
missing closing bracket`;

    await writeFile(join(commandsDir, "broken.toml"), invalidToml);

    const results = await parser.parseCommands(testDir);

    expect(results).toHaveLength(0);
  });

  it("ignores empty TOML files", async () => {
    const commandsDir = join(testDir, ".gemini", "commands");
    await mkdir(commandsDir, { recursive: true });

    await writeFile(join(commandsDir, "empty.toml"), "");
    await writeFile(join(commandsDir, "whitespace.toml"), "   \n  \t  ");

    const results = await parser.parseCommands(testDir);

    expect(results).toHaveLength(0);
  });

  it("returns empty array when commands directory doesn't exist", async () => {
    const results = await parser.parseCommands(testDir);

    expect(results).toEqual([]);
  });

  it("sets correct frontmatter structure", async () => {
    const commandsDir = join(testDir, ".gemini", "commands");
    await mkdir(commandsDir, { recursive: true });

    const tomlContent = `description = "Test command"
prompt = "Test prompt content"`;

    await writeFile(join(commandsDir, "test.toml"), tomlContent);

    const results = await parser.parseCommands(testDir);

    expect(results).toHaveLength(1);
    expect(results[0]!.frontmatter).toEqual({
      root: false,
      targets: ["geminicli"],
      description: "Test command",
      globs: ["**/*"],
    });
  });

  it("handles TOML files with non-string values", async () => {
    const commandsDir = join(testDir, ".gemini", "commands");
    await mkdir(commandsDir, { recursive: true });

    const tomlContent = `description = 123
prompt = "Valid prompt"`;

    await writeFile(join(commandsDir, "mixed-types.toml"), tomlContent);

    const results = await parser.parseCommands(testDir);

    expect(results).toHaveLength(1);
    expect(results[0]!.frontmatter.description).toBe("Command: mixed-types");
  });
});
