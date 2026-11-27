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

  it("should forward ${VAR} env values through envVars and drop what DeepCode would reject", async () => {
    const warn = vi.fn();
    const mcp = await DeepcodeMcp.fromRulesyncMcp({
      outputRoot: testDir,
      rulesyncMcp: makeRulesyncMcp({
        local: {
          command: "srv",
          env: {
            OPENAI_API_KEY: "${OPENAI_API_KEY}",
            LOG_LEVEL: "debug",
            ROOT: "${workspace}/data",
            DB_PASSWORD: "hunter2",
            RENAMED: "${OTHER}",
          },
        },
      }),
      logger: { warn } as never,
    });

    expect(mcp.getJson().mcpServers).toEqual({
      local: {
        type: "stdio",
        command: "srv",
        env: { LOG_LEVEL: "debug", ROOT: "${workspace}/data" },
        envVars: ["OPENAI_API_KEY"],
      },
    });
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("DB_PASSWORD"));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("RENAMED"));
  });

  it("should read ${VAR} headers from the environment and drop literal secrets", async () => {
    const warn = vi.fn();
    await writeFileContent(
      join(testDir, "deepcode_config.json"),
      JSON.stringify({
        mcpServers: {
          remote: {
            type: "streamableHttp",
            url: "https://example.com/mcp",
            bearerTokenCredential: { connection: "c" },
            approvalMode: "prompt",
          },
        },
      }),
    );

    const mcp = await DeepcodeMcp.fromRulesyncMcp({
      outputRoot: testDir,
      rulesyncMcp: makeRulesyncMcp({
        remote: {
          type: "http",
          url: "https://example.com/mcp",
          headers: {
            Authorization: "Bearer ${GITHUB_TOKEN}",
            "X-Api-Key": "${SERVICE_KEY}",
            "X-Team": "core",
            Cookie: "session=abc",
            "X-Partial": "id-${ID}",
          },
        },
      }),
      logger: { warn } as never,
    });

    expect(mcp.getJson().mcpServers).toEqual({
      remote: {
        type: "streamableHttp",
        url: "https://example.com/mcp",
        headers: { "X-Team": "core" },
        envHttpHeaders: { "X-Api-Key": "SERVICE_KEY" },
        bearerTokenEnvVar: "GITHUB_TOKEN",
        // The stored-credential bearer would conflict with the generated one.
        approvalMode: "prompt",
      },
    });
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("should skip a server whose name DeepCode rejects", async () => {
    const warn = vi.fn();
    const mcp = await DeepcodeMcp.fromRulesyncMcp({
      outputRoot: testDir,
      rulesyncMcp: makeRulesyncMcp({
        "my server": { command: "a" },
        "-dash": { command: "b" },
        ok_name: { command: "c" },
      }),
      logger: { warn } as never,
    });

    expect(Object.keys(mcp.getJson().mcpServers as object)).toEqual(["ok_name"]);
    expect(warn).toHaveBeenCalledTimes(2);
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
          remote: {
            type: "streamableHttp",
            url: "https://example.com/mcp",
            enabled: true,
            envHttpHeaders: { "X-Api-Key": "SERVICE_KEY" },
            bearerTokenEnvVar: "GITHUB_TOKEN",
          },
          forwarded: { type: "stdio", command: "srv", envVars: ["OPENAI_API_KEY"] },
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
      remote: {
        type: "http",
        url: "https://example.com/mcp",
        headers: { "X-Api-Key": "${SERVICE_KEY}", Authorization: "Bearer ${GITHUB_TOKEN}" },
      },
      forwarded: { type: "stdio", command: "srv", env: { OPENAI_API_KEY: "${OPENAI_API_KEY}" } },
    });
  });

  it("should never be deletable", async () => {
    const mcp = await DeepcodeMcp.fromFile({ outputRoot: testDir });
    expect(mcp.isDeletable()).toBe(false);
  });
});
