import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { GeminiCliMcp } from "./geminicli-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

describe("GeminiCliMcp", () => {
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
    it("should return correct paths for local mode", () => {
      const paths = GeminiCliMcp.getSettablePaths();

      expect(paths.relativeDirPath).toBe(".gemini");
      expect(paths.relativeFilePath).toBe("settings.json");
    });

    it("should return correct paths for global mode", () => {
      const paths = GeminiCliMcp.getSettablePaths({ global: true });

      expect(paths.relativeDirPath).toBe(".gemini");
      expect(paths.relativeFilePath).toBe("settings.json");
    });
  });

  describe("constructor", () => {
    it("should create instance with default parameters", () => {
      const validJsonContent = JSON.stringify({
        mcpServers: {
          "@modelcontextprotocol/server-filesystem": {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"],
          },
        },
      });

      const geminiCliMcp = new GeminiCliMcp({
        relativeDirPath: ".gemini",
        relativeFilePath: "settings.json",
        fileContent: validJsonContent,
      });

      expect(geminiCliMcp).toBeInstanceOf(GeminiCliMcp);
      expect(geminiCliMcp.getRelativeDirPath()).toBe(".gemini");
      expect(geminiCliMcp.getRelativeFilePath()).toBe("settings.json");
      expect(geminiCliMcp.getFileContent()).toBe(validJsonContent);
    });

    it("should create instance with custom baseDir", () => {
      const validJsonContent = JSON.stringify({
        mcpServers: {},
      });

      const geminiCliMcp = new GeminiCliMcp({
        baseDir: "/custom/path",
        relativeDirPath: ".gemini",
        relativeFilePath: "settings.json",
        fileContent: validJsonContent,
      });

      expect(geminiCliMcp.getFilePath()).toBe("/custom/path/.gemini/settings.json");
    });

    it("should parse JSON content correctly", () => {
      const jsonData = {
        mcpServers: {
          "test-server": {
            command: "node",
            args: ["server.js"],
            env: {
              NODE_ENV: "development",
            },
          },
        },
      };
      const validJsonContent = JSON.stringify(jsonData);

      const geminiCliMcp = new GeminiCliMcp({
        relativeDirPath: ".gemini",
        relativeFilePath: "settings.json",
        fileContent: validJsonContent,
      });

      expect(geminiCliMcp.getJson()).toEqual(jsonData);
    });

    it("should handle empty JSON object", () => {
      const emptyJsonContent = JSON.stringify({});

      const geminiCliMcp = new GeminiCliMcp({
        relativeDirPath: ".gemini",
        relativeFilePath: "settings.json",
        fileContent: emptyJsonContent,
      });

      expect(geminiCliMcp.getJson()).toEqual({});
    });

    it("should validate content by default", () => {
      const validJsonContent = JSON.stringify({
        mcpServers: {},
      });

      expect(() => {
        const _instance = new GeminiCliMcp({
          relativeDirPath: ".gemini",
          relativeFilePath: "settings.json",
          fileContent: validJsonContent,
        });
      }).not.toThrow();
    });

    it("should skip validation when validate is false", () => {
      const validJsonContent = JSON.stringify({
        mcpServers: {},
      });

      expect(() => {
        const _instance = new GeminiCliMcp({
          relativeDirPath: ".gemini",
          relativeFilePath: "settings.json",
          fileContent: validJsonContent,
          validate: false,
        });
      }).not.toThrow();
    });

    it("should throw error for invalid JSON content", () => {
      const invalidJsonContent = "{ invalid json }";

      expect(() => {
        const _instance = new GeminiCliMcp({
          relativeDirPath: ".gemini",
          relativeFilePath: "settings.json",
          fileContent: invalidJsonContent,
        });
      }).toThrow();
    });
  });

  describe("fromFile", () => {
    it("should create instance from file with default parameters", async () => {
      const jsonData = {
        mcpServers: {
          filesystem: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-filesystem", testDir],
          },
        },
      };
      await ensureDir(join(testDir, ".gemini"));
      await writeFileContent(
        join(testDir, ".gemini/settings.json"),
        JSON.stringify(jsonData, null, 2),
      );

      const geminiCliMcp = await GeminiCliMcp.fromFile({
        baseDir: testDir,
      });

      expect(geminiCliMcp).toBeInstanceOf(GeminiCliMcp);
      expect(geminiCliMcp.getJson()).toEqual(jsonData);
      expect(geminiCliMcp.getFilePath()).toBe(join(testDir, ".gemini/settings.json"));
    });

    it("should initialize empty mcpServers if file does not exist", async () => {
      const geminiCliMcp = await GeminiCliMcp.fromFile({
        baseDir: testDir,
      });

      expect(geminiCliMcp).toBeInstanceOf(GeminiCliMcp);
      expect(geminiCliMcp.getJson()).toEqual({ mcpServers: {} });
      expect(geminiCliMcp.getFilePath()).toBe(join(testDir, ".gemini/settings.json"));
    });

    it("should initialize mcpServers if missing in existing file", async () => {
      const jsonData = {
        customConfig: {
          setting: "value",
        },
      };
      await ensureDir(join(testDir, ".gemini"));
      await writeFileContent(join(testDir, ".gemini/settings.json"), JSON.stringify(jsonData));

      const geminiCliMcp = await GeminiCliMcp.fromFile({
        baseDir: testDir,
      });

      expect(geminiCliMcp.getJson()).toEqual({
        customConfig: {
          setting: "value",
        },
        mcpServers: {},
      });
    });

    it("should create instance from file with custom baseDir", async () => {
      const customDir = join(testDir, "custom");
      await ensureDir(join(customDir, ".gemini"));

      const jsonData = {
        mcpServers: {
          git: {
            command: "node",
            args: ["git-server.js"],
          },
        },
      };
      await writeFileContent(join(customDir, ".gemini/settings.json"), JSON.stringify(jsonData));

      const geminiCliMcp = await GeminiCliMcp.fromFile({
        baseDir: customDir,
      });

      expect(geminiCliMcp.getFilePath()).toBe(join(customDir, ".gemini/settings.json"));
      expect(geminiCliMcp.getJson()).toEqual(jsonData);
    });

    it("should handle validation when validate is true", async () => {
      const jsonData = {
        mcpServers: {
          "valid-server": {
            command: "node",
            args: ["server.js"],
          },
        },
      };
      await ensureDir(join(testDir, ".gemini"));
      await writeFileContent(join(testDir, ".gemini/settings.json"), JSON.stringify(jsonData));

      const geminiCliMcp = await GeminiCliMcp.fromFile({
        baseDir: testDir,
        validate: true,
      });

      expect(geminiCliMcp.getJson()).toEqual(jsonData);
    });

    it("should skip validation when validate is false", async () => {
      const jsonData = {
        mcpServers: {},
      };
      await ensureDir(join(testDir, ".gemini"));
      await writeFileContent(join(testDir, ".gemini/settings.json"), JSON.stringify(jsonData));

      const geminiCliMcp = await GeminiCliMcp.fromFile({
        baseDir: testDir,
        validate: false,
      });

      expect(geminiCliMcp.getJson()).toEqual(jsonData);
    });

    it("should create instance from file in global mode", async () => {
      const jsonData = {
        mcpServers: {
          filesystem: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-filesystem", testDir],
          },
        },
      };
      await ensureDir(join(testDir, ".gemini"));
      await writeFileContent(
        join(testDir, ".gemini/settings.json"),
        JSON.stringify(jsonData, null, 2),
      );

      const geminiCliMcp = await GeminiCliMcp.fromFile({
        baseDir: testDir,
        global: true,
      });

      expect(geminiCliMcp).toBeInstanceOf(GeminiCliMcp);
      expect(geminiCliMcp.getJson()).toEqual(jsonData);
      expect(geminiCliMcp.getFilePath()).toBe(join(testDir, ".gemini/settings.json"));
    });

    it("should create instance from file in local mode (default)", async () => {
      const jsonData = {
        mcpServers: {
          git: {
            command: "node",
            args: ["git-server.js"],
          },
        },
      };
      await ensureDir(join(testDir, ".gemini"));
      await writeFileContent(join(testDir, ".gemini/settings.json"), JSON.stringify(jsonData));

      const geminiCliMcp = await GeminiCliMcp.fromFile({
        baseDir: testDir,
        global: false,
      });

      expect(geminiCliMcp.getFilePath()).toBe(join(testDir, ".gemini/settings.json"));
      expect(geminiCliMcp.getJson()).toEqual(jsonData);
    });

    it("should initialize global config file if it does not exist", async () => {
      const geminiCliMcp = await GeminiCliMcp.fromFile({
        baseDir: testDir,
        global: true,
      });

      expect(geminiCliMcp).toBeInstanceOf(GeminiCliMcp);
      expect(geminiCliMcp.getJson()).toEqual({ mcpServers: {} });
      expect(geminiCliMcp.getFilePath()).toBe(join(testDir, ".gemini/settings.json"));
    });

    it("should preserve non-mcpServers properties in global mode", async () => {
      const existingGlobalConfig = {
        mcpServers: {
          "old-server": {
            command: "node",
            args: ["old-server.js"],
          },
        },
        userSettings: {
          theme: "dark",
          fontSize: 14,
        },
        version: "1.0.0",
      };
      await ensureDir(join(testDir, ".gemini"));
      await writeFileContent(
        join(testDir, ".gemini/settings.json"),
        JSON.stringify(existingGlobalConfig, null, 2),
      );

      const geminiCliMcp = await GeminiCliMcp.fromFile({
        baseDir: testDir,
        global: true,
      });

      const json = geminiCliMcp.getJson();
      expect(json.mcpServers).toEqual({
        "old-server": {
          command: "node",
          args: ["old-server.js"],
        },
      });
      expect((json as any).userSettings).toEqual({
        theme: "dark",
        fontSize: 14,
      });
      expect((json as any).version).toBe("1.0.0");
    });
  });

  describe("fromRulesyncMcp", () => {
    it("should create instance from RulesyncMcp with default parameters", async () => {
      const jsonData = {
        mcpServers: {
          "test-server": {
            command: "node",
            args: ["test-server.js"],
          },
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const geminiCliMcp = await GeminiCliMcp.fromRulesyncMcp({
        baseDir: testDir,
        rulesyncMcp,
      });

      expect(geminiCliMcp).toBeInstanceOf(GeminiCliMcp);
      expect(geminiCliMcp.getJson()).toEqual(jsonData);
      expect(geminiCliMcp.getRelativeDirPath()).toBe(".gemini");
      expect(geminiCliMcp.getRelativeFilePath()).toBe("settings.json");
    });

    it("should create instance from RulesyncMcp with custom baseDir", async () => {
      const jsonData = {
        mcpServers: {
          "custom-server": {
            command: "python",
            args: ["server.py"],
            env: {
              PYTHONPATH: "/custom/path",
            },
          },
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        baseDir: "/custom/base",
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const customDir = join(testDir, "target");
      await ensureDir(customDir);
      const geminiCliMcp = await GeminiCliMcp.fromRulesyncMcp({
        baseDir: customDir,
        rulesyncMcp,
      });

      expect(geminiCliMcp.getFilePath()).toBe(join(customDir, ".gemini/settings.json"));
      expect(geminiCliMcp.getJson()).toEqual(jsonData);
    });

    it("should handle validation when validate is true", async () => {
      const jsonData = {
        mcpServers: {
          "validated-server": {
            command: "node",
            args: ["validated-server.js"],
          },
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const geminiCliMcp = await GeminiCliMcp.fromRulesyncMcp({
        baseDir: testDir,
        rulesyncMcp,
        validate: true,
      });

      expect(geminiCliMcp.getJson()).toEqual(jsonData);
    });

    it("should skip validation when validate is false", async () => {
      const jsonData = {
        mcpServers: {},
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const geminiCliMcp = await GeminiCliMcp.fromRulesyncMcp({
        baseDir: testDir,
        rulesyncMcp,
        validate: false,
      });

      expect(geminiCliMcp.getJson()).toEqual(jsonData);
    });

    it("should handle empty mcpServers object", async () => {
      const jsonData = {
        mcpServers: {},
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const geminiCliMcp = await GeminiCliMcp.fromRulesyncMcp({
        baseDir: testDir,
        rulesyncMcp,
      });

      expect(geminiCliMcp.getJson()).toEqual(jsonData);
    });

    it("should create instance from RulesyncMcp in global mode", async () => {
      const jsonData = {
        mcpServers: {
          "global-server": {
            command: "node",
            args: ["global-server.js"],
          },
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const geminiCliMcp = await GeminiCliMcp.fromRulesyncMcp({
        baseDir: testDir,
        rulesyncMcp,
        global: true,
      });

      expect(geminiCliMcp).toBeInstanceOf(GeminiCliMcp);
      expect(geminiCliMcp.getJson()).toEqual(jsonData);
      expect(geminiCliMcp.getRelativeDirPath()).toBe(".gemini");
      expect(geminiCliMcp.getRelativeFilePath()).toBe("settings.json");
    });

    it("should create instance from RulesyncMcp in local mode (default)", async () => {
      const jsonData = {
        mcpServers: {
          "local-server": {
            command: "python",
            args: ["local-server.py"],
          },
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const geminiCliMcp = await GeminiCliMcp.fromRulesyncMcp({
        baseDir: testDir,
        rulesyncMcp,
        global: false,
      });

      expect(geminiCliMcp.getFilePath()).toBe(join(testDir, ".gemini/settings.json"));
      expect(geminiCliMcp.getJson()).toEqual(jsonData);
      expect(geminiCliMcp.getRelativeDirPath()).toBe(".gemini");
      expect(geminiCliMcp.getRelativeFilePath()).toBe("settings.json");
    });

    it("should preserve non-mcpServers properties when updating global config", async () => {
      const existingGlobalConfig = {
        mcpServers: {
          "old-server": {
            command: "node",
            args: ["old-server.js"],
          },
        },
        userSettings: {
          theme: "dark",
        },
        version: "1.0.0",
      };
      await ensureDir(join(testDir, ".gemini"));
      await writeFileContent(
        join(testDir, ".gemini/settings.json"),
        JSON.stringify(existingGlobalConfig, null, 2),
      );

      const newMcpServers = {
        mcpServers: {
          "new-server": {
            command: "python",
            args: ["new-server.py"],
          },
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(newMcpServers),
      });

      const geminiCliMcp = await GeminiCliMcp.fromRulesyncMcp({
        baseDir: testDir,
        rulesyncMcp,
        global: true,
      });

      const json = geminiCliMcp.getJson();
      expect(json.mcpServers).toEqual({
        "new-server": {
          command: "python",
          args: ["new-server.py"],
        },
      });
      expect((json as any).userSettings).toEqual({
        theme: "dark",
      });
      expect((json as any).version).toBe("1.0.0");
    });

    it("should merge mcpServers when updating global config", async () => {
      const existingGlobalConfig = {
        mcpServers: {
          "existing-server": {
            command: "node",
            args: ["existing-server.js"],
          },
        },
        customProperty: "value",
      };
      await ensureDir(join(testDir, ".gemini"));
      await writeFileContent(
        join(testDir, ".gemini/settings.json"),
        JSON.stringify(existingGlobalConfig, null, 2),
      );

      const newMcpConfig = {
        mcpServers: {
          "new-server": {
            command: "python",
            args: ["new-server.py"],
          },
          "another-server": {
            command: "node",
            args: ["another.js"],
          },
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(newMcpConfig),
      });

      const geminiCliMcp = await GeminiCliMcp.fromRulesyncMcp({
        baseDir: testDir,
        rulesyncMcp,
        global: true,
      });

      const json = geminiCliMcp.getJson();
      // Should replace mcpServers entirely, not merge individual servers
      expect(json.mcpServers).toEqual({
        "new-server": {
          command: "python",
          args: ["new-server.py"],
        },
        "another-server": {
          command: "node",
          args: ["another.js"],
        },
      });
      expect((json as any).customProperty).toBe("value");
    });
  });

  describe("toRulesyncMcp", () => {
    it("should convert to RulesyncMcp with default configuration", () => {
      const jsonData = {
        mcpServers: {
          filesystem: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
          },
        },
      };
      const geminiCliMcp = new GeminiCliMcp({
        relativeDirPath: ".gemini",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify(jsonData),
      });

      const rulesyncMcp = geminiCliMcp.toRulesyncMcp();

      expect(rulesyncMcp).toBeInstanceOf(RulesyncMcp);
      expect(rulesyncMcp.getFileContent()).toBe(JSON.stringify(jsonData, null, 2));
      expect(rulesyncMcp.getRelativeDirPath()).toBe(RULESYNC_RELATIVE_DIR_PATH);
      expect(rulesyncMcp.getRelativeFilePath()).toBe(".mcp.json");
    });

    it("should preserve file content when converting to RulesyncMcp", () => {
      const jsonData = {
        mcpServers: {
          "complex-server": {
            command: "node",
            args: ["complex-server.js", "--port", "3000"],
            env: {
              NODE_ENV: "production",
              DEBUG: "mcp:*",
            },
          },
          "another-server": {
            command: "python",
            args: ["another-server.py"],
          },
        },
      };
      const geminiCliMcp = new GeminiCliMcp({
        baseDir: "/test/dir",
        relativeDirPath: ".gemini",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify(jsonData),
      });

      const rulesyncMcp = geminiCliMcp.toRulesyncMcp();

      expect(rulesyncMcp.getBaseDir()).toBe("/test/dir");
      expect(JSON.parse(rulesyncMcp.getFileContent())).toEqual(jsonData);
    });

    it("should handle empty mcpServers object when converting", () => {
      const jsonData = {
        mcpServers: {},
      };
      const geminiCliMcp = new GeminiCliMcp({
        relativeDirPath: ".gemini",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify(jsonData),
      });

      const rulesyncMcp = geminiCliMcp.toRulesyncMcp();

      expect(JSON.parse(rulesyncMcp.getFileContent())).toEqual(jsonData);
    });

    it("should extract only mcpServers when converting to RulesyncMcp", () => {
      const jsonData = {
        mcpServers: {
          "test-server": {
            command: "node",
            args: ["server.js"],
          },
        },
        userSettings: {
          theme: "light",
        },
        version: "2.0.0",
      };
      const geminiCliMcp = new GeminiCliMcp({
        relativeDirPath: ".gemini",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify(jsonData),
      });

      const rulesyncMcp = geminiCliMcp.toRulesyncMcp();

      const exportedJson = JSON.parse(rulesyncMcp.getFileContent());
      expect(exportedJson).toEqual({
        mcpServers: {
          "test-server": {
            command: "node",
            args: ["server.js"],
          },
        },
      });
      expect((exportedJson as any).userSettings).toBeUndefined();
      expect((exportedJson as any).version).toBeUndefined();
    });
  });

  describe("validate", () => {
    it("should return successful validation result", () => {
      const jsonData = {
        mcpServers: {
          "test-server": {
            command: "node",
            args: ["server.js"],
          },
        },
      };
      const geminiCliMcp = new GeminiCliMcp({
        relativeDirPath: ".gemini",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify(jsonData),
        validate: false, // Skip validation in constructor to test method directly
      });

      const result = geminiCliMcp.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should always return success (no validation logic implemented)", () => {
      const jsonData = {
        mcpServers: {},
      };
      const geminiCliMcp = new GeminiCliMcp({
        relativeDirPath: ".gemini",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify(jsonData),
        validate: false,
      });

      const result = geminiCliMcp.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return success for complex MCP configuration", () => {
      const jsonData = {
        mcpServers: {
          filesystem: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"],
            env: {
              NODE_ENV: "development",
            },
          },
          git: {
            command: "node",
            args: ["git-server.js"],
          },
          sqlite: {
            command: "python",
            args: ["sqlite-server.py", "--database", "/path/to/db.sqlite"],
            env: {
              PYTHONPATH: "/custom/path",
              DEBUG: "true",
            },
          },
        },
        globalSettings: {
          timeout: 30000,
          retries: 3,
        },
      };
      const geminiCliMcp = new GeminiCliMcp({
        relativeDirPath: ".gemini",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify(jsonData),
        validate: false,
      });

      const result = geminiCliMcp.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });

  describe("integration", () => {
    it("should handle complete workflow: fromFile -> toRulesyncMcp -> fromRulesyncMcp", async () => {
      const originalJsonData = {
        mcpServers: {
          "workflow-server": {
            command: "node",
            args: ["workflow-server.js", "--config", "config.json"],
            env: {
              NODE_ENV: "test",
            },
          },
        },
      };
      await ensureDir(join(testDir, ".gemini"));
      await writeFileContent(
        join(testDir, ".gemini/settings.json"),
        JSON.stringify(originalJsonData, null, 2),
      );

      // Step 1: Load from file
      const originalGeminiCliMcp = await GeminiCliMcp.fromFile({
        baseDir: testDir,
      });

      // Step 2: Convert to RulesyncMcp
      const rulesyncMcp = originalGeminiCliMcp.toRulesyncMcp();

      // Step 3: Create new GeminiCliMcp from RulesyncMcp
      const newGeminiCliMcp = await GeminiCliMcp.fromRulesyncMcp({
        baseDir: testDir,
        rulesyncMcp,
      });

      // Verify data integrity
      expect(newGeminiCliMcp.getJson()).toEqual(originalJsonData);
      expect(newGeminiCliMcp.getFilePath()).toBe(join(testDir, ".gemini/settings.json"));
    });

    it("should maintain data consistency across transformations", async () => {
      const complexJsonData = {
        mcpServers: {
          "primary-server": {
            command: "node",
            args: ["primary.js", "--mode", "production"],
            env: {
              NODE_ENV: "production",
              LOG_LEVEL: "info",
              API_KEY: "secret",
            },
          },
          "secondary-server": {
            command: "python",
            args: ["secondary.py", "--workers", "4"],
            env: {
              PYTHONPATH: "/app/lib",
            },
          },
        },
        config: {
          timeout: 60000,
          maxRetries: 5,
          logLevel: "debug",
        },
      };

      // Create GeminiCliMcp
      const geminiCliMcp = new GeminiCliMcp({
        baseDir: testDir,
        relativeDirPath: ".gemini",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify(complexJsonData),
      });

      // Convert to RulesyncMcp
      const rulesyncMcp = geminiCliMcp.toRulesyncMcp();

      // Verify only mcpServers is in exported data
      const exportedJson = JSON.parse(rulesyncMcp.getFileContent());
      expect(exportedJson.mcpServers).toBeDefined();
      expect((exportedJson as any).config).toBeUndefined();
    });

    it("should handle complete workflow in global mode", async () => {
      const originalJsonData = {
        mcpServers: {
          "global-workflow-server": {
            command: "node",
            args: ["global-server.js"],
          },
        },
      };
      await ensureDir(join(testDir, ".gemini"));
      await writeFileContent(
        join(testDir, ".gemini/settings.json"),
        JSON.stringify(originalJsonData, null, 2),
      );

      // Step 1: Load from global config
      const originalGeminiCliMcp = await GeminiCliMcp.fromFile({
        baseDir: testDir,
        global: true,
      });

      // Step 2: Convert to RulesyncMcp
      const rulesyncMcp = originalGeminiCliMcp.toRulesyncMcp();

      // Step 3: Create new GeminiCliMcp from RulesyncMcp in global mode
      const newGeminiCliMcp = await GeminiCliMcp.fromRulesyncMcp({
        baseDir: testDir,
        rulesyncMcp,
        global: true,
      });

      // Verify data integrity
      expect(newGeminiCliMcp.getJson()).toEqual(originalJsonData);
      expect(newGeminiCliMcp.getFilePath()).toBe(join(testDir, ".gemini/settings.json"));
    });
  });

  describe("error handling", () => {
    it("should handle malformed JSON in existing file gracefully", async () => {
      await ensureDir(join(testDir, ".gemini"));
      await writeFileContent(join(testDir, ".gemini/settings.json"), "{ invalid json }");

      await expect(
        GeminiCliMcp.fromFile({
          baseDir: testDir,
        }),
      ).rejects.toThrow();
    });

    it("should handle malformed JSON in global config gracefully", async () => {
      await ensureDir(join(testDir, ".gemini"));
      await writeFileContent(join(testDir, ".gemini/settings.json"), "{ invalid: json }");

      await expect(
        GeminiCliMcp.fromFile({
          baseDir: testDir,
          global: true,
        }),
      ).rejects.toThrow();
    });

    it("should handle null mcpServers in existing file", async () => {
      const jsonData = {
        mcpServers: null,
      };
      await ensureDir(join(testDir, ".gemini"));
      await writeFileContent(join(testDir, ".gemini/settings.json"), JSON.stringify(jsonData));

      const geminiCliMcp = await GeminiCliMcp.fromFile({
        baseDir: testDir,
      });

      expect(geminiCliMcp.getJson().mcpServers).toEqual({});
    });

    it("should handle undefined mcpServers in existing file", async () => {
      const jsonData = {
        otherProperty: "value",
      };
      await ensureDir(join(testDir, ".gemini"));
      await writeFileContent(join(testDir, ".gemini/settings.json"), JSON.stringify(jsonData));

      const geminiCliMcp = await GeminiCliMcp.fromFile({
        baseDir: testDir,
      });

      expect(geminiCliMcp.getJson().mcpServers).toEqual({});
      expect((geminiCliMcp.getJson() as any).otherProperty).toBe("value");
    });

    it("should handle empty file", async () => {
      await ensureDir(join(testDir, ".gemini"));
      await writeFileContent(join(testDir, ".gemini/settings.json"), "");

      await expect(
        GeminiCliMcp.fromFile({
          baseDir: testDir,
        }),
      ).rejects.toThrow();
    });

    it("should handle file with only whitespace", async () => {
      await ensureDir(join(testDir, ".gemini"));
      await writeFileContent(join(testDir, ".gemini/settings.json"), "   \n\t  ");

      await expect(
        GeminiCliMcp.fromFile({
          baseDir: testDir,
        }),
      ).rejects.toThrow();
    });
  });
});
