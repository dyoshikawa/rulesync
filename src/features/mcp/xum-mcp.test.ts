import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { parseJsonc } from "../../utils/jsonc.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import { XumMcp } from "./xum-mcp.js";

describe("XumMcp", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  const makeRulesyncMcp = (mcpServers: Record<string, unknown>) =>
    new RulesyncMcp({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: "mcp.json",
      fileContent: JSON.stringify({ mcpServers }),
    });

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  it("should use .xum/mcp.jsonc for both scopes", () => {
    for (const global of [false, true]) {
      expect(XumMcp.getSettablePaths({ global })).toEqual({
        relativeDirPath: ".xum",
        relativeFilePath: "mcp.jsonc",
      });
    }
  });

  it("should write stdio servers as shell command strings", async () => {
    const xum = await XumMcp.fromRulesyncMcp({
      outputRoot: testDir,
      rulesyncMcp: makeRulesyncMcp({
        memory: {
          type: "stdio",
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-memory"],
        },
        chrome: { command: "npx -y chrome-devtools-mcp@latest --headless" },
        quoted: { command: ["node", "server.js"], args: ["--name", "it's here"] },
      }),
    });

    expect(xum.getRelativeDirPath()).toBe(".xum");
    expect(xum.getRelativeFilePath()).toBe("mcp.jsonc");
    expect(parseJsonc(xum.getFileContent())).toEqual({
      servers: {
        memory: "npx -y @modelcontextprotocol/server-memory",
        chrome: "npx -y chrome-devtools-mcp@latest --headless",
        quoted: "node server.js --name 'it'\\''s here'",
      },
    });
  });

  it("should use the object form for disabled servers and enabledTools", async () => {
    const xum = await XumMcp.fromRulesyncMcp({
      outputRoot: testDir,
      rulesyncMcp: makeRulesyncMcp({
        off: { command: "off-server", disabled: true },
        limited: { command: "npx", args: ["limited"], enabledTools: ["read"] },
      }),
    });

    expect(parseJsonc(xum.getFileContent())).toEqual({
      servers: {
        off: { command: "off-server", disabled: true },
        limited: { command: "npx limited", toolAllowlist: ["read"] },
      },
    });
  });

  it("should write remote servers with their transport, URL and headers", async () => {
    const xum = await XumMcp.fromRulesyncMcp({
      outputRoot: testDir,
      rulesyncMcp: makeRulesyncMcp({
        http: {
          type: "http",
          url: "https://example.com/mcp",
          headers: { Authorization: "Bearer x" },
        },
        streamable: { type: "streamable-http", url: "https://example.com/stream" },
        sse: { type: "sse", url: "https://example.com/sse" },
        auto: { url: "https://example.com/auto" },
      }),
    });

    expect(parseJsonc(xum.getFileContent())).toEqual({
      servers: {
        http: {
          transport: "http",
          url: "https://example.com/mcp",
          headers: { Authorization: "Bearer x" },
        },
        streamable: { transport: "http", url: "https://example.com/stream" },
        sse: { transport: "sse", url: "https://example.com/sse" },
        auto: { url: "https://example.com/auto" },
      },
    });
  });

  it("should skip websocket servers and warn about env it cannot express", async () => {
    const logger = createMockLogger();
    const xum = await XumMcp.fromRulesyncMcp({
      outputRoot: testDir,
      rulesyncMcp: makeRulesyncMcp({
        ws: { type: "ws", url: "wss://example.com/ws" },
        withEnv: { command: "server", env: { TOKEN: "x" } },
      }),
      logger,
    });

    expect(parseJsonc(xum.getFileContent())).toEqual({ servers: { withEnv: "server" } });
    const warnings = logger.warn.mock.calls.map(([message]) => String(message));
    expect(warnings.some((message) => message.includes('"ws"'))).toBe(true);
    expect(warnings.some((message) => message.includes("env"))).toBe(true);
  });

  it("should keep other top-level keys such as enabledPluginServers", async () => {
    await writeFileContent(
      join(testDir, ".xum", "mcp.jsonc"),
      '{\n  // managed by Xum\n  "servers": { "old": "old-server" },\n  "enabledPluginServers": ["plugin:0123:coder"],\n}\n',
    );

    const xum = await XumMcp.fromRulesyncMcp({
      outputRoot: testDir,
      rulesyncMcp: makeRulesyncMcp({ fresh: { command: "fresh" } }),
      global: true,
    });

    expect(parseJsonc(xum.getFileContent())).toEqual({
      servers: { fresh: "fresh" },
      enabledPluginServers: ["plugin:0123:coder"],
    });
    expect(xum.isDeletable()).toBe(false);
  });

  it("should be deletable in project mode only", async () => {
    const project = await XumMcp.fromRulesyncMcp({
      outputRoot: testDir,
      rulesyncMcp: makeRulesyncMcp({}),
    });
    expect(project.isDeletable()).toBe(true);
  });

  it("should import Xum servers back into the canonical shape", async () => {
    await writeFileContent(
      join(testDir, ".xum", "mcp.jsonc"),
      JSON.stringify({
        servers: {
          memory: "npx -y @modelcontextprotocol/server-memory",
          piped: "cat config.json | my-server",
          off: { command: "off-server", disabled: true, toolAllowlist: ["read"] },
          remote: {
            transport: "sse",
            url: "https://example.com/sse",
            headers: { Authorization: "Bearer x", Secret: { secret: "KEY" } },
          },
          auto: { transport: "auto", url: "https://example.com/auto" },
        },
      }),
    );

    const xum = await XumMcp.fromFile({ outputRoot: testDir });

    expect(xum.toRulesyncMcp().getMcpServers()).toEqual({
      memory: { command: "npx", args: ["-y", "@modelcontextprotocol/server-memory"] },
      piped: { command: "cat config.json | my-server" },
      off: { command: "off-server", disabled: true, enabledTools: ["read"] },
      remote: {
        type: "sse",
        url: "https://example.com/sse",
        headers: { Authorization: "Bearer x" },
      },
      auto: { url: "https://example.com/auto" },
    });
  });

  it("should refuse a file that does not parse", async () => {
    await writeFileContent(join(testDir, ".xum", "mcp.jsonc"), "{ not json");

    await expect(
      XumMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: makeRulesyncMcp({ a: { command: "a" } }),
      }),
    ).rejects.toThrow();
  });
});
