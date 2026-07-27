import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_MCP_FILE_NAME,
  RULESYNC_MCP_SCHEMA_URL,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { RovodevMcp } from "./rovodev-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

describe("RovodevMcp", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  const validMcpConfig = {
    mcpServers: {
      filesystem: {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      },
    },
  };

  beforeEach(async () => {
    const testSetup = await setupTestDirectory();
    testDir = testSetup.testDir;
    cleanup = testSetup.cleanup;
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  describe("getSettablePaths", () => {
    it("should return .rovodev/mcp.json paths", () => {
      expect(RovodevMcp.getSettablePaths()).toEqual({
        relativeDirPath: ".rovodev",
        relativeFilePath: "mcp.json",
      });
    });
  });

  describe("global-only enforcement", () => {
    it("should throw fromFile when global is false", async () => {
      await expect(
        RovodevMcp.fromFile({
          outputRoot: testDir,
          validate: true,
          global: false,
        }),
      ).rejects.toThrow("Rovodev MCP is global-only; use --global to sync ~/.rovodev/mcp.json");
    });

    it("should throw fromRulesyncMcp when global is false", async () => {
      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_MCP_FILE_NAME,
        fileContent: JSON.stringify({ mcpServers: {} }),
        validate: true,
      });

      await expect(
        RovodevMcp.fromRulesyncMcp({
          outputRoot: testDir,
          rulesyncMcp,
          validate: true,
          global: false,
        }),
      ).rejects.toThrow("Rovodev MCP is global-only; use --global to sync ~/.rovodev/mcp.json");
    });
  });

  describe("constructor JSON parse errors", () => {
    it("should throw for invalid JSON in fileContent", () => {
      expect(() => {
        new RovodevMcp({
          outputRoot: testDir,
          relativeDirPath: ".rovodev",
          relativeFilePath: "mcp.json",
          fileContent: "{ not json",
          validate: false,
          global: true,
        });
      }).toThrow(/Failed to parse Rovodev MCP config/);
    });

    it("should include path in parse error message", () => {
      expect(() => {
        new RovodevMcp({
          outputRoot: testDir,
          relativeDirPath: ".rovodev",
          relativeFilePath: "mcp.json",
          fileContent: "{ not json",
          validate: false,
          global: true,
        });
      }).toThrow(join(".rovodev", "mcp.json"));
    });
  });

  describe("fromFile JSON parse errors", () => {
    it("should throw when existing file contains invalid JSON", async () => {
      await ensureDir(join(testDir, ".rovodev"));
      await writeFileContent(join(testDir, ".rovodev", "mcp.json"), "{ not json");

      await expect(
        RovodevMcp.fromFile({
          outputRoot: testDir,
          validate: true,
          global: true,
        }),
      ).rejects.toThrow(/Failed to parse Rovodev MCP config/);

      await expect(
        RovodevMcp.fromFile({
          outputRoot: testDir,
          validate: true,
          global: true,
        }),
      ).rejects.toThrow(join(".rovodev", "mcp.json"));
    });
  });

  describe("fromRulesyncMcp JSON parse errors", () => {
    it("should throw when existing Rovodev file contains invalid JSON", async () => {
      await ensureDir(join(testDir, ".rovodev"));
      await writeFileContent(join(testDir, ".rovodev", "mcp.json"), "{ not json");

      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_MCP_FILE_NAME,
        fileContent: JSON.stringify({ mcpServers: {} }),
        validate: true,
      });

      await expect(
        RovodevMcp.fromRulesyncMcp({
          outputRoot: testDir,
          rulesyncMcp,
          validate: true,
          global: true,
        }),
      ).rejects.toThrow(/Failed to parse Rovodev MCP config/);

      await expect(
        RovodevMcp.fromRulesyncMcp({
          outputRoot: testDir,
          rulesyncMcp,
          validate: true,
          global: true,
        }),
      ).rejects.toThrow(join(".rovodev", "mcp.json"));
    });
  });

  describe("toRulesyncMcp", () => {
    it("should not propagate unknown top-level keys from Rovodev mcp.json", () => {
      const rovodev = new RovodevMcp({
        outputRoot: testDir,
        relativeDirPath: ".rovodev",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: validMcpConfig.mcpServers,
          hypotheticalRovodevExtension: { ignored: true },
        }),
        validate: false,
        global: true,
      });

      const rulesyncMcp = rovodev.toRulesyncMcp();

      expect(rulesyncMcp.getJson()).toEqual(
        expect.objectContaining({
          mcpServers: validMcpConfig.mcpServers,
        }),
      );
      expect(Object.keys(rulesyncMcp.getJson())).not.toContain("hypotheticalRovodevExtension");
    });
  });

  describe("round-trip conversion", () => {
    it("should round-trip RulesyncMcp through RovodevMcp and back", async () => {
      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_MCP_FILE_NAME,
        fileContent: JSON.stringify(validMcpConfig),
        validate: true,
      });

      const rovodev = await RovodevMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        validate: true,
        global: true,
      });

      const back = rovodev.toRulesyncMcp();

      expect(back).toBeInstanceOf(RulesyncMcp);
      expect(back.getJson()).toEqual({
        $schema: RULESYNC_MCP_SCHEMA_URL,
        ...rulesyncMcp.getJson(),
      });
    });

    it("should round-trip fromFile through toRulesyncMcp", async () => {
      const mcpPath = join(testDir, ".rovodev", "mcp.json");
      await ensureDir(join(testDir, ".rovodev"));
      await writeFileContent(mcpPath, JSON.stringify(validMcpConfig, null, 2));

      const rovodev = await RovodevMcp.fromFile({
        outputRoot: testDir,
        validate: true,
        global: true,
      });

      const rulesyncMcp = rovodev.toRulesyncMcp();

      expect(rulesyncMcp.getJson()).toEqual({
        $schema: RULESYNC_MCP_SCHEMA_URL,
        mcpServers: validMcpConfig.mcpServers,
      });
    });
  });

  describe("isDeletable", () => {
    it("should always return false (global-only MCP config is not treated as deletable project output)", () => {
      const globalInstance = new RovodevMcp({
        outputRoot: testDir,
        relativeDirPath: ".rovodev",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ mcpServers: {} }),
        validate: false,
        global: true,
      });
      expect(globalInstance.isDeletable()).toBe(false);

      const nonGlobalInstance = new RovodevMcp({
        outputRoot: testDir,
        relativeDirPath: ".rovodev",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ mcpServers: {} }),
        validate: false,
        global: false,
      });
      expect(nonGlobalInstance.isDeletable()).toBe(false);
    });
  });

  describe("transport translation", () => {
    it("writes the canonical type as Rovo Dev's transport key", async () => {
      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            remote: { type: "streamable-http", url: "https://example.com/mcp" },
            local: { type: "local", command: "node" },
          },
        }),
      });

      const rovodevMcp = await RovodevMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });

      const servers = JSON.parse(rovodevMcp.getFileContent()).mcpServers;
      expect(servers.remote).toEqual({ transport: "http", url: "https://example.com/mcp" });
      expect(servers.local).toEqual({ transport: "stdio", command: "node" });
    });

    it("skips a server whose transport Rovo Dev does not have", async () => {
      // Emitting it without a transport key leaves Rovo Dev to guess, so the
      // entry is dropped instead (same as the Kimi Code adapter).
      const logger = createMockLogger();
      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            socket: { type: "ws", url: "wss://example.com/mcp" },
            kept: { type: "http", url: "https://example.com/mcp" },
          },
        }),
      });

      const rovodevMcp = await RovodevMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
        logger,
      });

      const servers = JSON.parse(rovodevMcp.getFileContent()).mcpServers;
      expect(servers.socket).toBeUndefined();
      expect(servers.kept).toEqual({ transport: "http", url: "https://example.com/mcp" });
      expect(
        logger.warn.mock.calls.some(([message]) =>
          String(message).includes('"ws" transport is unsupported'),
        ),
      ).toBe(true);
    });

    it("skips a disabled server, which mcp.json cannot express", async () => {
      // Rovo Dev disables servers through `mcp.disabledMcpServers` in
      // config.yml, so an entry written here would simply run.
      const logger = createMockLogger();
      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            off: { type: "http", url: "https://example.com/mcp", disabled: true },
            on: { type: "http", url: "https://example.com/mcp", disabled: false },
          },
        }),
      });

      const rovodevMcp = await RovodevMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
        logger,
      });

      const servers = JSON.parse(rovodevMcp.getFileContent()).mcpServers;
      expect(servers.off).toBeUndefined();
      // `disabled: false` is dropped too — mcp.json is not where a Rovo Dev
      // server is switched on and off.
      expect(servers.on).toEqual({ transport: "http", url: "https://example.com/mcp" });
      expect(
        logger.warn.mock.calls.some(([message]) => String(message).includes('skipping "off"')),
      ).toBe(true);
    });

    it("reads the transport key back as the canonical type", () => {
      const rovodevMcp = new RovodevMcp({
        outputRoot: testDir,
        relativeDirPath: ".rovodev",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: { remote: { transport: "sse", url: "https://example.com/mcp" } },
        }),
        global: true,
      });

      const imported = JSON.parse(rovodevMcp.toRulesyncMcp().getFileContent());
      expect(imported.mcpServers.remote).toEqual({
        type: "sse",
        url: "https://example.com/mcp",
      });
    });

    it.each([
      { canonical: "stdio", rovodev: "stdio" },
      { canonical: "local", rovodev: "stdio" },
      { canonical: "http", rovodev: "http" },
      { canonical: "streamable-http", rovodev: "http" },
      { canonical: "sse", rovodev: "sse" },
    ])("writes canonical $canonical as $rovodev", async ({ canonical, rovodev }) => {
      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ mcpServers: { server: { type: canonical } } }),
      });

      const rovodevMcp = await RovodevMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });

      expect(JSON.parse(rovodevMcp.getFileContent()).mcpServers.server).toEqual({
        transport: rovodev,
      });
    });

    it.each(["stdio", "http", "sse"])("reads %s back as the canonical type", (transport) => {
      const rovodevMcp = new RovodevMcp({
        outputRoot: testDir,
        relativeDirPath: ".rovodev",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ mcpServers: { server: { transport } } }),
        global: true,
      });

      const imported = JSON.parse(rovodevMcp.toRulesyncMcp().getFileContent());
      expect(imported.mcpServers.server).toEqual({ type: transport });
    });

    it("imports a file an earlier rulesync wrote with the canonical type key", () => {
      const rovodevMcp = new RovodevMcp({
        outputRoot: testDir,
        relativeDirPath: ".rovodev",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: { legacy: { type: "streamable-http", url: "https://example.com/mcp" } },
        }),
        global: true,
      });

      const imported = JSON.parse(rovodevMcp.toRulesyncMcp().getFileContent());
      expect(imported.mcpServers.legacy).toEqual({
        type: "streamable-http",
        url: "https://example.com/mcp",
      });
    });

    it("round-trips a canonical config, normalizing local to stdio", async () => {
      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: { local: { type: "local", command: "node" } },
        }),
      });

      const rovodevMcp = await RovodevMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });
      const imported = JSON.parse(rovodevMcp.toRulesyncMcp().getFileContent());

      // `local` and `stdio` are the same transport, so the rename is the only
      // difference the round-trip introduces.
      expect(imported.mcpServers.local).toEqual({ type: "stdio", command: "node" });
    });

    it("drops a transport value outside Rovo Dev's vocabulary on import", () => {
      // The canonical transport field is a strict enum, so carrying an unknown
      // value over would make .rulesync/mcp.json unparseable for every target.
      const rovodevMcp = new RovodevMcp({
        outputRoot: testDir,
        relativeDirPath: ".rovodev",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: { odd: { transport: "websocket", url: "https://example.com/mcp" } },
        }),
        global: true,
      });

      const imported = JSON.parse(rovodevMcp.toRulesyncMcp().getFileContent());
      expect(imported.mcpServers.odd).toEqual({ url: "https://example.com/mcp" });
    });

    it("skips a server entry that is not an object rather than throwing", () => {
      const rovodevMcp = new RovodevMcp({
        outputRoot: testDir,
        relativeDirPath: ".rovodev",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: { broken: null, alsoBroken: "oops", ok: { transport: "stdio" } },
        }),
        global: true,
      });

      const imported = JSON.parse(rovodevMcp.toRulesyncMcp().getFileContent());
      expect(imported.mcpServers).toEqual({ ok: { type: "stdio" } });
    });
  });
});
