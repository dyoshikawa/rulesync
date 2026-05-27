import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_MCP_SCHEMA_URL,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { QoderMcp } from "./qoder-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

describe("QoderMcp", () => {
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

  describe("constructor", () => {
    it("should create instance with valid JSON content", () => {
      const jsonContent = JSON.stringify({
        mcpServers: {
          "test-server": { command: "node", args: ["server.js"] },
        },
      });

      const mcp = new QoderMcp({
        relativeDirPath: ".qoder",
        relativeFilePath: "mcp.json",
        fileContent: jsonContent,
      });

      expect(mcp).toBeInstanceOf(QoderMcp);
      expect(mcp.getRelativeDirPath()).toBe(".qoder");
      expect(mcp.getRelativeFilePath()).toBe("mcp.json");
      expect(mcp.getFileContent()).toBe(jsonContent);
    });

    it("should parse JSON content correctly", () => {
      const jsonData = {
        mcpServers: {
          "test-server": { command: "node", args: ["server.js"], env: { NODE_ENV: "dev" } },
        },
      };

      const mcp = new QoderMcp({
        relativeDirPath: ".qoder",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      expect(mcp.getJson()).toEqual(jsonData);
    });

    it("should handle empty JSON object", () => {
      const mcp = new QoderMcp({
        relativeDirPath: ".qoder",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({}),
      });

      expect(mcp.getJson()).toEqual({});
    });

    it("should throw error for invalid JSON content", () => {
      expect(() => {
        const _instance = new QoderMcp({
          relativeDirPath: ".qoder",
          relativeFilePath: "mcp.json",
          fileContent: "{ invalid json }",
        });
      }).toThrow();
    });
  });

  describe("getSettablePaths", () => {
    it("should return correct paths", () => {
      const paths = QoderMcp.getSettablePaths();
      expect(paths).toEqual({
        relativeDirPath: ".qoder",
        relativeFilePath: "mcp.json",
      });
    });
  });

  describe("fromFile", () => {
    it("should create instance from file", async () => {
      const qoderDir = join(testDir, ".qoder");
      await ensureDir(qoderDir);
      const jsonData = {
        mcpServers: {
          filesystem: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem"] },
        },
      };
      await writeFileContent(join(qoderDir, "mcp.json"), JSON.stringify(jsonData, null, 2));

      const mcp = await QoderMcp.fromFile({ outputRoot: testDir });

      expect(mcp).toBeInstanceOf(QoderMcp);
      expect(mcp.getJson()).toEqual(jsonData);
      expect(mcp.getFilePath()).toBe(join(testDir, ".qoder", "mcp.json"));
    });

    it("should throw error if file does not exist", async () => {
      await expect(QoderMcp.fromFile({ outputRoot: testDir })).rejects.toThrow();
    });
  });

  describe("fromRulesyncMcp", () => {
    it("should create instance from RulesyncMcp", () => {
      const jsonData = {
        mcpServers: {
          "test-server": { command: "node", args: ["test-server.js"] },
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const mcp = QoderMcp.fromRulesyncMcp({ rulesyncMcp });

      expect(mcp).toBeInstanceOf(QoderMcp);
      expect(mcp.getJson()).toEqual(jsonData);
      expect(mcp.getRelativeDirPath()).toBe(".qoder");
      expect(mcp.getRelativeFilePath()).toBe("mcp.json");
    });

    it("should create instance with custom outputRoot", () => {
      const jsonData = { mcpServers: {} };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const mcp = QoderMcp.fromRulesyncMcp({
        outputRoot: "/target/dir",
        rulesyncMcp,
      });

      expect(mcp.getFilePath()).toBe("/target/dir/.qoder/mcp.json");
    });
  });

  describe("toRulesyncMcp", () => {
    it("should convert to RulesyncMcp", () => {
      const jsonData = {
        mcpServers: {
          filesystem: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem"] },
        },
      };
      const mcp = new QoderMcp({
        relativeDirPath: ".qoder",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const rulesyncMcp = mcp.toRulesyncMcp();

      expect(rulesyncMcp).toBeInstanceOf(RulesyncMcp);
      expect(JSON.parse(rulesyncMcp.getFileContent())).toEqual({
        $schema: RULESYNC_MCP_SCHEMA_URL,
        ...jsonData,
      });
    });
  });

  describe("validate", () => {
    it("should always return successful validation", () => {
      const mcp = new QoderMcp({
        relativeDirPath: ".qoder",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ mcpServers: {} }),
        validate: false,
      });

      const result = mcp.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });

  describe("integration", () => {
    it("should handle complete workflow: fromFile -> toRulesyncMcp -> fromRulesyncMcp", async () => {
      const qoderDir = join(testDir, ".qoder");
      await ensureDir(qoderDir);
      const originalJsonData = {
        mcpServers: {
          "workflow-server": {
            command: "node",
            args: ["workflow-server.js"],
            env: { NODE_ENV: "test" },
          },
        },
      };
      await writeFileContent(join(qoderDir, "mcp.json"), JSON.stringify(originalJsonData, null, 2));

      const originalMcp = await QoderMcp.fromFile({ outputRoot: testDir });
      const rulesyncMcp = originalMcp.toRulesyncMcp();
      const newMcp = QoderMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp });

      expect(newMcp.getJson()).toEqual({
        $schema: RULESYNC_MCP_SCHEMA_URL,
        ...originalJsonData,
      });
      expect(newMcp.getFilePath()).toBe(join(testDir, ".qoder", "mcp.json"));
    });
  });
});
