import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_MCP_SCHEMA_URL } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { readFileContent, writeFileContent } from "../../utils/file.js";
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
              mode: "trusted",
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
        // unknown keys (`mode`) pass through.
        remote: { url: "https://example.com/mcp", disabled: true, mode: "trusted" },
      });
      expect(json.schema_version).toBeUndefined();
      expect(json.model).toBeUndefined();
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
