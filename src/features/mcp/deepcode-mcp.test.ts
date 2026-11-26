import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { DeepcodeMcp } from "./deepcode-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

describe("DeepcodeMcp", () => {
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

  const makeRulesyncMcp = (mcpServers: Record<string, unknown>) =>
    new RulesyncMcp({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "mcp.json",
      fileContent: JSON.stringify({ mcpServers }),
    });

  it("should write deepcode_config.json at the project root and under .deepcode globally", () => {
    expect(DeepcodeMcp.getSettablePaths()).toEqual({
      relativeDirPath: ".",
      relativeFilePath: "deepcode_config.json",
    });
    expect(DeepcodeMcp.getSettablePaths({ global: true })).toEqual({
      relativeDirPath: ".deepcode",
      relativeFilePath: "deepcode_config.json",
    });
  });

  it("should always write an explicit transport type", async () => {
    const mcp = await DeepcodeMcp.fromRulesyncMcp({
      outputRoot: testDir,
      rulesyncMcp: makeRulesyncMcp({
        local: { command: "npx", args: ["-y", "server"], env: { TOKEN: "x" }, disabled: true },
        remote: { url: "https://example.com/mcp", headers: { "X-Key": "v" } },
        events: { type: "sse", url: "https://example.com/sse" },
        filtered: { command: "srv", enabledTools: ["a"], disabledTools: ["b"] },
      }),
    });

    expect(mcp.getJson().mcpServers).toEqual({
      local: {
        type: "stdio",
        command: "npx",
        args: ["-y", "server"],
        env: { TOKEN: "x" },
        enabled: false,
      },
      remote: {
        type: "streamableHttp",
        url: "https://example.com/mcp",
        headers: { "X-Key": "v" },
      },
      events: { type: "sse", url: "https://example.com/sse" },
      filtered: { type: "stdio", command: "srv", enabledTools: ["a"], disabledTools: ["b"] },
    });
  });

  it("should skip a WebSocket server with a warning", async () => {
    const warn = vi.fn();
    const mcp = await DeepcodeMcp.fromRulesyncMcp({
      outputRoot: testDir,
      rulesyncMcp: makeRulesyncMcp({ ws: { type: "ws", url: "wss://example.com" } }),
      logger: { warn } as never,
    });

    expect(mcp.getJson().mcpServers).toEqual({});
    expect(warn).toHaveBeenCalledOnce();
  });

  it("should keep other config keys and the native-only keys of existing servers", async () => {
    await writeFileContent(
      join(testDir, "deepcode_config.json"),
      JSON.stringify({
        security: { accessPreset: "ask" },
        agents: { defaults: { model: "m" } },
        mcpServers: {
          local: {
            type: "stdio",
            command: "old",
            args: ["stale"],
            approvalMode: "prompt",
            credentialEnv: { TOKEN: { connection: "c" } },
            toolTimeoutSeconds: 120,
          },
          moved: {
            type: "streamableHttp",
            url: "https://example.com",
            bearerTokenEnvVar: "TOKEN",
            deferLoading: true,
          },
          gone: { type: "stdio", command: "gone" },
        },
      }),
    );

    const mcp = await DeepcodeMcp.fromRulesyncMcp({
      outputRoot: testDir,
      rulesyncMcp: makeRulesyncMcp({
        local: { command: "new" },
        moved: { command: "local-now" },
      }),
    });
    const json = mcp.getJson();

    expect(json.security).toEqual({ accessPreset: "ask" });
    expect(json.agents).toEqual({ defaults: { model: "m" } });
    expect(json.mcpServers).toEqual({
      local: {
        type: "stdio",
        command: "new",
        approvalMode: "prompt",
        credentialEnv: { TOKEN: { connection: "c" } },
        toolTimeoutSeconds: 120,
      },
      // `bearerTokenEnvVar` is rejected on a stdio server, so it is not kept.
      moved: { type: "stdio", command: "local-now", deferLoading: true },
    });
  });

  it("should import only the keys rulesync models", async () => {
    await writeFileContent(
      join(testDir, "deepcode_config.json"),
      JSON.stringify({
        security: { permissions: { bash: "ask" } },
        mcpServers: {
          local: {
            type: "stdio",
            command: "npx",
            args: ["srv"],
            enabled: false,
            enabled_tools: ["a"],
            approvalMode: "prompt",
            tools: { a: { approvalMode: "prompt" } },
          },
          remote: { type: "streamableHttp", url: "https://example.com/mcp", enabled: true },
        },
      }),
    );

    const mcp = await DeepcodeMcp.fromFile({ outputRoot: testDir });
    const rulesync = mcp.toRulesyncMcp();

    expect(rulesync.getJson().mcpServers).toEqual({
      local: {
        type: "stdio",
        command: "npx",
        args: ["srv"],
        disabled: true,
        enabledTools: ["a"],
      },
      remote: { type: "http", url: "https://example.com/mcp" },
    });
  });

  it("should never be deletable", async () => {
    const mcp = await DeepcodeMcp.fromFile({ outputRoot: testDir });
    expect(mcp.isDeletable()).toBe(false);
  });
});
