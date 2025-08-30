import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CLAUDECODE_MCP_FILE } from "../constants/paths.js";
import { setupTestDirectory } from "../test-utils/index.js";
import { ClaudecodeMcp } from "./claudecode-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

describe("ClaudecodeMcp", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("fromFilePath", () => {
    it("should create ClaudecodeMcp from valid JSON file", async () => {
      const config = {
        mcpServers: {
          "test-server": {
            command: "test-command",
            args: ["--arg1", "value1"],
            env: { API_KEY: "test-key" },
          },
        },
      };

      const filePath = join(testDir, CLAUDECODE_MCP_FILE);
      await writeFile(filePath, JSON.stringify(config, null, 2));

      const mcp = await ClaudecodeMcp.fromFilePath({ filePath });

      expect(mcp.getJson()).toEqual(config);
      expect(mcp.getTargetFilePath()).toBe(join(".", ".", CLAUDECODE_MCP_FILE));
    });

    it("should throw error for invalid JSON", async () => {
      const filePath = join(testDir, CLAUDECODE_MCP_FILE);
      await writeFile(filePath, "invalid json");

      await expect(ClaudecodeMcp.fromFilePath({ filePath })).rejects.toThrow(
        "Invalid JSON in Claude Code MCP file",
      );
    });
  });

  describe("fromRulesyncMcp", () => {
    it("should convert RulesyncMcp to ClaudecodeMcp", async () => {
      const rulesyncConfig = {
        mcpServers: {
          "test-server": {
            command: "test-command",
            args: ["--arg1"],
            env: { TOKEN: "secret" },
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

      const claudeCodeMcp = ClaudecodeMcp.fromRulesyncMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        rulesyncMcp,
        validate: false,
      });

      expect(claudeCodeMcp.getJson()).toEqual({
        mcpServers: rulesyncConfig.mcpServers,
      });
    });
  });

  describe("toRulesyncMcp", () => {
    it("should convert ClaudecodeMcp to RulesyncMcp", async () => {
      const config = {
        mcpServers: {
          "test-server": {
            command: "test-command",
          },
        },
      };

      const claudeCodeMcp = new ClaudecodeMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: CLAUDECODE_MCP_FILE,
        fileContent: JSON.stringify(config, null, 2),
        json: config,
        validate: false,
      });

      const rulesyncMcp = claudeCodeMcp.toRulesyncMcp();

      expect(rulesyncMcp.getJson()).toEqual({
        mcpServers: config.mcpServers,
      });
    });
  });

  describe("validate", () => {
    it("should validate valid configuration", async () => {
      const config = {
        mcpServers: {
          "test-server": {
            command: "test-command",
            args: ["--flag"],
            env: { KEY: "value" },
            transport: "stdio",
            timeout: 30000,
            disabled: false,
          },
          "remote-server": {
            url: "https://example.com/mcp",
            headers: { Authorization: "Bearer token" },
          },
          "http-server": {
            httpUrl: "https://example.com/stream",
          },
        },
      };

      const mcp = new ClaudecodeMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: CLAUDECODE_MCP_FILE,
        fileContent: JSON.stringify(config, null, 2),
        json: config,
        validate: false,
      });

      const result = mcp.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });

    it("should reject invalid JSON structure", async () => {
      const mcp = new ClaudecodeMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: CLAUDECODE_MCP_FILE,
        fileContent: "null",
        json: null as unknown as Record<string, unknown>,
        validate: false,
      });

      const result = mcp.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("must be a JSON object");
    });

    it("should reject server without command, url, or httpUrl", async () => {
      const config = {
        mcpServers: {
          "invalid-server": {
            args: ["--flag"],
          },
        },
      };

      const mcp = new ClaudecodeMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: CLAUDECODE_MCP_FILE,
        fileContent: JSON.stringify(config, null, 2),
        json: config,
        validate: false,
      });

      const result = mcp.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('must have "command", "url", or "httpUrl"');
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

      const mcp = new ClaudecodeMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: CLAUDECODE_MCP_FILE,
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

      const mcp = new ClaudecodeMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: CLAUDECODE_MCP_FILE,
        fileContent: JSON.stringify(config, null, 2),
        json: config,
        validate: false,
      });

      const result = mcp.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('"env" must be an object');
    });

    it("should reject invalid timeout type", async () => {
      const config = {
        mcpServers: {
          "test-server": {
            command: "test-command",
            timeout: "not-a-number",
          },
        },
      };

      const mcp = new ClaudecodeMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: CLAUDECODE_MCP_FILE,
        fileContent: JSON.stringify(config, null, 2),
        json: config,
        validate: false,
      });

      const result = mcp.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('"timeout" must be a number');
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

      const mcp = new ClaudecodeMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: CLAUDECODE_MCP_FILE,
        fileContent: JSON.stringify(config, null, 2),
        json: config,
        validate: false,
      });

      const result = mcp.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('"disabled" must be a boolean');
    });

    it("should reject invalid headers type", async () => {
      const config = {
        mcpServers: {
          "test-server": {
            url: "https://example.com/mcp",
            headers: "not-an-object",
          },
        },
      };

      const mcp = new ClaudecodeMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: CLAUDECODE_MCP_FILE,
        fileContent: JSON.stringify(config, null, 2),
        json: config,
        validate: false,
      });

      const result = mcp.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('"headers" must be an object');
    });
  });

  describe("getTargetFilePath", () => {
    it("should return correct file path", async () => {
      const mcp = new ClaudecodeMcp({
        baseDir: testDir,
        relativeDirPath: "subdir",
        relativeFilePath: CLAUDECODE_MCP_FILE,
        fileContent: "{}",
        json: {},
        validate: false,
      });

      expect(mcp.getTargetFilePath()).toBe(join(testDir, "subdir", CLAUDECODE_MCP_FILE));
    });
  });
});
