import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import { parseClaudeConfiguration } from "./claudecode.js";

describe("parseClaudeConfiguration", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;
  let claudeFilePath: string;
  let memoryDir: string;
  let settingsPath: string;

  beforeEach(async () => {
    const testSetup = await setupTestDirectory();
    testDir = testSetup.testDir;
    cleanup = testSetup.cleanup;
    claudeFilePath = join(testDir, "CLAUDE.md");
    memoryDir = join(testDir, ".claude", "memories");
    settingsPath = join(testDir, ".claude", "settings.json");

    const { mkdir } = await import("node:fs/promises");
    await mkdir(memoryDir, { recursive: true });
  });

  afterEach(async () => {
    await cleanup();
  });

  it("should return error when CLAUDE.md is not found", async () => {
    const result = await parseClaudeConfiguration(testDir);
    expect(result.errors).toContain("CLAUDE.md file not found");
    expect(result.rules).toEqual([]);
  });

  it("should parse CLAUDE.md file successfully", async () => {
    const claudeContent = `# Project Guidelines

This is the main Claude configuration.

## Code Style
- Use TypeScript
- Follow ESLint rules`;

    await writeFile(claudeFilePath, claudeContent);

    const result = await parseClaudeConfiguration(testDir);
    expect(result.errors).toEqual([]);
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0]?.frontmatter).toEqual({
      root: false,
      targets: ["claudecode"],
      description: "Main Claude Code configuration",
      globs: ["**/*"],
    });
    expect(result.rules[0]?.content).toContain("This is the main Claude configuration");
  });

  it("should skip reference table in CLAUDE.md", async () => {
    const claudeContent = `# Project Guidelines

| Document | Description | File Patterns |
|----------|-------------|---------------|
| @memory1.md | Memory file 1 | **/*.ts |
| @memory2.md | Memory file 2 | **/*.js |

## Actual Content
This is the real content after the table.`;

    await writeFile(claudeFilePath, claudeContent);

    const result = await parseClaudeConfiguration(testDir);
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0]?.content).not.toContain("| Document |");
    expect(result.rules[0]?.content).toContain("## Actual Content");
  });

  it("should parse memory files", async () => {
    await writeFile(claudeFilePath, "# Main config");
    await writeFile(
      join(memoryDir, "coding-standards.md"),
      "# Coding Standards\n\nUse strict mode",
    );
    await writeFile(
      join(memoryDir, "architecture.md"),
      "# Architecture\n\nFollow clean architecture",
    );

    const result = await parseClaudeConfiguration(testDir);
    expect(result.rules).toHaveLength(3);

    const memoryRules = result.rules.filter((r) => r.filename !== "main");
    expect(memoryRules).toHaveLength(2);

    const contents = memoryRules.map((r) => r.content);
    expect(contents.some((c) => c.includes("Use strict mode"))).toBe(true);
    expect(contents.some((c) => c.includes("Follow clean architecture"))).toBe(true);
  });

  it("should skip empty memory files", async () => {
    await writeFile(claudeFilePath, "# Main config");
    await writeFile(join(memoryDir, "empty.md"), "");
    await writeFile(join(memoryDir, "whitespace.md"), "   \n  \t  ");
    await writeFile(join(memoryDir, "valid.md"), "# Valid content");

    const result = await parseClaudeConfiguration(testDir);
    const memoryRules = result.rules.filter((r) => r.filename !== "main");
    expect(memoryRules).toHaveLength(1);
    expect(memoryRules[0]?.filename).toBe("valid");
  });

  it("should parse settings.json and extract ignore patterns", async () => {
    await writeFile(claudeFilePath, "# Main config");
    const settings = {
      permissions: {
        deny: [
          "Read(node_modules/**)",
          "Read(.env)",
          "Edit(dist/**)",
          "WebFetch",
          "Bash(rm -rf /*)",
          "Read(secrets/*)",
        ],
      },
    };
    await writeFile(settingsPath, JSON.stringify(settings, null, 2));

    const result = await parseClaudeConfiguration(testDir);
    expect(result.ignorePatterns).toEqual(["node_modules/**", ".env", "secrets/*"]);
  });

  it("should parse settings.json and extract MCP servers", async () => {
    await writeFile(claudeFilePath, "# Main config");
    const settings = {
      mcpServers: {
        "typescript-server": {
          command: "typescript-language-server",
          args: ["--stdio"],
        },
        "eslint-server": {
          command: "eslint-server",
          args: ["--stdio"],
        },
      },
    };
    await writeFile(settingsPath, JSON.stringify(settings, null, 2));

    const result = await parseClaudeConfiguration(testDir);
    expect(result.mcpServers).toEqual(settings.mcpServers);
  });

  it("should handle invalid settings.json gracefully", async () => {
    await writeFile(claudeFilePath, "# Main config");
    await writeFile(settingsPath, "invalid json{");

    const result = await parseClaudeConfiguration(testDir);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Failed to parse settings.json");
    expect(result.rules).toHaveLength(1); // Main config should still be parsed
  });

  it("should handle missing memory directory gracefully", async () => {
    await writeFile(claudeFilePath, "# Main config");
    const { rm } = await import("node:fs/promises");
    await rm(memoryDir, { recursive: true, force: true });

    const result = await parseClaudeConfiguration(testDir);
    expect(result.errors).toEqual([]);
    expect(result.rules).toHaveLength(1);
  });

  it("should handle file reading errors", async () => {
    await writeFile(claudeFilePath, "# Main config");
    // Create a directory with the same name as a memory file to cause read error
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(memoryDir, "test.md"), { recursive: true });

    const result = await parseClaudeConfiguration(testDir);
    // Should continue parsing other files despite the error
    expect(result.rules).toHaveLength(1);
  });

  it("should handle empty CLAUDE.md file", async () => {
    await writeFile(claudeFilePath, "");

    const result = await parseClaudeConfiguration(testDir);
    expect(result.errors).toEqual([]);
    expect(result.rules).toEqual([]);
  });

  it("should extract complex ignore patterns from settings.json", async () => {
    await writeFile(claudeFilePath, "# Main config");
    const settings = {
      permissions: {
        deny: [
          "Read(**/*.test.ts)",
          "Read(~/.ssh/**)",
          "Read(tmp/**/*)",
          "Edit(src/**)",
          "Read(.git/**)",
        ],
        allow: ["Read(src/public/**)", "Edit(README.md)"],
      },
    };
    await writeFile(settingsPath, JSON.stringify(settings, null, 2));

    const result = await parseClaudeConfiguration(testDir);
    expect(result.ignorePatterns).toEqual(["**/*.test.ts", "~/.ssh/**", "tmp/**/*", ".git/**"]);
  });

  it("should handle settings.json without permissions section", async () => {
    await writeFile(claudeFilePath, "# Main config");
    const settings = {
      theme: "dark",
      fontSize: 14,
    };
    await writeFile(settingsPath, JSON.stringify(settings, null, 2));

    const result = await parseClaudeConfiguration(testDir);
    expect(result.ignorePatterns).toBeUndefined();
    expect(result.mcpServers).toBeUndefined();
  });

  it("should handle both ignore patterns and MCP servers", async () => {
    await writeFile(claudeFilePath, "# Main config");
    const settings = {
      permissions: {
        deny: ["Read(private/*)", "Read(*.env)"],
      },
      mcpServers: {
        "test-server": {
          url: "http://localhost:3000",
        },
      },
    };
    await writeFile(settingsPath, JSON.stringify(settings, null, 2));

    const result = await parseClaudeConfiguration(testDir);
    expect(result.ignorePatterns).toEqual(["private/*", "*.env"]);
    expect(result.mcpServers).toEqual(settings.mcpServers);
  });
});
