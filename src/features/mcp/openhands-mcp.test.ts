import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { OpenhandsMcp } from "./openhands-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

function makeRulesyncMcp(mcpServers: Record<string, unknown>): RulesyncMcp {
  return new RulesyncMcp({
    outputRoot: "/mock",
    relativeDirPath: ".rulesync",
    relativeFilePath: "mcp.json",
    fileContent: JSON.stringify({ mcpServers }),
  });
}

describe("OpenhandsMcp", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory({ home: true }));
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  it("should use ~/.openhands/mcp.json", () => {
    expect(OpenhandsMcp.getSettablePaths({ global: true })).toEqual({
      relativeDirPath: ".openhands",
      relativeFilePath: "mcp.json",
    });
  });

  it("should refuse project mode", async () => {
    await expect(
      OpenhandsMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp: makeRulesyncMcp({}) }),
    ).rejects.toThrow("global-only");
    await expect(OpenhandsMcp.fromFile({ outputRoot: testDir })).rejects.toThrow("global-only");
  });

  describe("fromRulesyncMcp", () => {
    it("should write stdio and remote servers", async () => {
      const mcp = await OpenhandsMcp.fromRulesyncMcp({
        outputRoot: testDir,
        global: true,
        rulesyncMcp: makeRulesyncMcp({
          local: { command: "python", args: ["-m", "tools"], env: { DEBUG: "true" } },
          joined: { type: "stdio", command: ["npx", "-y", "server"] },
          api: {
            type: "streamable-http",
            url: "https://api.example.com/mcp",
            headers: { Authorization: "Bearer token" },
          },
          events: { type: "sse", url: "https://events.example.com/sse" },
          notion: { url: "https://mcp.notion.com/mcp", auth: "oauth" },
          off: { command: "node", args: ["off.js"], disabled: true },
        }),
      });

      expect(JSON.parse(mcp.getFileContent())).toEqual({
        mcpServers: {
          local: { command: "python", args: ["-m", "tools"], env: { DEBUG: "true" } },
          joined: { command: "npx", args: ["-y", "server"] },
          api: {
            url: "https://api.example.com/mcp",
            transport: "http",
            headers: { Authorization: "Bearer token" },
          },
          events: { url: "https://events.example.com/sse", transport: "sse" },
          notion: { url: "https://mcp.notion.com/mcp", transport: "http", auth: "oauth" },
          off: { command: "node", args: ["off.js"], enabled: false },
        },
      });
    });

    it("should skip WebSocket servers and drop cwd with warnings", async () => {
      const logger = createMockLogger();
      const mcp = await OpenhandsMcp.fromRulesyncMcp({
        outputRoot: testDir,
        global: true,
        logger,
        rulesyncMcp: makeRulesyncMcp({
          ws: { type: "ws", url: "wss://example.com/mcp" },
          local: { command: "node", cwd: "/srv" },
        }),
      });

      expect(JSON.parse(mcp.getFileContent())).toEqual({
        mcpServers: { local: { command: "node" } },
      });
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('"ws"'));
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("dropping cwd"));
    });

    it("should keep other top-level keys and unmanaged keys of existing servers", async () => {
      await writeFileContent(
        join(testDir, ".openhands", "mcp.json"),
        JSON.stringify({
          other: true,
          mcpServers: {
            local: {
              command: "old",
              transport: "stdio",
              enabled: false,
              timeout: 5000,
            },
            stale: { command: "gone" },
          },
        }),
      );
      const mcp = await OpenhandsMcp.fromRulesyncMcp({
        outputRoot: testDir,
        global: true,
        rulesyncMcp: makeRulesyncMcp({ local: { command: "new" } }),
      });

      expect(JSON.parse(mcp.getFileContent())).toEqual({
        other: true,
        mcpServers: { local: { command: "new", timeout: 5000 } },
      });
    });

    it("should refuse to rewrite an unparseable file", async () => {
      await writeFileContent(join(testDir, ".openhands", "mcp.json"), "{ not json");
      await expect(
        OpenhandsMcp.fromRulesyncMcp({
          outputRoot: testDir,
          global: true,
          rulesyncMcp: makeRulesyncMcp({ local: { command: "node" } }),
        }),
      ).rejects.toThrow("Failed to parse OpenHands MCP config");
    });
  });

  describe("toRulesyncMcp", () => {
    it("should import servers the openhands CLI writes", async () => {
      await writeFileContent(
        join(testDir, ".openhands", "mcp.json"),
        JSON.stringify({
          mcpServers: {
            local: {
              command: "python",
              args: ["-m", "tools"],
              env: { A: "1" },
              transport: "stdio",
              enabled: true,
            },
            api: {
              url: "https://api.example.com/mcp",
              transport: "http",
              headers: { "X-API-Key": "k" },
              auth: "oauth",
              enabled: false,
            },
            events: { url: "https://events.example.com/sse", transport: "sse" },
          },
        }),
      );
      const mcp = await OpenhandsMcp.fromFile({ outputRoot: testDir, global: true });

      expect(mcp.toRulesyncMcp().getMcpServers()).toEqual({
        local: { type: "stdio", command: "python", args: ["-m", "tools"], env: { A: "1" } },
        api: {
          type: "http",
          url: "https://api.example.com/mcp",
          headers: { "X-API-Key": "k" },
          auth: "oauth",
          disabled: true,
        },
        events: { type: "sse", url: "https://events.example.com/sse" },
      });
    });
  });

  it("should never be deleted", () => {
    expect(
      OpenhandsMcp.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".openhands",
        relativeFilePath: "mcp.json",
        global: true,
      }).isDeletable(),
    ).toBe(false);
  });
});
