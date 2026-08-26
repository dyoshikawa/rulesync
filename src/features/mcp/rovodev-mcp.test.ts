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

  describe("enable_instructions", () => {
    it("writes the canonical flag out under Rovo Dev's own key", async () => {
      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            trusted: { command: "node", rovodevEnableInstructions: true },
            plain: { command: "node" },
            off: { command: "node", rovodevEnableInstructions: false },
          },
        }),
      });

      const rovodevMcp = await RovodevMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });

      const servers = JSON.parse(rovodevMcp.getFileContent()).mcpServers;
      expect(servers.trusted).toEqual({ command: "node", enable_instructions: true });
      // Absent and `false` mean the same thing to Rovo Dev, so neither is written.
      expect(servers.plain).toEqual({ command: "node" });
      expect(servers.off).toEqual({ command: "node" });
    });

    it("accepts Rovo Dev's own spelling in the canonical config", async () => {
      // So an entry copied straight out of Atlassian's docs still works.
      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: { trusted: { command: "node", enable_instructions: true } },
        }),
      });

      const rovodevMcp = await RovodevMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });

      expect(JSON.parse(rovodevMcp.getFileContent()).mcpServers.trusted).toEqual({
        command: "node",
        enable_instructions: true,
      });
    });

    it("lets an explicit canonical false override the raw spelling", async () => {
      // Fail-open would be the wrong default on the one key whose whole purpose
      // is a trust decision, so the canonical key decides whenever it is
      // present — the same precedence codex applies to its two spellings.
      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            distrusted: {
              command: "node",
              enable_instructions: true,
              rovodevEnableInstructions: false,
            },
          },
        }),
      });

      const rovodevMcp = await RovodevMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });

      expect(JSON.parse(rovodevMcp.getFileContent()).mcpServers.distrusted).toEqual({
        command: "node",
      });
    });

    it("reports the servers whose instructions it enables", async () => {
      const logger = createMockLogger();
      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            trusted: { command: "node", rovodevEnableInstructions: true },
            plain: { command: "node" },
          },
        }),
      });

      await RovodevMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
        logger,
      });

      // Atlassian gates this key on trust, and it is the only thing generate
      // writes that widens what steers the model — it must not be the quietest.
      const message = logger.warn.mock.calls
        .map(([entry]) => String(entry))
        .find((entry) => entry.includes("enable_instructions: true"));
      expect(message).toContain("trusted");
      expect(message).not.toContain("plain");
    });

    it("keeps the flag through the pipeline generate actually runs", async () => {
      // The re-merge reads `getJson().mcpServers` off whatever instance the
      // processor hands over, and that is a rebuilt one: `forTarget()` folds the
      // tool-scoped `rovodev` block in and `stripMcpServerFields` rebuilds it
      // again. Constructing a RulesyncMcp directly skips both steps.
      const source = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: { shared: { command: "shared-server", rovodevEnableInstructions: true } },
          rovodev: {
            mcpServers: { scoped: { command: "scoped-server", enable_instructions: true } },
          },
        }),
      });

      const rovodevMcp = await RovodevMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: source
          .forTarget({ toolTarget: "rovodev" })
          .stripMcpServerFields(["enabledTools", "disabledTools"]),
        global: true,
      });

      expect(JSON.parse(rovodevMcp.getFileContent()).mcpServers).toEqual({
        shared: { command: "shared-server", enable_instructions: true },
        scoped: { command: "scoped-server", enable_instructions: true },
      });
    });

    it("lifts the flag back onto the canonical key on import", () => {
      const rovodevMcp = new RovodevMcp({
        outputRoot: testDir,
        relativeDirPath: ".rovodev",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            trusted: { transport: "stdio", command: "node", enable_instructions: true },
            plain: { transport: "stdio", command: "node" },
            // Only a real `true` enables instructions in Rovo Dev, so nothing
            // else may import as an enabled flag.
            fuzzy: { transport: "stdio", command: "node", enable_instructions: "yes" },
          },
        }),
      });

      const servers = JSON.parse(rovodevMcp.toRulesyncMcp().getFileContent()).mcpServers;
      expect(servers.trusted).toEqual({
        type: "stdio",
        command: "node",
        rovodevEnableInstructions: true,
      });
      expect(servers.plain).toEqual({ type: "stdio", command: "node" });
      expect(servers.fuzzy).toEqual({ type: "stdio", command: "node" });
    });

    it("survives an import followed by a generate", async () => {
      const imported = new RovodevMcp({
        outputRoot: testDir,
        relativeDirPath: ".rovodev",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            trusted: { transport: "stdio", command: "node", enable_instructions: true },
          },
        }),
      }).toRulesyncMcp();

      const regenerated = await RovodevMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: imported,
        global: true,
      });

      expect(JSON.parse(regenerated.getFileContent()).mcpServers.trusted).toEqual({
        transport: "stdio",
        command: "node",
        enable_instructions: true,
      });
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

    it("points mcp.mcpConfigPath at the project mcp.json it writes", async () => {
      const logger = createMockLogger();
      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ mcpServers: { managed: { command: "node" } } }),
      });

      // No config.yml and nothing disabled: without the pointer Rovo Dev keeps
      // reading the global MCP file and the generated project one is inert.
      const auxiliary = await RovodevMcp.getAuxiliaryFiles({
        outputRoot: testDir,
        rulesyncMcp,
        logger,
      });
      expect(auxiliary).toHaveLength(1);
      expect(auxiliary[0]!.getFileContent()).toContain("mcpConfigPath: .rovodev/mcp.json");
      // Writing the pointer is what makes Rovo Dev start the generated servers and
      // takes this project off the global MCP config, so it is announced.
      expect(
        logger.info.mock.calls.some(([message]) =>
          String(message).includes("setting mcp.mcpConfigPath"),
        ),
      ).toBe(true);
    });

    it("does not write the pointer when no server targets rovodev", async () => {
      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: { elsewhere: { command: "node", targets: ["cursor"] } },
        }),
      });

      // `mcp.json` is still written, but empty. Pointing at it would replace
      // the user's global MCP config with nothing for this repository.
      const auxiliary = await RovodevMcp.getAuxiliaryFiles({ outputRoot: testDir, rulesyncMcp });
      expect(auxiliary).toEqual([]);
    });

    it("does not add the pointer to an existing config.yml when no server targets rovodev", async () => {
      // Separated from the case above, where `[]` also satisfies the "do not
      // create a file just to hold an empty block" early return. Here the file
      // exists, so the gate is the only thing keeping the pointer out.
      await ensureDir(join(testDir, ".rovodev"));
      await writeFileContent(
        join(testDir, ".rovodev", "config.yml"),
        ["mcp:", "  allowedMcpServers:", "    - keep-me"].join("\n"),
      );

      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: { elsewhere: { command: "node", targets: ["cursor"] } },
        }),
      });

      const auxiliary = await RovodevMcp.getAuxiliaryFiles({ outputRoot: testDir, rulesyncMcp });
      expect(auxiliary[0]!.getFileContent()).not.toContain("mcpConfigPath");
      expect(auxiliary[0]!.getFileContent()).toContain("keep-me");
    });

    it("does not write the pointer when the only rovodev server is disabled", async () => {
      const logger = createMockLogger();
      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: { only: { command: "node", disabled: true } },
        }),
      });

      // The server is written to `mcp.json` but switched off through
      // `disabledMcpServers`, so the project would end up with no servers at
      // all and off the global config.
      const auxiliary = await RovodevMcp.getAuxiliaryFiles({
        outputRoot: testDir,
        rulesyncMcp,
        logger,
      });
      expect(auxiliary[0]!.getFileContent()).toContain("disabledMcpServers");
      expect(auxiliary[0]!.getFileContent()).not.toContain("mcpConfigPath");
    });

    it("does not write the pointer for a server entry with no endpoint", async () => {
      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
        // The canonical schema does not require `command`/`url`, so an entry
        // naming only its targets is valid and reaches `mcp.json` -- but there
        // is nothing there for Rovo Dev to start.
        fileContent: JSON.stringify({ mcpServers: { hollow: { targets: ["rovodev"] } } }),
      });

      const auxiliary = await RovodevMcp.getAuxiliaryFiles({ outputRoot: testDir, rulesyncMcp });
      expect(auxiliary).toEqual([]);
    });

    it("warns about a standing pointer when the only rovodev server is switched off", async () => {
      // The other route to a server-less `mcp.json`: the server is still
      // targeted, but disabled, so `hasLiveServers` goes false through
      // `disabledNames` rather than through an empty target list.
      const logger = createMockLogger();
      await ensureDir(join(testDir, ".rovodev"));
      await writeFileContent(
        join(testDir, ".rovodev", "config.yml"),
        ["mcp:", "  mcpConfigPath: .rovodev/mcp.json"].join("\n"),
      );

      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: { only: { command: "node", disabled: true } },
        }),
      });

      await RovodevMcp.getAuxiliaryFiles({ outputRoot: testDir, rulesyncMcp, logger });

      expect(
        logger.warn.mock.calls.some(([message]) =>
          String(message).includes("which now has no enabled"),
        ),
      ).toBe(true);
    });

    it("warns when a pointer written earlier now names an mcp.json with no enabled server", async () => {
      const logger = createMockLogger();
      await ensureDir(join(testDir, ".rovodev"));
      await writeFileContent(
        join(testDir, ".rovodev", "config.yml"),
        ["mcp:", "  mcpConfigPath: .rovodev/mcp.json"].join("\n"),
      );

      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: { elsewhere: { command: "node", targets: ["cursor"] } },
        }),
      });

      await RovodevMcp.getAuxiliaryFiles({ outputRoot: testDir, rulesyncMcp, logger });

      // Rulesync does not take the pointer back out, so the project is left
      // reading an empty file rather than the global config. Say so.
      expect(
        logger.warn.mock.calls.some(([message]) =>
          String(message).includes("which now has no enabled"),
        ),
      ).toBe(true);
    });

    it("leaves a user-chosen mcpConfigPath in place and warns that mcp.json is unread", async () => {
      const logger = createMockLogger();
      await ensureDir(join(testDir, ".rovodev"));
      await writeFileContent(
        join(testDir, ".rovodev", "config.yml"),
        ["mcp:", "  mcpConfigPath: custom/mcp.json"].join("\n"),
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
      expect(auxiliary[0]!.getFileContent()).toContain("mcpConfigPath: custom/mcp.json");
      expect(
        logger.warn.mock.calls.some(([message]) =>
          String(message).includes("leaving mcp.mcpConfigPath"),
        ),
      ).toBe(true);
    });

    it("writes a home-anchored pointer in global scope", async () => {
      const logger = createMockLogger();
      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ mcpServers: { managed: { command: "node" } } }),
      });

      const auxiliary = await RovodevMcp.getAuxiliaryFiles({
        outputRoot: testDir,
        global: true,
        rulesyncMcp,
        logger,
      });
      // Atlassian's settings reference documents the default as
      // `~/.rovodev/mcp_config.json`, so the global `mcp.json` rulesync writes
      // is not necessarily read until the pointer names it. The value has to
      // be home-anchored: `~/.rovodev/config.yml` is read from whatever
      // directory Rovo Dev runs in.
      expect(auxiliary[0]!.getFileContent()).toContain("mcpConfigPath: ~/.rovodev/mcp.json");
      // Warned, not noted: the global pointer changes Rovo Dev on every project.
      expect(
        logger.warn.mock.calls.some(([message]) =>
          String(message).includes('setting mcp.mcpConfigPath to "~/.rovodev/mcp.json"'),
        ),
      ).toBe(true);
    });

    it("withholds the global pointer when mcp_config.json holds servers", async () => {
      const logger = createMockLogger();
      await ensureDir(join(testDir, ".rovodev"));
      // Atlassian's settings reference documents this file as the default. If
      // that is the spelling in force, these are the servers Rovo Dev is
      // running today, and mcpConfigPath replaces rather than merges — so the
      // pointer must not be written behind the user's back.
      await writeFileContent(
        join(testDir, ".rovodev", "mcp_config.json"),
        JSON.stringify({ mcpServers: { theirs: { command: "their-server" } } }),
      );
      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ mcpServers: { managed: { command: "node" } } }),
      });

      const auxiliary = await RovodevMcp.getAuxiliaryFiles({
        outputRoot: testDir,
        global: true,
        rulesyncMcp,
        logger,
      });

      expect(auxiliary).toEqual([]);
      expect(
        logger.warn.mock.calls.some(([message]) =>
          String(message).includes("leaving mcp.mcpConfigPath unset"),
        ),
      ).toBe(true);
      expect(logger.warn.mock.calls.some(([message]) => String(message).includes("theirs"))).toBe(
        true,
      );
    });

    it("withholds the global pointer when mcp_config.json cannot be parsed", async () => {
      const logger = createMockLogger();
      await ensureDir(join(testDir, ".rovodev"));
      // Cannot be shown to be empty, and taking a whole global MCP config away
      // is not a decision to make on a guess.
      await writeFileContent(join(testDir, ".rovodev", "mcp_config.json"), "{ not json");
      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ mcpServers: { managed: { command: "node" } } }),
      });

      const auxiliary = await RovodevMcp.getAuxiliaryFiles({
        outputRoot: testDir,
        global: true,
        rulesyncMcp,
        logger,
      });

      expect(auxiliary).toEqual([]);
      expect(
        logger.warn.mock.calls.some(([message]) => String(message).includes("cannot be parsed")),
      ).toBe(true);
    });

    it("writes the global pointer when mcp_config.json defines no servers", async () => {
      const logger = createMockLogger();
      await ensureDir(join(testDir, ".rovodev"));
      await writeFileContent(
        join(testDir, ".rovodev", "mcp_config.json"),
        JSON.stringify({ mcpServers: {} }),
      );
      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ mcpServers: { managed: { command: "node" } } }),
      });

      const auxiliary = await RovodevMcp.getAuxiliaryFiles({
        outputRoot: testDir,
        global: true,
        rulesyncMcp,
        logger,
      });

      expect(auxiliary[0]!.getFileContent()).toContain("mcpConfigPath: ~/.rovodev/mcp.json");
    });

    it("does not consult mcp_config.json in project scope", async () => {
      const logger = createMockLogger();
      await ensureDir(join(testDir, ".rovodev"));
      await writeFileContent(
        join(testDir, ".rovodev", "mcp_config.json"),
        JSON.stringify({ mcpServers: { theirs: { command: "their-server" } } }),
      );
      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ mcpServers: { managed: { command: "node" } } }),
      });

      // The displaced-servers question is about Rovo Dev's home-directory
      // default; a repo-relative `.rovodev/mcp_config.json` is not it.
      const auxiliary = await RovodevMcp.getAuxiliaryFiles({
        outputRoot: testDir,
        rulesyncMcp,
        logger,
      });

      expect(auxiliary[0]!.getFileContent()).toContain("mcpConfigPath: .rovodev/mcp.json");
    });

    it("keeps a global pointer the user aimed elsewhere", async () => {
      const logger = createMockLogger();
      await ensureDir(join(testDir, ".rovodev"));
      await writeFileContent(
        join(testDir, ".rovodev", "config.yml"),
        "mcp:\n  mcpConfigPath: ~/.rovodev/mcp_config.json\n",
      );
      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ mcpServers: { managed: { command: "node" } } }),
      });

      const auxiliary = await RovodevMcp.getAuxiliaryFiles({
        outputRoot: testDir,
        global: true,
        rulesyncMcp,
        logger,
      });
      expect(auxiliary[0]!.getFileContent()).toContain("mcpConfigPath: ~/.rovodev/mcp_config.json");
      expect(
        logger.warn.mock.calls.some(([message]) =>
          String(message).includes("leaving mcp.mcpConfigPath"),
        ),
      ).toBe(true);
    });

    it("does not write a global pointer when no server can be started", async () => {
      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ mcpServers: { managed: { targets: ["rovodev"] } } }),
      });

      // Pointing at an mcp.json with nothing runnable in it would take away
      // whatever Rovo Dev's own default resolves to, in exchange for nothing.
      const auxiliary = await RovodevMcp.getAuxiliaryFiles({
        outputRoot: testDir,
        global: true,
        rulesyncMcp,
      });
      expect(auxiliary).toEqual([]);
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
