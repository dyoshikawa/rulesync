import { join } from "node:path";

import { load } from "js-yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { isRecord } from "../../utils/type-guards.js";
import { HermesagentMcp } from "./hermesagent-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

const HERMES_DIR = ".hermes";
const HERMES_FILE = "config.yaml";

function getMcpServers(content: string): Record<string, Record<string, unknown>> {
  const parsed = load(content);
  if (!isRecord(parsed) || !isRecord(parsed.mcp_servers)) return {};
  return parsed.mcp_servers as Record<string, Record<string, unknown>>;
}

describe("HermesagentMcp", () => {
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
    it("targets ~/.hermes/config.yaml", () => {
      const paths = HermesagentMcp.getSettablePaths();
      expect(paths.relativeDirPath).toBe(HERMES_DIR);
      expect(paths.relativeFilePath).toBe(HERMES_FILE);
    });
  });

  describe("isDeletable", () => {
    it("is never deletable (shared config file)", () => {
      const mcp = new HermesagentMcp({
        relativeDirPath: HERMES_DIR,
        relativeFilePath: HERMES_FILE,
        fileContent: "",
        validate: false,
      });
      expect(mcp.isDeletable()).toBe(false);
    });
  });

  describe("global-only", () => {
    it("fromRulesyncMcp throws without global", async () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({ mcpServers: {} }),
      });
      await expect(HermesagentMcp.fromRulesyncMcp({ rulesyncMcp, global: false })).rejects.toThrow(
        /global-only/,
      );
    });

    it("fromFile throws without global", async () => {
      await expect(HermesagentMcp.fromFile({ outputRoot: testDir, global: false })).rejects.toThrow(
        /global-only/,
      );
    });
  });

  describe("fromRulesyncMcp", () => {
    it("converts a stdio server to an mcp_servers entry following the MCP spec", async () => {
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

      const mcp = await HermesagentMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });
      const server = getMcpServers(mcp.getFileContent()).fetch;

      expect(server).toMatchObject({
        command: "uvx",
        args: ["mcp-server-fetch"],
        env: { TOKEN: "x" },
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

      const mcp = await HermesagentMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });
      const server = getMcpServers(mcp.getFileContent()).fetch;

      expect(server?.env).toEqual({ TOKEN: "safe" });
    });

    it("converts a remote server to url/headers, dropping the canonical-only type", async () => {
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

      const mcp = await HermesagentMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });
      const server = getMcpServers(mcp.getFileContent()).remote;

      expect(server).toMatchObject({
        url: "https://example.com/mcp",
        headers: { Authorization: "Bearer x" },
      });
      // Hermes infers the transport from the presence of `url`, so `type` and
      // `command` are not emitted into the shared config.
      expect(server?.type).toBeUndefined();
      expect(server?.command).toBeUndefined();
    });

    it("maps the canonical httpUrl alias to url", async () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({
          mcpServers: { remote: { httpUrl: "https://example.com/mcp" } },
        }),
      });

      const mcp = await HermesagentMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });
      const server = getMcpServers(mcp.getFileContent()).remote;

      expect(server?.url).toBe("https://example.com/mcp");
      expect(server?.httpUrl).toBeUndefined();
    });

    it("folds an array-form command tail into args", async () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({
          mcpServers: { fetch: { command: ["npx", "-y", "server"], args: ["--flag"] } },
        }),
      });

      const mcp = await HermesagentMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });
      const server = getMcpServers(mcp.getFileContent()).fetch;

      expect(server?.command).toBe("npx");
      expect(server?.args).toEqual(["-y", "server", "--flag"]);
    });

    it("carries the timeout field through (from networkTimeout alias too)", async () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({
          mcpServers: { fetch: { command: "uvx", networkTimeout: 120 } },
        }),
      });

      const mcp = await HermesagentMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });
      const server = getMcpServers(mcp.getFileContent()).fetch;

      expect(server?.timeout).toBe(120);
    });

    it("translates a disabled server to enabled: false", async () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({
          mcpServers: { fetch: { command: "uvx", disabled: true } },
        }),
      });

      const mcp = await HermesagentMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });
      const server = getMcpServers(mcp.getFileContent()).fetch;

      expect(server?.enabled).toBe(false);
      expect(server?.disabled).toBeUndefined();
    });

    it("maps canonical enabledTools/disabledTools to the Hermes tools block", async () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            fetch: {
              command: "uvx",
              enabledTools: ["search", "fetch"],
              disabledTools: ["delete"],
            },
          },
        }),
      });

      const mcp = await HermesagentMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });
      const server = getMcpServers(mcp.getFileContent()).fetch;

      expect(server?.tools).toEqual({ include: ["search", "fetch"], exclude: ["delete"] });
    });

    it("emits only include when only enabledTools is set", async () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({
          mcpServers: { fetch: { command: "uvx", enabledTools: ["search"] } },
        }),
      });

      const mcp = await HermesagentMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });
      const server = getMcpServers(mcp.getFileContent()).fetch;

      expect(server?.tools).toEqual({ include: ["search"] });
    });

    it("emits only exclude when only disabledTools is set", async () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({
          mcpServers: { fetch: { command: "uvx", disabledTools: ["delete"] } },
        }),
      });

      const mcp = await HermesagentMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });
      const server = getMcpServers(mcp.getFileContent()).fetch;

      expect(server?.tools).toEqual({ exclude: ["delete"] });
    });

    it("omits the tools block when no tool filters are set", async () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({ mcpServers: { fetch: { command: "uvx" } } }),
      });

      const mcp = await HermesagentMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });
      const server = getMcpServers(mcp.getFileContent()).fetch;

      expect(server?.tools).toBeUndefined();
    });

    it("passes through advanced auth/mTLS/timeout fields (issue #2236)", async () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            remote: {
              url: "https://example.com/mcp",
              auth: "oauth",
              client_cert: ["~/secrets/client.crt", "~/secrets/client.key", "pass"],
              client_key: "~/secrets/client.key",
              connect_timeout: 60,
              supports_parallel_tool_calls: false,
            },
          },
        }),
      });

      const mcp = await HermesagentMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });
      const server = getMcpServers(mcp.getFileContent()).remote;

      expect(server?.auth).toBe("oauth");
      expect(server?.client_cert).toEqual(["~/secrets/client.crt", "~/secrets/client.key", "pass"]);
      expect(server?.client_key).toBe("~/secrets/client.key");
      expect(server?.connect_timeout).toBe(60);
      expect(server?.supports_parallel_tool_calls).toBe(false);
    });

    it("passes through the boolean tools.prompts/resources capability toggles (issue #2236)", async () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            fetch: {
              command: "uvx",
              enabledTools: ["search"],
              tools: { prompts: true, resources: false },
            },
          },
        }),
      });

      const mcp = await HermesagentMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });
      const server = getMcpServers(mcp.getFileContent()).fetch;

      expect(server?.tools).toEqual({ include: ["search"], prompts: true, resources: false });
    });

    it("preserves other config.yaml keys when merging", async () => {
      const dir = join(testDir, HERMES_DIR);
      await ensureDir(dir);
      await writeFileContent(join(dir, HERMES_FILE), "model: claude-opus\nterminal: bash\n");

      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({ mcpServers: { fetch: { command: "uvx" } } }),
      });

      const mcp = await HermesagentMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });
      const parsed = load(mcp.getFileContent());

      expect(isRecord(parsed) && parsed.model).toBe("claude-opus");
      expect(isRecord(parsed) && parsed.terminal).toBe("bash");
      expect(getMcpServers(mcp.getFileContent()).fetch?.command).toBe("uvx");
    });
  });

  describe("toRulesyncMcp round-trip", () => {
    it("converts mcp_servers back to canonical servers", async () => {
      const dir = join(testDir, HERMES_DIR);
      await ensureDir(dir);
      await writeFileContent(
        join(dir, HERMES_FILE),
        [
          "mcp_servers:",
          "  fetch:",
          "    command: uvx",
          "    args: [mcp-server-fetch]",
          "    timeout: 120",
          "  remote:",
          "    url: https://example.com/mcp",
          "  legacy:",
          "    url: https://legacy.example.com/mcp",
          "    enabled: false",
          "",
        ].join("\n"),
      );

      const mcp = await HermesagentMcp.fromFile({ outputRoot: testDir, global: true });
      const rulesync = mcp.toRulesyncMcp();
      const servers = JSON.parse(rulesync.getFileContent()).mcpServers;

      expect(servers.fetch).toMatchObject({
        command: "uvx",
        args: ["mcp-server-fetch"],
        networkTimeout: 120,
      });
      expect(servers.remote).toMatchObject({ url: "https://example.com/mcp" });
      // `enabled: false` maps back to the canonical `disabled: true`.
      expect(servers.legacy).toMatchObject({
        url: "https://legacy.example.com/mcp",
        disabled: true,
      });
      expect(servers.legacy.enabled).toBeUndefined();
    });

    it("maps the Hermes tools block back to canonical enabledTools/disabledTools", async () => {
      const dir = join(testDir, HERMES_DIR);
      await ensureDir(dir);
      await writeFileContent(
        join(dir, HERMES_FILE),
        [
          "mcp_servers:",
          "  fetch:",
          "    command: uvx",
          "    tools:",
          "      include: [search, fetch]",
          "      exclude: [delete]",
          "",
        ].join("\n"),
      );

      const mcp = await HermesagentMcp.fromFile({ outputRoot: testDir, global: true });
      const servers = JSON.parse(mcp.toRulesyncMcp().getFileContent()).mcpServers;

      expect(servers.fetch).toMatchObject({
        command: "uvx",
        enabledTools: ["search", "fetch"],
        disabledTools: ["delete"],
      });
    });

    it("round-trips advanced Hermes per-server fields (issue #2236)", async () => {
      const dir = join(testDir, HERMES_DIR);
      await ensureDir(dir);
      await writeFileContent(
        join(dir, HERMES_FILE),
        [
          "mcp_servers:",
          "  remote:",
          "    url: https://example.com/mcp",
          "    auth: oauth",
          "    client_cert: ~/secrets/mcp-client.pem",
          "    client_key: ~/secrets/client.key",
          "    connect_timeout: 60",
          "    supports_parallel_tool_calls: true",
          "    tools:",
          "      include: [search]",
          "      prompts: true",
          "      resources: false",
          "",
        ].join("\n"),
      );

      // Import into the canonical model.
      const imported = await HermesagentMcp.fromFile({ outputRoot: testDir, global: true });
      const canonical = imported.toRulesyncMcp();
      const server = JSON.parse(canonical.getFileContent()).mcpServers.remote;

      expect(server).toMatchObject({
        url: "https://example.com/mcp",
        auth: "oauth",
        client_cert: "~/secrets/mcp-client.pem",
        client_key: "~/secrets/client.key",
        connect_timeout: 60,
        supports_parallel_tool_calls: true,
        enabledTools: ["search"],
        tools: { prompts: true, resources: false },
      });

      // Re-export back to Hermes and confirm the fields survive unchanged.
      const regenerated = await HermesagentMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: new RulesyncMcp({
          relativeDirPath: ".rulesync",
          relativeFilePath: ".mcp.json",
          fileContent: canonical.getFileContent(),
        }),
        global: true,
      });
      const hermes = getMcpServers(regenerated.getFileContent()).remote;

      expect(hermes).toMatchObject({
        url: "https://example.com/mcp",
        auth: "oauth",
        client_cert: "~/secrets/mcp-client.pem",
        client_key: "~/secrets/client.key",
        connect_timeout: 60,
        supports_parallel_tool_calls: true,
        tools: { include: ["search"], prompts: true, resources: false },
      });
    });

    it("strips prototype-pollution keys from a server's headers on import", async () => {
      const dir = join(testDir, HERMES_DIR);
      await ensureDir(dir);
      await writeFileContent(
        join(dir, HERMES_FILE),
        [
          "mcp_servers:",
          "  remote:",
          "    url: https://example.com/mcp",
          "    headers:",
          "      __proto__: polluted",
          "      constructor: polluted",
          "      Authorization: Bearer safe",
          "",
        ].join("\n"),
      );

      const mcp = await HermesagentMcp.fromFile({ outputRoot: testDir, global: true });
      const servers = JSON.parse(mcp.toRulesyncMcp().getFileContent()).mcpServers;

      expect(servers.remote.headers).toEqual({ Authorization: "Bearer safe" });
    });
  });

  describe("forDeletion", () => {
    it("returns a non-deletable instance", () => {
      const mcp = HermesagentMcp.forDeletion({
        outputRoot: testDir,
        relativeDirPath: HERMES_DIR,
        relativeFilePath: HERMES_FILE,
        global: true,
      });
      expect(mcp).toBeInstanceOf(HermesagentMcp);
      expect(mcp.isDeletable()).toBe(false);
    });
  });

  it("converts Hermes timeout back to canonical networkTimeout", () => {
    const mcp = new HermesagentMcp({
      outputRoot: testDir,
      relativeDirPath: ".hermes",
      relativeFilePath: HERMES_FILE,
      fileContent: `mcp_servers:
  fetch:
    command: uvx
    timeout: 120
`,
      global: true,
    });

    const rulesync = mcp.toRulesyncMcp();
    const servers = JSON.parse(rulesync.getFileContent()).mcpServers;

    expect(servers.fetch.networkTimeout).toBe(120);
    expect(servers.fetch.timeout).toBeUndefined();
  });

  it("merges generated MCP servers when existing Hermes config is loaded later", async () => {
    const rulesyncMcp = new RulesyncMcp({
      outputRoot: testDir,
      relativeDirPath: ".",
      relativeFilePath: ".mcp.json",
      fileContent: JSON.stringify({
        mcpServers: {
          "test-server": {
            command: "echo",
            args: ["hello"],
            env: {},
          },
        },
      }),
    });

    const mcp = await HermesagentMcp.fromRulesyncMcp({
      outputRoot: testDir,
      rulesyncMcp,
      global: true,
    });

    mcp.setFileContent(`model: hermes-3
mcp_servers:
  existing-server:
    command: existing
  test-server:
    command: stale
`);

    const config = mcp.getConfig();
    expect(config.model).toBe("hermes-3");
    expect(getMcpServers(mcp.getFileContent())["existing-server"]?.command).toBe("existing");
    expect(getMcpServers(mcp.getFileContent())["test-server"]?.command).toBe("echo");
    expect(getMcpServers(mcp.getFileContent())["test-server"]?.args).toEqual(["hello"]);
  });
});
