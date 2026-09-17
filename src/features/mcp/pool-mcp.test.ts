import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_MCP_SCHEMA_URL } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { readFileContent, writeFileContent } from "../../utils/file.js";
import { PoolMcp } from "./pool-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

const serversOf = (mcp: PoolMcp): unknown => mcp.getSettings().mcp_servers;

describe("PoolMcp", () => {
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

  const projectSettingsPath = () => join(testDir, ".poolside", "settings.yaml");

  const buildRulesyncMcp = (mcpServers: Record<string, unknown>): RulesyncMcp =>
    new RulesyncMcp({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: ".mcp.json",
      fileContent: JSON.stringify({ mcpServers }),
    });

  describe("getSettablePaths", () => {
    it("should point to .poolside/settings.yaml in project mode", () => {
      expect(PoolMcp.getSettablePaths()).toEqual({
        relativeDirPath: ".poolside",
        relativeFilePath: "settings.yaml",
      });
    });

    it("should point to .config/poolside/settings.yaml in global mode", () => {
      expect(PoolMcp.getSettablePaths({ global: true })).toEqual({
        relativeDirPath: join(".config", "poolside"),
        relativeFilePath: "settings.yaml",
      });
    });
  });

  describe("isDeletable", () => {
    it("should never be deletable (the user's primary Pool settings)", () => {
      const mcp = new PoolMcp({
        outputRoot: testDir,
        relativeDirPath: ".poolside",
        relativeFilePath: "settings.yaml",
        fileContent: "",
      });

      expect(mcp.isDeletable()).toBe(false);
    });
  });

  describe("fromRulesyncMcp", () => {
    it("should convert stdio servers to command/args/cwd/env", async () => {
      const mcp = await PoolMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: buildRulesyncMcp({
          fs: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
            cwd: "./packages/api",
            env: { TOKEN: "x" },
          },
          bare: { command: ["uvx", "mcp-server-git"] },
        }),
      });

      expect(serversOf(mcp)).toEqual({
        fs: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
          cwd: "./packages/api",
          env: { TOKEN: "x" },
        },
        bare: { command: "uvx", args: ["mcp-server-git"] },
      });
      expect(mcp.getFileContent()).toContain("mcp_servers:");
      expect(mcp.getFileContent()).toContain("command: npx");
    });

    it("should convert remote servers to Pool's transport block with a headers list", async () => {
      const mcp = await PoolMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: buildRulesyncMcp({
          http: {
            type: "http",
            url: "https://example.com/mcp",
            headers: { Authorization: "Bearer abc", "X-Trace": "1" },
            env: { API_KEY: "k" },
          },
          streamable: { type: "streamable-http", url: "https://example.com/stream" },
          sse: { transport: "sse", url: "https://example.com/sse" },
          "bare-url": { url: "https://example.com/bare" },
          "http-url-alias": { httpUrl: "https://example.com/alias" },
        }),
      });

      expect(serversOf(mcp)).toEqual({
        http: {
          transport: {
            type: "http",
            url: "https://example.com/mcp",
            headers: ["Authorization: Bearer abc", "X-Trace: 1"],
          },
          env: { API_KEY: "k" },
        },
        streamable: { transport: { type: "http", url: "https://example.com/stream" } },
        sse: { transport: { type: "sse", url: "https://example.com/sse" } },
        "bare-url": { transport: { type: "http", url: "https://example.com/bare" } },
        "http-url-alias": { transport: { type: "http", url: "https://example.com/alias" } },
      });
    });

    it("should map tool filters and disabled onto Pool's own switches", async () => {
      const mcp = await PoolMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: buildRulesyncMcp({
          filtered: {
            command: "srv",
            enabledTools: ["read_file", "list_dir"],
            disabledTools: ["delete_*"],
            allow: ["read_*"],
            disabled: true,
          },
          "empty-filters": { command: "srv", enabledTools: [], disabledTools: [], allow: [] },
          "bad-allow": { command: "srv", allow: "read_*" },
        }),
      });

      expect(serversOf(mcp)).toEqual({
        filtered: {
          command: "srv",
          args: [],
          enabled_tools: ["read_file", "list_dir"],
          allow: ["read_*"],
          deny: ["delete_*"],
          disabled: true,
        },
        "empty-filters": { command: "srv", args: [] },
        "bad-allow": { command: "srv", args: [] },
      });
    });

    it("should warn-and-skip servers Pool cannot run", async () => {
      const logger = createMockLogger();
      const mcp = await PoolMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: buildRulesyncMcp({
          socket: { type: "ws", url: "wss://example.com/ws" },
          "bare-ws-url": { url: "ws://example.com/ws" },
          "no-transport": { disabledTools: ["x"] },
          "remote-no-url": { type: "http" },
          "stdio-no-command": { command: "" },
          "stdio-args-only": { type: "stdio", args: ["-y", "git-mcp"] },
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
        "stdio-args-only",
      ]) {
        expect(
          logger.warn.mock.calls.some(
            ([message]) => typeof message === "string" && message.includes(`"${serverName}"`),
          ),
        ).toBe(true);
      }
    });

    it("should preserve unrelated top-level keys and replace the whole mcp_servers block", async () => {
      await writeFileContent(
        projectSettingsPath(),
        [
          "model: claude-opus-5",
          "permissions:",
          "  allow:",
          "    - Bash(git status)",
          "mcp_servers:",
          "  old:",
          "    command: old",
          "",
        ].join("\n"),
      );

      const mcp = await PoolMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: buildRulesyncMcp({ fs: { command: "fs" } }),
      });

      const settings = mcp.getSettings();
      expect(settings.model).toBe("claude-opus-5");
      expect(settings.permissions).toEqual({ allow: ["Bash(git status)"] });
      expect(settings.mcp_servers).toEqual({ fs: { command: "fs", args: [] } });
    });

    it("should write to .config/poolside/settings.yaml in global mode", async () => {
      const mcp = await PoolMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: buildRulesyncMcp({ fs: { command: "fs" } }),
        global: true,
      });

      expect(mcp.getRelativeDirPath()).toBe(join(".config", "poolside"));
      expect(mcp.getRelativeFilePath()).toBe("settings.yaml");
      expect(serversOf(mcp)).toEqual({ fs: { command: "fs", args: [] } });
    });

    it("should fail closed on an unparseable existing settings file", async () => {
      await writeFileContent(projectSettingsPath(), "- just\n- a list\n");

      await expect(
        PoolMcp.fromRulesyncMcp({
          outputRoot: testDir,
          rulesyncMcp: buildRulesyncMcp({ fs: { command: "fs" } }),
        }),
      ).rejects.toThrow();
    });
  });

  describe("fromFile", () => {
    it("should read an existing settings file", async () => {
      await writeFileContent(projectSettingsPath(), "mcp_servers:\n  fs:\n    command: fs\n");

      const mcp = await PoolMcp.fromFile({ outputRoot: testDir });
      expect(serversOf(mcp)).toEqual({ fs: { command: "fs" } });
    });

    it("should default to an empty document when the file is missing", async () => {
      const mcp = await PoolMcp.fromFile({ outputRoot: testDir });
      expect(mcp.getSettings()).toEqual({});
    });

    it("should read the global settings from .config/poolside/", async () => {
      await writeFileContent(
        join(testDir, ".config", "poolside", "settings.yaml"),
        "mcp_servers:\n  global:\n    command: g\n",
      );

      const mcp = await PoolMcp.fromFile({ outputRoot: testDir, global: true });
      expect(serversOf(mcp)).toEqual({ global: { command: "g" } });
    });
  });

  describe("toRulesyncMcp", () => {
    it("should convert back to canonical servers without leaking Pool's own keys", () => {
      const mcp = new PoolMcp({
        outputRoot: testDir,
        relativeDirPath: ".poolside",
        relativeFilePath: "settings.yaml",
        fileContent: [
          "model: claude-opus-5",
          "mcp_servers:",
          "  fs:",
          "    command: fs",
          "    args: ['--root', '.']",
          "    cwd: ./api",
          "    env:",
          "      TOKEN: x",
          "    enabled_tools: [read_file]",
          "    allow: ['read_*']",
          "    deny: ['delete_*']",
          "    disabled: true",
          "  remote:",
          "    transport:",
          "      type: sse",
          "      url: https://example.com/sse",
          "      headers:",
          "        - 'Authorization: Bearer abc'",
          "        - 'X-Trace:1'",
          "        - not-a-header",
          "        - ': empty-name'",
          "",
        ].join("\n"),
      });

      expect(JSON.parse(mcp.toRulesyncMcp().getFileContent())).toEqual({
        $schema: RULESYNC_MCP_SCHEMA_URL,
        mcpServers: {
          fs: {
            command: "fs",
            args: ["--root", "."],
            cwd: "./api",
            env: { TOKEN: "x" },
            enabledTools: ["read_file"],
            allow: ["read_*"],
            disabledTools: ["delete_*"],
            disabled: true,
          },
          remote: {
            type: "sse",
            url: "https://example.com/sse",
            headers: { Authorization: "Bearer abc", "X-Trace": "1" },
          },
        },
      });
    });

    it("should yield empty servers when the settings have no mcp_servers block", () => {
      const mcp = new PoolMcp({
        outputRoot: testDir,
        relativeDirPath: ".poolside",
        relativeFilePath: "settings.yaml",
        fileContent: "model: claude-opus-5\n",
      });

      expect(JSON.parse(mcp.toRulesyncMcp().getFileContent())).toEqual({
        $schema: RULESYNC_MCP_SCHEMA_URL,
        mcpServers: {},
      });
    });

    it("should round-trip a generated settings file", async () => {
      const servers = {
        fs: { command: "fs", args: ["."], enabledTools: ["read_file"] },
        remote: {
          type: "http",
          url: "https://example.com/mcp",
          headers: { Authorization: "Bearer abc" },
        },
      };
      const generated = await PoolMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: buildRulesyncMcp(servers),
      });
      await writeFileContent(projectSettingsPath(), generated.getFileContent());

      const imported = await PoolMcp.fromFile({ outputRoot: testDir });
      expect(JSON.parse(imported.toRulesyncMcp().getFileContent()).mcpServers).toEqual(servers);
      expect(await readFileContent(projectSettingsPath())).toContain("Authorization: Bearer abc");
    });
  });

  describe("validate", () => {
    it("should always succeed", () => {
      const mcp = new PoolMcp({
        outputRoot: testDir,
        relativeDirPath: ".poolside",
        relativeFilePath: "settings.yaml",
        fileContent: "",
      });

      expect(mcp.validate()).toEqual({ success: true, error: null });
    });
  });

  describe("forDeletion", () => {
    it("should build a well-formed, non-deletable instance", () => {
      const mcp = PoolMcp.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".poolside",
        relativeFilePath: "settings.yaml",
      });

      expect(mcp.isDeletable()).toBe(false);
      expect(mcp.getSettings()).toEqual({});
    });
  });
});
