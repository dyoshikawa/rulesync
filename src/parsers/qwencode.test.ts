import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import { parseQwenConfiguration } from "./qwencode.js";

describe("parseQwenConfiguration", () => {
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

  it("should parse empty directory", async () => {
    const result = await parseQwenConfiguration(testDir);

    expect(result).toEqual({
      rules: [],
      errors: ["QWEN.md file not found"],
      ignorePatterns: undefined,
      mcpServers: undefined,
    });
  });

  it("should parse QWEN.md file", async () => {
    const qwenContent = `---
title: Qwen Configuration
---

# Qwen Code Settings

These are the main settings for Qwen Code.

## Coding Standards
- Use TypeScript
- Follow ESLint rules`;

    await writeFile(join(testDir, "QWEN.md"), qwenContent);

    const result = await parseQwenConfiguration(testDir);

    expect(result.rules).toHaveLength(1);
    expect(result.rules[0]).toMatchObject({
      content: expect.stringContaining("# Qwen Code Settings"),
      filename: "main",
    });
    expect(result.rules[0]?.frontmatter.targets).toContain("qwencode");
    expect(result.errors).toEqual([]);
  });

  it("should parse memory files", async () => {
    const memoriesDir = join(testDir, ".qwen", "memories");
    await mkdir(memoriesDir, { recursive: true });

    // Create required QWEN.md file
    await writeFile(join(testDir, "QWEN.md"), "# Main Config\n\nMain configuration.");

    await writeFile(
      join(memoriesDir, "project.md"),
      "# Project Memory\n\nProject specific information.",
    );
    await writeFile(join(memoriesDir, "team.md"), "# Team Memory\n\nTeam conventions.");

    const result = await parseQwenConfiguration(testDir);

    expect(result.rules).toHaveLength(3); // main + 2 memory files
    expect(result.rules.map((r) => r.filename)).toContain("main");
    expect(result.rules.map((r) => r.filename)).toContain("project");
    expect(result.rules.map((r) => r.filename)).toContain("team");
    expect(result.errors).toEqual([]);
  });

  it("should parse settings.json for MCP configuration", async () => {
    const qwenDir = join(testDir, ".qwen");
    await mkdir(qwenDir, { recursive: true });

    // Create QWEN.md first since it's required
    await writeFile(join(testDir, "QWEN.md"), "# Main Config\n\nMain configuration.");

    const settingsConfig = {
      mcpServers: {
        "qwen-server": {
          command: "python",
          args: ["-m", "qwen_server"],
          env: { MODEL: "qwen3-coder" },
        },
      },
    };

    await writeFile(join(qwenDir, "settings.json"), JSON.stringify(settingsConfig, null, 2));

    const result = await parseQwenConfiguration(testDir);

    expect(result.mcpServers).toEqual({
      "qwen-server": {
        command: "python",
        args: ["-m", "qwen_server"],
        env: { MODEL: "qwen3-coder" },
      },
    });
    expect(result.errors).toEqual([]);
  });

  it("should parse command files", async () => {
    const commandsDir = join(testDir, ".qwen", "commands");
    await mkdir(commandsDir, { recursive: true });

    // Create QWEN.md first since it's required
    await writeFile(join(testDir, "QWEN.md"), "# Main Config\n\nMain configuration.");

    await writeFile(
      join(commandsDir, "review.md"),
      `---
description: "Code review command"
---

Please review the following code: {{args}}`,
    );
    await writeFile(
      join(commandsDir, "analyze.md"),
      `---
description: "Code analysis command"
---

Analyze this code for issues: {{args}}`,
    );

    const result = await parseQwenConfiguration(testDir);

    expect(result.rules).toHaveLength(3); // QWEN.md + 2 command files
    expect(result.rules.some((r) => r.filename === "review")).toBe(true);
    expect(result.rules.some((r) => r.filename === "analyze")).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("should handle invalid settings JSON", async () => {
    const qwenDir = join(testDir, ".qwen");
    await mkdir(qwenDir, { recursive: true });

    // Create QWEN.md first since it's required
    await writeFile(join(testDir, "QWEN.md"), "# Main Config\n\nMain configuration.");

    await writeFile(join(qwenDir, "settings.json"), "{ invalid json }");

    const result = await parseQwenConfiguration(testDir);

    expect(result.mcpServers).toBeUndefined();
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Failed to parse settings.json");
  });

  it("should use default baseDir when not provided", async () => {
    const result = await parseQwenConfiguration();

    expect(result.rules).toBeDefined();
    expect(result.errors).toBeDefined();
  });

  it("should handle mixed configuration types", async () => {
    // Create main QWEN.md
    await writeFile(join(testDir, "QWEN.md"), "# Main Config\n\nMain configuration.");

    // Create memory files
    const memoriesDir = join(testDir, ".qwen", "memories");
    await mkdir(memoriesDir, { recursive: true });
    await writeFile(join(memoriesDir, "memory.md"), "# Memory\n\nMemory content.");

    // Create command files
    const commandsDir = join(testDir, ".qwen", "commands");
    await mkdir(commandsDir, { recursive: true });
    await writeFile(
      join(commandsDir, "cmd.md"),
      `---
description: "Test command"
---

Test: {{args}}`,
    );

    // Create settings
    const qwenDir = join(testDir, ".qwen");
    const settingsConfig = {
      mcpServers: {
        test: { command: "test" },
      },
    };
    await writeFile(join(qwenDir, "settings.json"), JSON.stringify(settingsConfig));

    const result = await parseQwenConfiguration(testDir);

    expect(result.rules).toHaveLength(3);
    expect(result.mcpServers).toBeDefined();
    expect(result.errors).toEqual([]);
  });
});
