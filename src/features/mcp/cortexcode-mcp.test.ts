import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_MCP_SCHEMA_URL,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { CortexcodeMcp } from "./cortexcode-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

const buildRulesyncMcp = (mcpServers: Record<string, unknown>): RulesyncMcp =>
  new RulesyncMcp({
    relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
    relativeFilePath: "mcp.json",
    fileContent: JSON.stringify({ mcpServers }),
  });

const GLOBAL_DIR = join(".snowflake", "cortex");

describe("CortexcodeMcp", () => {
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
    it("should point to ~/.snowflake/cortex/mcp.json", () => {
      expect(CortexcodeMcp.getSettablePaths({ global: true })).toEqual({
        relativeDirPath: GLOBAL_DIR,
        relativeFilePath: "mcp.json",
      });
    });

    it("should return the same global path when called without options", () => {
      expect(CortexcodeMcp.getSettablePaths()).toEqual(
        CortexcodeMcp.getSettablePaths({ global: true }),
      );
    });
  });

  describe("constructor", () => {
    it("should parse the JSON content", () => {
      const mcp = new CortexcodeMcp({
        outputRoot: testDir,
        relativeDirPath: GLOBAL_DIR,
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ mcpServers: { git: { type: "stdio", command: "git-mcp" } } }),
        global: true,
      });
      expect(mcp.getJson()).toEqual({ mcpServers: { git: { type: "stdio", command: "git-mcp" } } });
    });

    it("should throw when the JSON root is not an object", () => {
      expect(
        () =>
          new CortexcodeMcp({
            outputRoot: testDir,
            relativeDirPath: GLOBAL_DIR,
            relativeFilePath: "mcp.json",
            fileContent: "[]",
            global: true,
          }),
      ).toThrow("expected a JSON object at the root");
    });

    it("should throw on invalid JSON", () => {
      expect(
        () =>
          new CortexcodeMcp({
            outputRoot: testDir,
            relativeDirPath: GLOBAL_DIR,
            relativeFilePath: "mcp.json",
            fileContent: "{ not json",
            global: true,
          }),
      ).toThrow("Failed to parse Cortex Code MCP config");
    });
  });

  describe("isDeletable", () => {
    it("should never be deletable (file shared with cortex mcp add)", () => {
      const mcp = new CortexcodeMcp({
        outputRoot: testDir,
        relativeDirPath: GLOBAL_DIR,
        relativeFilePath: "mcp.json",
        fileContent: "{}",
        global: true,
      });
      expect(mcp.isDeletable()).toBe(false);
    });
  });

  describe("fromRulesyncMcp", () => {
    it("should throw in non-global mode", async () => {
      await expect(
        CortexcodeMcp.fromRulesyncMcp({ rulesyncMcp: buildRulesyncMcp({}), global: false }),
      ).rejects.toThrow("global-only");
    });

    it("should write stdio servers with an explicit type under ~/.snowflake/cortex/mcp.json", async () => {
      const rulesyncMcp = buildRulesyncMcp({
        git: { command: "npx", args: ["-y", "mcp-git"], env: { TOKEN: "x" } },
      });

      const mcp = await CortexcodeMcp.fromRulesyncMcp({ rulesyncMcp, global: true });

      expect(mcp.getOutputRoot()).toBe(testDir);
      expect(mcp.getRelativeDirPath()).toBe(GLOBAL_DIR);
      expect(mcp.getRelativeFilePath()).toBe("mcp.json");
      expect(mcp.isDeletable()).toBe(false);
      expect(JSON.parse(mcp.getFileContent())).toEqual({
        mcpServers: {
          git: { type: "stdio", command: "npx", args: ["-y", "mcp-git"], env: { TOKEN: "x" } },
        },
      });
    });

    it("should write http, streamable-http and bare-url servers as type http", async () => {
      const rulesyncMcp = buildRulesyncMcp({
        http: { type: "http", url: "https://example.com/mcp", headers: { A: "b" } },
        streamable: { type: "streamable-http", url: "https://example.com/s" },
        bare: { url: "https://example.com/bare" },
        aliased: { httpUrl: "https://example.com/alias" },
      });

      const mcp = await CortexcodeMcp.fromRulesyncMcp({ rulesyncMcp, global: true });

      expect(JSON.parse(mcp.getFileContent())).toEqual({
        mcpServers: {
          http: { type: "http", url: "https://example.com/mcp", headers: { A: "b" } },
          streamable: { type: "http", url: "https://example.com/s" },
          bare: { type: "http", url: "https://example.com/bare" },
          aliased: { type: "http", url: "https://example.com/alias" },
        },
      });
    });

    it("should keep sse servers as type sse", async () => {
      const rulesyncMcp = buildRulesyncMcp({
        events: { transport: "sse", url: "https://example.com/sse", timeout: 30000 },
      });

      const mcp = await CortexcodeMcp.fromRulesyncMcp({ rulesyncMcp, global: true });

      expect(JSON.parse(mcp.getFileContent())).toEqual({
        mcpServers: { events: { type: "sse", url: "https://example.com/sse", timeout: 30000 } },
      });
    });

    it("should normalize an array command into command and args", async () => {
      const rulesyncMcp = buildRulesyncMcp({ git: { command: ["uvx", "mcp-server-git"] } });

      const mcp = await CortexcodeMcp.fromRulesyncMcp({ rulesyncMcp, global: true });

      expect(JSON.parse(mcp.getFileContent())).toEqual({
        mcpServers: { git: { type: "stdio", command: "uvx", args: ["mcp-server-git"] } },
      });
    });

    it("should warn and skip servers Cortex Code cannot start or reach", async () => {
      const logger = createMockLogger();
      const rulesyncMcp = buildRulesyncMcp({
        none: { env: { A: "b" } },
        noUrl: { type: "http" },
        ws: { url: "wss://example.com/socket" },
        wsTyped: { type: "ws", url: "wss://example.com/socket" },
        noCommand: { type: "stdio" },
        argsOnly: { args: ["-y", "git-mcp"] },
        ok: { command: "git-mcp" },
      });

      const mcp = await CortexcodeMcp.fromRulesyncMcp({ rulesyncMcp, global: true, logger });

      expect(JSON.parse(mcp.getFileContent())).toEqual({
        mcpServers: { ok: { type: "stdio", command: "git-mcp" } },
      });
      const warnings = logger.warn.mock.calls.map(([message]) => String(message));
      expect(warnings).toHaveLength(6);
      for (const name of ["none", "noUrl", "ws", "wsTyped", "noCommand", "argsOnly"]) {
        expect(warnings.some((message) => message.includes(`"${name}"`))).toBe(true);
      }
    });

    it("should ignore prototype-pollution keys on generate", async () => {
      const rulesyncMcp = buildRulesyncMcp(
        JSON.parse(
          '{"__proto__":{"command":"evil"},"git":{"command":"git-mcp","__proto__":{"x":1}}}',
        ),
      );

      const mcp = await CortexcodeMcp.fromRulesyncMcp({ rulesyncMcp, global: true });

      const servers = JSON.parse(mcp.getFileContent()).mcpServers;
      expect(Object.keys(servers)).toEqual(["git"]);
      expect(Object.keys(servers.git)).toEqual(["type", "command"]);
    });

    it("should sanitize prototype-pollution keys inside env and headers", async () => {
      const rulesyncMcp = buildRulesyncMcp(
        JSON.parse(
          '{"git":{"command":"git-mcp","env":{"TOKEN":"x","__proto__":{"y":1}}},"api":{"url":"https://example.com/mcp","headers":{"Authorization":"Bearer t","constructor":{"z":1}}}}',
        ),
      );

      const mcp = await CortexcodeMcp.fromRulesyncMcp({ rulesyncMcp, global: true });

      const servers = JSON.parse(mcp.getFileContent()).mcpServers;
      expect(Object.keys(servers.git.env)).toEqual(["TOKEN"]);
      expect(Object.keys(servers.api.headers)).toEqual(["Authorization"]);
    });

    it("should pass through oauth and timeout", async () => {
      const rulesyncMcp = buildRulesyncMcp({
        api: {
          type: "http",
          url: "https://api.example.com/mcp",
          oauth: { client_id: "my-client-id", redirect_port: 8585, scope: "openid mcp" },
          timeout: 30000,
        },
      });

      const mcp = await CortexcodeMcp.fromRulesyncMcp({ rulesyncMcp, global: true });

      expect(JSON.parse(mcp.getFileContent()).mcpServers.api).toEqual({
        type: "http",
        url: "https://api.example.com/mcp",
        oauth: { client_id: "my-client-id", redirect_port: 8585, scope: "openid mcp" },
        timeout: 30000,
      });
    });

    it("should strip rulesync-only fields such as targets", async () => {
      const rulesyncMcp = buildRulesyncMcp({
        git: { command: "git-mcp", targets: ["cortexcode"] },
      });

      const mcp = await CortexcodeMcp.fromRulesyncMcp({ rulesyncMcp, global: true });

      expect(JSON.parse(mcp.getFileContent()).mcpServers.git).toEqual({
        type: "stdio",
        command: "git-mcp",
      });
    });

    it("should keep sibling top-level keys of an existing file", async () => {
      await ensureDir(join(testDir, GLOBAL_DIR));
      await writeFileContent(
        join(testDir, GLOBAL_DIR, "mcp.json"),
        JSON.stringify({ someOtherKey: true, mcpServers: { stale: { command: "old" } } }),
      );
      const rulesyncMcp = buildRulesyncMcp({ git: { command: "git-mcp" } });

      const mcp = await CortexcodeMcp.fromRulesyncMcp({ rulesyncMcp, global: true });

      expect(JSON.parse(mcp.getFileContent())).toEqual({
        someOtherKey: true,
        mcpServers: { git: { type: "stdio", command: "git-mcp" } },
      });
    });

    it("should throw when the existing file is not valid JSON", async () => {
      await ensureDir(join(testDir, GLOBAL_DIR));
      await writeFileContent(join(testDir, GLOBAL_DIR, "mcp.json"), "{ nope");

      await expect(
        CortexcodeMcp.fromRulesyncMcp({ rulesyncMcp: buildRulesyncMcp({}), global: true }),
      ).rejects.toThrow("Failed to parse Cortex Code MCP config");
    });

    it("should honor a custom outputRoot", async () => {
      const mcp = await CortexcodeMcp.fromRulesyncMcp({
        outputRoot: join(testDir, "custom"),
        rulesyncMcp: buildRulesyncMcp({}),
        global: true,
      });
      expect(mcp.getOutputRoot()).toBe(join(testDir, "custom"));
    });
  });

  describe("fromFile", () => {
    it("should throw in non-global mode", async () => {
      await expect(CortexcodeMcp.fromFile({ global: false })).rejects.toThrow("global-only");
    });

    it("should read ~/.snowflake/cortex/mcp.json", async () => {
      await ensureDir(join(testDir, GLOBAL_DIR));
      await writeFileContent(
        join(testDir, GLOBAL_DIR, "mcp.json"),
        JSON.stringify({ mcpServers: { git: { type: "stdio", command: "git-mcp" } } }),
      );

      const mcp = await CortexcodeMcp.fromFile({ global: true });

      expect(mcp.getRelativeDirPath()).toBe(GLOBAL_DIR);
      expect(mcp.getJson()).toEqual({ mcpServers: { git: { type: "stdio", command: "git-mcp" } } });
    });

    it("should fall back to an empty server map when the file is missing", async () => {
      const mcp = await CortexcodeMcp.fromFile({ global: true });
      expect(mcp.getJson()).toEqual({ mcpServers: {} });
    });

    it("should throw when the file is not valid JSON", async () => {
      await ensureDir(join(testDir, GLOBAL_DIR));
      await writeFileContent(join(testDir, GLOBAL_DIR, "mcp.json"), "not json");

      await expect(CortexcodeMcp.fromFile({ global: true })).rejects.toThrow(
        "Failed to parse Cortex Code MCP config",
      );
    });
  });

  describe("toRulesyncMcp", () => {
    it("should keep servers as they are and emit the rulesync schema", () => {
      const mcp = new CortexcodeMcp({
        outputRoot: testDir,
        relativeDirPath: GLOBAL_DIR,
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            git: { type: "stdio", command: "uvx", args: ["mcp-server-git"] },
            api: { type: "http", url: "https://api.example.com/mcp", oauth: { client_id: "c" } },
            events: { type: "sse", url: "https://realtime.example.com/events" },
          },
        }),
        global: true,
      });

      const rulesyncMcp = mcp.toRulesyncMcp();

      expect(rulesyncMcp.getRelativeDirPath()).toBe(RULESYNC_RELATIVE_DIR_PATH);
      expect(JSON.parse(rulesyncMcp.getFileContent())).toEqual({
        $schema: RULESYNC_MCP_SCHEMA_URL,
        mcpServers: {
          git: { type: "stdio", command: "uvx", args: ["mcp-server-git"] },
          api: { type: "http", url: "https://api.example.com/mcp", oauth: { client_id: "c" } },
          events: { type: "sse", url: "https://realtime.example.com/events" },
        },
      });
    });

    it("should ignore prototype-pollution keys on import", () => {
      const mcp = new CortexcodeMcp({
        outputRoot: testDir,
        relativeDirPath: GLOBAL_DIR,
        relativeFilePath: "mcp.json",
        fileContent:
          '{"mcpServers":{"__proto__":{"command":"evil"},"git":{"command":"git-mcp","__proto__":{"x":1}}}}',
        global: true,
      });

      const servers = JSON.parse(mcp.toRulesyncMcp().getFileContent()).mcpServers;
      expect(Object.keys(servers)).toEqual(["git"]);
      expect(Object.keys(servers.git)).toEqual(["command"]);
    });

    it("should drop sibling top-level keys and tolerate a missing server map", () => {
      const mcp = new CortexcodeMcp({
        outputRoot: testDir,
        relativeDirPath: GLOBAL_DIR,
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ someOtherKey: true }),
        global: true,
      });

      expect(JSON.parse(mcp.toRulesyncMcp().getFileContent())).toEqual({
        $schema: RULESYNC_MCP_SCHEMA_URL,
        mcpServers: {},
      });
    });

    it("should round-trip stdio, http and sse servers", async () => {
      const servers = {
        git: { command: "git-mcp", args: ["--repo", "."] },
        api: { type: "http", url: "https://api.example.com/mcp", headers: { A: "b" } },
        events: { type: "sse", url: "https://realtime.example.com/events" },
      };
      const generated = await CortexcodeMcp.fromRulesyncMcp({
        rulesyncMcp: buildRulesyncMcp(servers),
        global: true,
      });

      const imported = JSON.parse(generated.toRulesyncMcp().getFileContent()).mcpServers;

      expect(imported).toEqual({
        git: { type: "stdio", command: "git-mcp", args: ["--repo", "."] },
        api: servers.api,
        events: servers.events,
      });
    });
  });

  describe("validate", () => {
    it("should always return success", () => {
      const mcp = new CortexcodeMcp({
        outputRoot: testDir,
        relativeDirPath: GLOBAL_DIR,
        relativeFilePath: "mcp.json",
        fileContent: "{}",
        global: true,
      });
      expect(mcp.validate()).toEqual({ success: true, error: null });
    });
  });

  describe("forDeletion", () => {
    it("should create an instance with empty content", () => {
      const mcp = CortexcodeMcp.forDeletion({
        relativeDirPath: GLOBAL_DIR,
        relativeFilePath: "mcp.json",
        global: true,
      });
      expect(mcp.getFileContent()).toBe("{}");
      expect(mcp.isDeletable()).toBe(false);
    });
  });
});
