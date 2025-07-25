import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RulesyncMcpConfig } from "../types/mcp.js";
import { generateMcpConfigurations } from "./mcp-generator.js";
import { parseMcpConfig } from "./mcp-parser.js";

describe("generateMcpConfigurations", () => {
  const testDir = join(__dirname, "test-temp-mcp");

  beforeEach(async () => {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(testDir, { recursive: true, force: true });
  });

  it("should generate configurations for all default targets", async () => {
    const mcpConfig = {
      mcpServers: {
        "test-server": {
          command: "test-server",
          args: ["--stdio"],
        },
      },
    };

    const outputs = await generateMcpConfigurations(mcpConfig, testDir);

    // Should generate for all supported tools by default
    // AugmentCode and AugmentCode-legacy both map to same .mcp.json (deduplicated), Copilot generates 2 files, others generate 1 each
    // Total: augmentcode(1) + claudecode(1) + cursor(1) + cline(1) + roo(1) + copilot(2) + geminicli(1) + kiro(1) = 9
    expect(outputs).toHaveLength(9);

    const filepaths = outputs.map((o) => o.filepath);
    expect(filepaths).toContain(join(testDir, ".mcp.json")); // AugmentCode
    expect(filepaths).toContain(join(testDir, ".claude/settings.json"));
    expect(filepaths).toContain(join(testDir, ".vscode/mcp.json"));
    expect(filepaths).toContain(join(testDir, ".copilot/mcp.json"));
    expect(filepaths).toContain(join(testDir, ".cursor/mcp.json"));
    expect(filepaths).toContain(join(testDir, ".cline/mcp.json"));
    expect(filepaths).toContain(join(testDir, ".roo/mcp.json"));
    expect(filepaths).toContain(join(testDir, ".gemini/settings.json"));
    expect(filepaths).toContain(join(testDir, ".kiro/mcp.json"));
  });

  it("should generate configurations for specific targets", async () => {
    const mcpConfig = {
      mcpServers: {
        server1: {
          command: "server1",
        },
      },
    };

    const outputs = await generateMcpConfigurations(mcpConfig, testDir, ["claudecode", "cursor"]);

    expect(outputs).toHaveLength(2);

    const filepaths = outputs.map((o) => o.filepath);
    expect(filepaths).toContain(join(testDir, ".claude/settings.json"));
    expect(filepaths).toContain(join(testDir, ".cursor/mcp.json"));
  });

  it("should filter servers by targets", async () => {
    const mcpConfig: RulesyncMcpConfig = {
      mcpServers: {
        "claude-only": {
          command: "claude-server",
          targets: ["claudecode"],
        },
        "cursor-only": {
          command: "cursor-server",
          targets: ["cursor"],
        },
        "all-tools": {
          command: "all-server",
          targets: ["*"],
        },
      },
    };

    const outputs = await generateMcpConfigurations(mcpConfig, testDir, ["claudecode", "cursor"]);

    // Check Claude configuration
    const claudeOutput = outputs.find((o) => o.filepath.includes(".claude"));
    expect(claudeOutput).toBeDefined();
    const claudeConfig = JSON.parse(claudeOutput!.content);
    expect(claudeConfig.mcpServers).toHaveProperty("claude-only");
    expect(claudeConfig.mcpServers).not.toHaveProperty("cursor-only");
    expect(claudeConfig.mcpServers).toHaveProperty("all-tools");

    // Check Cursor configuration
    const cursorOutput = outputs.find((o) => o.filepath.includes(".cursor"));
    expect(cursorOutput).toBeDefined();
    const cursorConfig = JSON.parse(cursorOutput!.content);
    expect(cursorConfig.mcpServers).not.toHaveProperty("claude-only");
    expect(cursorConfig.mcpServers).toHaveProperty("cursor-only");
    expect(cursorConfig.mcpServers).toHaveProperty("all-tools");
  });

  it("should handle empty MCP configuration", async () => {
    const mcpConfig = {
      mcpServers: {},
    };

    const outputs = await generateMcpConfigurations(mcpConfig, testDir, ["copilot"]);

    expect(outputs).toHaveLength(2); // Copilot generates 2 files

    // Check editor config
    const editorOutput = outputs.find(
      (o) => o.filepath.includes("mcp.json") && !o.filepath.includes("codingagent"),
    );
    expect(editorOutput).toBeDefined();
    const editorConfig = JSON.parse(editorOutput!.content);
    expect(editorConfig.servers).toEqual({});
  });

  it("should handle MCP configuration from file", async () => {
    const { writeFile } = await import("node:fs/promises");
    const mcpPath = join(testDir, ".rulesync", ".mcp.json");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(testDir, ".rulesync"), { recursive: true });

    const mcpContent = {
      mcpServers: {
        "file-server": {
          command: "server-from-file",
          args: ["--config", "file.json"],
        },
      },
    };
    await writeFile(mcpPath, JSON.stringify(mcpContent, null, 2));

    const parsedConfig = parseMcpConfig(testDir)!;
    const outputs = await generateMcpConfigurations(parsedConfig, testDir, ["cline"]);

    expect(outputs).toHaveLength(1);
    expect(outputs[0]!.filepath).toBe(join(testDir, ".cline/mcp.json"));

    const config = JSON.parse(outputs[0]!.content);
    expect(config.mcpServers["file-server"]).toEqual({
      command: "server-from-file",
      args: ["--config", "file.json"],
    });
  });

  it("should preserve all server properties except targets", async () => {
    const mcpConfig: RulesyncMcpConfig = {
      mcpServers: {
        "complex-server": {
          command: "complex",
          args: ["--verbose"],
          env: { DEBUG: "true" },
          url: "http://fallback.url",
          // headers: { "X-Custom": "header" },
          // customProperty: "value",
          targets: ["roo"],
        },
      },
    };

    const outputs = await generateMcpConfigurations(mcpConfig, testDir, ["roo"]);

    const config = JSON.parse(outputs[0]!.content);
    expect(config.mcpServers["complex-server"]).toEqual({
      command: "complex",
      args: ["--verbose"],
      env: { DEBUG: "true" },
      url: "http://fallback.url",
      // headers: { "X-Custom": "header" },
      // customProperty: "value",
    });
    expect(config.mcpServers["complex-server"]).not.toHaveProperty("targets");
  });

  it("should handle multiple base directories", async () => {
    const mcpConfig = {
      mcpServers: {
        "test-server": {
          command: "test",
        },
      },
    };

    const baseDir1 = join(testDir, "app1");
    const baseDir2 = join(testDir, "app2");

    const { mkdir } = await import("node:fs/promises");
    await mkdir(baseDir1, { recursive: true });
    await mkdir(baseDir2, { recursive: true });

    const outputs1 = await generateMcpConfigurations(mcpConfig, baseDir1, ["claudecode"]);
    const outputs2 = await generateMcpConfigurations(mcpConfig, baseDir2, ["claudecode"]);

    expect(outputs1[0]!.filepath).toBe(join(baseDir1, ".claude/settings.json"));
    expect(outputs2[0]!.filepath).toBe(join(baseDir2, ".claude/settings.json"));
  });

  it("should handle tool-specific formatting differences", async () => {
    const mcpConfig = {
      mcpServers: {
        "test-server": {
          command: "test",
          args: ["--stdio"],
          env: { TEST: "true" },
        },
      },
    };

    const outputs = await generateMcpConfigurations(mcpConfig, testDir, [
      "claudecode",
      "copilot",
      "geminicli",
    ]);

    // Claude uses settings.json with mcpServers
    const claudeOutput = outputs.find((o) => o.filepath.includes(".claude"));
    expect(claudeOutput?.filepath).toContain("settings.json");
    const claudeConfig = JSON.parse(claudeOutput!.content);
    expect(claudeConfig).toHaveProperty("mcpServers");

    // Copilot generates two files
    const copilotOutputs = outputs.filter(
      (o) => o.filepath.includes(".copilot") || o.filepath.includes(".vscode"),
    );
    expect(copilotOutputs).toHaveLength(2);

    // Check editor config (uses "servers")
    const copilotEditorOutput = copilotOutputs.find((o) => o.filepath.includes(".vscode"));
    expect(copilotEditorOutput?.filepath).toContain(".vscode/mcp.json");
    const editorConfig = JSON.parse(copilotEditorOutput!.content);
    expect(editorConfig).toHaveProperty("servers");

    // Gemini uses settings.json
    const geminiOutput = outputs.find((o) => o.filepath.includes(".gemini"));
    expect(geminiOutput?.filepath).toContain("settings.json");
    const geminiConfig = JSON.parse(geminiOutput!.content);
    expect(geminiConfig).toHaveProperty("mcpServers");
  });
});
