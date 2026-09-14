import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_MCP_SCHEMA_URL,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { ClaudecodeMcp } from "./claudecode-mcp.js";
import { CommandcodeMcp } from "./commandcode-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

const buildRulesyncMcp = (mcpServers: Record<string, unknown>): RulesyncMcp =>
  new RulesyncMcp({
    relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
    relativeFilePath: "mcp.json",
    fileContent: JSON.stringify({ mcpServers }),
  });

const GLOBAL_DIR = ".commandcode";

describe("CommandcodeMcp", () => {
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
    it("should point to .mcp.json at the project root in project mode", () => {
      expect(CommandcodeMcp.getSettablePaths()).toEqual({
        relativeDirPath: ".",
        relativeFilePath: ".mcp.json",
      });
    });

    it("should point to ~/.commandcode/mcp.json in global mode", () => {
      expect(CommandcodeMcp.getSettablePaths({ global: true })).toEqual({
        relativeDirPath: GLOBAL_DIR,
        relativeFilePath: "mcp.json",
      });
    });
  });

  describe("constructor", () => {
    it("should parse the JSON content", () => {
      const mcp = new CommandcodeMcp({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({
          mcpServers: { git: { transport: "stdio", command: "git-mcp" } },
        }),
      });
      expect(mcp.getJson()).toEqual({
        mcpServers: { git: { transport: "stdio", command: "git-mcp" } },
      });
    });

    it("should accept JSONC comments in a hand-written file", () => {
      const mcp = new CommandcodeMcp({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".mcp.json",
        fileContent: '{ // shared with other agents\n "mcpServers": {} }',
      });
      expect(mcp.getJson()).toEqual({ mcpServers: {} });
    });

    it("should throw when the JSON root is not an object", () => {
      expect(
        () =>
          new CommandcodeMcp({
            outputRoot: testDir,
            relativeDirPath: ".",
            relativeFilePath: ".mcp.json",
            fileContent: "[]",
          }),
      ).toThrow("expected a JSON object at the root");
    });

    it("should throw on invalid JSON", () => {
      expect(
        () =>
          new CommandcodeMcp({
            outputRoot: testDir,
            relativeDirPath: ".",
            relativeFilePath: ".mcp.json",
            fileContent: "{ nope",
          }),
      ).toThrow("Failed to parse Command Code MCP config");
    });
  });

  describe("isDeletable", () => {
    it("should be deletable in project mode and not in global mode", () => {
      const build = (global: boolean) =>
        new CommandcodeMcp({
          outputRoot: testDir,
          relativeDirPath: global ? GLOBAL_DIR : ".",
          relativeFilePath: global ? "mcp.json" : ".mcp.json",
          fileContent: "{}",
          global,
        });
      expect(build(false).isDeletable()).toBe(true);
      expect(build(true).isDeletable()).toBe(false);
    });
  });

  describe("fromRulesyncMcp", () => {
    // Servers spanning every shape the project file may carry; `.mcp.json` is
    // shared with the `claudecode` target, so these must come out untouched.
    const sharedProjectServers = {
      git: { command: "npx", args: ["-y", "mcp-git"], env: { TOKEN: "x" } },
      http: { type: "http", url: "https://example.com/mcp", headers: { A: "b" } },
      streamable: { transport: "streamable-http", url: "https://example.com/s" },
      bare: { url: "https://example.com/bare", disabled: true },
      events: { type: "sse", url: "https://example.com/sse", timeout: 30000 },
      scoped: { command: "git-mcp", targets: ["commandcode"] },
    };

    it("should write servers pass-through to .mcp.json in project mode", async () => {
      const rulesyncMcp = buildRulesyncMcp(sharedProjectServers);

      const mcp = await CommandcodeMcp.fromRulesyncMcp({ rulesyncMcp });

      expect(mcp.getOutputRoot()).toBe(testDir);
      expect(mcp.getRelativeDirPath()).toBe(".");
      expect(mcp.getRelativeFilePath()).toBe(".mcp.json");
      // No `transport` / `enabled` rewrite: Command Code reads `type`, a bare
      // `url` and `disabled` from the shared file as they are. Only the
      // rulesync-only `targets` field is stripped.
      expect(JSON.parse(mcp.getFileContent())).toEqual({
        mcpServers: { ...sharedProjectServers, scoped: { command: "git-mcp" } },
      });
    });

    it("should write the same .mcp.json bytes as the claudecode target in project mode", async () => {
      await writeFileContent(
        join(testDir, ".mcp.json"),
        JSON.stringify({ someOtherKey: true, mcpServers: { stale: { command: "old" } } }),
      );
      const rulesyncMcp = buildRulesyncMcp(sharedProjectServers);

      const commandcode = await CommandcodeMcp.fromRulesyncMcp({ rulesyncMcp });
      const claudecode = await ClaudecodeMcp.fromRulesyncMcp({ rulesyncMcp });

      expect(commandcode.getRelativeDirPath()).toBe(claudecode.getRelativeDirPath());
      expect(commandcode.getRelativeFilePath()).toBe(claudecode.getRelativeFilePath());
      expect(commandcode.getFileContent()).toBe(claudecode.getFileContent());
    });

    it("should ignore prototype-pollution keys on generate in project mode", async () => {
      const rulesyncMcp = buildRulesyncMcp(
        JSON.parse(
          '{"__proto__":{"command":"evil"},"git":{"command":"git-mcp","__proto__":{"x":1}}}',
        ),
      );

      const mcp = await CommandcodeMcp.fromRulesyncMcp({ rulesyncMcp });

      const servers = JSON.parse(mcp.getFileContent()).mcpServers;
      expect(Object.keys(servers)).toEqual(["git"]);
      expect(Object.keys(servers.git)).toEqual(["command"]);
    });

    it("should write to ~/.commandcode/mcp.json in global mode", async () => {
      const mcp = await CommandcodeMcp.fromRulesyncMcp({
        rulesyncMcp: buildRulesyncMcp({ git: { command: "git-mcp" } }),
        global: true,
      });

      expect(mcp.getRelativeDirPath()).toBe(GLOBAL_DIR);
      expect(mcp.getRelativeFilePath()).toBe("mcp.json");
      expect(mcp.isDeletable()).toBe(false);
      expect(JSON.parse(mcp.getFileContent())).toEqual({
        mcpServers: { git: { transport: "stdio", command: "git-mcp" } },
      });
    });

    it("should write http, streamable-http and bare-url servers as transport http in global mode", async () => {
      const rulesyncMcp = buildRulesyncMcp({
        http: { type: "http", url: "https://example.com/mcp", headers: { A: "b" } },
        streamable: { transport: "streamable-http", url: "https://example.com/s" },
        bare: { url: "https://example.com/bare" },
        aliased: { httpUrl: "https://example.com/alias" },
      });

      const mcp = await CommandcodeMcp.fromRulesyncMcp({ rulesyncMcp, global: true });

      expect(JSON.parse(mcp.getFileContent())).toEqual({
        mcpServers: {
          http: { transport: "http", url: "https://example.com/mcp", headers: { A: "b" } },
          streamable: { transport: "http", url: "https://example.com/s" },
          bare: { transport: "http", url: "https://example.com/bare" },
          aliased: { transport: "http", url: "https://example.com/alias" },
        },
      });
    });

    it("should keep sse servers as transport sse and drop timeout in global mode", async () => {
      const rulesyncMcp = buildRulesyncMcp({
        events: { type: "sse", url: "https://example.com/sse", timeout: 30000 },
      });

      const mcp = await CommandcodeMcp.fromRulesyncMcp({ rulesyncMcp, global: true });

      expect(JSON.parse(mcp.getFileContent())).toEqual({
        mcpServers: { events: { transport: "sse", url: "https://example.com/sse" } },
      });
    });

    it("should normalize an array command into command and args in global mode", async () => {
      const rulesyncMcp = buildRulesyncMcp({ git: { command: ["uvx", "mcp-server-git"] } });

      const mcp = await CommandcodeMcp.fromRulesyncMcp({ rulesyncMcp, global: true });

      expect(JSON.parse(mcp.getFileContent())).toEqual({
        mcpServers: { git: { transport: "stdio", command: "uvx", args: ["mcp-server-git"] } },
      });
    });

    it("should carry oauth and env for remote servers and map disabled to enabled: false in global mode", async () => {
      const rulesyncMcp = buildRulesyncMcp({
        api: {
          type: "http",
          url: "https://api.example.com/mcp",
          disabled: true,
          env: { API_KEY: "value" },
          oauth: { authorizationUrl: "https://example.com/authorize", clientId: "c" },
        },
      });

      const mcp = await CommandcodeMcp.fromRulesyncMcp({ rulesyncMcp, global: true });

      expect(JSON.parse(mcp.getFileContent()).mcpServers.api).toEqual({
        transport: "http",
        url: "https://api.example.com/mcp",
        enabled: false,
        env: { API_KEY: "value" },
        oauth: { authorizationUrl: "https://example.com/authorize", clientId: "c" },
      });
    });

    it("should not write enabled for a server that is not disabled in global mode", async () => {
      const rulesyncMcp = buildRulesyncMcp({ git: { command: "git-mcp", disabled: false } });

      const mcp = await CommandcodeMcp.fromRulesyncMcp({ rulesyncMcp, global: true });

      expect(JSON.parse(mcp.getFileContent()).mcpServers.git).toEqual({
        transport: "stdio",
        command: "git-mcp",
      });
    });

    it("should warn and skip servers Command Code cannot start or reach in global mode", async () => {
      const logger = createMockLogger();
      const rulesyncMcp = buildRulesyncMcp({
        none: { env: { A: "b" } },
        noUrl: { type: "http" },
        ws: { url: "wss://example.com/socket" },
        wsTyped: { type: "ws", url: "wss://example.com/socket" },
        noCommand: { type: "stdio" },
        argsOnly: { type: "stdio", args: ["--verbose"] },
        ok: { command: "git-mcp" },
      });

      const mcp = await CommandcodeMcp.fromRulesyncMcp({ rulesyncMcp, global: true, logger });

      expect(JSON.parse(mcp.getFileContent())).toEqual({
        mcpServers: { ok: { transport: "stdio", command: "git-mcp" } },
      });
      const warnings = logger.warn.mock.calls.map(([message]) => String(message));
      expect(warnings).toHaveLength(6);
      for (const name of ["none", "noUrl", "ws", "wsTyped", "noCommand", "argsOnly"]) {
        expect(warnings.some((message) => message.includes(`"${name}"`))).toBe(true);
      }
    });

    it("should ignore prototype-pollution keys on generate in global mode", async () => {
      const rulesyncMcp = buildRulesyncMcp(
        JSON.parse(
          '{"__proto__":{"command":"evil"},"git":{"command":"git-mcp","__proto__":{"x":1}}}',
        ),
      );

      const mcp = await CommandcodeMcp.fromRulesyncMcp({ rulesyncMcp, global: true });

      const servers = JSON.parse(mcp.getFileContent()).mcpServers;
      expect(Object.keys(servers)).toEqual(["git"]);
      expect(Object.keys(servers.git)).toEqual(["transport", "command"]);
    });

    it("should sanitize prototype-pollution keys inside env, headers and oauth in global mode", async () => {
      const rulesyncMcp = buildRulesyncMcp(
        JSON.parse(
          '{"git":{"command":"git-mcp","env":{"TOKEN":"x","__proto__":{"y":1}}},"api":{"url":"https://example.com/mcp","headers":{"Authorization":"Bearer t","constructor":{"z":1}},"oauth":{"clientId":"c","prototype":{"w":1}}}}',
        ),
      );

      const mcp = await CommandcodeMcp.fromRulesyncMcp({ rulesyncMcp, global: true });

      const servers = JSON.parse(mcp.getFileContent()).mcpServers;
      expect(Object.keys(servers.git.env)).toEqual(["TOKEN"]);
      expect(Object.keys(servers.api.headers)).toEqual(["Authorization"]);
      expect(Object.keys(servers.api.oauth)).toEqual(["clientId"]);
    });

    it("should strip rulesync-only fields such as targets in global mode", async () => {
      const rulesyncMcp = buildRulesyncMcp({
        git: { command: "git-mcp", targets: ["commandcode"] },
      });

      const mcp = await CommandcodeMcp.fromRulesyncMcp({ rulesyncMcp, global: true });

      expect(JSON.parse(mcp.getFileContent()).mcpServers.git).toEqual({
        transport: "stdio",
        command: "git-mcp",
      });
    });

    it("should keep sibling top-level keys of an existing .mcp.json", async () => {
      await writeFileContent(
        join(testDir, ".mcp.json"),
        JSON.stringify({ someOtherKey: true, mcpServers: { stale: { command: "old" } } }),
      );
      const rulesyncMcp = buildRulesyncMcp({ git: { command: "git-mcp" } });

      const mcp = await CommandcodeMcp.fromRulesyncMcp({ rulesyncMcp });

      expect(JSON.parse(mcp.getFileContent())).toEqual({
        someOtherKey: true,
        mcpServers: { git: { command: "git-mcp" } },
      });
    });

    it("should throw when the existing file is not valid JSON", async () => {
      await writeFileContent(join(testDir, ".mcp.json"), "{ nope");

      await expect(
        CommandcodeMcp.fromRulesyncMcp({ rulesyncMcp: buildRulesyncMcp({}) }),
      ).rejects.toThrow("Failed to parse Command Code MCP config");
    });

    it("should honor a custom outputRoot", async () => {
      const mcp = await CommandcodeMcp.fromRulesyncMcp({
        outputRoot: join(testDir, "custom"),
        rulesyncMcp: buildRulesyncMcp({}),
      });
      expect(mcp.getOutputRoot()).toBe(join(testDir, "custom"));
    });
  });

  describe("fromFile", () => {
    it("should read .mcp.json at the project root", async () => {
      await writeFileContent(
        join(testDir, ".mcp.json"),
        JSON.stringify({ mcpServers: { git: { transport: "stdio", command: "git-mcp" } } }),
      );

      const mcp = await CommandcodeMcp.fromFile({});

      expect(mcp.getRelativeDirPath()).toBe(".");
      expect(mcp.getRelativeFilePath()).toBe(".mcp.json");
      expect(mcp.getJson()).toEqual({
        mcpServers: { git: { transport: "stdio", command: "git-mcp" } },
      });
    });

    it("should read ~/.commandcode/mcp.json in global mode", async () => {
      await ensureDir(join(testDir, GLOBAL_DIR));
      await writeFileContent(
        join(testDir, GLOBAL_DIR, "mcp.json"),
        JSON.stringify({ mcpServers: { git: { type: "stdio", command: "git-mcp" } } }),
      );

      const mcp = await CommandcodeMcp.fromFile({ global: true });

      expect(mcp.getRelativeDirPath()).toBe(GLOBAL_DIR);
      expect(mcp.getJson()).toEqual({ mcpServers: { git: { type: "stdio", command: "git-mcp" } } });
    });

    it("should fall back to an empty server map when the file is missing", async () => {
      const mcp = await CommandcodeMcp.fromFile({});
      expect(mcp.getJson()).toEqual({ mcpServers: {} });
    });

    it("should throw when the file is not valid JSON", async () => {
      await writeFileContent(join(testDir, ".mcp.json"), "not json");

      await expect(CommandcodeMcp.fromFile({})).rejects.toThrow(
        "Failed to parse Command Code MCP config",
      );
    });
  });

  describe("toRulesyncMcp", () => {
    it("should keep servers as they are and emit the rulesync schema", () => {
      const mcp = new CommandcodeMcp({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            git: { transport: "stdio", command: "uvx", args: ["mcp-server-git"] },
            api: { type: "http", url: "https://api.example.com/mcp", oauth: { clientId: "c" } },
            events: { transport: "sse", url: "https://realtime.example.com/events" },
          },
        }),
      });

      const rulesyncMcp = mcp.toRulesyncMcp();

      expect(rulesyncMcp.getRelativeDirPath()).toBe(RULESYNC_RELATIVE_DIR_PATH);
      expect(JSON.parse(rulesyncMcp.getFileContent())).toEqual({
        $schema: RULESYNC_MCP_SCHEMA_URL,
        mcpServers: {
          git: { transport: "stdio", command: "uvx", args: ["mcp-server-git"] },
          api: { type: "http", url: "https://api.example.com/mcp", oauth: { clientId: "c" } },
          events: { transport: "sse", url: "https://realtime.example.com/events" },
        },
      });
    });

    it("should map enabled: false back to disabled: true on import", () => {
      const mcp = new CommandcodeMcp({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            off: { transport: "stdio", command: "off-mcp", enabled: false },
            on: { transport: "stdio", command: "on-mcp", enabled: true },
          },
        }),
      });

      const servers = JSON.parse(mcp.toRulesyncMcp().getFileContent()).mcpServers;
      expect(servers.off).toEqual({ transport: "stdio", command: "off-mcp", disabled: true });
      expect(servers.on).toEqual({ transport: "stdio", command: "on-mcp" });
    });

    it("should ignore prototype-pollution keys on import", () => {
      const mcp = new CommandcodeMcp({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".mcp.json",
        fileContent:
          '{"mcpServers":{"__proto__":{"command":"evil"},"git":{"command":"git-mcp","__proto__":{"x":1}}}}',
      });

      const servers = JSON.parse(mcp.toRulesyncMcp().getFileContent()).mcpServers;
      expect(Object.keys(servers)).toEqual(["git"]);
      expect(Object.keys(servers.git)).toEqual(["command"]);
    });

    it("should drop sibling top-level keys and tolerate a missing server map", () => {
      const mcp = new CommandcodeMcp({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({ someOtherKey: true }),
      });

      expect(JSON.parse(mcp.toRulesyncMcp().getFileContent())).toEqual({
        $schema: RULESYNC_MCP_SCHEMA_URL,
        mcpServers: {},
      });
    });

    it("should round-trip stdio, http and sse servers in project mode", async () => {
      const servers = {
        git: { command: "git-mcp", args: ["--repo", "."] },
        api: { transport: "http", url: "https://api.example.com/mcp", headers: { A: "b" } },
        events: { transport: "sse", url: "https://realtime.example.com/events" },
      };
      const generated = await CommandcodeMcp.fromRulesyncMcp({
        rulesyncMcp: buildRulesyncMcp(servers),
      });

      const imported = JSON.parse(generated.toRulesyncMcp().getFileContent()).mcpServers;

      expect(imported).toEqual(servers);
    });

    it("should round-trip stdio, http and sse servers in global mode", async () => {
      const servers = {
        git: { command: "git-mcp", args: ["--repo", "."] },
        api: { transport: "http", url: "https://api.example.com/mcp", headers: { A: "b" } },
        events: { transport: "sse", url: "https://realtime.example.com/events" },
      };
      const generated = await CommandcodeMcp.fromRulesyncMcp({
        rulesyncMcp: buildRulesyncMcp(servers),
        global: true,
      });

      const imported = JSON.parse(generated.toRulesyncMcp().getFileContent()).mcpServers;

      expect(imported).toEqual({
        git: { transport: "stdio", command: "git-mcp", args: ["--repo", "."] },
        api: servers.api,
        events: servers.events,
      });
    });
  });

  describe("validate", () => {
    it("should always return success", () => {
      const mcp = new CommandcodeMcp({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".mcp.json",
        fileContent: "{}",
      });
      expect(mcp.validate()).toEqual({ success: true, error: null });
    });
  });

  describe("forDeletion", () => {
    it("should create a deletable project instance with empty content", () => {
      const mcp = CommandcodeMcp.forDeletion({
        relativeDirPath: ".",
        relativeFilePath: ".mcp.json",
      });
      expect(mcp.getFileContent()).toBe("{}");
      expect(mcp.isDeletable()).toBe(true);
    });

    it("should not be deletable in global mode", () => {
      const mcp = CommandcodeMcp.forDeletion({
        relativeDirPath: GLOBAL_DIR,
        relativeFilePath: "mcp.json",
        global: true,
      });
      expect(mcp.isDeletable()).toBe(false);
    });
  });
});
