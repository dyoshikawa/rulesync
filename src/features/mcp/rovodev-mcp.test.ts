import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_MCP_FILE_NAME,
  RULESYNC_MCP_SCHEMA_URL,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { RovodevMcp } from "./rovodev-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

describe("RovodevMcp", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  const validMcpConfig = {
    mcpServers: {
      filesystem: {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      },
    },
  };

  beforeEach(async () => {
    const testSetup = await setupTestDirectory();
    testDir = testSetup.testDir;
    cleanup = testSetup.cleanup;
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  describe("getSettablePaths", () => {
    it("should return .rovodev/mcp.json paths", () => {
      expect(RovodevMcp.getSettablePaths()).toEqual({
        relativeDirPath: ".rovodev",
        relativeFilePath: "mcp.json",
      });
    });
  });

  describe("global-only enforcement", () => {
    it("should throw fromFile when global is false", async () => {
      await expect(
        RovodevMcp.fromFile({
          baseDir: testDir,
          validate: true,
          global: false,
        }),
      ).rejects.toThrow("Rovodev MCP is global-only; use --global to sync ~/.rovodev/mcp.json");
    });

    it("should throw fromRulesyncMcp when global is false", async () => {
      const rulesyncMcp = new RulesyncMcp({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_MCP_FILE_NAME,
        fileContent: JSON.stringify({ mcpServers: {} }),
        validate: true,
      });

      await expect(
        RovodevMcp.fromRulesyncMcp({
          baseDir: testDir,
          rulesyncMcp,
          validate: true,
          global: false,
        }),
      ).rejects.toThrow("Rovodev MCP is global-only; use --global to sync ~/.rovodev/mcp.json");
    });
  });

  describe("constructor JSON parse errors", () => {
    it("should throw for invalid JSON in fileContent", () => {
      expect(() => {
        new RovodevMcp({
          baseDir: testDir,
          relativeDirPath: ".rovodev",
          relativeFilePath: "mcp.json",
          fileContent: "{ not json",
          validate: false,
          global: true,
        });
      }).toThrow(/Failed to parse Rovodev MCP config/);
    });

    it("should include path in parse error message", () => {
      expect(() => {
        new RovodevMcp({
          baseDir: testDir,
          relativeDirPath: ".rovodev",
          relativeFilePath: "mcp.json",
          fileContent: "{ not json",
          validate: false,
          global: true,
        });
      }).toThrow(join(".rovodev", "mcp.json"));
    });
  });

  describe("fromFile JSON parse errors", () => {
    it("should throw when existing file contains invalid JSON", async () => {
      await ensureDir(join(testDir, ".rovodev"));
      await writeFileContent(join(testDir, ".rovodev", "mcp.json"), "{ not json");

      await expect(
        RovodevMcp.fromFile({
          baseDir: testDir,
          validate: true,
          global: true,
        }),
      ).rejects.toThrow(/Failed to parse Rovodev MCP config/);

      await expect(
        RovodevMcp.fromFile({
          baseDir: testDir,
          validate: true,
          global: true,
        }),
      ).rejects.toThrow(join(".rovodev", "mcp.json"));
    });
  });

  describe("fromRulesyncMcp JSON parse errors", () => {
    it("should throw when existing Rovodev file contains invalid JSON", async () => {
      await ensureDir(join(testDir, ".rovodev"));
      await writeFileContent(join(testDir, ".rovodev", "mcp.json"), "{ not json");

      const rulesyncMcp = new RulesyncMcp({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_MCP_FILE_NAME,
        fileContent: JSON.stringify({ mcpServers: {} }),
        validate: true,
      });

      await expect(
        RovodevMcp.fromRulesyncMcp({
          baseDir: testDir,
          rulesyncMcp,
          validate: true,
          global: true,
        }),
      ).rejects.toThrow(/Failed to parse Rovodev MCP config/);

      await expect(
        RovodevMcp.fromRulesyncMcp({
          baseDir: testDir,
          rulesyncMcp,
          validate: true,
          global: true,
        }),
      ).rejects.toThrow(join(".rovodev", "mcp.json"));
    });
  });

  describe("toRulesyncMcp", () => {
    it("should not propagate unknown top-level keys from Rovodev mcp.json", () => {
      const rovodev = new RovodevMcp({
        baseDir: testDir,
        relativeDirPath: ".rovodev",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: validMcpConfig.mcpServers,
          hypotheticalRovodevExtension: { ignored: true },
        }),
        validate: false,
        global: true,
      });

      const rulesyncMcp = rovodev.toRulesyncMcp();

      expect(rulesyncMcp.getJson()).toEqual(
        expect.objectContaining({
          mcpServers: validMcpConfig.mcpServers,
        }),
      );
      expect(Object.keys(rulesyncMcp.getJson())).not.toContain("hypotheticalRovodevExtension");
    });
  });

  describe("round-trip conversion", () => {
    it("should round-trip RulesyncMcp through RovodevMcp and back", async () => {
      const rulesyncMcp = new RulesyncMcp({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_MCP_FILE_NAME,
        fileContent: JSON.stringify(validMcpConfig),
        validate: true,
      });

      const rovodev = await RovodevMcp.fromRulesyncMcp({
        baseDir: testDir,
        rulesyncMcp,
        validate: true,
        global: true,
      });

      const back = rovodev.toRulesyncMcp();

      expect(back).toBeInstanceOf(RulesyncMcp);
      expect(back.getJson()).toEqual({
        $schema: RULESYNC_MCP_SCHEMA_URL,
        ...rulesyncMcp.getJson(),
      });
    });

    it("should round-trip fromFile through toRulesyncMcp", async () => {
      const mcpPath = join(testDir, ".rovodev", "mcp.json");
      await ensureDir(join(testDir, ".rovodev"));
      await writeFileContent(mcpPath, JSON.stringify(validMcpConfig, null, 2));

      const rovodev = await RovodevMcp.fromFile({
        baseDir: testDir,
        validate: true,
        global: true,
      });

      const rulesyncMcp = rovodev.toRulesyncMcp();

      expect(rulesyncMcp.getJson()).toEqual({
        $schema: RULESYNC_MCP_SCHEMA_URL,
        mcpServers: validMcpConfig.mcpServers,
      });
    });
  });

  describe("isDeletable", () => {
    it("should always return false (global-only MCP config is not treated as deletable project output)", () => {
      const globalInstance = new RovodevMcp({
        baseDir: testDir,
        relativeDirPath: ".rovodev",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ mcpServers: {} }),
        validate: false,
        global: true,
      });
      expect(globalInstance.isDeletable()).toBe(false);

      const nonGlobalInstance = new RovodevMcp({
        baseDir: testDir,
        relativeDirPath: ".rovodev",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ mcpServers: {} }),
        validate: false,
        global: false,
      });
      expect(nonGlobalInstance.isDeletable()).toBe(false);
    });
  });
});
