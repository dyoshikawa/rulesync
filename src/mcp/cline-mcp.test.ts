import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CLINE_MCP_FILE } from "../constants/paths.js";
import { setupTestDirectory } from "../test-utils/index.js";
import { ClineMcp } from "./cline-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

describe("ClineMcp", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("fromFilePath", () => {
    it("should create ClineMcp from valid JSON file", async () => {
      const config = {
        mcpServers: {
          "test-server": {
            command: "test-command",
            args: ["--arg1", "value1"],
            env: { API_KEY: "test-key" },
            alwaysAllow: ["tool1", "tool2"],
          },
        },
      };

      const filePath = join(testDir, CLINE_MCP_FILE);
      const dirPath = join(testDir, ".cline");
      await mkdir(dirPath, { recursive: true });
      await writeFile(filePath, JSON.stringify(config, null, 2));

      const mcp = await ClineMcp.fromFilePath({ filePath });

      expect(mcp.getJson()).toEqual(config);
      expect(mcp.getTargetFilePath()).toBe(join(".", ".", CLINE_MCP_FILE));
    });

    it("should throw error for invalid JSON", async () => {
      const filePath = join(testDir, CLINE_MCP_FILE);
      const dirPath = join(testDir, ".cline");
      await mkdir(dirPath, { recursive: true });
      await writeFile(filePath, "invalid json");

      await expect(ClineMcp.fromFilePath({ filePath })).rejects.toThrow(
        "Invalid JSON in Cline MCP file",
      );
    });
  });

  describe("fromRulesyncMcp", () => {
    it("should convert RulesyncMcp to ClineMcp", async () => {
      const rulesyncConfig = {
        mcpServers: {
          "test-server": {
            command: "test-command",
            args: ["--arg1"],
            env: { TOKEN: "secret" },
            alwaysAllow: ["tool1"],
          },
        },
      };

      const rulesyncMcp = new RulesyncMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "rulesync.mcp.json",
        body: JSON.stringify(rulesyncConfig, null, 2),
        fileContent: JSON.stringify(rulesyncConfig, null, 2),
        json: rulesyncConfig,
        validate: false,
      });

      const clineMcp = ClineMcp.fromRulesyncMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        rulesyncMcp,
        validate: false,
      });

      expect(clineMcp.getJson()).toEqual({
        mcpServers: rulesyncConfig.mcpServers,
      });
    });
  });

  describe("toRulesyncMcp", () => {
    it("should convert ClineMcp to RulesyncMcp", async () => {
      const config = {
        mcpServers: {
          "test-server": {
            command: "test-command",
            alwaysAllow: ["tool1"],
          },
        },
      };

      const clineMcp = new ClineMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: CLINE_MCP_FILE,
        fileContent: JSON.stringify(config, null, 2),
        json: config,
        validate: false,
      });

      const rulesyncMcp = clineMcp.toRulesyncMcp();

      expect(rulesyncMcp.getJson()).toEqual({
        mcpServers: config.mcpServers,
      });
    });
  });

  describe("validate", () => {
    it("should validate valid configuration", async () => {
      const config = {
        mcpServers: {
          "stdio-server": {
            command: "test-command",
            args: ["--flag"],
            env: { KEY: "value" },
            alwaysAllow: ["tool1", "tool2"],
            disabled: false,
            networkTimeout: 30000,
          },
          "sse-server": {
            url: "https://example.com/endpoint",
            headers: { Authorization: "Bearer token" },
            alwaysAllow: [],
            disabled: false,
          },
        },
      };

      const mcp = new ClineMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: CLINE_MCP_FILE,
        fileContent: JSON.stringify(config, null, 2),
        json: config,
        validate: false,
      });

      const result = mcp.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });

    it("should reject invalid JSON structure", async () => {
      const mcp = new ClineMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: CLINE_MCP_FILE,
        fileContent: "null",
        json: null as unknown as Record<string, unknown>,
        validate: false,
      });

      const result = mcp.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("must be a JSON object");
    });

    it("should reject server without command or url", async () => {
      const config = {
        mcpServers: {
          "invalid-server": {
            args: ["--flag"],
          },
        },
      };

      const mcp = new ClineMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: CLINE_MCP_FILE,
        fileContent: JSON.stringify(config, null, 2),
        json: config,
        validate: false,
      });

      const result = mcp.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('must have "command" or "url"');
    });

    it("should reject invalid args type", async () => {
      const config = {
        mcpServers: {
          "test-server": {
            command: "test-command",
            args: "not-an-array",
          },
        },
      };

      const mcp = new ClineMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: CLINE_MCP_FILE,
        fileContent: JSON.stringify(config, null, 2),
        json: config,
        validate: false,
      });

      const result = mcp.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('"args" must be an array');
    });

    it("should reject invalid env type", async () => {
      const config = {
        mcpServers: {
          "test-server": {
            command: "test-command",
            env: "not-an-object",
          },
        },
      };

      const mcp = new ClineMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: CLINE_MCP_FILE,
        fileContent: JSON.stringify(config, null, 2),
        json: config,
        validate: false,
      });

      const result = mcp.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('"env" must be an object');
    });

    it("should reject invalid headers type", async () => {
      const config = {
        mcpServers: {
          "test-server": {
            url: "https://example.com/endpoint",
            headers: "not-an-object",
          },
        },
      };

      const mcp = new ClineMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: CLINE_MCP_FILE,
        fileContent: JSON.stringify(config, null, 2),
        json: config,
        validate: false,
      });

      const result = mcp.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('"headers" must be an object');
    });

    it("should reject invalid alwaysAllow type", async () => {
      const config = {
        mcpServers: {
          "test-server": {
            command: "test-command",
            alwaysAllow: "not-an-array",
          },
        },
      };

      const mcp = new ClineMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: CLINE_MCP_FILE,
        fileContent: JSON.stringify(config, null, 2),
        json: config,
        validate: false,
      });

      const result = mcp.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('"alwaysAllow" must be an array');
    });

    it("should reject invalid disabled type", async () => {
      const config = {
        mcpServers: {
          "test-server": {
            command: "test-command",
            disabled: "not-a-boolean",
          },
        },
      };

      const mcp = new ClineMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: CLINE_MCP_FILE,
        fileContent: JSON.stringify(config, null, 2),
        json: config,
        validate: false,
      });

      const result = mcp.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('"disabled" must be a boolean');
    });

    it("should reject invalid networkTimeout type", async () => {
      const config = {
        mcpServers: {
          "test-server": {
            command: "test-command",
            networkTimeout: "not-a-number",
          },
        },
      };

      const mcp = new ClineMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: CLINE_MCP_FILE,
        fileContent: JSON.stringify(config, null, 2),
        json: config,
        validate: false,
      });

      const result = mcp.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('"networkTimeout" must be a number');
    });
  });

  describe("getTargetFilePath", () => {
    it("should return correct file path", async () => {
      const mcp = new ClineMcp({
        baseDir: testDir,
        relativeDirPath: "subdir",
        relativeFilePath: CLINE_MCP_FILE,
        fileContent: "{}",
        json: {},
        validate: false,
      });

      expect(mcp.getTargetFilePath()).toBe(join(testDir, "subdir", CLINE_MCP_FILE));
    });
  });
});
