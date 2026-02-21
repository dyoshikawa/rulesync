import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
        baseDir: testDir,
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
        baseDir: testDir,
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
        baseDir: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "rulesync.mcp.json",
        fileContent: JSON.stringify(validMcpConfig),
        validate: true,
      });

      const factorydroidMcp = FactorydroidMcp.fromRulesyncMcp({
        baseDir: testDir,
        rulesyncMcp,
        validate: true,
      });

      expect(factorydroidMcp).toBeInstanceOf(FactorydroidMcp);
      expect(factorydroidMcp.getJson()).toEqual(validMcpConfig);
      expect(factorydroidMcp.getRelativeFilePath()).toBe("mcp.json");
    });

    it("should handle RulesyncMcp with empty servers", () => {
      const rulesyncMcp = new RulesyncMcp({
        baseDir: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "rulesync.mcp.json",
        fileContent: JSON.stringify({ mcpServers: {} }),
        validate: true,
      });

      const factorydroidMcp = FactorydroidMcp.fromRulesyncMcp({
        baseDir: testDir,
        rulesyncMcp,
        validate: true,
      });

      expect(factorydroidMcp.getJson()).toEqual({ mcpServers: {} });
    });
  });

  describe("fromFile", () => {
    it("should load FactorydroidMcp from file", async () => {
      const mcpFile = join(testDir, ".factory", "mcp.json");

      await writeFileContent(mcpFile, JSON.stringify(validMcpConfig, null, 2));

      const mcp = await FactorydroidMcp.fromFile({
        baseDir: testDir,
        validate: true,
      });

      expect(mcp).toBeInstanceOf(FactorydroidMcp);
      expect(mcp.getJson()).toEqual(validMcpConfig);
    });

    it("should throw error when file does not exist", async () => {
      await expect(
        FactorydroidMcp.fromFile({
          baseDir: testDir,
          validate: true,
        }),
      ).rejects.toThrow();
    });
  });

  describe("toRulesyncMcp", () => {
    it("should convert to RulesyncMcp", () => {
      const mcp = new FactorydroidMcp({
        baseDir: testDir,
        relativeDirPath: ".factory",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(validMcpConfig),
        validate: true,
      });

      const rulesyncMcp = mcp.toRulesyncMcp();

      expect(rulesyncMcp).toBeInstanceOf(RulesyncMcp);
      expect(rulesyncMcp.getJson()).toEqual(validMcpConfig);
    });
  });

  describe("validate", () => {
    it("should return success for valid MCP config", () => {
      const mcp = new FactorydroidMcp({
        baseDir: testDir,
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
        baseDir: testDir,
        relativeDirPath: ".factory",
        relativeFilePath: "mcp.json",
      });

      expect(mcp).toBeInstanceOf(FactorydroidMcp);
      expect(mcp.getJson()).toEqual({});
    });
  });
});
