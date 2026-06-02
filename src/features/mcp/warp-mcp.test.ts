import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_MCP_SCHEMA_URL,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import { WarpMcp } from "./warp-mcp.js";

describe("WarpMcp", () => {
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
    it("should return .warp/.mcp.json for project scope", () => {
      const paths = WarpMcp.getSettablePaths();

      expect(paths).toEqual({
        relativeDirPath: ".warp",
        relativeFilePath: ".mcp.json",
      });
    });

    it("should return .warp/.mcp.json for global scope", () => {
      const paths = WarpMcp.getSettablePaths({ global: true });

      expect(paths).toEqual({
        relativeDirPath: ".warp",
        relativeFilePath: ".mcp.json",
      });
    });
  });

  describe("constructor", () => {
    it("should parse JSON content", () => {
      const jsonData = {
        mcpServers: {
          "test-server": {
            command: "node",
            args: ["server.js"],
          },
        },
      };

      const warpMcp = new WarpMcp({
        relativeDirPath: ".warp",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      expect(warpMcp.getJson()).toEqual(jsonData);
    });

    it("should throw on invalid JSON content", () => {
      expect(() => {
        const _instance = new WarpMcp({
          relativeDirPath: ".warp",
          relativeFilePath: ".mcp.json",
          fileContent: "{ invalid json }",
        });
      }).toThrow("Failed to parse Warp MCP config at .warp/.mcp.json");
    });
  });

  describe("fromFile", () => {
    it("should read an existing project config", async () => {
      const jsonData = {
        mcpServers: {
          "file-server": {
            command: "node",
            args: ["file-server.js"],
          },
        },
      };
      await ensureDir(join(testDir, ".warp"));
      await writeFileContent(
        join(testDir, ".warp", ".mcp.json"),
        JSON.stringify(jsonData, null, 2),
      );

      const warpMcp = await WarpMcp.fromFile({ validate: true });

      expect(warpMcp).toBeInstanceOf(WarpMcp);
      expect(warpMcp.getJson()).toEqual(jsonData);
      expect(warpMcp.getRelativeDirPath()).toBe(".warp");
      expect(warpMcp.getRelativeFilePath()).toBe(".mcp.json");
    });

    it("should initialize empty mcpServers when the file does not exist", async () => {
      const warpMcp = await WarpMcp.fromFile({ validate: true });

      expect(warpMcp.getJson()).toEqual({ mcpServers: {} });
    });

    it("should read an existing global config", async () => {
      const jsonData = {
        mcpServers: {
          "global-server": {
            command: "node",
            args: ["global-server.js"],
          },
        },
      };
      await ensureDir(join(testDir, ".warp"));
      await writeFileContent(
        join(testDir, ".warp", ".mcp.json"),
        JSON.stringify(jsonData, null, 2),
      );

      const warpMcp = await WarpMcp.fromFile({
        outputRoot: testDir,
        validate: true,
        global: true,
      });

      expect(warpMcp.getJson()).toEqual(jsonData);
      expect(warpMcp.getFilePath()).toBe(join(testDir, ".warp", ".mcp.json"));
    });
  });

  describe("fromRulesyncMcp", () => {
    it("should write mcpServers from RulesyncMcp", async () => {
      const rulesyncMcpData = {
        mcpServers: {
          "test-server": {
            command: "node",
            args: ["server.js"],
          },
        },
      };

      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(rulesyncMcpData),
      });

      const warpMcp = await WarpMcp.fromRulesyncMcp({
        rulesyncMcp,
        validate: true,
      });

      expect(warpMcp.getJson()).toEqual({ mcpServers: rulesyncMcpData.mcpServers });
      expect(warpMcp.getRelativeDirPath()).toBe(".warp");
      expect(warpMcp.getRelativeFilePath()).toBe(".mcp.json");
    });

    it("should strip rulesync-only fields such as targets", async () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            "test-server": {
              command: "node",
              args: ["server.js"],
              targets: ["warp"],
            },
          },
        }),
      });

      const warpMcp = await WarpMcp.fromRulesyncMcp({ rulesyncMcp, validate: true });
      const json = warpMcp.getJson() as {
        mcpServers: Record<string, { targets?: unknown }>;
      };

      expect(json.mcpServers["test-server"]?.targets).toBeUndefined();
    });
  });

  describe("toRulesyncMcp", () => {
    it("should convert WarpMcp to RulesyncMcp", () => {
      const warpMcpData = {
        mcpServers: {
          "test-server": {
            command: "node",
            args: ["server.js"],
          },
        },
      };

      const warpMcp = new WarpMcp({
        outputRoot: testDir,
        relativeDirPath: ".warp",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(warpMcpData),
      });

      const rulesyncMcp = warpMcp.toRulesyncMcp();

      expect(rulesyncMcp).toBeInstanceOf(RulesyncMcp);
      expect(JSON.parse(rulesyncMcp.getFileContent())).toEqual({
        $schema: RULESYNC_MCP_SCHEMA_URL,
        ...warpMcpData,
      });
    });
  });

  describe("validate", () => {
    it("should always return success", () => {
      const warpMcp = new WarpMcp({
        relativeDirPath: ".warp",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({ mcpServers: {} }),
        validate: false,
      });

      const result = warpMcp.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });

  describe("forDeletion", () => {
    it("should create a deletable instance", () => {
      const warpMcp = WarpMcp.forDeletion({
        relativeDirPath: ".warp",
        relativeFilePath: ".mcp.json",
      });

      expect(warpMcp).toBeInstanceOf(WarpMcp);
      expect(warpMcp.getJson()).toEqual({});
    });
  });
});
