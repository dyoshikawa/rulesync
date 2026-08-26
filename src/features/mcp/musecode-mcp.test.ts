import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_MCP_SCHEMA_URL } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { readFileContent, writeFileContent } from "../../utils/file.js";
import { fallbackLogger } from "../../utils/logger.js";
import { MusecodeMcp } from "./musecode-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import { ToolMcp } from "./tool-mcp.js";

describe("MusecodeMcp", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

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

  const settingsPath = () => join(testDir, ".config", "muse", "settings.json");

  const buildRulesyncMcp = (mcpServers: Record<string, unknown>): RulesyncMcp =>
    new RulesyncMcp({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: ".mcp.json",
      fileContent: JSON.stringify({ mcpServers }),
    });

  describe("getSettablePaths", () => {
    it("should point to .config/muse/settings.json at both scopes", () => {
      const expected = {
        relativeDirPath: join(".config", "muse"),
        relativeFilePath: "settings.json",
      };
      expect(MusecodeMcp.getSettablePaths({ global: true })).toEqual(expected);
      expect(MusecodeMcp.getSettablePaths()).toEqual(expected);
    });
  });

  describe("isDeletable", () => {
    it("should never be deletable (the user's primary settings file)", () => {
      const mcp = new MusecodeMcp({
        outputRoot: testDir,
        relativeDirPath: join(".config", "muse"),
        relativeFilePath: "settings.json",
        fileContent: "{}",
        global: true,
      });
      expect(mcp.isDeletable()).toBe(false);
    });
  });

  describe("fromRulesyncMcp", () => {
    it("should throw in non-global mode", async () => {
      await expect(
        MusecodeMcp.fromRulesyncMcp({
          outputRoot: testDir,
          rulesyncMcp: buildRulesyncMcp({}),
          global: false,
        }),
      ).rejects.toThrow(/global-only/);
    });

    it("should convert stdio servers to Muse Code's native shape", async () => {
      const mcp = await MusecodeMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: buildRulesyncMcp({
          fs: { command: "fs-server", args: ["--root", "."], env: { TOKEN: "x" } },
        }),
        global: true,
      });

      expect(mcp.getJson().mcp_servers).toEqual({
        fs: {
          transport: "stdio",
          command: "fs-server",
          args: ["--root", "."],
          env: { TOKEN: "x" },
        },
      });
    });

    it("should convert remote servers to streamable_http with url/headers", async () => {
      const mcp = await MusecodeMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: buildRulesyncMcp({
          remote: {
            type: "http",
            url: "https://example.com/mcp",
            headers: { Authorization: "Bearer x" },
          },
        }),
        global: true,
      });

      expect(mcp.getJson().mcp_servers).toEqual({
        remote: {
          transport: "streamable_http",
          url: "https://example.com/mcp",
          headers: { Authorization: "Bearer x" },
        },
      });
    });

    it("should map disabled: true to enabled: false and skip transport-less servers", async () => {
      const mcp = await MusecodeMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: buildRulesyncMcp({
          off: { command: "srv", disabled: true },
          broken: { disabledTools: ["x"] },
        }),
        global: true,
      });

      expect(mcp.getJson().mcp_servers).toEqual({
        off: { transport: "stdio", command: "srv", args: [], enabled: false },
      });
    });

    it("should warn-and-skip sse and ws servers instead of rewriting them to streamable_http", async () => {
      const logger = createMockLogger();
      const mcp = await MusecodeMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: buildRulesyncMcp({
          legacy: { type: "sse", url: "https://example.com/sse" },
          socket: { type: "ws", url: "wss://example.com/ws" },
          "bare-ws-url": { url: "ws://example.com/ws" },
          kept: { type: "http", url: "https://example.com/mcp" },
        }),
        global: true,
        logger,
      });

      // Only the streamable-HTTP-capable server survives; sse/ws servers would
      // not connect over Muse Code's streamable_http transport.
      expect(mcp.getJson().mcp_servers).toEqual({
        kept: { transport: "streamable_http", url: "https://example.com/mcp" },
      });
      for (const [serverName, transport] of [
        ["legacy", "sse"],
        ["socket", "ws"],
        ["bare-ws-url", "ws"],
      ] as const) {
        expect(
          logger.warn.mock.calls.some(
            ([message]) =>
              typeof message === "string" &&
              message.includes(`"${serverName}"`) &&
              message.includes(`"${transport}"`),
          ),
        ).toBe(true);
      }
    });

    it("should write musecodeMode out under Muse Code's own mode key", async () => {
      const mcp = await MusecodeMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: buildRulesyncMcp({
          // Both documented values, including the one that matches Muse Code's
          // default: an authored `required` is written rather than dropped as
          // redundant, so a generate does not silently rewrite the file.
          flaky: { command: "flaky-server", musecodeMode: "optional" },
          core: { command: "core-server", musecodeMode: "required" },
          plain: { command: "plain-server" },
        }),
        global: true,
      });

      expect(mcp.getJson().mcp_servers).toEqual({
        flaky: { transport: "stdio", command: "flaky-server", args: [], mode: "optional" },
        core: { transport: "stdio", command: "core-server", args: [], mode: "required" },
        plain: { transport: "stdio", command: "plain-server", args: [] },
      });
    });

    it("should bootstrap schema_version: 1 when creating the file", async () => {
      const mcp = await MusecodeMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: buildRulesyncMcp({ fs: { command: "fs" } }),
        global: true,
      });

      expect(mcp.getJson().schema_version).toBe(1);
    });

    it("should preserve an existing schema_version and other settings keys", async () => {
      await writeFileContent(
        settingsPath(),
        JSON.stringify(
          {
            schema_version: 2,
            model: "muse-large",
            mcp_servers: { old: { transport: "stdio", command: "old" } },
          },
          null,
          2,
        ),
      );

      const mcp = await MusecodeMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: buildRulesyncMcp({ fs: { command: "fs" } }),
        global: true,
      });

      const json = mcp.getJson();
      expect(json.schema_version).toBe(2);
      expect(json.model).toBe("muse-large");
      // mcp_servers is replaced with the rulesync servers (old one removed).
      expect(json.mcp_servers).toEqual({
        fs: { transport: "stdio", command: "fs", args: [] },
      });
    });
  });

  describe("fromFile", () => {
    it("should throw in non-global mode", async () => {
      await expect(MusecodeMcp.fromFile({ outputRoot: testDir, global: false })).rejects.toThrow(
        /global-only/,
      );
    });

    it("should read existing settings and surface mcp_servers", async () => {
      await writeFileContent(
        settingsPath(),
        JSON.stringify({
          schema_version: 1,
          mcp_servers: { fs: { transport: "stdio", command: "fs" } },
        }),
      );

      const mcp = await MusecodeMcp.fromFile({ outputRoot: testDir, global: true });
      expect(mcp.getJson().mcp_servers).toEqual({ fs: { transport: "stdio", command: "fs" } });
    });

    it("should default to an empty document when file is missing", async () => {
      const mcp = await MusecodeMcp.fromFile({ outputRoot: testDir, global: true });
      expect(mcp.getJson()).toEqual({});
    });
  });

  describe("toRulesyncMcp", () => {
    it("should convert back to canonical servers without leaking settings keys", () => {
      const mcp = new MusecodeMcp({
        outputRoot: testDir,
        relativeDirPath: join(".config", "muse"),
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({
          schema_version: 1,
          model: "muse-large",
          mcp_servers: {
            fs: { transport: "stdio", command: "fs", args: ["--x"], env: { A: "1" } },
            remote: {
              transport: "streamable_http",
              url: "https://example.com/mcp",
              enabled: false,
              framing: "ndjson",
            },
          },
        }),
        global: true,
      });

      const rulesyncMcp = mcp.toRulesyncMcp();
      const json = JSON.parse(rulesyncMcp.getFileContent());
      expect(json.$schema).toBe(RULESYNC_MCP_SCHEMA_URL);
      expect(json.mcpServers).toEqual({
        fs: { command: "fs", args: ["--x"], env: { A: "1" } },
        // `transport` is dropped, `enabled: false` maps to `disabled: true`,
        // unknown keys (`framing`) pass through.
        remote: { url: "https://example.com/mcp", disabled: true, framing: "ndjson" },
      });
      expect(json.schema_version).toBeUndefined();
      expect(json.model).toBeUndefined();
    });
  });

  describe("mode round-trip", () => {
    const importSettings = (mcpServers: Record<string, unknown>): MusecodeMcp =>
      new MusecodeMcp({
        outputRoot: testDir,
        relativeDirPath: join(".config", "muse"),
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({ schema_version: 1, mcp_servers: mcpServers }),
        global: true,
      });

    it("should lift a documented mode into musecodeMode on import", () => {
      const rulesyncMcp = importSettings({
        flaky: { transport: "stdio", command: "flaky-server", mode: "optional" },
        core: { transport: "stdio", command: "core-server", mode: "required" },
      }).toRulesyncMcp();

      expect(JSON.parse(rulesyncMcp.getFileContent()).mcpServers).toEqual({
        flaky: { command: "flaky-server", musecodeMode: "optional" },
        core: { command: "core-server", musecodeMode: "required" },
      });
    });

    it("should drop a rulesync-side musecodeMode found in the settings file", () => {
      // Muse Code never writes `musecodeMode`, so one in settings.json is noise.
      // Passing it through would put an unchecked value into `.rulesync/mcp.json`
      // under a key typed as exactly two values, and the next parse would reject
      // the whole file rather than just this entry.
      const rulesyncMcp = importSettings({
        junk: { transport: "stdio", command: "junk-server", musecodeMode: 5 },
        both: {
          transport: "stdio",
          command: "both-server",
          mode: "optional",
          musecodeMode: "GARBAGE",
        },
      }).toRulesyncMcp();

      expect(JSON.parse(rulesyncMcp.getFileContent()).mcpServers).toEqual({
        junk: { command: "junk-server" },
        both: { command: "both-server", musecodeMode: "optional" },
      });
    });

    it("should drop an undocumented mode with a warning instead of passing it through", () => {
      // Keeping it would copy a Muse Code key into every OTHER target's config,
      // since `McpServerSchema` is loose — while Muse Code's own generate would
      // still not emit it. Dropping loses nothing the next generate kept.
      const warnSpy = vi.spyOn(fallbackLogger, "warn").mockImplementation(() => {});

      const rulesyncMcp = importSettings({
        odd: { transport: "stdio", command: "odd-server", mode: "lazy" },
      }).toRulesyncMcp();

      expect(JSON.parse(rulesyncMcp.getFileContent()).mcpServers).toEqual({
        odd: { command: "odd-server" },
      });
      // Both halves quoted by the serializer, since both come off disk.
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('"lazy"'));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('"odd"'));
      warnSpy.mockRestore();
    });

    it("should carry mode alongside a remote transport and a disabled server", () => {
      // `mode` is appended after the transport branch, so the remote path and
      // the `enabled: false` path both have to keep it.
      const settings = {
        remote: {
          transport: "streamable_http",
          url: "https://example.com/mcp",
          mode: "optional",
        },
        off: { transport: "stdio", command: "off-server", enabled: false, mode: "required" },
      };

      const rulesyncMcp = importSettings(settings).toRulesyncMcp();
      expect(JSON.parse(rulesyncMcp.getFileContent()).mcpServers).toEqual({
        remote: { url: "https://example.com/mcp", musecodeMode: "optional" },
        off: { command: "off-server", disabled: true, musecodeMode: "required" },
      });
    });

    it("should keep musecodeMode through the pipeline generate actually runs", async () => {
      // The re-merge reads `getJson().mcpServers` off whatever instance the
      // processor hands over, which is a rebuilt one: `forTarget()` folds the
      // tool-scoped `musecode` block into the shared map and `stripMcpServerFields`
      // rebuilds it again. Both steps are the only way the re-merge can break, and
      // constructing a RulesyncMcp directly (as the tests above do) skips them.
      const source = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({
          mcpServers: { shared: { command: "shared-server", musecodeMode: "optional" } },
          musecode: {
            mcpServers: { scoped: { command: "scoped-server", musecodeMode: "required" } },
          },
        }),
      });

      const mcp = await MusecodeMcp.fromRulesyncMcp({
        outputRoot: testDir,
        // musecode's meta sets both supportsEnabledTools and supportsDisabledTools
        // to false, so these are the fields `mcp-processor.ts` strips for it.
        rulesyncMcp: source
          .forTarget({ toolTarget: "musecode" })
          .stripMcpServerFields(["enabledTools", "disabledTools"]),
        global: true,
      });

      expect(mcp.getJson().mcp_servers).toEqual({
        shared: { transport: "stdio", command: "shared-server", args: [], mode: "optional" },
        scoped: { transport: "stdio", command: "scoped-server", args: [], mode: "required" },
      });
    });

    it("should survive an import followed by a generate", async () => {
      // The regression #2769 reported: before `musecodeMode` existed, `mode`
      // came back as an unknown key and the next generate dropped it silently.
      const imported = importSettings({
        flaky: { transport: "stdio", command: "flaky-server", args: ["--x"], mode: "optional" },
      }).toRulesyncMcp();

      const regenerated = await MusecodeMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: imported,
        global: true,
      });

      expect(regenerated.getJson().mcp_servers).toEqual({
        flaky: { transport: "stdio", command: "flaky-server", args: ["--x"], mode: "optional" },
      });
    });
  });

  describe("generation writes a merged file", () => {
    it("should not clobber other keys when written to disk", async () => {
      await writeFileContent(
        settingsPath(),
        JSON.stringify({ schema_version: 1, someOtherKey: 42 }, null, 2),
      );

      const mcp = await MusecodeMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: buildRulesyncMcp({ fs: { command: "fs" } }),
        global: true,
      });

      await writeFileContent(settingsPath(), mcp.getFileContent());
      const written = JSON.parse(await readFileContent(settingsPath()));
      expect(written.schema_version).toBe(1);
      expect(written.someOtherKey).toBe(42);
      expect(written.mcp_servers).toEqual({ fs: { transport: "stdio", command: "fs", args: [] } });
    });

    it("should be an instance of ToolMcp", () => {
      const mcp = new MusecodeMcp({
        outputRoot: testDir,
        relativeDirPath: join(".config", "muse"),
        relativeFilePath: "settings.json",
        fileContent: "{}",
        global: true,
      });
      expect(mcp).toBeInstanceOf(ToolMcp);
    });
  });
});
