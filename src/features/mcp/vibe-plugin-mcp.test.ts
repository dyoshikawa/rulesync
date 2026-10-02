import { describe, expect, it } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import { VIBE_PLUGIN_MCP_SCHEMA_URL, VibePluginMcp } from "./vibe-plugin-mcp.js";

const buildRulesyncMcp = (mcpServers: Record<string, unknown>) =>
  new RulesyncMcp({
    outputRoot: ".",
    relativeDirPath: ".rulesync",
    relativeFilePath: "mcp.json",
    fileContent: JSON.stringify({ mcpServers }),
  });

describe("VibePluginMcp", () => {
  it("writes mcp.json at the plugin root", () => {
    expect(VibePluginMcp.getSettablePaths()).toEqual({
      relativeDirPath: ".",
      relativeFilePath: "mcp.json",
    });
  });

  it("writes the Agent Plugins shape with a $schema and a type on every server", async () => {
    const logger = createMockLogger();

    const mcp = await VibePluginMcp.fromRulesyncMcp({
      outputRoot: ".",
      rulesyncMcp: buildRulesyncMcp({
        local: {
          command: ["npx", "-y"],
          args: ["server"],
          env: { TOKEN: "x" },
          cwd: "${PLUGIN_ROOT}/tools",
        },
        remote: { type: "http", url: "https://example.com/mcp", headers: { A: "b" } },
        spec: { type: "streamable-http", url: "https://example.com/spec" },
      }),
      logger,
    });

    expect(JSON.parse(mcp.getFileContent())).toEqual({
      $schema: VIBE_PLUGIN_MCP_SCHEMA_URL,
      mcpServers: {
        local: {
          type: "stdio",
          command: "npx",
          args: ["-y", "server"],
          env: { TOKEN: "x" },
          cwd: "${PLUGIN_ROOT}/tools",
        },
        remote: { type: "streamable-http", url: "https://example.com/mcp", headers: { A: "b" } },
        spec: { type: "streamable-http", url: "https://example.com/spec" },
      },
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("skips servers Vibe does not run from a plugin and drops fields it rejects", async () => {
    const logger = createMockLogger();

    const mcp = await VibePluginMcp.fromRulesyncMcp({
      outputRoot: ".",
      rulesyncMcp: buildRulesyncMcp({
        events: { type: "sse", url: "https://example.com/sse" },
        off: { command: "npx", disabled: true },
        slow: { command: "node", timeout: 1000, env: { PLUGIN_ROOT: "/x", KEEP: "1" } },
      }),
      logger,
    });

    expect(JSON.parse(mcp.getFileContent()).mcpServers).toEqual({
      slow: { type: "stdio", command: "node", env: { KEEP: "1" } },
    });
    const warnings = logger.warn.mock.calls.map(([message]) => String(message));
    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('"events"'),
        expect.stringContaining('disabled vibe-plugin MCP server "off"'),
        expect.stringContaining("dropping timeout"),
        expect.stringContaining("dropping env PLUGIN_ROOT"),
      ]),
    );
  });

  it("warns about a command or cwd Vibe will reject", async () => {
    const logger = createMockLogger();

    await VibePluginMcp.fromRulesyncMcp({
      outputRoot: ".",
      rulesyncMcp: buildRulesyncMcp({
        abs: { command: "/usr/bin/node", cwd: "/tmp" },
        rel: { command: "./bin/server", cwd: "./work" },
      }),
      logger,
    });

    const warnings = logger.warn.mock.calls.map(([message]) => String(message));
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('"/usr/bin/node"');
    expect(warnings[1]).toContain('"/tmp"');
  });

  it("imports stdio and remote servers back to the canonical shape", () => {
    const mcp = new VibePluginMcp({
      outputRoot: ".",
      relativeDirPath: ".",
      relativeFilePath: "mcp.json",
      fileContent: JSON.stringify({
        $schema: VIBE_PLUGIN_MCP_SCHEMA_URL,
        mcpServers: {
          local: { type: "stdio", command: "npx", args: ["server"], cwd: "./work" },
          remote: { type: "streamable-http", url: "https://example.com/mcp" },
          events: { type: "sse", url: "https://example.com/sse" },
        },
      }),
    });

    expect(JSON.parse(mcp.toRulesyncMcp().getFileContent()).mcpServers).toEqual({
      local: { command: "npx", args: ["server"], cwd: "./work" },
      remote: { type: "http", url: "https://example.com/mcp" },
      events: { type: "sse", url: "https://example.com/sse" },
    });
  });
});
