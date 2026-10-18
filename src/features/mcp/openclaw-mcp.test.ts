import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { parseJson5 } from "../../utils/json5.js";
import { OpenclawMcp } from "./openclaw-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

const serversOf = (mcp: OpenclawMcp): unknown =>
  (mcp.getConfig().mcp as Record<string, unknown> | undefined)?.servers;

describe("OpenclawMcp", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory({ home: true }));
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  const configPath = () => join(testDir, ".openclaw", "openclaw.json");

  const buildRulesyncMcp = (json: Record<string, unknown>): RulesyncMcp =>
    new RulesyncMcp({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "mcp.json",
      fileContent: JSON.stringify(json),
    });

  const generate = (json: Record<string, unknown>, logger = createMockLogger()) =>
    OpenclawMcp.fromRulesyncMcp({
      outputRoot: testDir,
      rulesyncMcp: buildRulesyncMcp(json).forTarget({ toolTarget: "openclaw" }),
      global: true,
      logger,
    });

  it("points at ~/.openclaw/openclaw.json and is never deletable", () => {
    expect(OpenclawMcp.getSettablePaths({ global: true })).toEqual({
      relativeDirPath: ".openclaw",
      relativeFilePath: "openclaw.json",
    });
    expect(
      OpenclawMcp.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".openclaw",
        relativeFilePath: "openclaw.json",
        global: true,
      }).isDeletable(),
    ).toBe(false);
  });

  it("is global-only", async () => {
    await expect(
      OpenclawMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp: buildRulesyncMcp({}) }),
    ).rejects.toThrow("global-only");
    await expect(OpenclawMcp.fromFile({ outputRoot: testDir })).rejects.toThrow("global-only");
  });

  describe("fromRulesyncMcp", () => {
    it("maps stdio and remote servers onto OpenClaw's fields", async () => {
      const mcp = await generate({
        mcpServers: {
          fs: {
            command: ["npx", "-y"],
            args: ["fs-server"],
            env: { TOKEN: "x" },
            cwd: "/srv/tools",
            disabled: true,
          },
          remote: {
            type: "http",
            url: "https://example.com/mcp",
            headers: { Authorization: "Bearer ${TOKEN}" },
            enabledTools: ["search_*"],
            disabledTools: ["admin_*"],
          },
          events: { type: "sse", url: "https://example.com/sse" },
          plain: { url: "https://example.com/plain" },
        },
      });

      expect(serversOf(mcp)).toEqual({
        fs: {
          command: "npx",
          args: ["-y", "fs-server"],
          env: { TOKEN: "x" },
          cwd: "/srv/tools",
          enabled: false,
        },
        remote: {
          url: "https://example.com/mcp",
          transport: "streamable-http",
          headers: { Authorization: "Bearer ${TOKEN}" },
          toolFilter: { include: ["search_*"], exclude: ["admin_*"] },
        },
        events: { url: "https://example.com/sse", transport: "sse" },
        plain: { url: "https://example.com/plain", transport: "streamable-http" },
      });
    });

    it("never writes keys OpenClaw's strict validation rejects", async () => {
      const mcp = await generate({
        mcpServers: {
          remote: {
            type: "streamable-http",
            url: "https://example.com/mcp",
            timeout: 5,
            alwaysAllow: ["x"],
            oauth: { client_id: "hermes-only" },
            enabledTools: [],
          },
        },
      });

      expect(serversOf(mcp)).toEqual({
        remote: { url: "https://example.com/mcp", transport: "streamable-http" },
      });
    });

    it("carries OpenClaw-only fields from the openclaw override block", async () => {
      const mcp = await generate({
        mcpServers: { remote: { type: "http", url: "https://shared.example.com/mcp" } },
        openclaw: {
          mcpServers: {
            remote: {
              type: "http",
              url: "https://example.com/mcp",
              auth: "oauth",
              oauth: { identity: "per-requester", scope: "docs.read", unknown: "dropped" },
              sslVerify: false,
              clientCert: "/c.crt",
              clientKey: "/c.key",
              requestTimeoutMs: 20000,
              connectionTimeoutMs: 5000,
              supportsParallelToolCalls: true,
              codex: { agents: ["main"], defaultToolsApprovalMode: "approve" },
            },
          },
        },
      });

      expect(serversOf(mcp)).toEqual({
        remote: {
          url: "https://example.com/mcp",
          transport: "streamable-http",
          auth: "oauth",
          oauth: { identity: "per-requester", scope: "docs.read" },
          sslVerify: false,
          clientCert: "/c.crt",
          clientKey: "/c.key",
          requestTimeoutMs: 20000,
          connectionTimeoutMs: 5000,
          supportsParallelToolCalls: true,
          codex: { agents: ["main"], defaultToolsApprovalMode: "approve" },
        },
      });
    });

    it("skips servers OpenClaw cannot reach, out loud", async () => {
      const logger = createMockLogger();
      const mcp = await generate(
        {
          mcpServers: {
            ws: { type: "ws", url: "wss://example.com" },
            nothing: { args: ["x"] },
            stdio: { type: "stdio" },
            ok: { command: "ok" },
          },
        },
        logger,
      );

      expect(serversOf(mcp)).toEqual({ ok: { command: "ok" } });
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("WebSocket"));
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("no transport"));
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("without a command"));
    });

    it("merges into an existing JSON5 config, keeping every other key and server", async () => {
      await writeFileContent(
        configPath(),
        `{
  // Gateway settings
  gateway: { port: 18789, auth: { token: 'secret' } },
  mcp: {
    sessionIdleTtlMs: 3600000,
    servers: {
      mine: { command: 'uvx', args: ['mcp-server-fetch'] },
      shared: { command: 'old' },
    },
  },
}
`,
      );

      const mcp = await generate({ mcpServers: { shared: { command: "new" } } });
      const written = parseJson5(mcp.getFileContent());

      expect(written).toEqual({
        gateway: { port: 18789, auth: { token: "secret" } },
        mcp: {
          sessionIdleTtlMs: 3600000,
          servers: {
            mine: { command: "uvx", args: ["mcp-server-fetch"] },
            shared: { command: "new" },
          },
        },
      });
    });

    it("edits a JSONC-compatible config in place, keeping its comments", async () => {
      await writeFileContent(
        configPath(),
        `{
  // keep me
  "gateway": { "port": 18789 }
}
`,
      );

      const mcp = await generate({ mcpServers: { ok: { command: "ok" } } });

      expect(mcp.getFileContent()).toContain("// keep me");
      expect(parseJson5(mcp.getFileContent())).toEqual({
        gateway: { port: 18789 },
        mcp: { servers: { ok: { command: "ok" } } },
      });
    });

    it("refuses a config whose root is not an object", async () => {
      await writeFileContent(configPath(), "[1, 2]");
      await expect(generate({ mcpServers: {} })).rejects.toThrow("expected a mapping at the root");
    });
  });

  describe("toRulesyncMcp", () => {
    it("imports servers and moves OpenClaw-only fields into the override block", async () => {
      await writeFileContent(
        configPath(),
        `{
  gateway: { auth: { token: 'secret' } },
  mcp: {
    servers: {
      docs: { command: 'uvx', args: ['mcp-server-fetch'], env: { PORT: 8080 }, cwd: '/srv', enabled: false },
      remote: {
        url: 'https://example.com/mcp',
        transport: 'sse',
        headers: { Authorization: 'Bearer \${T}' },
        toolFilter: { include: ['search_*'], exclude: ['admin_*'] },
        auth: 'oauth',
        requestTimeoutMs: 20000,
      },
      http: { url: 'https://example.com/http', transport: 'streamable-http' },
    },
  },
}`,
      );

      const mcp = await OpenclawMcp.fromFile({ outputRoot: testDir, global: true });
      const { $schema: _schema, ...json } = JSON.parse(mcp.toRulesyncMcp().getFileContent());

      expect(json).toEqual({
        mcpServers: {
          docs: {
            command: "uvx",
            args: ["mcp-server-fetch"],
            env: { PORT: "8080" },
            cwd: "/srv",
            disabled: true,
          },
          remote: {
            type: "sse",
            url: "https://example.com/mcp",
            headers: { Authorization: "Bearer ${T}" },
            enabledTools: ["search_*"],
            disabledTools: ["admin_*"],
          },
          http: { type: "http", url: "https://example.com/http" },
        },
        openclaw: {
          mcpServers: {
            remote: {
              type: "sse",
              url: "https://example.com/mcp",
              headers: { Authorization: "Bearer ${T}" },
              enabledTools: ["search_*"],
              disabledTools: ["admin_*"],
              auth: "oauth",
              requestTimeoutMs: 20000,
            },
          },
        },
      });
      expect(JSON.stringify(json)).not.toContain("secret");
    });

    it("round-trips an imported config back to the same servers", async () => {
      const original = {
        mcp: {
          servers: {
            remote: {
              url: "https://example.com/mcp",
              transport: "streamable-http",
              auth: "oauth",
              oauth: { scope: "docs.read" },
              toolFilter: { exclude: ["admin_*"] },
            },
          },
        },
      };
      await writeFileContent(configPath(), JSON.stringify(original, null, 2));
      const imported = (
        await OpenclawMcp.fromFile({ outputRoot: testDir, global: true })
      ).toRulesyncMcp();

      const regenerated = await OpenclawMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: buildRulesyncMcp(JSON.parse(imported.getFileContent())).forTarget({
          toolTarget: "openclaw",
        }),
        global: true,
      });

      expect(regenerated.getConfig()).toEqual(original);
    });
  });
});
