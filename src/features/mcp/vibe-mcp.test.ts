import { join } from "node:path";

import * as smolToml from "smol-toml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import { VibeMcp } from "./vibe-mcp.js";

const buildRulesyncMcp = ({
  testDir,
  servers,
}: {
  testDir: string;
  servers: Record<string, Record<string, unknown>>;
}): RulesyncMcp =>
  new RulesyncMcp({
    outputRoot: testDir,
    relativeDirPath: ".rulesync",
    relativeFilePath: "mcp.json",
    fileContent: JSON.stringify({ mcpServers: servers }),
  });

describe("VibeMcp", () => {
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

  it("should export rulesync MCP servers as Vibe mcp_servers and preserve config keys", async () => {
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      [
        'active_model = "devstral"',
        'enabled_tools = ["read_file"]',
        "",
        "[tools.bash]",
        'permission = "ask"',
      ].join("\n"),
    );

    const rulesyncMcp = new RulesyncMcp({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "mcp.json",
      fileContent: JSON.stringify({
        mcpServers: {
          local: {
            type: "stdio",
            command: "node",
            args: ["server.js"],
            env: { NODE_ENV: "test" },
            startup_timeout_sec: 5,
          },
          remote: {
            type: "http",
            url: "https://example.com/mcp",
            headers: { Authorization: "Bearer token" },
            api_key_env: "MCP_TOKEN",
            api_key_header: "Authorization",
            api_key_format: "Bearer {token}",
          },
        },
      }),
    });

    const vibeMcp = await VibeMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp });
    const parsed = smolToml.parse(vibeMcp.getFileContent()) as any;

    expect(parsed.active_model).toBe("devstral");
    expect(parsed.enabled_tools).toEqual(["read_file"]);
    expect(parsed.tools.bash.permission).toBe("ask");
    expect(parsed.mcp_servers).toMatchObject([
      {
        name: "local",
        transport: "stdio",
        command: "node",
        args: ["server.js"],
        env: { NODE_ENV: "test" },
        startup_timeout_sec: 5,
      },
      {
        name: "remote",
        transport: "http",
        url: "https://example.com/mcp",
        headers: { Authorization: "Bearer token" },
        api_key_env: "MCP_TOKEN",
        api_key_header: "Authorization",
        api_key_format: "Bearer {token}",
      },
    ]);
  });

  it("should import Vibe mcp_servers into rulesync mcpServers", () => {
    const fileContent = [
      "[[mcp_servers]]",
      'name = "fetch"',
      'transport = "http"',
      'url = "https://example.com/mcp"',
      'headers = { Authorization = "Bearer token" }',
      "tool_timeout_sec = 30",
      "",
      "[[mcp_servers]]",
      'name = "local"',
      'transport = "stdio"',
      'command = "node"',
      'args = ["server.js"]',
      'env = { NODE_ENV = "test" }',
    ].join("\n");

    const vibeMcp = new VibeMcp({
      outputRoot: testDir,
      relativeDirPath: ".vibe",
      relativeFilePath: "config.toml",
      fileContent,
    });

    const rulesyncMcp = vibeMcp.toRulesyncMcp();
    const parsed = JSON.parse(rulesyncMcp.getFileContent());

    expect(parsed.mcpServers).toMatchObject({
      fetch: {
        type: "http",
        transport: "http",
        url: "https://example.com/mcp",
        headers: { Authorization: "Bearer token" },
        tool_timeout_sec: 30,
      },
      local: {
        type: "stdio",
        transport: "stdio",
        command: "node",
        args: ["server.js"],
        env: { NODE_ENV: "test" },
      },
    });
  });

  it("should emit stdio cwd and round-trip it on import", async () => {
    const rulesyncMcp = new RulesyncMcp({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "mcp.json",
      fileContent: JSON.stringify({
        mcpServers: {
          local: {
            type: "stdio",
            command: "node",
            args: ["server.js"],
            cwd: "/srv/project",
          },
        },
      }),
    });

    const vibeMcp = await VibeMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp });
    const parsed = smolToml.parse(vibeMcp.getFileContent()) as any;
    expect(parsed.mcp_servers[0].cwd).toBe("/srv/project");

    // Round-trips back into the canonical schema on import.
    const imported = JSON.parse(vibeMcp.toRulesyncMcp().getFileContent());
    expect(imported.mcpServers.local.cwd).toBe("/srv/project");
  });

  it("should emit a structured auth block and suppress legacy static-auth keys", async () => {
    const rulesyncMcp = new RulesyncMcp({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "mcp.json",
      fileContent: JSON.stringify({
        mcpServers: {
          remote: {
            type: "http",
            url: "https://example.com/mcp",
            // Legacy top-level static-auth keys must not be emitted alongside an
            // explicit `auth` block (upstream rejects the mix).
            headers: { Authorization: "Bearer legacy" },
            api_key_env: "LEGACY_TOKEN",
            auth: {
              type: "oauth",
              scopes: ["read", "write"],
              client_id: "abc123",
              redirect_port: 47823,
            },
          },
        },
      }),
    });

    const vibeMcp = await VibeMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp });
    const parsed = smolToml.parse(vibeMcp.getFileContent()) as any;
    const server = parsed.mcp_servers[0];

    expect(server.auth).toMatchObject({
      type: "oauth",
      scopes: ["read", "write"],
      client_id: "abc123",
      redirect_port: 47823,
    });
    expect(server.headers).toBeUndefined();
    expect(server.api_key_env).toBeUndefined();

    // The auth block round-trips on import.
    const imported = JSON.parse(vibeMcp.toRulesyncMcp().getFileContent());
    expect(imported.mcpServers.remote.auth.type).toBe("oauth");
  });

  it("should pass through and round-trip a static auth block", async () => {
    const rulesyncMcp = new RulesyncMcp({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "mcp.json",
      fileContent: JSON.stringify({
        mcpServers: {
          remote: {
            type: "http",
            url: "https://example.com/mcp",
            auth: {
              type: "static",
              headers: { "X-Custom": "value" },
              api_key_env: "MCP_TOKEN",
              api_key_header: "Authorization",
              api_key_format: "Bearer {token}",
            },
          },
        },
      }),
    });

    const vibeMcp = await VibeMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp });
    const parsed = smolToml.parse(vibeMcp.getFileContent()) as any;
    expect(parsed.mcp_servers[0].auth).toMatchObject({
      type: "static",
      api_key_env: "MCP_TOKEN",
    });

    const imported = JSON.parse(vibeMcp.toRulesyncMcp().getFileContent());
    expect(imported.mcpServers.remote.auth).toMatchObject({
      type: "static",
      api_key_env: "MCP_TOKEN",
    });
  });

  it("should not be deletable because config.toml is shared", () => {
    const vibeMcp = VibeMcp.forDeletion({
      outputRoot: testDir,
      relativeDirPath: ".vibe",
      relativeFilePath: "config.toml",
    });

    expect(vibeMcp.isDeletable()).toBe(false);
  });

  it("should preserve the keys a user sets through Vibe's /mcp panel", async () => {
    // `mcp_servers` is replaced as a whole array on each generate, so a toggle
    // the user made in the TUI has to be carried over explicitly.
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      [
        "[[mcp_servers]]",
        'name = "srv"',
        'transport = "stdio"',
        'command = "node"',
        "disabled = true",
        'disabled_tools = ["danger"]',
        "sampling_enabled = true",
        'prompt = "Use sparingly"',
      ].join("\n"),
    );

    const vibeMcp = await VibeMcp.fromRulesyncMcp({
      outputRoot: testDir,
      rulesyncMcp: buildRulesyncMcp({ testDir, servers: { srv: { command: "node" } } }),
    });

    const server = (smolToml.parse(vibeMcp.getFileContent()) as any).mcp_servers[0];
    expect(server).toMatchObject({
      name: "srv",
      command: "node",
      disabled: true,
      disabled_tools: ["danger"],
      sampling_enabled: true,
      prompt: "Use sparingly",
    });
  });

  it("should let the rulesync source override a user toggle", async () => {
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      ["[[mcp_servers]]", 'name = "srv"', 'command = "node"', "disabled = true"].join("\n"),
    );

    const vibeMcp = await VibeMcp.fromRulesyncMcp({
      outputRoot: testDir,
      rulesyncMcp: buildRulesyncMcp({
        testDir,
        servers: { srv: { command: "node", disabled: false } },
      }),
    });

    const server = (smolToml.parse(vibeMcp.getFileContent()) as any).mcp_servers[0];
    expect(server.disabled).toBe(false);
  });

  it("should map disabled_tools to the canonical disabledTools in both directions", async () => {
    const vibeMcp = await VibeMcp.fromRulesyncMcp({
      outputRoot: testDir,
      rulesyncMcp: buildRulesyncMcp({
        testDir,
        servers: { srv: { command: "node", disabledTools: ["danger"] } },
      }),
    });

    const server = (smolToml.parse(vibeMcp.getFileContent()) as any).mcp_servers[0];
    expect(server.disabled_tools).toEqual(["danger"]);
    expect(server.disabledTools).toBeUndefined();

    const imported = JSON.parse(vibeMcp.toRulesyncMcp().getFileContent());
    expect(imported.mcpServers.srv.disabledTools).toEqual(["danger"]);
  });

  it("should preserve servers added outside rulesync (vibe mcp add) after the managed entries", async () => {
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      [
        "[[mcp_servers]]",
        'name = "added-by-vibe-mcp-add"',
        'transport = "streamable_http"',
        'url = "https://example.com/mcp"',
        "",
        "[[mcp_servers]]",
        'name = "managed"',
        'command = "old-command"',
      ].join("\n"),
    );

    const vibeMcp = await VibeMcp.fromRulesyncMcp({
      outputRoot: testDir,
      rulesyncMcp: buildRulesyncMcp({
        testDir,
        servers: { managed: { command: "node" } },
      }),
    });

    const servers = (smolToml.parse(vibeMcp.getFileContent()) as any).mcp_servers;
    expect(servers.map((server: any) => server.name)).toEqual(["managed", "added-by-vibe-mcp-add"]);
    expect(servers[0].command).toBe("node");
    expect(servers[1].url).toBe("https://example.com/mcp");
  });
});
