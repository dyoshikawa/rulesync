import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_MCP_SCHEMA_URL } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import { ZcodeMcp } from "./zcode-mcp.js";

const serversOf = (mcp: ZcodeMcp): unknown =>
  (mcp.getJson().mcp as Record<string, unknown> | undefined)?.servers;

describe("ZcodeMcp", () => {
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

  const projectConfigPath = () => join(testDir, ".zcode", "config.json");

  const buildRulesyncMcp = (mcpServers: Record<string, unknown>): RulesyncMcp =>
    new RulesyncMcp({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: ".mcp.json",
      fileContent: JSON.stringify({ mcpServers }),
    });

  describe("getSettablePaths", () => {
    it("should point to .zcode/config.json in project mode", () => {
      expect(ZcodeMcp.getSettablePaths()).toEqual({
        relativeDirPath: ".zcode",
        relativeFilePath: "config.json",
      });
    });

    it("should point to .zcode/cli/config.json in global mode", () => {
      expect(ZcodeMcp.getSettablePaths({ global: true })).toEqual({
        relativeDirPath: join(".zcode", "cli"),
        relativeFilePath: "config.json",
      });
    });
  });

  describe("isDeletable", () => {
    it("should never be deletable (the user's primary ZCode config)", () => {
      const mcp = new ZcodeMcp({
        outputRoot: testDir,
        relativeDirPath: ".zcode",
        relativeFilePath: "config.json",
        fileContent: "{}",
      });

      expect(mcp.isDeletable()).toBe(false);
    });
  });

  describe("fromRulesyncMcp", () => {
    it("should convert stdio servers to command/args/env", async () => {
      const mcp = await ZcodeMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: buildRulesyncMcp({
          fs: { command: "fs-server", args: ["--root", "."], env: { TOKEN: "x" } },
        }),
      });

      expect(serversOf(mcp)).toEqual({
        fs: { command: "fs-server", args: ["--root", "."], env: { TOKEN: "x" } },
      });
    });

    it("should convert remote servers to ZCode's type/url/headers shape", async () => {
      const mcp = await ZcodeMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: buildRulesyncMcp({
          remote: {
            type: "streamable-http",
            url: "https://example.com/mcp",
            headers: { Authorization: "Bearer x" },
          },
          legacy: { type: "sse", url: "https://example.com/sse" },
          bare: { url: "https://example.com/plain" },
        }),
      });

      expect(serversOf(mcp)).toEqual({
        remote: {
          type: "http",
          url: "https://example.com/mcp",
          headers: { Authorization: "Bearer x" },
        },
        legacy: { type: "sse", url: "https://example.com/sse" },
        // No stated transport and an http(s) URL: ZCode's default remote
        // transport is http.
        bare: { type: "http", url: "https://example.com/plain" },
      });
    });

    it("should map disabled: true to enable: false", async () => {
      const mcp = await ZcodeMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: buildRulesyncMcp({ off: { command: "srv", disabled: true } }),
      });

      expect(serversOf(mcp)).toEqual({
        off: { command: "srv", args: [], enable: false },
      });
    });

    it("should warn-and-skip servers ZCode cannot run", async () => {
      const logger = createMockLogger();
      const mcp = await ZcodeMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: buildRulesyncMcp({
          socket: { type: "ws", url: "wss://example.com/ws" },
          "bare-ws-url": { url: "ws://example.com/ws" },
          "no-transport": { disabledTools: ["x"] },
          "remote-no-url": { type: "http" },
          "stdio-no-command": { command: "" },
          kept: { command: "keeper" },
        }),
        logger,
      });

      expect(serversOf(mcp)).toEqual({ kept: { command: "keeper", args: [] } });
      for (const serverName of [
        "socket",
        "bare-ws-url",
        "no-transport",
        "remote-no-url",
        "stdio-no-command",
      ]) {
        expect(
          logger.warn.mock.calls.some(
            ([message]) => typeof message === "string" && message.includes(`"${serverName}"`),
          ),
        ).toBe(true);
      }
    });

    it("should preserve unrelated top-level keys and mcp siblings", async () => {
      await writeFileContent(
        projectConfigPath(),
        JSON.stringify(
          {
            model: "glm-4.6",
            mcp: { timeout: 30, servers: { old: { command: "old" } } },
          },
          null,
          2,
        ),
      );

      const mcp = await ZcodeMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: buildRulesyncMcp({ fs: { command: "fs" } }),
      });

      const json = mcp.getJson();
      expect(json.model).toBe("glm-4.6");
      expect(json.mcp).toEqual({ timeout: 30, servers: { fs: { command: "fs", args: [] } } });
    });

    it("should fail closed on an unparseable existing config", async () => {
      await writeFileContent(projectConfigPath(), "{ not json");

      await expect(
        ZcodeMcp.fromRulesyncMcp({
          outputRoot: testDir,
          rulesyncMcp: buildRulesyncMcp({ fs: { command: "fs" } }),
        }),
      ).rejects.toThrow();
    });
  });

  describe("fromFile", () => {
    it("should read an existing config", async () => {
      await writeFileContent(
        projectConfigPath(),
        JSON.stringify({ mcp: { servers: { fs: { command: "fs" } } } }),
      );

      const mcp = await ZcodeMcp.fromFile({ outputRoot: testDir });
      expect(serversOf(mcp)).toEqual({ fs: { command: "fs" } });
    });

    it("should default to an empty document when the file is missing", async () => {
      const mcp = await ZcodeMcp.fromFile({ outputRoot: testDir });
      expect(mcp.getJson()).toEqual({});
    });

    it("should read the global config from .zcode/cli/", async () => {
      await writeFileContent(
        join(testDir, ".zcode", "cli", "config.json"),
        JSON.stringify({ mcp: { servers: { fs: { command: "global-fs" } } } }),
      );

      const mcp = await ZcodeMcp.fromFile({ outputRoot: testDir, global: true });
      expect(serversOf(mcp)).toEqual({ fs: { command: "global-fs" } });
    });
  });

  describe("toRulesyncMcp", () => {
    it("should convert back to canonical servers without leaking ZCode's own keys", () => {
      const mcp = new ZcodeMcp({
        outputRoot: testDir,
        relativeDirPath: ".zcode",
        relativeFilePath: "config.json",
        fileContent: JSON.stringify({
          model: "glm-4.6",
          mcp: {
            servers: {
              fs: { command: "fs", args: ["--root", "."] },
              off: { command: "srv", enable: false },
              on: { command: "srv2", enable: true },
              remote: { type: "sse", url: "https://example.com/sse" },
            },
          },
        }),
      });

      expect(JSON.parse(mcp.toRulesyncMcp().getFileContent())).toEqual({
        $schema: RULESYNC_MCP_SCHEMA_URL,
        mcpServers: {
          fs: { command: "fs", args: ["--root", "."] },
          off: { command: "srv", disabled: true },
          // `enable: true` is ZCode's default, so it carries no canonical flag.
          on: { command: "srv2" },
          remote: { type: "sse", url: "https://example.com/sse" },
        },
      });
    });

    it("should yield empty servers when the config has no mcp block", () => {
      const mcp = new ZcodeMcp({
        outputRoot: testDir,
        relativeDirPath: ".zcode",
        relativeFilePath: "config.json",
        fileContent: JSON.stringify({ model: "glm-4.6" }),
      });

      expect(JSON.parse(mcp.toRulesyncMcp().getFileContent())).toEqual({
        $schema: RULESYNC_MCP_SCHEMA_URL,
        mcpServers: {},
      });
    });
  });

  describe("validate", () => {
    it("should always succeed", () => {
      const mcp = new ZcodeMcp({
        outputRoot: testDir,
        relativeDirPath: ".zcode",
        relativeFilePath: "config.json",
        fileContent: "{}",
      });

      expect(mcp.validate()).toEqual({ success: true, error: null });
    });
  });
});
