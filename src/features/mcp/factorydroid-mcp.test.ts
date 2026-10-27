import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_MCP_SCHEMA_URL } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { FactorydroidMcp } from "./factorydroid-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

describe("FactorydroidMcp", () => {
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
    it("should return correct paths for factorydroid mcp", () => {
      const paths = FactorydroidMcp.getSettablePaths();
      expect(paths).toEqual({
        relativeDirPath: ".factory",
        relativeFilePath: "mcp.json",
      });
    });
  });

  describe("constructor", () => {
    it("should create instance with valid MCP config", () => {
      const mcp = new FactorydroidMcp({
        outputRoot: testDir,
        relativeDirPath: ".factory",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(validMcpConfig),
        validate: true,
      });

      expect(mcp).toBeInstanceOf(FactorydroidMcp);
      expect(mcp.getJson()).toEqual(validMcpConfig);
    });

    it("should handle empty MCP config", () => {
      const mcp = new FactorydroidMcp({
        outputRoot: testDir,
        relativeDirPath: ".factory",
        relativeFilePath: "mcp.json",
        fileContent: "{}",
        validate: true,
      });

      expect(mcp.getJson()).toEqual({});
    });
  });

  describe("fromRulesyncMcp", () => {
    it("should create FactorydroidMcp from RulesyncMcp", () => {
      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "rulesync.mcp.json",
        fileContent: JSON.stringify(validMcpConfig),
        validate: true,
      });

      const factorydroidMcp = FactorydroidMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        validate: true,
      });

      expect(factorydroidMcp).toBeInstanceOf(FactorydroidMcp);
      expect(factorydroidMcp.getJson()).toEqual(validMcpConfig);
      expect(factorydroidMcp.getRelativeFilePath()).toBe("mcp.json");
    });

    it("should handle RulesyncMcp with empty servers", () => {
      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "rulesync.mcp.json",
        fileContent: JSON.stringify({ mcpServers: {} }),
        validate: true,
      });

      const factorydroidMcp = FactorydroidMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        validate: true,
      });

      expect(factorydroidMcp.getJson()).toEqual({ mcpServers: {} });
    });

    it("should write the enabledTools and disabledTools filters unchanged", () => {
      // Droid reads both per-server filters: https://docs.factory.com/harness/mcp
      const filteredConfig = {
        mcpServers: {
          filtered: {
            command: "server",
            enabledTools: ["read", "search"],
            disabledTools: ["write"],
          },
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "rulesync.mcp.json",
        fileContent: JSON.stringify(filteredConfig),
        validate: true,
      });

      const factorydroidMcp = FactorydroidMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        validate: true,
      });

      expect(factorydroidMcp.getJson()).toEqual(filteredConfig);
    });

    it("should skip a server whose enabledTools list is empty, with a warning", () => {
      // Droid applies `enabledTools` only "when the list is non-empty"
      // (https://docs.factory.com/harness/mcp), so `[]` would load every tool,
      // while canonically an empty allowlist allows none.
      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "rulesync.mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            emptyAllow: { command: "server", enabledTools: [] },
            emptyDeny: { command: "server", disabledTools: [] },
            kept: { command: "server", enabledTools: ["read"] },
          },
        }),
        validate: true,
      });
      const logger = createMockLogger();

      const factorydroidMcp = FactorydroidMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        validate: true,
        logger,
      });

      expect(factorydroidMcp.getJson()).toEqual({
        mcpServers: {
          emptyDeny: { command: "server", disabledTools: [] },
          kept: { command: "server", enabledTools: ["read"] },
        },
      });
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('"emptyAllow"'));
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("empty enabledTools"));
    });
  });

  describe("fromFile", () => {
    it("should load FactorydroidMcp from file", async () => {
      const mcpFile = join(testDir, ".factory", "mcp.json");

      await writeFileContent(mcpFile, JSON.stringify(validMcpConfig, null, 2));

      const mcp = await FactorydroidMcp.fromFile({
        outputRoot: testDir,
        validate: true,
      });

      expect(mcp).toBeInstanceOf(FactorydroidMcp);
      expect(mcp.getJson()).toEqual(validMcpConfig);
    });

    it("should throw error when file does not exist", async () => {
      await expect(
        FactorydroidMcp.fromFile({
          outputRoot: testDir,
          validate: true,
        }),
      ).rejects.toThrow();
    });
  });

  describe("toRulesyncMcp", () => {
    it("should convert to RulesyncMcp", () => {
      const mcp = new FactorydroidMcp({
        outputRoot: testDir,
        relativeDirPath: ".factory",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(validMcpConfig),
        validate: true,
      });

      const rulesyncMcp = mcp.toRulesyncMcp();

      expect(rulesyncMcp).toBeInstanceOf(RulesyncMcp);
      expect(rulesyncMcp.getJson()).toEqual({
        $schema: RULESYNC_MCP_SCHEMA_URL,
        ...validMcpConfig,
      });
    });

    it("should import the enabledTools and disabledTools filters", () => {
      const filteredConfig = {
        mcpServers: {
          filtered: {
            command: "server",
            enabledTools: ["read"],
            disabledTools: ["write"],
          },
        },
      };
      const mcp = new FactorydroidMcp({
        outputRoot: testDir,
        relativeDirPath: ".factory",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(filteredConfig),
        validate: true,
      });

      expect(mcp.toRulesyncMcp().getMcpServers()).toEqual(filteredConfig.mcpServers);
    });
  });

  describe("validate", () => {
    it("should return success for valid MCP config", () => {
      const mcp = new FactorydroidMcp({
        outputRoot: testDir,
        relativeDirPath: ".factory",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(validMcpConfig),
        validate: false,
      });

      const result = mcp.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });

  describe("forDeletion", () => {
    it("should create deletion marker", () => {
      const mcp = FactorydroidMcp.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".factory",
        relativeFilePath: "mcp.json",
      });

      expect(mcp).toBeInstanceOf(FactorydroidMcp);
      expect(mcp.getJson()).toEqual({});
    });
  });
});
