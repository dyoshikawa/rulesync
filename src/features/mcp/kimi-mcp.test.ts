import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_MCP_FILE_NAME,
  RULESYNC_MCP_SCHEMA_URL,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { KimiMcp } from "./kimi-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

describe("KimiMcp", () => {
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
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  describe("getSettablePaths", () => {
    it("should return .kimi-code/mcp.json for project scope", () => {
      expect(KimiMcp.getSettablePaths()).toEqual({
        relativeDirPath: ".kimi-code",
        relativeFilePath: "mcp.json",
      });
    });

    it("should return the same relative path for global scope", () => {
      expect(KimiMcp.getSettablePaths({ global: true })).toEqual({
        relativeDirPath: ".kimi-code",
        relativeFilePath: "mcp.json",
      });
    });
  });

  describe("constructor JSON parse errors", () => {
    it("should throw for invalid JSON in fileContent", () => {
      expect(() => {
        new KimiMcp({
          outputRoot: testDir,
          relativeDirPath: ".kimi-code",
          relativeFilePath: "mcp.json",
          fileContent: "{ not json",
          validate: false,
        });
      }).toThrow(/Failed to parse Kimi MCP config/);
    });

    it("should include path in parse error message", () => {
      expect(() => {
        new KimiMcp({
          outputRoot: testDir,
          relativeDirPath: ".kimi-code",
          relativeFilePath: "mcp.json",
          fileContent: "{ not json",
          validate: false,
        });
      }).toThrow(join(".kimi-code", "mcp.json"));
    });
  });

  describe("fromFile", () => {
    it("should read servers verbatim (project scope)", async () => {
      const mcpPath = join(testDir, ".kimi-code", "mcp.json");
      await ensureDir(join(testDir, ".kimi-code"));
      await writeFileContent(mcpPath, JSON.stringify(validMcpConfig, null, 2));

      const kimi = await KimiMcp.fromFile({ outputRoot: testDir, validate: true });
      expect(kimi.getJson().mcpServers).toEqual(validMcpConfig.mcpServers);
    });

    it("should default to an empty mcpServers map when the file is absent", async () => {
      const kimi = await KimiMcp.fromFile({ outputRoot: testDir, validate: true });
      expect(kimi.getJson().mcpServers).toEqual({});
    });

    it("should throw when existing file contains invalid JSON", async () => {
      await ensureDir(join(testDir, ".kimi-code"));
      await writeFileContent(join(testDir, ".kimi-code", "mcp.json"), "{ not json");

      await expect(KimiMcp.fromFile({ outputRoot: testDir, validate: true })).rejects.toThrow(
        /Failed to parse Kimi MCP config/,
      );
    });
  });

  describe("fromRulesyncMcp", () => {
    it("should write mcpServers verbatim (simple passthrough)", async () => {
      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_MCP_FILE_NAME,
        fileContent: JSON.stringify(validMcpConfig),
        validate: true,
      });

      const kimi = await KimiMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        validate: true,
      });

      expect(kimi.getJson().mcpServers).toEqual(validMcpConfig.mcpServers);
      expect(kimi.getRelativeDirPath()).toBe(".kimi-code");
      expect(kimi.getRelativeFilePath()).toBe("mcp.json");
    });
  });

  describe("toRulesyncMcp", () => {
    it("should not propagate unknown top-level keys from Kimi mcp.json", () => {
      const kimi = new KimiMcp({
        outputRoot: testDir,
        relativeDirPath: ".kimi-code",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: validMcpConfig.mcpServers,
          hypotheticalKimiExtension: { ignored: true },
        }),
        validate: false,
      });

      const rulesyncMcp = kimi.toRulesyncMcp();

      expect(rulesyncMcp.getJson()).toEqual(
        expect.objectContaining({ mcpServers: validMcpConfig.mcpServers }),
      );
      expect(Object.keys(rulesyncMcp.getJson())).not.toContain("hypotheticalKimiExtension");
    });
  });

  describe("round-trip conversion", () => {
    it("should round-trip RulesyncMcp through KimiMcp and back", async () => {
      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_MCP_FILE_NAME,
        fileContent: JSON.stringify(validMcpConfig),
        validate: true,
      });

      const kimi = await KimiMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        validate: true,
      });

      const back = kimi.toRulesyncMcp();
      expect(back).toBeInstanceOf(RulesyncMcp);
      expect(back.getJson()).toEqual({
        $schema: RULESYNC_MCP_SCHEMA_URL,
        ...rulesyncMcp.getJson(),
      });
    });
  });

  describe("isDeletable", () => {
    it("should be deletable (dedicated mcp.json, not a shared settings file)", () => {
      const instance = new KimiMcp({
        outputRoot: testDir,
        relativeDirPath: ".kimi-code",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ mcpServers: {} }),
        validate: false,
      });
      expect(instance.isDeletable()).toBe(true);
    });
  });
});
