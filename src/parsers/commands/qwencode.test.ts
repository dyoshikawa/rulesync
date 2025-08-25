import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../../test-utils/index.js";
import { QwenCodeCommandParser } from "./qwencode.js";

describe("QwenCodeCommandParser", () => {
  let parser: QwenCodeCommandParser;
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    parser = new QwenCodeCommandParser();
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  it("returns correct tool name", () => {
    expect(parser.getToolName()).toBe("qwencode");
  });

  it("returns correct commands directory", () => {
    expect(parser.getCommandsDirectory()).toBe(".qwen/commands");
  });

  it("parses commands from .qwen/commands directory", async () => {
    const commandsDir = join(testDir, ".qwen", "commands");
    await mkdir(commandsDir, { recursive: true });

    await writeFile(join(commandsDir, "review.md"), "Please review this code");
    await writeFile(join(commandsDir, "optimize.md"), "Optimize this code");

    const results = await parser.parseCommands(testDir);

    expect(results).toHaveLength(2);
    expect(results[0]!.filename).toBe("optimize");
    expect(results[0]!.content).toBe("Optimize this code");
    expect(results[0]!.frontmatter.targets).toEqual(["qwencode"]);
    expect(results[1]!.filename).toBe("review");
    expect(results[1]!.content).toBe("Please review this code");
    expect(results[1]!.frontmatter.targets).toEqual(["qwencode"]);
  });

  it("returns empty array when commands directory doesn't exist", async () => {
    const results = await parser.parseCommands(testDir);

    expect(results).toEqual([]);
  });

  it("sets correct frontmatter for all commands", async () => {
    const commandsDir = join(testDir, ".qwen", "commands");
    await mkdir(commandsDir, { recursive: true });

    await writeFile(join(commandsDir, "test-command.md"), "Test content");

    const results = await parser.parseCommands(testDir);

    expect(results).toHaveLength(1);
    expect(results[0]!.frontmatter).toEqual({
      root: false,
      targets: ["qwencode"],
      description: "Command: test-command",
      globs: ["**/*"],
    });
    expect(results[0]!.type).toBe("command");
  });
});
