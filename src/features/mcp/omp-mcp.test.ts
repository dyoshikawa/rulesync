import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { OmpMcp } from "./omp-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

const buildRulesyncMcp = (mcpServers: Record<string, unknown>): RulesyncMcp =>
  new RulesyncMcp({
    relativeDirPath: ".rulesync",
    relativeFilePath: "mcp.json",
    fileContent: JSON.stringify({ mcpServers }),
    validate: false,
  });

describe("OmpMcp", () => {
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

  it("should return .omp/mcp.json for project and .omp/agent/mcp.json for global", () => {
    expect(OmpMcp.getSettablePaths()).toEqual({
      relativeDirPath: ".omp",
      relativeFilePath: "mcp.json",
    });
    expect(OmpMcp.getSettablePaths({ global: true })).toEqual({
      relativeDirPath: join(".omp", "agent"),
      relativeFilePath: "mcp.json",
    });
  });

  describe("fromRulesyncMcp", () => {
    it("should convert stdio and remote servers to oh-my-pi's mcpServers map", async () => {
      const mcp = await OmpMcp.fromRulesyncMcp({
        outputRoot: testDir,
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
            timeout: 5000,
          },
          legacy: { transport: "sse", url: "https://example.com/sse" },
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
            timeout: 5000,
          },
          legacy: { type: "sse", url: "https://example.com/sse" },
        },
      });
    });

    it("should skip servers oh-my-pi cannot start or reach", async () => {
      const logger = createMockLogger();
      const mcp = await OmpMcp.fromRulesyncMcp({
        outputRoot: testDir,
        logger,
        rulesyncMcp: buildRulesyncMcp({
          socket: { type: "ws", url: "wss://example.com" },
          noUrl: { type: "http" },
          noCommand: { type: "stdio" },
        }),
      });

      expect(mcp.getJson()).toEqual({ mcpServers: {} });
      expect(logger.warn).toHaveBeenCalledTimes(3);
    });

    it("should preserve other top-level keys of an existing file", async () => {
      await writeFileContent(
        join(testDir, ".omp", "mcp.json"),
        JSON.stringify({ $schema: "schema", disabledServers: ["x"], mcpServers: { old: {} } }),
      );

      const mcp = await OmpMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: buildRulesyncMcp({ local: { command: "server" } }),
      });

      expect(mcp.getJson()).toEqual({
        $schema: "schema",
        disabledServers: ["x"],
        mcpServers: { local: { type: "stdio", command: "server" } },
      });
    });

    it("should fail on a malformed existing file", async () => {
      await writeFileContent(join(testDir, ".omp", "mcp.json"), "[1]");

      await expect(
        OmpMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp: buildRulesyncMcp({}) }),
      ).rejects.toThrow(/expected a JSON object/);
    });
  });

  describe("toRulesyncMcp", () => {
    it("should import servers and map enabled: false to disabled: true", async () => {
      await writeFileContent(
        join(testDir, ".omp", "agent", "mcp.json"),
        JSON.stringify({
          mcpServers: {
            local: { command: "server", enabled: false },
            remote: { type: "http", url: "https://example.com/mcp", enabled: true },
          },
        }),
      );

      const mcp = await OmpMcp.fromFile({ outputRoot: testDir, global: true });

      expect(mcp.isDeletable()).toBe(false);
      expect(mcp.toRulesyncMcp().getJson().mcpServers).toEqual({
        local: { command: "server", disabled: true },
        remote: { type: "http", url: "https://example.com/mcp" },
      });
    });
  });
});
