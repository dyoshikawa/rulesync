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

  describe("project scope", () => {
    it("should read and write the project .rovodev/mcp.json without --global", async () => {
      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_MCP_FILE_NAME,
        fileContent: JSON.stringify({ mcpServers: { srv: { command: "node" } } }),
        validate: true,
      });

      const mcp = await RovodevMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp });
      expect(mcp.getRelativeDirPath()).toBe(".rovodev");
      const json = JSON.parse(mcp.getFileContent());
      expect(json.mcpServers.srv.command).toBe("node");

      const imported = await RovodevMcp.fromFile({ outputRoot: testDir, validate: true });
      expect(imported).toBeInstanceOf(RovodevMcp);
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

    it("writes a disabled server to mcp.json and toggles it via config.yml", async () => {
      // Rovo Dev disables servers through `mcp.disabledMcpServers` in
      // config.yml, so the definition is written here (minus the flag) and the
      // toggle goes to the auxiliary config.yml writer.
      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            "off-server": { type: "http", url: "https://example.com/mcp", disabled: true },
            "on-server": { type: "http", url: "https://example.com/mcp", disabled: false },
          },
        }),
      });

      const rovodevMcp = await RovodevMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });

      const servers = JSON.parse(rovodevMcp.getFileContent()).mcpServers;
      // `disabled` is dropped from the entries — mcp.json is not where a Rovo
      // Dev server is switched on and off — but the definition survives.
      expect(servers["off-server"]).toEqual({ transport: "http", url: "https://example.com/mcp" });
      expect(servers["on-server"]).toEqual({ transport: "http", url: "https://example.com/mcp" });

      const auxiliary = await RovodevMcp.getAuxiliaryFiles({
        outputRoot: testDir,
        global: true,
        rulesyncMcp,
      });
      expect(auxiliary).toHaveLength(1);
      expect(auxiliary[0]!.getRelativeFilePath()).toBe("config.yml");
      expect(auxiliary[0]!.getFileContent()).toContain("disabledMcpServers");
      expect(auxiliary[0]!.getFileContent()).toContain("- off-server");
      expect(auxiliary[0]!.getFileContent()).not.toContain("- on-server");
    });

    it("preserves user mcp keys and unmanaged disabled names in config.yml", async () => {
      await ensureDir(join(testDir, ".rovodev"));
      await writeFileContent(
        join(testDir, ".rovodev", "config.yml"),
        [
          "mcp:",
          "  mcpConfigPath: .rovodev/mcp.json",
          "  disabledMcpServers:",
          "    - user-server",
          "    - managed",
        ].join("\n"),
      );

      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: { managed: { command: "node" } },
        }),
      });

      const auxiliary = await RovodevMcp.getAuxiliaryFiles({
        outputRoot: testDir,
        rulesyncMcp,
      });
      const content = auxiliary[0]!.getFileContent();
      // rulesync owns the toggle for managed servers (the enabled `managed`
      // entry is removed), unmanaged names and user keys survive.
      expect(content).toContain("mcpConfigPath: .rovodev/mcp.json");
      expect(content).toContain("- user-server");
      expect(content).not.toContain("- managed");
    });

    it("fails import closed when config.yml exists but cannot be parsed", async () => {
      await ensureDir(join(testDir, ".rovodev"));
      await writeFileContent(
        join(testDir, ".rovodev", "mcp.json"),
        JSON.stringify({ mcpServers: { srv: { command: "node" } } }),
      );
      await writeFileContent(join(testDir, ".rovodev", "config.yml"), "mcp: [unclosed");

      await expect(RovodevMcp.fromFile({ outputRoot: testDir, validate: true })).rejects.toThrow();
    });

    it("skips a disabled server on generate when config.yml cannot be parsed", async () => {
      const logger = createMockLogger();
      await ensureDir(join(testDir, ".rovodev"));
      await writeFileContent(join(testDir, ".rovodev", "config.yml"), "mcp: [unclosed");

      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            "off-server": { command: "node", disabled: true },
            "on-server": { command: "node" },
          },
        }),
      });

      const mcp = await RovodevMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp, logger });
      const servers = JSON.parse(mcp.getFileContent()).mcpServers;
      // Fail-closed: the toggle cannot be written, so the runnable definition
      // must not be written either.
      expect(servers["off-server"]).toBeUndefined();
      expect(servers["on-server"]).toEqual({ command: "node" });
      expect(
        logger.warn.mock.calls.some(([message]) =>
          String(message).includes('skipping disabled server "off-server"'),
        ),
      ).toBe(true);
    });

    it("warns when re-enabling a managed server the user disabled by hand", async () => {
      const logger = createMockLogger();
      await ensureDir(join(testDir, ".rovodev"));
      await writeFileContent(
        join(testDir, ".rovodev", "config.yml"),
        ["mcp:", "  disabledMcpServers:", "    - managed"].join("\n"),
      );

      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ mcpServers: { managed: { command: "node" } } }),
      });

      const auxiliary = await RovodevMcp.getAuxiliaryFiles({
        outputRoot: testDir,
        rulesyncMcp,
        logger,
      });
      expect(auxiliary[0]!.getFileContent()).not.toContain("- managed");
      expect(
        logger.warn.mock.calls.some(([message]) => String(message).includes("re-enabling managed")),
      ).toBe(true);
    });

    it("does not let a __proto__ entry in disabledMcpServers mutate the overlay", async () => {
      await ensureDir(join(testDir, ".rovodev"));
      await writeFileContent(
        join(testDir, ".rovodev", "mcp.json"),
        JSON.stringify({ mcpServers: { srv: { command: "node" } } }),
      );
      await writeFileContent(
        join(testDir, ".rovodev", "config.yml"),
        ["mcp:", "  disabledMcpServers:", '    - "__proto__"'].join("\n"),
      );

      const imported = await RovodevMcp.fromFile({ outputRoot: testDir, validate: true });
      const parsed = JSON.parse(imported.toRulesyncMcp().getFileContent());
      expect(parsed.mcpServers.srv.disabled).toBeUndefined();
      expect(({} as Record<string, unknown>).disabled).toBeUndefined();
    });

    it("round-trips the disabled toggle on import", async () => {
      await ensureDir(join(testDir, ".rovodev"));
      await writeFileContent(
        join(testDir, ".rovodev", "mcp.json"),
        JSON.stringify({
          mcpServers: {
            "off-server": { transport: "http", url: "https://example.com/mcp" },
            "on-server": { command: "node" },
          },
        }),
      );
      await writeFileContent(
        join(testDir, ".rovodev", "config.yml"),
        ["mcp:", "  disabledMcpServers:", "    - off-server"].join("\n"),
      );

      const imported = await RovodevMcp.fromFile({ outputRoot: testDir, validate: true });
      const parsed = JSON.parse(imported.toRulesyncMcp().getFileContent());
      expect(parsed.mcpServers["off-server"].disabled).toBe(true);
      expect(parsed.mcpServers["on-server"].disabled).toBeUndefined();
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

    it("does not resolve a transport name off the prototype chain", () => {
      const rovodevMcp = new RovodevMcp({
        outputRoot: testDir,
        relativeDirPath: ".rovodev",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: { odd: { transport: "toString", url: "https://example.com/mcp" } },
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
