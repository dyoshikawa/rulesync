import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { GajaecodeMcp } from "./gajaecode-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

const buildRulesyncMcp = (mcpServers: Record<string, unknown>): RulesyncMcp =>
  new RulesyncMcp({
    relativeDirPath: ".rulesync",
    relativeFilePath: "mcp.json",
    fileContent: JSON.stringify({ mcpServers }),
    validate: false,
  });

describe("GajaecodeMcp", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  it("should return .gjc/mcp.json for project and .gjc/agent/mcp.json for global", () => {
    expect(GajaecodeMcp.getSettablePaths()).toEqual({
      relativeDirPath: ".gjc",
      relativeFilePath: "mcp.json",
    });
    expect(GajaecodeMcp.getSettablePaths({ global: true })).toEqual({
      relativeDirPath: join(".gjc", "agent"),
      relativeFilePath: "mcp.json",
    });
  });

  describe("fromRulesyncMcp", () => {
    it("should convert stdio and remote servers to Gajae-Code's mcpServers map", async () => {
      const mcp = await GajaecodeMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: buildRulesyncMcp({
          local: {
            command: ["npx", "-y"],
            args: ["server"],
            env: { TOKEN: "${TOKEN}" },
            disabled: true,
          },
          remote: {
            type: "streamable-http",
            url: "https://example.com/mcp",
            headers: { Authorization: "Bearer ${API_KEY}" },
            timeout: 5000,
          },
          legacy: { transport: "sse", url: "https://example.com/sse" },
        }),
      });

      expect(mcp.getJson()).toEqual({
        mcpServers: {
          local: {
            type: "stdio",
            command: "npx",
            args: ["-y", "server"],
            env: { TOKEN: "${TOKEN}" },
            enabled: false,
          },
          remote: {
            type: "http",
            url: "https://example.com/mcp",
            headers: { Authorization: "Bearer ${API_KEY}" },
            timeout: 5000,
          },
          legacy: { type: "sse", url: "https://example.com/sse" },
        },
      });
    });

    it("should skip servers Gajae-Code cannot start or reach", async () => {
      const logger = createMockLogger();
      const mcp = await GajaecodeMcp.fromRulesyncMcp({
        outputRoot: testDir,
        logger,
        rulesyncMcp: buildRulesyncMcp({
          socket: { type: "ws", url: "wss://example.com" },
          noUrl: { type: "http" },
          noCommand: { type: "stdio" },
        }),
      });

      expect(mcp.getJson()).toEqual({ mcpServers: {} });
      expect(logger.warn).toHaveBeenCalledTimes(3);
    });

    it("should preserve other top-level keys of an existing file", async () => {
      await writeFileContent(
        join(testDir, ".gjc", "mcp.json"),
        JSON.stringify({ $schema: "schema", disabledServers: ["x"], mcpServers: { old: {} } }),
      );

      const mcp = await GajaecodeMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: buildRulesyncMcp({ local: { command: "server" } }),
      });

      expect(mcp.getJson()).toEqual({
        $schema: "schema",
        disabledServers: ["x"],
        mcpServers: { local: { type: "stdio", command: "server" }, old: {} },
      });
    });

    it("should keep servers added outside rulesync verbatim", async () => {
      await writeFileContent(
        join(testDir, ".gjc", "agent", "mcp.json"),
        JSON.stringify({
          mcpServers: {
            handWritten: { type: "http", url: "https://example.com/mcp", autoload: false },
          },
        }),
      );

      const mcp = await GajaecodeMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: buildRulesyncMcp({ local: { command: "server" } }),
        global: true,
      });

      expect(mcp.getJson()).toEqual({
        mcpServers: {
          local: { type: "stdio", command: "server" },
          handWritten: { type: "http", url: "https://example.com/mcp", autoload: false },
        },
      });
    });

    it("should keep auth and oauth of a regenerated server that keeps its endpoint", async () => {
      await writeFileContent(
        join(testDir, ".gjc", "mcp.json"),
        JSON.stringify({
          mcpServers: {
            remote: {
              type: "http",
              url: "https://example.com/mcp",
              timeout: 1000,
              autoload: false,
              auth: { type: "oauth", credentialId: "cred" },
              oauth: { clientId: "client" },
            },
          },
        }),
      );

      const mcp = await GajaecodeMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: buildRulesyncMcp({
          remote: { type: "http", url: "https://example.com/mcp" },
        }),
      });

      // `timeout` and `autoload` follow the source (absent there, so removed);
      // only the credential binding survives.
      expect(mcp.getJson()).toEqual({
        mcpServers: {
          remote: {
            type: "http",
            url: "https://example.com/mcp",
            auth: { type: "oauth", credentialId: "cred" },
            oauth: { clientId: "client" },
          },
        },
      });
    });

    it.each([
      {
        name: "url",
        existing: { type: "http", url: "https://example.com/mcp" },
        source: { type: "http", url: "https://attacker.example/mcp" },
      },
      {
        name: "transport",
        existing: { type: "http", url: "https://example.com/mcp" },
        source: { type: "sse", url: "https://example.com/mcp" },
      },
      {
        name: "command",
        existing: { type: "stdio", command: "server" },
        source: { command: "other-server" },
      },
      {
        name: "args",
        existing: { type: "stdio", command: "npx", args: ["server"] },
        source: { command: "npx", args: ["other-server"] },
      },
    ])(
      "should drop auth and oauth when the regenerated server changes its $name",
      async ({ existing, source }) => {
        await writeFileContent(
          join(testDir, ".gjc", "mcp.json"),
          JSON.stringify({
            mcpServers: {
              server: {
                ...existing,
                auth: { type: "oauth", credentialId: "cred", clientSecret: "secret" },
                oauth: { clientId: "client" },
              },
            },
          }),
        );

        const mcp = await GajaecodeMcp.fromRulesyncMcp({
          outputRoot: testDir,
          rulesyncMcp: buildRulesyncMcp({ server: source }),
        });

        const server = (mcp.getJson().mcpServers as Record<string, Record<string, unknown>>).server;
        expect(server?.auth).toBeUndefined();
        expect(server?.oauth).toBeUndefined();
      },
    );

    it("should write Gajae-Code-only keys only when the source states them", async () => {
      await writeFileContent(
        join(testDir, ".gjc", "mcp.json"),
        JSON.stringify({
          mcpServers: {
            local: { command: "server", autoload: false, noInheritEnv: true, publicNetwork: true },
          },
        }),
      );

      const removed = await GajaecodeMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: buildRulesyncMcp({ local: { command: "server" } }),
      });
      expect(removed.getJson()).toEqual({
        mcpServers: { local: { type: "stdio", command: "server" } },
      });

      const stated = await GajaecodeMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: buildRulesyncMcp({ local: { command: "server", autoload: true } }),
      });
      expect(stated.getJson()).toEqual({
        mcpServers: { local: { type: "stdio", command: "server", autoload: true } },
      });
    });

    it("should not duplicate a hand-written server on an import -> generate round trip", async () => {
      await writeFileContent(
        join(testDir, ".gjc", "mcp.json"),
        JSON.stringify({
          mcpServers: {
            handWritten: {
              type: "stdio",
              command: "tool",
              autoload: false,
              auth: { type: "oauth", credentialId: "cred" },
            },
          },
        }),
      );

      const imported = (await GajaecodeMcp.fromFile({ outputRoot: testDir })).toRulesyncMcp();
      const mcp = await GajaecodeMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: imported.forTarget({ toolTarget: "gajaecode" }),
      });

      expect(mcp.getJson()).toEqual({
        mcpServers: {
          handWritten: {
            type: "stdio",
            command: "tool",
            autoload: false,
            auth: { type: "oauth", credentialId: "cred" },
          },
        },
      });
    });

    it("should fail on a malformed existing file", async () => {
      await writeFileContent(join(testDir, ".gjc", "mcp.json"), "[1]");

      await expect(
        GajaecodeMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp: buildRulesyncMcp({}) }),
      ).rejects.toThrow(/expected a JSON object/);
    });
  });

  describe("toRulesyncMcp", () => {
    it("should keep secrets out and put Gajae-Code-only keys in the gajaecode block", async () => {
      await writeFileContent(
        join(testDir, ".gjc", "mcp.json"),
        JSON.stringify({
          mcpServers: {
            plain: { command: "plain" },
            remote: {
              type: "http",
              url: "https://example.com/mcp",
              autoload: false,
              publicNetwork: true,
              auth: { type: "oauth", credentialId: "cred", clientSecret: "secret" },
              oauth: { clientId: "client" },
            },
          },
        }),
      );

      const json = (await GajaecodeMcp.fromFile({ outputRoot: testDir }))
        .toRulesyncMcp()
        .getJson() as Record<string, unknown>;

      expect(json.mcpServers).toEqual({
        plain: { command: "plain" },
        remote: { type: "http", url: "https://example.com/mcp" },
      });
      expect(json.gajaecode).toEqual({
        mcpServers: {
          remote: {
            type: "http",
            url: "https://example.com/mcp",
            autoload: false,
            publicNetwork: true,
          },
        },
      });
      expect(JSON.stringify(json)).not.toContain("secret");
    });

    it("should import servers and map enabled: false to disabled: true", async () => {
      await writeFileContent(
        join(testDir, ".gjc", "agent", "mcp.json"),
        JSON.stringify({
          mcpServers: {
            local: { command: "server", enabled: false },
            remote: { type: "http", url: "https://example.com/mcp", enabled: true },
          },
        }),
      );

      const mcp = await GajaecodeMcp.fromFile({ outputRoot: testDir, global: true });

      expect(mcp.isDeletable()).toBe(false);
      expect((await GajaecodeMcp.fromFile({ outputRoot: testDir })).isDeletable()).toBe(false);
      expect(mcp.toRulesyncMcp().getJson().mcpServers).toEqual({
        local: { command: "server", disabled: true },
        remote: { type: "http", url: "https://example.com/mcp" },
      });
    });
  });
});
