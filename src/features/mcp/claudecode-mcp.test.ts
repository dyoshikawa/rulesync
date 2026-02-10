import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { ClaudecodeMcp } from "./claudecode-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

describe("ClaudecodeMcp", () => {
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
      const paths = ClaudecodeMcp.getSettablePaths();

      expect(paths.relativeDirPath).toBe(".");
      expect(paths.relativeFilePath).toBe(".mcp.json");
    });

    it("should return correct paths for global mode", () => {
      const paths = ClaudecodeMcp.getSettablePaths({ global: true });

      expect(paths.relativeDirPath).toBe(".claude");
      expect(paths.relativeFilePath).toBe(".claude.json");
    });
  });

  describe("isDeletable", () => {
    it("should return true in local mode", () => {
      const claudecodeMcp = new ClaudecodeMcp({
        relativeDirPath: ".",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({ mcpServers: {} }),
        global: false,
      });

      expect(claudecodeMcp.isDeletable()).toBe(true);
    });

    it("should return false in global mode", () => {
      const claudecodeMcp = new ClaudecodeMcp({
        relativeDirPath: ".claude",
        relativeFilePath: ".claude.json",
        fileContent: JSON.stringify({ mcpServers: {} }),
        global: true,
      });

      expect(claudecodeMcp.isDeletable()).toBe(false);
    });

    it("should return false when created via forDeletion with global: true", () => {
      const claudecodeMcp = ClaudecodeMcp.forDeletion({
        relativeDirPath: ".claude",
        relativeFilePath: ".claude.json",
        global: true,
      });

      expect(claudecodeMcp.isDeletable()).toBe(false);
    });
  });

  describe("constructor", () => {
    it("should create instance with default parameters", () => {
      const validJsonContent = JSON.stringify({
        mcpServers: {
          "@anthropic-ai/mcp-server-filesystem": {
            command: "npx",
            args: ["-y", "@anthropic-ai/mcp-server-filesystem", "/workspace"],
          },
        },
      });

      const claudecodeMcp = new ClaudecodeMcp({
        relativeDirPath: ".",
        relativeFilePath: ".mcp.json",
        fileContent: validJsonContent,
      });

      expect(claudecodeMcp).toBeInstanceOf(ClaudecodeMcp);
      expect(claudecodeMcp.getRelativeDirPath()).toBe(".");
      expect(claudecodeMcp.getRelativeFilePath()).toBe(".mcp.json");
      expect(claudecodeMcp.getFileContent()).toBe(validJsonContent);
    });

    it("should create instance with custom baseDir", () => {
      const validJsonContent = JSON.stringify({
        mcpServers: {},
      });

      const claudecodeMcp = new ClaudecodeMcp({
        baseDir: "/custom/path",
        relativeDirPath: ".",
        relativeFilePath: ".mcp.json",
        fileContent: validJsonContent,
      });

      expect(claudecodeMcp.getFilePath()).toBe("/custom/path/.mcp.json");
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

      const claudecodeMcp = new ClaudecodeMcp({
        relativeDirPath: ".",
        relativeFilePath: ".mcp.json",
        fileContent: validJsonContent,
      });

      expect(claudecodeMcp.getJson()).toEqual(jsonData);
    });

    it("should handle empty JSON object", () => {
      const emptyJsonContent = JSON.stringify({});

      const claudecodeMcp = new ClaudecodeMcp({
        relativeDirPath: ".",
        relativeFilePath: ".mcp.json",
        fileContent: emptyJsonContent,
      });

      expect(claudecodeMcp.getJson()).toEqual({});
    });

    it("should validate content by default", () => {
      const validJsonContent = JSON.stringify({
        mcpServers: {},
      });

      expect(() => {
        const _instance = new ClaudecodeMcp({
          relativeDirPath: ".",
          relativeFilePath: ".mcp.json",
          fileContent: validJsonContent,
        });
      }).not.toThrow();
    });

    it("should skip validation when validate is false", () => {
      const validJsonContent = JSON.stringify({
        mcpServers: {},
      });

      expect(() => {
        const _instance = new ClaudecodeMcp({
          relativeDirPath: ".",
          relativeFilePath: ".mcp.json",
          fileContent: validJsonContent,
          validate: false,
        });
      }).not.toThrow();
    });

    it("should throw error for invalid JSON content", () => {
      const invalidJsonContent = "{ invalid json }";

      expect(() => {
        const _instance = new ClaudecodeMcp({
          relativeDirPath: ".",
          relativeFilePath: ".mcp.json",
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
      await writeFileContent(join(testDir, ".mcp.json"), JSON.stringify(jsonData, null, 2));

      const claudecodeMcp = await ClaudecodeMcp.fromFile({
        baseDir: testDir,
      });

      expect(claudecodeMcp).toBeInstanceOf(ClaudecodeMcp);
      expect(claudecodeMcp.getJson()).toEqual(jsonData);
      expect(claudecodeMcp.getFilePath()).toBe(join(testDir, ".mcp.json"));
    });

    it("should initialize empty mcpServers if file does not exist", async () => {
      const claudecodeMcp = await ClaudecodeMcp.fromFile({
        baseDir: testDir,
      });

      expect(claudecodeMcp).toBeInstanceOf(ClaudecodeMcp);
      expect(claudecodeMcp.getJson()).toEqual({ mcpServers: {} });
      expect(claudecodeMcp.getFilePath()).toBe(join(testDir, ".mcp.json"));
    });

    it("should initialize mcpServers if missing in existing file", async () => {
      const jsonData = {
        customConfig: {
          setting: "value",
        },
      };
      await writeFileContent(join(testDir, ".mcp.json"), JSON.stringify(jsonData));

      const claudecodeMcp = await ClaudecodeMcp.fromFile({
        baseDir: testDir,
      });

      expect(claudecodeMcp.getJson()).toEqual({
        customConfig: {
          setting: "value",
        },
        mcpServers: {},
      });
    });

    it("should create instance from file with custom baseDir", async () => {
      const customDir = join(testDir, "custom");
      await ensureDir(customDir);

      const jsonData = {
        mcpServers: {
          git: {
            command: "node",
            args: ["git-server.js"],
          },
        },
      };
      await writeFileContent(join(customDir, ".mcp.json"), JSON.stringify(jsonData));

      const claudecodeMcp = await ClaudecodeMcp.fromFile({
        baseDir: customDir,
      });

      expect(claudecodeMcp.getFilePath()).toBe(join(customDir, ".mcp.json"));
      expect(claudecodeMcp.getJson()).toEqual(jsonData);
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
      await writeFileContent(join(testDir, ".mcp.json"), JSON.stringify(jsonData));

      const claudecodeMcp = await ClaudecodeMcp.fromFile({
        baseDir: testDir,
        validate: true,
      });

      expect(claudecodeMcp.getJson()).toEqual(jsonData);
    });

    it("should skip validation when validate is false", async () => {
      const jsonData = {
        mcpServers: {},
      };
      await writeFileContent(join(testDir, ".mcp.json"), JSON.stringify(jsonData));

      const claudecodeMcp = await ClaudecodeMcp.fromFile({
        baseDir: testDir,
        validate: false,
      });

      expect(claudecodeMcp.getJson()).toEqual(jsonData);
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
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(
        join(testDir, ".claude/.claude.json"),
        JSON.stringify(jsonData, null, 2),
      );

      const claudecodeMcp = await ClaudecodeMcp.fromFile({
        baseDir: testDir,
        global: true,
      });

      expect(claudecodeMcp).toBeInstanceOf(ClaudecodeMcp);
      expect(claudecodeMcp.getJson()).toEqual(jsonData);
      expect(claudecodeMcp.getFilePath()).toBe(join(testDir, ".claude/.claude.json"));
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
      await writeFileContent(join(testDir, ".mcp.json"), JSON.stringify(jsonData));

      const claudecodeMcp = await ClaudecodeMcp.fromFile({
        baseDir: testDir,
        global: false,
      });

      expect(claudecodeMcp.getFilePath()).toBe(join(testDir, ".mcp.json"));
      expect(claudecodeMcp.getJson()).toEqual(jsonData);
    });

    it("should initialize global config file if it does not exist", async () => {
      const claudecodeMcp = await ClaudecodeMcp.fromFile({
        baseDir: testDir,
        global: true,
      });

      expect(claudecodeMcp).toBeInstanceOf(ClaudecodeMcp);
      expect(claudecodeMcp.getJson()).toEqual({ mcpServers: {} });
      expect(claudecodeMcp.getFilePath()).toBe(join(testDir, ".claude/.claude.json"));
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
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(
        join(testDir, ".claude/.claude.json"),
        JSON.stringify(existingGlobalConfig, null, 2),
      );

      const claudecodeMcp = await ClaudecodeMcp.fromFile({
        baseDir: testDir,
        global: true,
      });

      const json = claudecodeMcp.getJson();
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

      const claudecodeMcp = await ClaudecodeMcp.fromRulesyncMcp({
        baseDir: testDir,
        rulesyncMcp,
      });

      expect(claudecodeMcp).toBeInstanceOf(ClaudecodeMcp);
      expect(claudecodeMcp.getJson()).toEqual(jsonData);
      expect(claudecodeMcp.getRelativeDirPath()).toBe(".");
      expect(claudecodeMcp.getRelativeFilePath()).toBe(".mcp.json");
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
      const claudecodeMcp = await ClaudecodeMcp.fromRulesyncMcp({
        baseDir: customDir,
        rulesyncMcp,
      });

      expect(claudecodeMcp.getFilePath()).toBe(join(customDir, ".mcp.json"));
      expect(claudecodeMcp.getJson()).toEqual(jsonData);
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

      const claudecodeMcp = await ClaudecodeMcp.fromRulesyncMcp({
        baseDir: testDir,
        rulesyncMcp,
        validate: true,
      });

      expect(claudecodeMcp.getJson()).toEqual(jsonData);
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

      const claudecodeMcp = await ClaudecodeMcp.fromRulesyncMcp({
        baseDir: testDir,
        rulesyncMcp,
        validate: false,
      });

      expect(claudecodeMcp.getJson()).toEqual(jsonData);
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

      const claudecodeMcp = await ClaudecodeMcp.fromRulesyncMcp({
        baseDir: testDir,
        rulesyncMcp,
      });

      expect(claudecodeMcp.getJson()).toEqual(jsonData);
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

      const claudecodeMcp = await ClaudecodeMcp.fromRulesyncMcp({
        baseDir: testDir,
        rulesyncMcp,
        global: true,
      });

      expect(claudecodeMcp).toBeInstanceOf(ClaudecodeMcp);
      expect(claudecodeMcp.getJson()).toEqual(jsonData);
      expect(claudecodeMcp.getRelativeDirPath()).toBe(".claude");
      expect(claudecodeMcp.getRelativeFilePath()).toBe(".claude.json");
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

      const claudecodeMcp = await ClaudecodeMcp.fromRulesyncMcp({
        baseDir: testDir,
        rulesyncMcp,
        global: false,
      });

      expect(claudecodeMcp.getFilePath()).toBe(join(testDir, ".mcp.json"));
      expect(claudecodeMcp.getJson()).toEqual(jsonData);
      expect(claudecodeMcp.getRelativeDirPath()).toBe(".");
      expect(claudecodeMcp.getRelativeFilePath()).toBe(".mcp.json");
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
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(
        join(testDir, ".claude/.claude.json"),
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
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(newMcpServers),
      });

      const claudecodeMcp = await ClaudecodeMcp.fromRulesyncMcp({
        baseDir: testDir,
        rulesyncMcp,
        global: true,
      });

      const json = claudecodeMcp.getJson();
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
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(
        join(testDir, ".claude/.claude.json"),
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
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(newMcpConfig),
      });

      const claudecodeMcp = await ClaudecodeMcp.fromRulesyncMcp({
        baseDir: testDir,
        rulesyncMcp,
        global: true,
      });

      const json = claudecodeMcp.getJson();
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
      const claudecodeMcp = new ClaudecodeMcp({
        relativeDirPath: ".",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const rulesyncMcp = claudecodeMcp.toRulesyncMcp();

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
      const claudecodeMcp = new ClaudecodeMcp({
        baseDir: "/test/dir",
        relativeDirPath: ".",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const rulesyncMcp = claudecodeMcp.toRulesyncMcp();

      expect(rulesyncMcp.getBaseDir()).toBe("/test/dir");
      expect(JSON.parse(rulesyncMcp.getFileContent())).toEqual(jsonData);
    });

    it("should handle empty mcpServers object when converting", () => {
      const jsonData = {
        mcpServers: {},
      };
      const claudecodeMcp = new ClaudecodeMcp({
        relativeDirPath: ".",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const rulesyncMcp = claudecodeMcp.toRulesyncMcp();

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
      const claudecodeMcp = new ClaudecodeMcp({
        relativeDirPath: ".claude",
        relativeFilePath: ".claude.json",
        fileContent: JSON.stringify(jsonData),
      });

      const rulesyncMcp = claudecodeMcp.toRulesyncMcp();

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
      const claudecodeMcp = new ClaudecodeMcp({
        relativeDirPath: ".",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(jsonData),
        validate: false, // Skip validation in constructor to test method directly
      });

      const result = claudecodeMcp.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should always return success (no validation logic implemented)", () => {
      const jsonData = {
        mcpServers: {},
      };
      const claudecodeMcp = new ClaudecodeMcp({
        relativeDirPath: ".",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(jsonData),
        validate: false,
      });

      const result = claudecodeMcp.validate();

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
      const claudecodeMcp = new ClaudecodeMcp({
        relativeDirPath: ".",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(jsonData),
        validate: false,
      });

      const result = claudecodeMcp.validate();

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
      await writeFileContent(join(testDir, ".mcp.json"), JSON.stringify(originalJsonData, null, 2));

      // Step 1: Load from file
      const originalClaudecodeMcp = await ClaudecodeMcp.fromFile({
        baseDir: testDir,
      });

      // Step 2: Convert to RulesyncMcp
      const rulesyncMcp = originalClaudecodeMcp.toRulesyncMcp();

      // Step 3: Create new ClaudecodeMcp from RulesyncMcp
      const newClaudecodeMcp = await ClaudecodeMcp.fromRulesyncMcp({
        baseDir: testDir,
        rulesyncMcp,
      });

      // Verify data integrity
      expect(newClaudecodeMcp.getJson()).toEqual(originalJsonData);
      expect(newClaudecodeMcp.getFilePath()).toBe(join(testDir, ".mcp.json"));
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

      // Create ClaudecodeMcp
      const claudecodeMcp = new ClaudecodeMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(complexJsonData),
      });

      // Convert to RulesyncMcp
      const rulesyncMcp = claudecodeMcp.toRulesyncMcp();

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
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(
        join(testDir, ".claude/.claude.json"),
        JSON.stringify(originalJsonData, null, 2),
      );

      // Step 1: Load from global config
      const originalClaudecodeMcp = await ClaudecodeMcp.fromFile({
        baseDir: testDir,
        global: true,
      });

      // Step 2: Convert to RulesyncMcp
      const rulesyncMcp = originalClaudecodeMcp.toRulesyncMcp();

      // Step 3: Create new ClaudecodeMcp from RulesyncMcp in global mode
      const newClaudecodeMcp = await ClaudecodeMcp.fromRulesyncMcp({
        baseDir: testDir,
        rulesyncMcp,
        global: true,
      });

      // Verify data integrity
      expect(newClaudecodeMcp.getJson()).toEqual(originalJsonData);
      expect(newClaudecodeMcp.getFilePath()).toBe(join(testDir, ".claude/.claude.json"));
    });
  });

  describe("error handling", () => {
    it("should handle malformed JSON in existing file gracefully", async () => {
      await writeFileContent(join(testDir, ".mcp.json"), "{ invalid json }");

      await expect(
        ClaudecodeMcp.fromFile({
          baseDir: testDir,
        }),
      ).rejects.toThrow();
    });

    it("should handle malformed JSON in global config gracefully", async () => {
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(join(testDir, ".claude/.claude.json"), "{ invalid: json }");

      await expect(
        ClaudecodeMcp.fromFile({
          baseDir: testDir,
          global: true,
        }),
      ).rejects.toThrow();
    });

    it("should handle null mcpServers in existing file", async () => {
      const jsonData = {
        mcpServers: null,
      };
      await writeFileContent(join(testDir, ".mcp.json"), JSON.stringify(jsonData));

      const claudecodeMcp = await ClaudecodeMcp.fromFile({
        baseDir: testDir,
      });

      expect(claudecodeMcp.getJson().mcpServers).toEqual({});
    });

    it("should handle undefined mcpServers in existing file", async () => {
      const jsonData = {
        otherProperty: "value",
      };
      await writeFileContent(join(testDir, ".mcp.json"), JSON.stringify(jsonData));

      const claudecodeMcp = await ClaudecodeMcp.fromFile({
        baseDir: testDir,
      });

      expect(claudecodeMcp.getJson().mcpServers).toEqual({});
      expect((claudecodeMcp.getJson() as any).otherProperty).toBe("value");
    });

    it("should handle empty file", async () => {
      await writeFileContent(join(testDir, ".mcp.json"), "");

      await expect(
        ClaudecodeMcp.fromFile({
          baseDir: testDir,
        }),
      ).rejects.toThrow();
    });

    it("should handle file with only whitespace", async () => {
      await writeFileContent(join(testDir, ".mcp.json"), "   \n\t  ");

      await expect(
        ClaudecodeMcp.fromFile({
          baseDir: testDir,
        }),
      ).rejects.toThrow();
    });
  });
});
