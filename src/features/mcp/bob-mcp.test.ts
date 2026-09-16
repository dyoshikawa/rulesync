import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_MCP_SCHEMA_URL,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { BobMcp } from "./bob-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

const buildRulesyncMcp = (mcpServers: Record<string, unknown>): RulesyncMcp =>
  new RulesyncMcp({
    relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
    relativeFilePath: "mcp.json",
    fileContent: JSON.stringify({ mcpServers }),
  });

describe("BobMcp", () => {
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
    it("should return .bob/mcp.json for project scope", () => {
      const paths = BobMcp.getSettablePaths();

      expect(paths.relativeDirPath).toBe(".bob");
      expect(paths.relativeFilePath).toBe("mcp.json");
    });

    it("should return .bob/mcp.json for global scope as well", () => {
      const paths = BobMcp.getSettablePaths({ global: true });

      expect(paths.relativeDirPath).toBe(".bob");
      expect(paths.relativeFilePath).toBe("mcp.json");
    });
  });

  describe("constructor", () => {
    it("should parse the JSON content", () => {
      const content = JSON.stringify({ mcpServers: { git: { command: "git-mcp" } } });

      const bobMcp = new BobMcp({
        relativeDirPath: ".bob",
        relativeFilePath: "mcp.json",
        fileContent: content,
      });

      expect(bobMcp).toBeInstanceOf(BobMcp);
      expect(bobMcp.getJson()).toEqual({ mcpServers: { git: { command: "git-mcp" } } });
      expect(bobMcp.getFileContent()).toBe(content);
    });

    it("should throw when the JSON root is not an object", () => {
      for (const fileContent of ["null", "[]", '"text"']) {
        expect(() => {
          return new BobMcp({
            relativeDirPath: ".bob",
            relativeFilePath: "mcp.json",
            fileContent,
          });
        }).toThrow(/expected a JSON object at the root/);
      }
    });

    it("should throw on invalid JSON", () => {
      expect(() => {
        return new BobMcp({
          relativeDirPath: ".bob",
          relativeFilePath: "mcp.json",
          fileContent: "{ not json",
        });
      }).toThrow(/Failed to parse Bob MCP config/);
    });
  });

  describe("isDeletable", () => {
    it("should be deletable in project scope", () => {
      const bobMcp = new BobMcp({
        relativeDirPath: ".bob",
        relativeFilePath: "mcp.json",
        fileContent: "{}",
      });

      expect(bobMcp.isDeletable()).toBe(true);
    });

    it("should not be deletable in global scope", () => {
      const bobMcp = new BobMcp({
        relativeDirPath: ".bob",
        relativeFilePath: "mcp.json",
        fileContent: "{}",
        global: true,
      });

      expect(bobMcp.isDeletable()).toBe(false);
    });
  });

  describe("fromRulesyncMcp", () => {
    it("should write stdio servers as-is under .bob/mcp.json", async () => {
      const rulesyncMcp = buildRulesyncMcp({
        git: { command: "npx", args: ["-y", "mcp-git"], env: { TOKEN: "x" }, cwd: "/repo" },
      });

      const bobMcp = await BobMcp.fromRulesyncMcp({ rulesyncMcp });

      expect(bobMcp.getOutputRoot()).toBe(testDir);
      expect(bobMcp.getRelativeDirPath()).toBe(".bob");
      expect(bobMcp.getRelativeFilePath()).toBe("mcp.json");
      expect(JSON.parse(bobMcp.getFileContent())).toEqual({
        mcpServers: {
          git: { command: "npx", args: ["-y", "mcp-git"], env: { TOKEN: "x" }, cwd: "/repo" },
        },
      });
    });

    it("should write sse servers as a bare url without a type key", async () => {
      const rulesyncMcp = buildRulesyncMcp({
        events: { type: "sse", url: "https://example.com/sse", headers: { A: "b" } },
      });

      const bobMcp = await BobMcp.fromRulesyncMcp({ rulesyncMcp });

      expect(JSON.parse(bobMcp.getFileContent())).toEqual({
        mcpServers: { events: { url: "https://example.com/sse", headers: { A: "b" } } },
      });
    });

    it("should write http and streamable-http servers as type streamable-http", async () => {
      const rulesyncMcp = buildRulesyncMcp({
        http: { type: "http", url: "https://example.com/mcp", headers: { A: "b" } },
        streamable: { transport: "streamable-http", url: "https://example.com/stream" },
        bare: { url: "https://example.com/bare" },
        alias: { httpUrl: "https://example.com/alias" },
      });

      const bobMcp = await BobMcp.fromRulesyncMcp({ rulesyncMcp });

      expect(JSON.parse(bobMcp.getFileContent())).toEqual({
        mcpServers: {
          http: { type: "streamable-http", url: "https://example.com/mcp", headers: { A: "b" } },
          streamable: { type: "streamable-http", url: "https://example.com/stream" },
          bare: { type: "streamable-http", url: "https://example.com/bare" },
          alias: { type: "streamable-http", url: "https://example.com/alias" },
        },
      });
    });

    it("should drop an explicit stdio type key, which Bob does not use", async () => {
      const rulesyncMcp = buildRulesyncMcp({
        git: { type: "stdio", command: "git-mcp", args: ["x"] },
      });

      const bobMcp = await BobMcp.fromRulesyncMcp({ rulesyncMcp });

      expect(JSON.parse(bobMcp.getFileContent()).mcpServers.git).toEqual({
        command: "git-mcp",
        args: ["x"],
      });
    });

    it("should normalize an array command into command and args", async () => {
      const rulesyncMcp = buildRulesyncMcp({
        git: { command: ["npx", "-y"], args: ["mcp-git"] },
      });

      const bobMcp = await BobMcp.fromRulesyncMcp({ rulesyncMcp });

      expect(JSON.parse(bobMcp.getFileContent()).mcpServers.git).toEqual({
        command: "npx",
        args: ["-y", "mcp-git"],
      });
    });

    it("should warn and skip servers Bob cannot start or reach", async () => {
      const logger = createMockLogger();
      const rulesyncMcp = buildRulesyncMcp({
        none: { env: { A: "b" } },
        noUrl: { type: "http" },
        ws: { url: "wss://example.com/socket" },
        wsTyped: { type: "ws", url: "wss://example.com/socket" },
        noCommand: { type: "stdio" },
        argsOnly: { type: "stdio", args: ["-y", "git-mcp"] },
        ok: { command: "git-mcp" },
      });

      const bobMcp = await BobMcp.fromRulesyncMcp({ rulesyncMcp, logger });

      expect(JSON.parse(bobMcp.getFileContent())).toEqual({
        mcpServers: { ok: { command: "git-mcp" } },
      });
      const warnings = logger.warn.mock.calls.map(([message]) => String(message));
      expect(warnings).toHaveLength(6);
      for (const name of ["none", "noUrl", "ws", "wsTyped", "noCommand", "argsOnly"]) {
        expect(warnings.some((message) => message.includes(`"${name}"`))).toBe(true);
      }
      // `argsOnly` names a transport, so it must be refused for lacking a
      // command rather than folded into the "no transport" path.
      expect(warnings).toContainEqual(
        expect.stringContaining(
          'skipping "argsOnly" because it declares a stdio transport without a command',
        ),
      );
    });

    it("should ignore prototype-pollution keys on generate", async () => {
      const rulesyncMcp = buildRulesyncMcp(
        JSON.parse(
          '{"__proto__":{"command":"evil"},"git":{"command":"git-mcp","__proto__":{"x":1}}}',
        ),
      );

      const bobMcp = await BobMcp.fromRulesyncMcp({ rulesyncMcp });

      const servers = JSON.parse(bobMcp.getFileContent()).mcpServers;
      expect(Object.keys(servers)).toEqual(["git"]);
      expect(Object.keys(servers.git)).toEqual(["command"]);
    });

    it("should sanitize prototype-pollution keys inside env and headers", async () => {
      const rulesyncMcp = buildRulesyncMcp(
        JSON.parse(
          '{"git":{"command":"git-mcp","env":{"TOKEN":"x","__proto__":{"y":1}}},"api":{"url":"https://example.com/mcp","headers":{"Authorization":"Bearer t","constructor":{"z":1}}}}',
        ),
      );

      const bobMcp = await BobMcp.fromRulesyncMcp({ rulesyncMcp });

      const servers = JSON.parse(bobMcp.getFileContent()).mcpServers;
      expect(Object.keys(servers.git.env)).toEqual(["TOKEN"]);
      expect(Object.keys(servers.api.headers)).toEqual(["Authorization"]);
    });

    it("should pass through Bob-specific keys", async () => {
      const rulesyncMcp = buildRulesyncMcp({
        git: { command: "git-mcp", timeout: 60, alwaysAllow: ["status"], disabled: true },
      });

      const bobMcp = await BobMcp.fromRulesyncMcp({ rulesyncMcp });

      expect(JSON.parse(bobMcp.getFileContent()).mcpServers.git).toEqual({
        command: "git-mcp",
        timeout: 60,
        alwaysAllow: ["status"],
        disabled: true,
      });
    });

    it("should flatten the canonical oauth object onto Bob's oauth keys (issue #3074)", async () => {
      const rulesyncMcp = buildRulesyncMcp({
        remote: {
          type: "http",
          url: "https://example.com/mcp",
          oauth: { clientId: "abc", clientSecret: "shh", scope: "read write", callbackPort: 3000 },
        },
      });

      const bobMcp = await BobMcp.fromRulesyncMcp({ rulesyncMcp });

      expect(JSON.parse(bobMcp.getFileContent()).mcpServers.remote).toEqual({
        type: "streamable-http",
        url: "https://example.com/mcp",
        oauth: true,
        clientId: "abc",
        clientSecret: "shh",
        scope: "read write",
      });
    });

    it("should keep a flat Bob-style oauth key over the nested one and pass a boolean oauth through", async () => {
      const rulesyncMcp = buildRulesyncMcp({
        flat: {
          url: "https://example.com/mcp",
          clientId: "bob-authored",
          oauth: { clientId: "nested", scope: 42 },
        },
        off: { url: "https://example.com/other", oauth: false },
      });

      const bobMcp = await BobMcp.fromRulesyncMcp({ rulesyncMcp });

      const servers = JSON.parse(bobMcp.getFileContent()).mcpServers;
      expect(servers.flat).toEqual({
        type: "streamable-http",
        url: "https://example.com/mcp",
        oauth: true,
        clientId: "bob-authored",
      });
      expect(servers.off).toEqual({
        type: "streamable-http",
        url: "https://example.com/other",
        oauth: false,
      });
    });

    it("should strip rulesync-only fields such as targets", async () => {
      const rulesyncMcp = buildRulesyncMcp({
        git: { command: "git-mcp", targets: ["bob"] },
      });

      const bobMcp = await BobMcp.fromRulesyncMcp({ rulesyncMcp });

      expect(JSON.parse(bobMcp.getFileContent()).mcpServers.git).toEqual({ command: "git-mcp" });
    });

    it("should keep sibling top-level keys of an existing file", async () => {
      await ensureDir(join(testDir, ".bob"));
      await writeFileContent(
        join(testDir, ".bob", "mcp.json"),
        JSON.stringify({ other: { keep: true }, mcpServers: { old: { command: "old" } } }),
      );
      const rulesyncMcp = buildRulesyncMcp({ git: { command: "git-mcp" } });

      const bobMcp = await BobMcp.fromRulesyncMcp({ rulesyncMcp });

      expect(JSON.parse(bobMcp.getFileContent())).toEqual({
        other: { keep: true },
        mcpServers: { git: { command: "git-mcp" } },
      });
    });

    it("should throw when the existing file is not valid JSON", async () => {
      await ensureDir(join(testDir, ".bob"));
      await writeFileContent(join(testDir, ".bob", "mcp.json"), "{ nope");
      const rulesyncMcp = buildRulesyncMcp({});

      await expect(BobMcp.fromRulesyncMcp({ rulesyncMcp })).rejects.toThrow(
        /Failed to parse Bob MCP config/,
      );
    });

    it("should write a non-deletable .bob/mcp.json in global scope", async () => {
      const rulesyncMcp = buildRulesyncMcp({ git: { command: "git-mcp" } });

      const bobMcp = await BobMcp.fromRulesyncMcp({ rulesyncMcp, global: true });

      expect(bobMcp.getRelativeDirPath()).toBe(".bob");
      expect(bobMcp.getRelativeFilePath()).toBe("mcp.json");
      expect(bobMcp.isDeletable()).toBe(false);
    });

    it("should honor a custom outputRoot", async () => {
      const rulesyncMcp = buildRulesyncMcp({});

      const bobMcp = await BobMcp.fromRulesyncMcp({ outputRoot: "/custom/base", rulesyncMcp });

      expect(bobMcp.getFilePath()).toBe(join("/custom/base", ".bob", "mcp.json"));
    });
  });

  describe("fromFile", () => {
    it("should read .bob/mcp.json", async () => {
      await ensureDir(join(testDir, ".bob"));
      await writeFileContent(
        join(testDir, ".bob", "mcp.json"),
        JSON.stringify({ mcpServers: { git: { command: "git-mcp" } } }),
      );

      const bobMcp = await BobMcp.fromFile({});

      expect(bobMcp.getRelativeDirPath()).toBe(".bob");
      expect(bobMcp.getRelativeFilePath()).toBe("mcp.json");
      expect(bobMcp.getJson()).toEqual({ mcpServers: { git: { command: "git-mcp" } } });
    });

    it("should fall back to an empty server map when the file is missing", async () => {
      const bobMcp = await BobMcp.fromFile({});

      expect(bobMcp.getJson()).toEqual({ mcpServers: {} });
    });

    it("should read ~/.bob/mcp.json in global scope", async () => {
      await ensureDir(join(testDir, ".bob"));
      await writeFileContent(
        join(testDir, ".bob", "mcp.json"),
        JSON.stringify({ mcpServers: { git: { command: "git-mcp" } } }),
      );

      const bobMcp = await BobMcp.fromFile({ global: true });

      expect(bobMcp.getRelativeFilePath()).toBe("mcp.json");
      expect(bobMcp.getJson()).toEqual({ mcpServers: { git: { command: "git-mcp" } } });
    });

    it("should throw when the file is not valid JSON", async () => {
      await ensureDir(join(testDir, ".bob"));
      await writeFileContent(join(testDir, ".bob", "mcp.json"), "{ nope");

      await expect(BobMcp.fromFile({})).rejects.toThrow(/Failed to parse Bob MCP config/);
    });
  });

  describe("toRulesyncMcp", () => {
    it("should keep stdio servers and emit the rulesync schema", () => {
      const bobMcp = new BobMcp({
        outputRoot: testDir,
        relativeDirPath: ".bob",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ mcpServers: { git: { command: "git-mcp", args: ["x"] } } }),
      });

      const rulesyncMcp = bobMcp.toRulesyncMcp();

      expect(rulesyncMcp).toBeInstanceOf(RulesyncMcp);
      expect(rulesyncMcp.getRelativeDirPath()).toBe(RULESYNC_RELATIVE_DIR_PATH);
      expect(rulesyncMcp.getRelativeFilePath()).toBe("mcp.jsonc");
      expect(JSON.parse(rulesyncMcp.getFileContent())).toEqual({
        $schema: RULESYNC_MCP_SCHEMA_URL,
        mcpServers: { git: { command: "git-mcp", args: ["x"] } },
      });
    });

    it("should keep Bob IDE streamable-http and sse entries as they are", () => {
      const bobMcp = new BobMcp({
        relativeDirPath: ".bob",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            remote: { type: "streamable-http", url: "https://example.com/mcp" },
            events: { type: "sse", url: "https://example.com/sse" },
          },
        }),
      });

      expect(bobMcp.toRulesyncMcp().getMcpServers()).toEqual({
        remote: { type: "streamable-http", url: "https://example.com/mcp" },
        events: { type: "sse", url: "https://example.com/sse" },
      });
    });

    it("should ignore prototype-pollution keys on import", () => {
      const bobMcp = new BobMcp({
        relativeDirPath: ".bob",
        relativeFilePath: "mcp.json",
        fileContent:
          '{"mcpServers":{"__proto__":{"command":"evil"},"git":{"command":"git-mcp","constructor":{"x":1}}}}',
      });

      const servers = bobMcp.toRulesyncMcp().getMcpServers();
      expect(Object.keys(servers)).toEqual(["git"]);
      expect(Object.keys(servers.git ?? {})).toEqual(["command"]);
    });

    it("should map Bob Shell httpURL to url with type http", () => {
      const bobMcp = new BobMcp({
        relativeDirPath: ".bob",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: { remote: { httpURL: "https://example.com/mcp", headers: { A: "b" } } },
        }),
      });

      expect(bobMcp.toRulesyncMcp().getMcpServers()).toEqual({
        remote: { url: "https://example.com/mcp", headers: { A: "b" }, type: "http" },
      });
    });

    it("should mark a plain url as sse", () => {
      const bobMcp = new BobMcp({
        relativeDirPath: ".bob",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: { events: { url: "https://example.com/sse" } },
        }),
      });

      expect(bobMcp.toRulesyncMcp().getMcpServers()).toEqual({
        events: { url: "https://example.com/sse", type: "sse" },
      });
    });

    it("should drop sibling top-level keys and tolerate a missing server map", () => {
      const bobMcp = new BobMcp({
        relativeDirPath: ".bob",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ other: true }),
      });

      expect(JSON.parse(bobMcp.toRulesyncMcp().getFileContent())).toEqual({
        $schema: RULESYNC_MCP_SCHEMA_URL,
        mcpServers: {},
      });
    });

    it("should round-trip http and sse servers", async () => {
      const original = buildRulesyncMcp({
        http: { type: "http", url: "https://example.com/mcp" },
        sse: { type: "sse", url: "https://example.com/sse" },
        stdio: { command: "git-mcp" },
      });

      const bobMcp = await BobMcp.fromRulesyncMcp({ rulesyncMcp: original });
      const restored = bobMcp.toRulesyncMcp();

      expect(restored.getMcpServers()).toEqual({
        http: { type: "streamable-http", url: "https://example.com/mcp" },
        sse: { url: "https://example.com/sse", type: "sse" },
        stdio: { command: "git-mcp" },
      });
    });

    it("should gather Bob's flat oauth keys into the canonical oauth object (issue #3074)", () => {
      const bobMcp = new BobMcp({
        outputRoot: testDir,
        relativeDirPath: ".bob",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            explicit: {
              type: "streamable-http",
              url: "https://example.com/mcp",
              oauth: true,
              clientId: "abc",
              clientSecret: "shh",
              scope: "read",
            },
            detected: { type: "streamable-http", url: "https://example.com/d", clientId: "abc" },
            bare: { type: "streamable-http", url: "https://example.com/b", oauth: true },
            off: {
              type: "streamable-http",
              url: "https://example.com/o",
              oauth: false,
              clientId: "x",
            },
          },
        }),
      });

      expect(bobMcp.toRulesyncMcp().getMcpServers()).toEqual({
        explicit: {
          type: "streamable-http",
          url: "https://example.com/mcp",
          oauth: { clientId: "abc", clientSecret: "shh", scope: "read" },
        },
        detected: {
          type: "streamable-http",
          url: "https://example.com/d",
          oauth: { clientId: "abc" },
        },
        bare: { type: "streamable-http", url: "https://example.com/b", oauth: {} },
        off: { type: "streamable-http", url: "https://example.com/o", oauth: false, clientId: "x" },
      });
    });

    it("should round-trip an oauth server", async () => {
      const original = buildRulesyncMcp({
        remote: {
          type: "http",
          url: "https://example.com/mcp",
          oauth: { clientId: "abc", scope: "read" },
        },
      });

      const bobMcp = await BobMcp.fromRulesyncMcp({ rulesyncMcp: original });
      const restored = bobMcp.toRulesyncMcp();

      expect(restored.getMcpServers()).toEqual({
        remote: {
          type: "streamable-http",
          url: "https://example.com/mcp",
          oauth: { clientId: "abc", scope: "read" },
        },
      });
    });
  });

  describe("validate", () => {
    it("should always return success", () => {
      const bobMcp = new BobMcp({
        relativeDirPath: ".bob",
        relativeFilePath: "mcp.json",
        fileContent: "{}",
      });

      expect(bobMcp.validate()).toEqual({ success: true, error: null });
    });
  });

  describe("forDeletion", () => {
    it("should create an instance with empty content", () => {
      const bobMcp = BobMcp.forDeletion({
        relativeDirPath: ".bob",
        relativeFilePath: "mcp.json",
      });

      expect(bobMcp.getFileContent()).toBe("{}");
      expect(bobMcp.getJson()).toEqual({});
    });
  });
});
