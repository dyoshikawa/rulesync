import { join } from "node:path";

import { load } from "js-yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { isRecord } from "../../utils/type-guards.js";
import { GooseMcp } from "./goose-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

const GOOSE_DIR = join(".config", "goose");
const GOOSE_FILE = "config.yaml";
const GOOSE_PLUGIN_DIR = join(".agents", "plugins", "rulesync");
const GOOSE_PLUGIN_FILE = ".mcp.json";

function getExtensions(content: string): Record<string, Record<string, unknown>> {
  const parsed = load(content);
  if (!isRecord(parsed) || !isRecord(parsed.extensions)) return {};
  return parsed.extensions as Record<string, Record<string, unknown>>;
}

describe("GooseMcp", () => {
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
    it("targets ~/.config/goose/config.yaml in global mode", () => {
      const paths = GooseMcp.getSettablePaths({ global: true });
      expect(paths.relativeDirPath).toBe(GOOSE_DIR);
      expect(paths.relativeFilePath).toBe(GOOSE_FILE);
    });

    it("targets the open-plugin .mcp.json manifest in project mode", () => {
      const paths = GooseMcp.getSettablePaths({ global: false });
      expect(paths.relativeDirPath).toBe(GOOSE_PLUGIN_DIR);
      expect(paths.relativeFilePath).toBe(GOOSE_PLUGIN_FILE);
    });
  });

  describe("isDeletable", () => {
    it("is not deletable in global mode (shared config file)", () => {
      const mcp = new GooseMcp({
        relativeDirPath: GOOSE_DIR,
        relativeFilePath: GOOSE_FILE,
        fileContent: "",
        validate: false,
        global: true,
      });
      expect(mcp.isDeletable()).toBe(false);
    });

    it("is deletable in project mode (rulesync-owned manifest)", () => {
      const mcp = new GooseMcp({
        relativeDirPath: GOOSE_PLUGIN_DIR,
        relativeFilePath: GOOSE_PLUGIN_FILE,
        fileContent: "",
        validate: false,
        global: false,
      });
      expect(mcp.isDeletable()).toBe(true);
    });
  });

  describe("fromRulesyncMcp (project mode)", () => {
    it("emits a Claude-style stdio server to .agents/plugins/rulesync/.mcp.json", async () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            fetch: {
              command: "uvx",
              args: ["mcp-server-fetch"],
              env: { TOKEN: "x" },
              cwd: "/srv/fetch",
            },
          },
        }),
      });

      const mcp = await GooseMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: false,
      });

      expect(mcp.getRelativeDirPath()).toBe(GOOSE_PLUGIN_DIR);
      expect(mcp.getRelativeFilePath()).toBe(GOOSE_PLUGIN_FILE);
      const parsed = JSON.parse(mcp.getFileContent());
      expect(parsed.mcpServers.fetch).toEqual({
        command: "uvx",
        args: ["mcp-server-fetch"],
        env: { TOKEN: "x" },
        cwd: "/srv/fetch",
      });
    });

    it("folds an array command's tail into args", async () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({
          mcpServers: { fetch: { command: ["uvx", "mcp-server-fetch"], args: ["--flag"] } },
        }),
      });

      const mcp = await GooseMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: false,
      });
      const parsed = JSON.parse(mcp.getFileContent());
      expect(parsed.mcpServers.fetch).toEqual({
        command: "uvx",
        args: ["mcp-server-fetch", "--flag"],
      });
    });

    it("skips remote (http/sse) servers with a warning", async () => {
      const warn = vi.fn();
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            local: { command: "uvx", args: ["mcp-server-fetch"] },
            remote: { type: "http", url: "https://example.com/mcp" },
            sse: { type: "sse", url: "https://example.com/sse" },
          },
        }),
      });

      const mcp = await GooseMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: false,
        logger: { warn } as never,
      });
      const parsed = JSON.parse(mcp.getFileContent());

      expect(Object.keys(parsed.mcpServers)).toEqual(["local"]);
      expect(warn).toHaveBeenCalledTimes(2);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("stdio-only"));
      // Assert on the resolved Goose server type rather than the server name, so
      // the test stays meaningful even if the sample server names change.
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("(streamable_http)"));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("(sse)"));
    });

    it("strips prototype-pollution keys from a server's env in project mode", async () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent:
          '{"mcpServers":{"fetch":{"command":"uvx",' +
          '"env":{"__proto__":"polluted","constructor":"polluted","TOKEN":"safe"}}}}',
      });

      const mcp = await GooseMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: false,
      });
      const parsed = JSON.parse(mcp.getFileContent());
      expect(parsed.mcpServers.fetch.env).toEqual({ TOKEN: "safe" });
    });

    it("round-trips a project manifest back to canonical servers", async () => {
      const dir = join(testDir, GOOSE_PLUGIN_DIR);
      await ensureDir(dir);
      await writeFileContent(
        join(dir, GOOSE_PLUGIN_FILE),
        JSON.stringify({
          mcpServers: { fetch: { command: "uvx", args: ["mcp-server-fetch"] } },
        }),
      );

      const mcp = await GooseMcp.fromFile({ outputRoot: testDir, global: false });
      const servers = JSON.parse(mcp.toRulesyncMcp().getFileContent()).mcpServers;
      expect(servers.fetch).toEqual({ command: "uvx", args: ["mcp-server-fetch"] });
    });
  });

  describe("fromRulesyncMcp", () => {
    it("converts a stdio server to a Goose extension", async () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            fetch: {
              command: "uvx",
              args: ["mcp-server-fetch"],
              env: { TOKEN: "x" },
            },
          },
        }),
      });

      const mcp = await GooseMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });
      const ext = getExtensions(mcp.getFileContent()).fetch;

      expect(ext).toMatchObject({
        name: "fetch",
        type: "stdio",
        cmd: "uvx",
        args: ["mcp-server-fetch"],
        envs: { TOKEN: "x" },
        enabled: true,
      });
    });

    it("strips prototype-pollution keys from a server's env table", async () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        // Authored as raw JSON text so `__proto__`/`constructor`/`prototype`
        // land as own enumerable keys (an object literal would set the prototype).
        fileContent:
          '{"mcpServers":{"fetch":{"command":"uvx",' +
          '"env":{"__proto__":"polluted","constructor":"polluted","prototype":"polluted","TOKEN":"safe"}}}}',
      });

      const mcp = await GooseMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });
      const ext = getExtensions(mcp.getFileContent()).fetch;

      expect(ext?.envs).toEqual({ TOKEN: "safe" });
    });

    it("converts a remote http server to a streamable_http extension", async () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            remote: {
              type: "http",
              url: "https://example.com/mcp",
              headers: { Authorization: "Bearer x" },
            },
          },
        }),
      });

      const mcp = await GooseMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });
      const ext = getExtensions(mcp.getFileContent()).remote;

      expect(ext).toMatchObject({
        name: "remote",
        type: "streamable_http",
        uri: "https://example.com/mcp",
        headers: { Authorization: "Bearer x" },
        enabled: true,
      });
      expect(ext?.cmd).toBeUndefined();
    });

    it("maps disabled to enabled: false", async () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({
          mcpServers: { off: { command: "x", disabled: true } },
        }),
      });

      const mcp = await GooseMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });
      expect(getExtensions(mcp.getFileContent()).off?.enabled).toBe(false);
    });

    it("preserves other config.yaml keys when merging", async () => {
      const dir = join(testDir, GOOSE_DIR);
      await ensureDir(dir);
      await writeFileContent(
        join(dir, GOOSE_FILE),
        "GOOSE_MODEL: gpt-4o\nGOOSE_PROVIDER: openai\n",
      );

      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({ mcpServers: { fetch: { command: "uvx" } } }),
      });

      const mcp = await GooseMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });
      const parsed = load(mcp.getFileContent());

      expect(isRecord(parsed) && parsed.GOOSE_MODEL).toBe("gpt-4o");
      expect(isRecord(parsed) && parsed.GOOSE_PROVIDER).toBe("openai");
      expect(getExtensions(mcp.getFileContent()).fetch?.cmd).toBe("uvx");
    });

    it("preserves the user's builtin and platform extensions", async () => {
      const dir = join(testDir, GOOSE_DIR);
      await ensureDir(dir);
      await writeFileContent(
        join(dir, GOOSE_FILE),
        [
          "extensions:",
          "  developer:",
          "    name: developer",
          "    type: builtin",
          "    bundled: true",
          "    timeout: 300",
          "    enabled: true",
          "  memory:",
          "    name: memory",
          "    type: platform",
          "    enabled: true",
          "  stale:",
          "    name: stale",
          "    type: stdio",
          "    cmd: old",
          "",
        ].join("\n"),
      );

      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({ mcpServers: { fetch: { command: "uvx" } } }),
      });

      const mcp = await GooseMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });
      const extensions = getExtensions(mcp.getFileContent());

      // Non-MCP extension types are Goose's own capabilities and survive
      // untouched; deleting `developer` would cost the agent its shell tools.
      expect(extensions.developer).toEqual({
        name: "developer",
        type: "builtin",
        bundled: true,
        timeout: 300,
        enabled: true,
      });
      expect(extensions.memory?.type).toBe("platform");
      expect(extensions.fetch?.cmd).toBe("uvx");
      // MCP-typed entries stay rulesync-owned, so a deleted server is retracted.
      expect(extensions.stale).toBeUndefined();
    });

    it("keeps an entry whose shape it cannot read and warns about the ones it retracts", async () => {
      const warn = vi.fn();
      const dir = join(testDir, GOOSE_DIR);
      await ensureDir(dir);
      await writeFileContent(
        join(dir, GOOSE_FILE),
        [
          "extensions:",
          // Neither a declared type nor a cmd/uri to infer one from: unreadable
          // rather than rulesync's, so it stays.
          "  mystery:",
          "    name: mystery",
          "    enabled: true",
          "  stale:",
          "    name: stale",
          "    type: stdio",
          "    cmd: old",
          "",
        ].join("\n"),
      );

      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({ mcpServers: {} }),
      });

      const mcp = await GooseMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
        logger: { warn } as never,
      });
      const extensions = getExtensions(mcp.getFileContent());

      expect(extensions.mystery).toEqual({ name: "mystery", enabled: true });
      expect(extensions.stale).toBeUndefined();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('"stale"'));
    });

    it("replaces a non-MCP extension of the same name with a warning", async () => {
      const warn = vi.fn();
      const dir = join(testDir, GOOSE_DIR);
      await ensureDir(dir);
      await writeFileContent(
        join(dir, GOOSE_FILE),
        ["extensions:", "  memory:", "    name: memory", "    type: builtin", ""].join("\n"),
      );

      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({ mcpServers: { memory: { command: "uvx" } } }),
      });

      const mcp = await GooseMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
        logger: { warn } as never,
      });

      expect(getExtensions(mcp.getFileContent()).memory).toMatchObject({
        type: "stdio",
        cmd: "uvx",
      });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("already exists"));
    });

    it("does not warn when it regenerates its own non-MCP entry", async () => {
      const warn = vi.fn();
      const dir = join(testDir, GOOSE_DIR);
      await ensureDir(dir);
      // What a previous generate wrote for a canonical `type: builtin` server.
      await writeFileContent(
        join(dir, GOOSE_FILE),
        ["extensions:", "  memory:", "    name: memory", "    type: builtin", ""].join("\n"),
      );

      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({ mcpServers: { memory: { type: "builtin" } } }),
      });

      const mcp = await GooseMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
        logger: { warn } as never,
      });

      expect(getExtensions(mcp.getFileContent()).memory?.type).toBe("builtin");
      expect(warn).not.toHaveBeenCalled();
    });

    it("reports an existing MCP extension removed because its server could not be converted", async () => {
      const warn = vi.fn();
      const dir = join(testDir, GOOSE_DIR);
      await ensureDir(dir);
      await writeFileContent(
        join(dir, GOOSE_FILE),
        ["extensions:", "  fetch:", "    name: fetch", "    type: stdio", "    cmd: uvx", ""].join(
          "\n",
        ),
      );

      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({ mcpServers: { fetch: { timeout: 300 } } }),
      });

      const mcp = await GooseMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
        logger: { warn } as never,
      });

      expect(getExtensions(mcp.getFileContent()).fetch).toBeUndefined();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("Removing MCP extension"));
    });

    it("treats a non-mapping extensions block as empty", async () => {
      const dir = join(testDir, GOOSE_DIR);
      await ensureDir(dir);
      await writeFileContent(join(dir, GOOSE_FILE), "extensions: []\nGOOSE_MODEL: gpt-4o\n");

      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({ mcpServers: { fetch: { command: "uvx" } } }),
      });

      const mcp = await GooseMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });
      const parsed = load(mcp.getFileContent());

      expect(getExtensions(mcp.getFileContent()).fetch?.cmd).toBe("uvx");
      expect(isRecord(parsed) && parsed.GOOSE_MODEL).toBe("gpt-4o");
    });

    it("skips a server with no command instead of writing a stdio extension Goose cannot start", async () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({
          mcpServers: { broken: { timeout: 300 }, fetch: { command: "uvx" } },
        }),
      });

      const mcp = await GooseMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });
      const extensions = getExtensions(mcp.getFileContent());

      expect(extensions.broken).toBeUndefined();
      expect(extensions.fetch?.cmd).toBe("uvx");
    });
  });

  describe("toRulesyncMcp round-trip", () => {
    it("converts Goose extensions back to canonical servers", async () => {
      const dir = join(testDir, GOOSE_DIR);
      await ensureDir(dir);
      await writeFileContent(
        join(dir, GOOSE_FILE),
        [
          "extensions:",
          "  fetch:",
          "    name: fetch",
          "    type: stdio",
          "    cmd: uvx",
          "    args: [mcp-server-fetch]",
          "    enabled: true",
          "  remote:",
          "    name: remote",
          "    type: streamable_http",
          "    uri: https://example.com/mcp",
          "    enabled: false",
          "",
        ].join("\n"),
      );

      const mcp = await GooseMcp.fromFile({ outputRoot: testDir, global: true });
      const rulesync = mcp.toRulesyncMcp();
      const servers = JSON.parse(rulesync.getFileContent()).mcpServers;

      expect(servers.fetch).toMatchObject({
        type: "stdio",
        command: "uvx",
        args: ["mcp-server-fetch"],
      });
      expect(servers.remote).toMatchObject({
        type: "http",
        url: "https://example.com/mcp",
        disabled: true,
      });
    });

    it("strips prototype-pollution keys from an extension's envs/headers on import", async () => {
      const dir = join(testDir, GOOSE_DIR);
      await ensureDir(dir);
      await writeFileContent(
        join(dir, GOOSE_FILE),
        [
          "extensions:",
          "  fetch:",
          "    name: fetch",
          "    type: stdio",
          "    cmd: uvx",
          "    envs:",
          "      __proto__: polluted",
          "      constructor: polluted",
          "      TOKEN: safe",
          "  remote:",
          "    name: remote",
          "    type: streamable_http",
          "    uri: https://example.com/mcp",
          "    headers:",
          "      __proto__: polluted",
          "      Authorization: Bearer safe",
          "",
        ].join("\n"),
      );

      const mcp = await GooseMcp.fromFile({ outputRoot: testDir, global: true });
      const servers = JSON.parse(mcp.toRulesyncMcp().getFileContent()).mcpServers;

      expect(servers.fetch.env).toEqual({ TOKEN: "safe" });
      expect(servers.remote.headers).toEqual({ Authorization: "Bearer safe" });
    });

    it("skips non-MCP extension types instead of importing them as stdio servers with no command", async () => {
      const dir = join(testDir, GOOSE_DIR);
      await ensureDir(dir);
      await writeFileContent(
        join(dir, GOOSE_FILE),
        [
          "extensions:",
          "  developer:",
          "    name: developer",
          "    type: builtin",
          "    bundled: true",
          "    timeout: 300",
          "  platform-memory:",
          "    name: platform-memory",
          "    type: platform",
          "  fetch:",
          "    name: fetch",
          "    type: stdio",
          "    cmd: uvx",
          "",
        ].join("\n"),
      );

      const mcp = await GooseMcp.fromFile({ outputRoot: testDir, global: true });
      const servers = JSON.parse(mcp.toRulesyncMcp().getFileContent()).mcpServers;

      expect(Object.keys(servers)).toEqual(["fetch"]);
    });
  });

  describe("forDeletion", () => {
    it("returns a non-deletable instance", () => {
      const mcp = GooseMcp.forDeletion({
        outputRoot: testDir,
        relativeDirPath: GOOSE_DIR,
        relativeFilePath: GOOSE_FILE,
        global: true,
      });
      expect(mcp).toBeInstanceOf(GooseMcp);
      expect(mcp.isDeletable()).toBe(false);
    });
  });
});
