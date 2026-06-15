import { join } from "node:path";

import * as smolToml from "smol-toml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import { VibeMcp } from "./vibe-mcp.js";

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

  it("should not be deletable because config.toml is shared", () => {
    const vibeMcp = VibeMcp.forDeletion({
      outputRoot: testDir,
      relativeDirPath: ".vibe",
      relativeFilePath: "config.toml",
    });

    expect(vibeMcp.isDeletable()).toBe(false);
  });
});
