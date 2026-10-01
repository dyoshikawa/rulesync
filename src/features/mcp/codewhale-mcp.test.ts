import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { CodewhaleMcp } from "./codewhale-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

const buildRulesyncMcp = (mcpServers: Record<string, unknown>): RulesyncMcp =>
  new RulesyncMcp({
    relativeDirPath: ".rulesync",
    relativeFilePath: "mcp.json",
    fileContent: JSON.stringify({ mcpServers }),
    validate: false,
  });

describe("CodewhaleMcp", () => {
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
    it("should return .codewhale/mcp.json for both scopes", () => {
      for (const global of [false, true]) {
        const paths = CodewhaleMcp.getSettablePaths({ global });
        expect(paths.relativeDirPath).toBe(".codewhale");
        expect(paths.relativeFilePath).toBe("mcp.json");
      }
    });
  });

  describe("fromRulesyncMcp", () => {
    it("should convert stdio and remote servers to Codewhale's servers map", async () => {
      const mcp = await CodewhaleMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: buildRulesyncMcp({
          local: {
            type: "stdio",
            command: "npx",
            args: ["-y", "server"],
            env: { A: "1" },
            enabledTools: ["read"],
          },
          remote: { type: "http", url: "https://example.com/mcp", disabledTools: ["write"] },
          legacy: { type: "sse", url: "https://example.com/sse" },
        }),
      });

      expect(mcp.getJson()).toEqual({
        servers: {
          local: {
            command: "npx",
            args: ["-y", "server"],
            env: { A: "1" },
            enabled_tools: ["read"],
          },
          remote: { url: "https://example.com/mcp", disabled_tools: ["write"] },
          legacy: { url: "https://example.com/sse", transport: "sse" },
        },
      });
    });

    it("should skip WebSocket servers and servers without a command, with warnings", async () => {
      const logger = createMockLogger();
      const mcp = await CodewhaleMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: buildRulesyncMcp({
          socket: { type: "ws", url: "wss://example.com" },
          empty: { type: "stdio" },
        }),
        logger,
      });

      expect(mcp.getJson()).toEqual({ servers: {} });
      expect(logger.warn).toHaveBeenCalledTimes(2);
    });

    it("should preserve sibling keys and keep the mcpServers alias the file already uses", async () => {
      await writeFileContent(
        join(testDir, ".codewhale", "mcp.json"),
        JSON.stringify({ timeouts: { connect: 5 }, mcpServers: { old: { command: "old" } } }),
      );

      const mcp = await CodewhaleMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: buildRulesyncMcp({ fresh: { command: "fresh" } }),
      });

      expect(mcp.getJson()).toEqual({
        timeouts: { connect: 5 },
        mcpServers: { fresh: { command: "fresh" } },
      });
    });

    it("should map canonical millisecond timeouts to whole-second Codewhale fields", async () => {
      const mcp = await CodewhaleMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: buildRulesyncMcp({
          local: { command: "npx", timeout: 60000, networkTimeout: 1500, read_timeout: 90 },
        }),
      });

      expect(mcp.getJson()).toEqual({
        servers: {
          local: { command: "npx", execute_timeout: 60, connect_timeout: 2, read_timeout: 90 },
        },
      });
    });

    it("should let an explicit Codewhale timeout win over its canonical twin", async () => {
      const mcp = await CodewhaleMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: buildRulesyncMcp({
          local: { command: "npx", timeout: 60000, execute_timeout: 300 },
        }),
      });

      expect(mcp.getJson()).toEqual({
        servers: { local: { command: "npx", execute_timeout: 300 } },
      });
    });

    it("should drop a negative or zero timeout with a warning", async () => {
      const logger = createMockLogger();
      const mcp = await CodewhaleMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: buildRulesyncMcp({
          local: { command: "npx", timeout: -1, networkTimeout: 0 },
        }),
        logger,
      });

      expect(mcp.getJson()).toEqual({ servers: { local: { command: "npx" } } });
      expect(logger.warn).toHaveBeenCalledTimes(2);
    });

    it("should fail closed on a malformed existing file", async () => {
      await writeFileContent(join(testDir, ".codewhale", "mcp.json"), "[]");

      await expect(
        CodewhaleMcp.fromRulesyncMcp({
          outputRoot: testDir,
          rulesyncMcp: buildRulesyncMcp({}),
        }),
      ).rejects.toThrow(/expected a JSON object/);
    });
  });

  describe("toRulesyncMcp", () => {
    it("should convert Codewhale servers back to the canonical shape", async () => {
      await writeFileContent(
        join(testDir, ".codewhale", "mcp.json"),
        JSON.stringify({
          servers: {
            legacy: { url: "https://example.com/sse", transport: "sse" },
            local: { command: "npx", enabled_tools: ["read"], disabled_tools: ["write"] },
          },
        }),
      );

      const mcp = await CodewhaleMcp.fromFile({ outputRoot: testDir });
      const servers = mcp.toRulesyncMcp().getMcpServers();

      expect(servers).toEqual({
        legacy: { url: "https://example.com/sse", type: "sse" },
        local: { command: "npx", enabledTools: ["read"], disabledTools: ["write"] },
      });
    });

    it("should convert second-based timeouts back to canonical milliseconds", async () => {
      await writeFileContent(
        join(testDir, ".codewhale", "mcp.json"),
        JSON.stringify({
          servers: {
            local: { command: "npx", execute_timeout: 60, connect_timeout: 30, read_timeout: 120 },
          },
        }),
      );

      const mcp = await CodewhaleMcp.fromFile({ outputRoot: testDir });

      expect(mcp.toRulesyncMcp().getMcpServers()).toEqual({
        local: { command: "npx", timeout: 60000, networkTimeout: 30000, read_timeout: 120 },
      });
    });

    it("should read the mcpServers alias", async () => {
      await writeFileContent(
        join(testDir, ".codewhale", "mcp.json"),
        JSON.stringify({ mcpServers: { local: { command: "npx" } } }),
      );

      const mcp = await CodewhaleMcp.fromFile({ outputRoot: testDir });

      expect(mcp.toRulesyncMcp().getMcpServers()).toEqual({ local: { command: "npx" } });
    });
  });

  it("should never be deletable", () => {
    expect(
      CodewhaleMcp.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".codewhale",
        relativeFilePath: "mcp.json",
      }).isDeletable(),
    ).toBe(false);
  });
});
