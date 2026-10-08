import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { PiMcp } from "./pi-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

const buildRulesyncMcp = (mcpServers: Record<string, unknown>): RulesyncMcp =>
  new RulesyncMcp({
    relativeDirPath: ".rulesync",
    relativeFilePath: "mcp.json",
    fileContent: JSON.stringify({ mcpServers }),
    validate: false,
  });

describe("PiMcp", () => {
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

  it("should return .pi/mcp.json for project and .pi/agent/mcp.json for global", () => {
    expect(PiMcp.getSettablePaths()).toEqual({
      relativeDirPath: ".pi",
      relativeFilePath: "mcp.json",
    });
    expect(PiMcp.getSettablePaths({ global: true })).toEqual({
      relativeDirPath: join(".pi", "agent"),
      relativeFilePath: "mcp.json",
    });
  });

  describe("fromRulesyncMcp", () => {
    it("should convert stdio and remote servers to Pi's mcpServers map", async () => {
      const logger = createMockLogger();
      const mcp = await PiMcp.fromRulesyncMcp({
        outputRoot: testDir,
        logger,
        rulesyncMcp: buildRulesyncMcp({
          local: {
            command: ["npx", "-y"],
            args: ["server"],
            env: { TOKEN: "${TOKEN}" },
            disabled: true,
          },
          remote: {
            type: "streamable-http",
            url: "https://example.com/mcp",
            headers: { Authorization: "Bearer ${API_KEY}" },
            timeout: 30000,
            exposure: "direct",
          },
        }),
      });

      expect(mcp.getJson()).toEqual({
        mcpServers: {
          local: {
            type: "stdio",
            command: "npx",
            args: ["-y", "server"],
            env: { TOKEN: "${TOKEN}" },
            enabled: false,
          },
          remote: {
            type: "http",
            url: "https://example.com/mcp",
            headers: { Authorization: "Bearer ${API_KEY}" },
            timeout: 30,
            exposure: "direct",
          },
        },
      });
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("should skip servers Pi cannot start or reach", async () => {
      const logger = createMockLogger();
      const mcp = await PiMcp.fromRulesyncMcp({
        outputRoot: testDir,
        logger,
        rulesyncMcp: buildRulesyncMcp({
          legacy: { transport: "sse", url: "https://example.com/sse" },
          socket: { type: "ws", url: "wss://example.com" },
          noUrl: { type: "http" },
          wsUrl: { url: "ws://example.com/mcp" },
          noCommand: { type: "stdio" },
          noTransport: { disabled: true },
        }),
      });

      expect(mcp.getJson()).toEqual({ mcpServers: {} });
      expect(logger.warn).toHaveBeenCalledTimes(6);
    });

    it("should skip server names Pi rejects or treats as the same server", async () => {
      const logger = createMockLogger();
      const mcp = await PiMcp.fromRulesyncMcp({
        outputRoot: testDir,
        logger,
        rulesyncMcp: buildRulesyncMcp({
          "my-server": { command: "a" },
          my_server: { command: "b" },
          "github.com": { command: "c" },
        }),
      });

      expect(mcp.getJson().mcpServers).toEqual({
        "my-server": { type: "stdio", command: "a" },
      });
      expect(logger.warn).toHaveBeenCalledTimes(2);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('"my_server"'));
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('"github.com"'));
    });

    it("should drop auth from the project file but keep it in the global one", async () => {
      const servers = {
        remote: { url: "https://example.com/mcp", auth: { provider: "github" } },
      };
      const logger = createMockLogger();
      const project = await PiMcp.fromRulesyncMcp({
        outputRoot: testDir,
        logger,
        rulesyncMcp: buildRulesyncMcp(servers),
      });
      const global = await PiMcp.fromRulesyncMcp({
        outputRoot: testDir,
        global: true,
        rulesyncMcp: buildRulesyncMcp(servers),
      });

      expect(project.getJson().mcpServers).toEqual({
        remote: { type: "http", url: "https://example.com/mcp" },
      });
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('"auth"'));
      expect(global.getJson().mcpServers).toEqual({
        remote: { type: "http", url: "https://example.com/mcp", auth: { provider: "github" } },
      });
    });

    it("should drop a non-positive timeout with a warning", async () => {
      const logger = createMockLogger();
      const mcp = await PiMcp.fromRulesyncMcp({
        outputRoot: testDir,
        logger,
        rulesyncMcp: buildRulesyncMcp({ local: { command: "server", timeout: 0 } }),
      });

      expect(mcp.getJson()).toEqual({
        mcpServers: { local: { type: "stdio", command: "server" } },
      });
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('"timeout"'));
    });

    it("should warn about environment variable references Pi does not expand", async () => {
      const logger = createMockLogger();
      const mcp = await PiMcp.fromRulesyncMcp({
        outputRoot: testDir,
        logger,
        rulesyncMcp: buildRulesyncMcp({
          homeArg: { command: "server", args: ["${HOME}/data"] },
          defaultEnv: { command: "server", env: { TOKEN: "${TOKEN:-none}" } },
          tilde: { command: "server", args: ["~/data"], env: { TOKEN: "$TOKEN" } },
        }),
      });

      expect(mcp.getJson().mcpServers).toEqual({
        homeArg: { type: "stdio", command: "server", args: ["${HOME}/data"] },
        defaultEnv: { type: "stdio", command: "server", env: { TOKEN: "${TOKEN:-none}" } },
        tilde: { type: "stdio", command: "server", args: ["~/data"], env: { TOKEN: "$TOKEN" } },
      });
      expect(logger.warn).toHaveBeenCalledTimes(2);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('"homeArg"'));
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('"defaultEnv"'));
    });

    it("should preserve other top-level keys of an existing file", async () => {
      await writeFileContent(
        join(testDir, ".pi", "mcp.json"),
        JSON.stringify({ autoEnableCodemode: false, mcpServers: { old: { command: "old" } } }),
      );

      const mcp = await PiMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: buildRulesyncMcp({ local: { command: "server" } }),
      });

      expect(mcp.getJson()).toEqual({
        autoEnableCodemode: false,
        mcpServers: { local: { type: "stdio", command: "server" } },
      });
    });

    it("should fail on a malformed existing file", async () => {
      await writeFileContent(join(testDir, ".pi", "mcp.json"), "[1]");

      await expect(
        PiMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp: buildRulesyncMcp({}) }),
      ).rejects.toThrow(/expected a JSON object/);
    });
  });

  describe("toRulesyncMcp", () => {
    it("should import servers, mapping enabled: false and second-based timeouts", async () => {
      await writeFileContent(
        join(testDir, ".pi", "agent", "mcp.json"),
        JSON.stringify({
          mcpServers: {
            local: { command: "server", enabled: false, timeout: 1.5 },
            remote: { type: "streamable-http", url: "https://example.com/mcp", enabled: true },
          },
        }),
      );

      const mcp = await PiMcp.fromFile({ outputRoot: testDir, global: true });

      expect(mcp.isDeletable()).toBe(false);
      expect(mcp.toRulesyncMcp().getJson().mcpServers).toEqual({
        local: { command: "server", disabled: true, timeout: 1500 },
        remote: { type: "streamable-http", url: "https://example.com/mcp" },
      });
    });

    it("should keep the project file deletable", async () => {
      const mcp = await PiMcp.fromFile({ outputRoot: testDir });

      expect(mcp.isDeletable()).toBe(true);
    });
  });
});
