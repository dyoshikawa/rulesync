import { join } from "node:path";

import { dump, load } from "js-yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POOL_GLOBAL_DIR } from "../../constants/pool-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { PoolMcp } from "./pool-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

describe("PoolMcp", () => {
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
  const source = (mcpServers: Record<string, unknown>) =>
    new RulesyncMcp({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "mcp.json",
      fileContent: JSON.stringify({ mcpServers }),
    });
  const native = (config: unknown) =>
    new PoolMcp({
      outputRoot: testDir,
      ...PoolMcp.getSettablePaths(),
      fileContent: dump(config),
    });

  it.each([false, true])(
    "preserves shared settings and regenerates idempotently (global=%s)",
    async (global) => {
      const paths = PoolMcp.getSettablePaths({ global });
      expect(paths.relativeDirPath).toBe(global ? POOL_GLOBAL_DIR : ".poolside");
      const filePath = join(testDir, paths.relativeDirPath, paths.relativeFilePath);
      const siblings = {
        model: "custom-model",
        permissions: { allow: ["Read"] },
        hooks: { start: [] },
      };
      await writeFileContent(
        filePath,
        dump({ ...siblings, mcp_servers: { stale: { command: "old" } } }),
      );
      const rulesyncMcp = source({
        local: {
          command: ["node", "server.js"],
          args: ["--debug"],
          cwd: "./tools",
          env: { TOKEN: "example" },
          disabled: false,
          enabledTools: [],
          disabledTools: ["delete_*"],
          allow: ["read_*"],
        },
      });
      const generated = await PoolMcp.fromRulesyncMcp({ outputRoot: testDir, global, rulesyncMcp });
      expect(load(generated.getFileContent())).toEqual({
        ...siblings,
        mcp_servers: {
          local: {
            command: "node",
            args: ["server.js", "--debug"],
            cwd: "./tools",
            env: { TOKEN: "example" },
            disabled: false,
            enabled_tools: [],
            deny: ["delete_*"],
            allow: ["read_*"],
          },
        },
      });
      expect(generated.isDeletable()).toBe(false);
      await writeFileContent(filePath, generated.getFileContent());
      const imported = (await PoolMcp.fromFile({ outputRoot: testDir, global })).toRulesyncMcp();
      expect(imported.getMcpServers().local).toEqual({
        command: "node",
        args: ["server.js", "--debug"],
        cwd: "./tools",
        env: { TOKEN: "example" },
        disabled: false,
        enabledTools: [],
        disabledTools: ["delete_*"],
        allow: ["read_*"],
      });
      const regenerated = await PoolMcp.fromRulesyncMcp({
        outputRoot: testDir,
        global,
        rulesyncMcp: imported,
      });
      expect(regenerated.getFileContent()).toBe(generated.getFileContent());
    },
  );

  it("round-trips nested remote transports, headers containing colons and filters", async () => {
    const mcpServers = {
      remote: {
        type: "http",
        url: "https://example.com/mcp",
        headers: { Authorization: "Bearer a:b", Empty: "" },
        env: { TOKEN: "example" },
        disabled: true,
      },
      events: { type: "sse", url: "https://example.com/events", enabledTools: ["read"] },
    };
    const generated = await PoolMcp.fromRulesyncMcp({ rulesyncMcp: source(mcpServers) });
    expect(load(generated.getFileContent())).toMatchObject({
      mcp_servers: {
        remote: {
          transport: {
            type: "http",
            url: mcpServers.remote.url,
            headers: ["Authorization: Bearer a:b", "Empty: "],
          },
        },
        events: { transport: { type: "sse" }, enabled_tools: ["read"] },
      },
    });
    expect(generated.toRulesyncMcp().getMcpServers()).toEqual(mcpServers);
  });

  it("warns and skips unsupported or incomplete transports", async () => {
    const logger = createMockLogger();
    const generated = await PoolMcp.fromRulesyncMcp({
      logger,
      rulesyncMcp: source({
        socket: { type: "ws", url: "wss://example.com" },
        missing: { type: "http" },
        empty: { command: "" },
        kept: { command: "echo" },
      }),
    });
    expect(load(generated.getFileContent())).toEqual({
      mcp_servers: { kept: { command: "echo", args: [] } },
    });
    expect(logger.warn).toHaveBeenCalledTimes(3);
  });

  it.each([["missing-colon"], ["X-Test: one", "x-test: two"], [": value"]])(
    "rejects unrepresentable headers without exposing values (%j)",
    (...headers) => {
      expect(() =>
        native({
          mcp_servers: {
            remote: { transport: { type: "http", url: "https://example.com", headers } },
          },
        }).toRulesyncMcp(),
      ).toThrow("Pool MCP headers");
    },
  );

  it.each(["[invalid", "- not-a-settings-object"])(
    "fails closed on malformed shared settings: %s",
    async (fileContent) => {
      await writeFileContent(join(testDir, ".poolside", "settings.yaml"), fileContent);
      await expect(PoolMcp.fromRulesyncMcp({ rulesyncMcp: source({}) })).rejects.toThrow();
    },
  );

  it("imports an absent file as empty without copying unrelated settings", async () => {
    expect(
      (await PoolMcp.fromFile({ outputRoot: testDir })).toRulesyncMcp().getMcpServers(),
    ).toEqual({});
    expect(native({ model: "custom" }).toRulesyncMcp().getMcpServers()).toEqual({});
  });
});
