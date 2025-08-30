import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { COPILOT_MCP_FILE } from "../constants/paths.js";
import { setupTestDirectory } from "../test-utils/index.js";
import { CopilotMcp } from "./copilot-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

describe("CopilotMcp", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("fromFilePath", () => {
    it("should create CopilotMcp from valid JSON file", async () => {
      const config = {
        servers: {
          "test-server": {
            command: "test-command",
            args: ["--arg1", "value1"],
            env: { API_KEY: "test-key" },
          },
        },
      };

      const filePath = join(testDir, COPILOT_MCP_FILE);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, JSON.stringify(config, null, 2));

      const mcp = await CopilotMcp.fromFilePath({ filePath });

      expect(mcp.getJson()).toEqual(config);
      expect(mcp.getTargetFilePath()).toBe(join(".", ".", COPILOT_MCP_FILE));
    });

    it("should throw error for invalid JSON", async () => {
      const filePath = join(testDir, COPILOT_MCP_FILE);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, "invalid json");

      await expect(CopilotMcp.fromFilePath({ filePath })).rejects.toThrow(
        "Invalid JSON in GitHub Copilot MCP file",
      );
    });
  });

  describe("fromRulesyncMcp", () => {
    it("should convert RulesyncMcp to CopilotMcp", async () => {
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

      const copilotMcp = CopilotMcp.fromRulesyncMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        rulesyncMcp,
        validate: false,
      });

      expect(copilotMcp.getJson()).toEqual({
        servers: rulesyncConfig.mcpServers,
      });
    });
  });

  describe("toRulesyncMcp", () => {
    it("should convert CopilotMcp to RulesyncMcp", async () => {
      const config = {
        servers: {
          "test-server": {
            command: "test-command",
          },
        },
      };

      const copilotMcp = new CopilotMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: COPILOT_MCP_FILE,
        fileContent: JSON.stringify(config, null, 2),
        json: config,
        validate: false,
      });

      const rulesyncMcp = copilotMcp.toRulesyncMcp();

      expect(rulesyncMcp.getJson()).toEqual({
        mcpServers: config.servers,
      });
    });
  });

  describe("validate", () => {
    it("should validate valid configuration", async () => {
      const config = {
        inputs: [
          {
            id: "github_token",
            type: "promptString",
            description: "GitHub Personal Access Token",
            password: true,
          },
        ],
        servers: {
          "test-server": {
            command: "test-command",
            args: ["--flag"],
            env: { KEY: "value" },
            tools: ["*"],
          },
          "remote-server": {
            url: "https://example.com/mcp",
            env: { GITHUB_PERSONAL_ACCESS_TOKEN: "${input:github_token}" },
          },
        },
      };

      const mcp = new CopilotMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: COPILOT_MCP_FILE,
        fileContent: JSON.stringify(config, null, 2),
        json: config,
        validate: false,
      });

      const result = mcp.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });

    it("should reject invalid JSON structure", async () => {
      const mcp = new CopilotMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: COPILOT_MCP_FILE,
        fileContent: "null",
        json: null as unknown as Record<string, unknown>,
        validate: false,
      });

      const result = mcp.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("must be a JSON object");
    });

    it("should reject invalid inputs type", async () => {
      const config = {
        inputs: "not-an-array",
        servers: {},
      };

      const mcp = new CopilotMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: COPILOT_MCP_FILE,
        fileContent: JSON.stringify(config, null, 2),
        json: config,
        validate: false,
      });

      const result = mcp.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("inputs must be an array");
    });

    it("should reject invalid input object", async () => {
      const config = {
        inputs: [null],
        servers: {},
      };

      const mcp = new CopilotMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: COPILOT_MCP_FILE,
        fileContent: JSON.stringify(config, null, 2),
        json: config,
        validate: false,
      });

      const result = mcp.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("must be an object");
    });

    it("should reject input without id", async () => {
      const config = {
        inputs: [{ type: "promptString" }],
        servers: {},
      };

      const mcp = new CopilotMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: COPILOT_MCP_FILE,
        fileContent: JSON.stringify(config, null, 2),
        json: config,
        validate: false,
      });

      const result = mcp.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('"id" must be a string');
    });

    it("should reject server without command or url", async () => {
      const config = {
        servers: {
          "invalid-server": {
            args: ["--flag"],
          },
        },
      };

      const mcp = new CopilotMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: COPILOT_MCP_FILE,
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
        servers: {
          "test-server": {
            command: "test-command",
            args: "not-an-array",
          },
        },
      };

      const mcp = new CopilotMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: COPILOT_MCP_FILE,
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
        servers: {
          "test-server": {
            command: "test-command",
            env: "not-an-object",
          },
        },
      };

      const mcp = new CopilotMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: COPILOT_MCP_FILE,
        fileContent: JSON.stringify(config, null, 2),
        json: config,
        validate: false,
      });

      const result = mcp.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('"env" must be an object');
    });

    it("should reject invalid tools type", async () => {
      const config = {
        servers: {
          "test-server": {
            command: "test-command",
            tools: "not-an-array",
          },
        },
      };

      const mcp = new CopilotMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: COPILOT_MCP_FILE,
        fileContent: JSON.stringify(config, null, 2),
        json: config,
        validate: false,
      });

      const result = mcp.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('"tools" must be an array');
    });
  });

  describe("getTargetFilePath", () => {
    it("should return correct file path", async () => {
      const mcp = new CopilotMcp({
        baseDir: testDir,
        relativeDirPath: "subdir",
        relativeFilePath: COPILOT_MCP_FILE,
        fileContent: "{}",
        json: {},
        validate: false,
      });

      expect(mcp.getTargetFilePath()).toBe(join(testDir, "subdir", COPILOT_MCP_FILE));
    });
  });
});
