import { describe, expect, it } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import { ZcodePluginMcp } from "./zcode-plugin-mcp.js";

const buildRulesyncMcp = (mcpServers: Record<string, unknown>) =>
  new RulesyncMcp({
    outputRoot: ".",
    relativeDirPath: ".rulesync",
    relativeFilePath: "mcp.json",
    fileContent: JSON.stringify({ mcpServers }),
  });

describe("ZcodePluginMcp", () => {
  it("writes .mcp.json at the plugin root", () => {
    expect(ZcodePluginMcp.getSettablePaths()).toEqual({
      relativeDirPath: ".",
      relativeFilePath: ".mcp.json",
    });
  });

  it("writes servers in ZCode's shape and maps disabled to the plugin's enabled: false", async () => {
    const logger = createMockLogger();

    const mcp = await ZcodePluginMcp.fromRulesyncMcp({
      outputRoot: ".",
      rulesyncMcp: buildRulesyncMcp({
        local: { command: "npx", args: ["-y", "server"], env: { TOKEN: "x" }, disabled: true },
        remote: { type: "streamable-http", url: "https://example.com/mcp" },
        events: { type: "sse", url: "https://example.com/sse" },
        socket: { type: "websocket", url: "wss://example.com" },
      }),
      logger,
    });

    expect(JSON.parse(mcp.getFileContent())).toEqual({
      mcpServers: {
        local: { command: "npx", args: ["-y", "server"], env: { TOKEN: "x" }, enabled: false },
        remote: { type: "http", url: "https://example.com/mcp" },
        events: { type: "sse", url: "https://example.com/sse" },
      },
    });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("socket"));
  });

  it("imports both the mcpServers wrapper and a bare server map", () => {
    const wrapped = new ZcodePluginMcp({
      outputRoot: ".",
      relativeDirPath: ".",
      relativeFilePath: ".mcp.json",
      fileContent: JSON.stringify({
        mcpServers: { local: { command: "npx", args: [], enabled: false } },
      }),
    });
    const bare = new ZcodePluginMcp({
      outputRoot: ".",
      relativeDirPath: ".",
      relativeFilePath: ".mcp.json",
      fileContent: JSON.stringify({ local: { command: "npx", args: [], enabled: true } }),
    });

    expect(wrapped.toRulesyncMcp().getMcpServers()).toEqual({
      local: { command: "npx", args: [], disabled: true },
    });
    expect(bare.toRulesyncMcp().getMcpServers()).toEqual({
      local: { command: "npx", args: [] },
    });
  });

  it("is deletable, since the plugin bundle is generated in full", () => {
    const mcp = ZcodePluginMcp.forDeletion({
      outputRoot: ".",
      relativeDirPath: ".",
      relativeFilePath: ".mcp.json",
    });
    expect(mcp.isDeletable()).toBe(true);
  });
});
