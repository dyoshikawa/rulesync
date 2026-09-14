import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { ContinueMcp } from "./continue-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

const buildRulesyncMcp = (mcpServers: Record<string, unknown>): RulesyncMcp =>
  new RulesyncMcp({
    relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
    relativeFilePath: "mcp.json",
    fileContent: JSON.stringify({ mcpServers }),
  });

const MCP_DIR = join(".continue", "mcpServers");

describe("ContinueMcp", () => {
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

  describe("getSettablePaths", () => {
    it("points to .continue/mcpServers/mcp.json in both scopes", () => {
      expect(ContinueMcp.getSettablePaths()).toEqual({
        relativeDirPath: MCP_DIR,
        relativeFilePath: "mcp.json",
      });
      expect(ContinueMcp.getSettablePaths({ global: true })).toEqual(
        ContinueMcp.getSettablePaths(),
      );
    });
  });

  describe("constructor", () => {
    it("parses JSONC content", () => {
      const mcp = new ContinueMcp({
        outputRoot: testDir,
        relativeDirPath: MCP_DIR,
        relativeFilePath: "mcp.json",
        fileContent:
          '{\n  // comment\n  "mcpServers": { "git": { "type": "stdio", "command": "git-mcp" }, },\n}',
      });

      expect(mcp.getJson()).toEqual({
        mcpServers: { git: { type: "stdio", command: "git-mcp" } },
      });
    });

    it("throws on malformed content", () => {
      expect(
        () =>
          new ContinueMcp({
            outputRoot: testDir,
            relativeDirPath: MCP_DIR,
            relativeFilePath: "mcp.json",
            fileContent: "{ not json",
          }),
      ).toThrow(/Failed to parse Continue MCP config/);
    });

    it("throws on a non-object root", () => {
      expect(
        () =>
          new ContinueMcp({
            outputRoot: testDir,
            relativeDirPath: MCP_DIR,
            relativeFilePath: "mcp.json",
            fileContent: "[]",
          }),
      ).toThrow(/expected a JSON object at the root/);
    });
  });

  describe("isDeletable", () => {
    it("is deletable in project scope and not in global scope", () => {
      const build = (global: boolean): ContinueMcp =>
        new ContinueMcp({
          outputRoot: testDir,
          relativeDirPath: MCP_DIR,
          relativeFilePath: "mcp.json",
          fileContent: "{}",
          global,
        });
      expect(build(false).isDeletable()).toBe(true);
      expect(build(true).isDeletable()).toBe(false);
    });
  });

  describe("fromRulesyncMcp", () => {
    it("emits stdio servers with the documented keys only", async () => {
      const mcp = await ContinueMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: buildRulesyncMcp({
          fs: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
            env: { HOME: "/tmp", __proto__: { polluted: true } },
            envFile: ".env",
            timeout: 30,
            targets: ["continue"],
          },
        }),
      });

      expect(mcp.getRelativeDirPath()).toBe(MCP_DIR);
      expect(mcp.getRelativeFilePath()).toBe("mcp.json");
      expect(JSON.parse(mcp.getFileContent())).toEqual({
        mcpServers: {
          fs: {
            type: "stdio",
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
            env: { HOME: "/tmp" },
            envFile: ".env",
          },
        },
      });
    });

    it("emits remote servers as http/sse and folds streamable-http into http", async () => {
      const mcp = await ContinueMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: buildRulesyncMcp({
          plain: { url: "https://example.com/mcp", headers: { Authorization: "Bearer x" } },
          sse: { type: "sse", url: "https://example.com/sse" },
          streamable: { type: "streamable-http", url: "https://example.com/stream" },
          viaTransport: { transport: "http", url: "https://example.com/http" },
        }),
      });

      expect(JSON.parse(mcp.getFileContent()).mcpServers).toEqual({
        plain: {
          type: "http",
          url: "https://example.com/mcp",
          headers: { Authorization: "Bearer x" },
        },
        sse: { type: "sse", url: "https://example.com/sse" },
        streamable: { type: "http", url: "https://example.com/stream" },
        viaTransport: { type: "http", url: "https://example.com/http" },
      });
    });

    it("warns and skips servers Continue cannot represent", async () => {
      const logger = createMockLogger();
      const mcp = await ContinueMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: buildRulesyncMcp({
          empty: {},
          noUrl: { type: "sse" },
          ws: { url: "wss://example.com/socket" },
          unknownTransport: { type: "grpc", url: "https://example.com/grpc" },
          noCommand: { type: "stdio", args: ["x"] },
          ok: { command: "ok-mcp" },
        }),
        logger,
      });

      expect(Object.keys(JSON.parse(mcp.getFileContent()).mcpServers)).toEqual(["ok"]);
      expect(logger.warn).toHaveBeenCalledTimes(5);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('skipping "ws"'));
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('skipping "unknownTransport"'),
      );
    });

    it("skips disabled servers and strips rulesync-only fields", async () => {
      const mcp = await ContinueMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: buildRulesyncMcp({
          disabled: { command: "y", enabled: false },
          forContinue: { command: "z", targets: ["continue"], enabled: true },
        }),
      });

      expect(JSON.parse(mcp.getFileContent()).mcpServers).toEqual({
        forContinue: { type: "stdio", command: "z" },
      });
    });

    it("preserves top-level sibling keys of an existing mcp.json", async () => {
      await ensureDir(join(testDir, MCP_DIR));
      await writeFileContent(
        join(testDir, MCP_DIR, "mcp.json"),
        JSON.stringify({
          name: "My servers",
          mcpServers: { stale: { type: "stdio", command: "stale" } },
        }),
      );

      const mcp = await ContinueMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: buildRulesyncMcp({ fresh: { command: "fresh" } }),
      });

      expect(JSON.parse(mcp.getFileContent())).toEqual({
        name: "My servers",
        mcpServers: { fresh: { type: "stdio", command: "fresh" } },
      });
    });

    it("throws when the existing mcp.json is malformed", async () => {
      await ensureDir(join(testDir, MCP_DIR));
      await writeFileContent(join(testDir, MCP_DIR, "mcp.json"), "{ broken");

      await expect(
        ContinueMcp.fromRulesyncMcp({
          outputRoot: testDir,
          rulesyncMcp: buildRulesyncMcp({ fresh: { command: "fresh" } }),
        }),
      ).rejects.toThrow(/Failed to parse Continue MCP config/);
    });

    it("writes the same relative path with the global flag in global mode", async () => {
      const mcp = await ContinueMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: buildRulesyncMcp({ fresh: { command: "fresh" } }),
        global: true,
      });

      expect(mcp.getRelativeDirPath()).toBe(MCP_DIR);
      expect(mcp.isDeletable()).toBe(false);
    });
  });

  describe("fromFile", () => {
    it("reads an existing mcp.json", async () => {
      await ensureDir(join(testDir, MCP_DIR));
      await writeFileContent(
        join(testDir, MCP_DIR, "mcp.json"),
        JSON.stringify({ mcpServers: { git: { type: "stdio", command: "git-mcp" } } }),
      );

      const mcp = await ContinueMcp.fromFile({ outputRoot: testDir });

      expect(mcp.getJson().mcpServers).toEqual({ git: { type: "stdio", command: "git-mcp" } });
    });

    it("falls back to an empty server map when the file is missing", async () => {
      const mcp = await ContinueMcp.fromFile({ outputRoot: testDir });

      expect(mcp.getJson()).toEqual({ mcpServers: {} });
    });
  });

  describe("toRulesyncMcp", () => {
    it("passes the documented shape through and drops prototype-pollution keys", () => {
      const mcp = new ContinueMcp({
        outputRoot: testDir,
        relativeDirPath: MCP_DIR,
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            git: { type: "stdio", command: "git-mcp", args: ["--x"], __proto__: { a: 1 } },
            remote: { type: "sse", url: "https://example.com/sse" },
            __proto__: { type: "stdio", command: "evil" },
          },
        }),
      });

      const json = JSON.parse(mcp.toRulesyncMcp().getFileContent());
      expect(json.mcpServers).toEqual({
        git: { type: "stdio", command: "git-mcp", args: ["--x"] },
        remote: { type: "sse", url: "https://example.com/sse" },
      });
    });

    it("returns an empty map when mcpServers is missing or malformed", () => {
      const mcp = new ContinueMcp({
        outputRoot: testDir,
        relativeDirPath: MCP_DIR,
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ mcpServers: "nope" }),
      });

      expect(JSON.parse(mcp.toRulesyncMcp().getFileContent()).mcpServers).toEqual({});
    });

    it("round-trips through generate and import", async () => {
      const mcp = await ContinueMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: buildRulesyncMcp({
          fs: { command: "npx", args: ["fs"] },
          remote: { type: "sse", url: "https://example.com/sse" },
        }),
      });

      const json = JSON.parse(mcp.toRulesyncMcp().getFileContent());
      expect(json.mcpServers).toEqual({
        fs: { type: "stdio", command: "npx", args: ["fs"] },
        remote: { type: "sse", url: "https://example.com/sse" },
      });
    });
  });

  describe("forDeletion", () => {
    it("creates an empty instance", () => {
      const mcp = ContinueMcp.forDeletion({
        outputRoot: testDir,
        relativeDirPath: MCP_DIR,
        relativeFilePath: "mcp.json",
      });

      expect(mcp.getJson()).toEqual({});
      expect(mcp.isDeletable()).toBe(true);
    });
  });
});
