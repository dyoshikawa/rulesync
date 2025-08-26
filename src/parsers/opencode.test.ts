import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import type { ParsedRule } from "../types/rules.js";
import { parseOpenCodeConfiguration } from "./opencode.js";

describe("parseOpenCodeConfiguration", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;
  let agentsFilePath: string;
  let memoryDir: string;
  let settingsPath: string;
  let opcodeIgnorePath: string;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    agentsFilePath = join(testDir, "AGENTS.md");
    memoryDir = join(testDir, ".opencode", "memories");
    settingsPath = join(testDir, "opencode.json");
    opcodeIgnorePath = join(testDir, ".opcodeignore");

    const { mkdir } = await import("node:fs/promises");
    await mkdir(memoryDir, { recursive: true });
  });

  afterEach(async () => {
    await cleanup();
  });

  it("should return empty result when AGENTS.md is not found", async () => {
    const result = await parseOpenCodeConfiguration(testDir);
    expect(result.errors).toEqual([]); // No error - AGENTS.md is optional
    expect(result.rules).toEqual([]);
  });

  it("should parse AGENTS.md file successfully", async () => {
    const agentsContent = `# Project Guidelines

This is the main OpenCode configuration.

## Code Style
- Use TypeScript
- Follow ESLint rules`;

    await writeFile(agentsFilePath, agentsContent);

    const result = await parseOpenCodeConfiguration(testDir);
    expect(result.errors).toEqual([]);
    expect(result.rules).toHaveLength(1);

    const rule = result.rules[0] as ParsedRule;
    expect(rule.filename).toBe("agents");
    expect(rule.filepath).toBe(agentsFilePath);
    expect(rule.frontmatter.description).toBe("OpenCode configuration");
    expect(rule.frontmatter.root).toBe(false);
    expect(rule.content.trim()).toContain("This is the main OpenCode configuration.");
  });

  it("should parse memory files successfully", async () => {
    const agentsContent = "# Main Configuration";
    await writeFile(agentsFilePath, agentsContent);

    const memoryContent = `# Memory Rule

This is a memory file for specific patterns.

## Guidelines
- Follow these patterns
- Use consistent naming`;

    const memoryFilePath = join(memoryDir, "patterns.md");
    await writeFile(memoryFilePath, memoryContent);

    const result = await parseOpenCodeConfiguration(testDir);
    expect(result.errors).toEqual([]);
    expect(result.rules).toHaveLength(2);

    const memoryRule = result.rules.find((r) => r.filename === "patterns");
    expect(memoryRule).toBeDefined();
    expect(memoryRule!.frontmatter.description).toBe("Memory file: patterns");
    expect(memoryRule!.frontmatter.root).toBe(false);
    expect(memoryRule!.content.trim()).toContain("This is a memory file for specific patterns.");
  });

  it("should parse .opcodeignore file", async () => {
    const agentsContent = "# Main Configuration";
    await writeFile(agentsFilePath, agentsContent);

    const ignoreContent = `# Ignore patterns
*.test.ts
node_modules/
build/
# Comment
temp/`;

    await writeFile(opcodeIgnorePath, ignoreContent);

    const result = await parseOpenCodeConfiguration(testDir);
    expect(result.errors).toEqual([]);
    expect(result.ignorePatterns).toEqual(["*.test.ts", "node_modules/", "build/", "temp/"]);
  });

  it("should parse opencode.json settings", async () => {
    const agentsContent = "# Main Configuration";
    await writeFile(agentsFilePath, agentsContent);

    const settingsContent = {
      mcpServers: {
        filesystem: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
        },
        github: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github"],
          env: {
            GITHUB_TOKEN: "ghp_xxx",
          },
        },
      },
    };

    await writeFile(settingsPath, JSON.stringify(settingsContent, null, 2));

    const result = await parseOpenCodeConfiguration(testDir);
    expect(result.errors).toEqual([]);
    expect(result.mcpServers).toBeDefined();
    expect(Object.keys(result.mcpServers!)).toEqual(["filesystem", "github"]);

    const filesystemServer = result.mcpServers!.filesystem!;
    expect(filesystemServer.command).toBe("npx");
    expect(filesystemServer.args).toEqual(["-y", "@modelcontextprotocol/server-filesystem", "."]);

    const githubServer = result.mcpServers!.github!;
    expect(githubServer.env).toEqual({ GITHUB_TOKEN: "ghp_xxx" });
  });

  it("should handle missing files gracefully", async () => {
    const agentsContent = "# Main Configuration";
    await writeFile(agentsFilePath, agentsContent);

    const result = await parseOpenCodeConfiguration(testDir);
    expect(result.errors).toEqual([]);
    expect(result.rules).toHaveLength(1);
    expect(result.ignorePatterns).toBeUndefined();
    expect(result.mcpServers).toBeUndefined();
  });

  it("should handle invalid JSON in settings file", async () => {
    const agentsContent = "# Main Configuration";
    await writeFile(agentsFilePath, agentsContent);

    await writeFile(settingsPath, "{ invalid json }");

    const result = await parseOpenCodeConfiguration(testDir);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.mcpServers).toBeUndefined();
  });

  it("should parse files without frontmatter correctly", async () => {
    const agentsContentNoFrontmatter = `# OpenCode Configuration

This is plain markdown content without frontmatter.`;

    await writeFile(agentsFilePath, agentsContentNoFrontmatter);

    const result = await parseOpenCodeConfiguration(testDir);
    expect(result.errors).toEqual([]);
    expect(result.rules).toHaveLength(1);

    const rule = result.rules[0] as ParsedRule;
    expect(rule.frontmatter.targets).toEqual(["opencode"]);
    expect(rule.frontmatter.root).toBe(false);
    expect(rule.content.trim()).toContain("This is plain markdown content without frontmatter.");
  });
});
