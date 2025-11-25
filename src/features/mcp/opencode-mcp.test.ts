import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { OpencodeMcp } from "./opencode-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

describe("OpencodeMcp", () => {
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
      const paths = OpencodeMcp.getSettablePaths();

      expect(paths.relativeDirPath).toBe(".");
      expect(paths.relativeFilePath).toBe("opencode.json");
    });

    it("should return correct paths for global mode", () => {
      const paths = OpencodeMcp.getSettablePaths({ global: true });

      expect(paths.relativeDirPath).toBe(".");
      expect(paths.relativeFilePath).toBe("opencode.json");
    });
  });

  describe("constructor", () => {
    it("should create instance with default parameters", () => {
      const validJsonContent = JSON.stringify({
        mcp: {
          "test-server": {
            type: "local",
            command: ["node", "server.js"],
            environment: {},
            enabled: true,
          },
        },
      });

      const opencodeMcp = new OpencodeMcp({
        relativeDirPath: ".",
        relativeFilePath: "opencode.json",
        fileContent: validJsonContent,
      });

      expect(opencodeMcp).toBeInstanceOf(OpencodeMcp);
      expect(opencodeMcp.getRelativeDirPath()).toBe(".");
      expect(opencodeMcp.getRelativeFilePath()).toBe("opencode.json");
      expect(opencodeMcp.getFileContent()).toBe(validJsonContent);
    });

    it("should create instance with custom baseDir", () => {
      const validJsonContent = JSON.stringify({
        mcp: {},
      });

      const opencodeMcp = new OpencodeMcp({
        baseDir: "/custom/path",
        relativeDirPath: ".",
        relativeFilePath: "opencode.json",
        fileContent: validJsonContent,
      });

      expect(opencodeMcp.getFilePath()).toBe("/custom/path/opencode.json");
    });

    it("should parse JSON content correctly", () => {
      const jsonData = {
        mcp: {
          "test-server": {
            type: "local",
            command: ["node", "server.js"],
            environment: { NODE_ENV: "development" },
            enabled: true,
          },
        },
      };
      const validJsonContent = JSON.stringify(jsonData);

      const opencodeMcp = new OpencodeMcp({
        relativeDirPath: ".",
        relativeFilePath: "opencode.json",
        fileContent: validJsonContent,
      });

      expect(opencodeMcp.getJson()).toEqual(jsonData);
    });

    it("should handle empty JSON object", () => {
      const emptyJsonContent = JSON.stringify({});

      const opencodeMcp = new OpencodeMcp({
        relativeDirPath: ".",
        relativeFilePath: "opencode.json",
        fileContent: emptyJsonContent,
      });

      expect(opencodeMcp.getJson()).toEqual({});
    });

    it("should validate content by default", () => {
      const validJsonContent = JSON.stringify({
        mcp: {},
      });

      expect(() => {
        const _instance = new OpencodeMcp({
          relativeDirPath: ".",
          relativeFilePath: "opencode.json",
          fileContent: validJsonContent,
        });
      }).not.toThrow();
    });

    it("should skip validation when validate is false", () => {
      const validJsonContent = JSON.stringify({
        mcp: {},
      });

      expect(() => {
        const _instance = new OpencodeMcp({
          relativeDirPath: ".",
          relativeFilePath: "opencode.json",
          fileContent: validJsonContent,
          validate: false,
        });
      }).not.toThrow();
    });

    it("should throw error for invalid JSON content", () => {
      const invalidJsonContent = "{ invalid json }";

      expect(() => {
        const _instance = new OpencodeMcp({
          relativeDirPath: ".",
          relativeFilePath: "opencode.json",
          fileContent: invalidJsonContent,
        });
      }).toThrow();
    });
  });

  describe("fromFile", () => {
    it("should create instance from file with default parameters", async () => {
      const jsonData = {
        mcp: {
          filesystem: {
            type: "local",
            command: ["npx", "-y", "@modelcontextprotocol/server-filesystem", testDir],
            environment: {},
            enabled: true,
          },
        },
      };
      await writeFileContent(join(testDir, "opencode.json"), JSON.stringify(jsonData, null, 2));

      const opencodeMcp = await OpencodeMcp.fromFile({
        baseDir: testDir,
      });

      expect(opencodeMcp).toBeInstanceOf(OpencodeMcp);
      expect(opencodeMcp.getJson()).toEqual(jsonData);
      expect(opencodeMcp.getFilePath()).toBe(join(testDir, "opencode.json"));
    });

    it("should initialize empty mcp if file does not exist", async () => {
      const opencodeMcp = await OpencodeMcp.fromFile({
        baseDir: testDir,
      });

      expect(opencodeMcp).toBeInstanceOf(OpencodeMcp);
      expect(opencodeMcp.getJson()).toEqual({ mcp: {} });
      expect(opencodeMcp.getFilePath()).toBe(join(testDir, "opencode.json"));
    });

    it("should initialize mcp if missing in existing file", async () => {
      const jsonData = {
        customConfig: {
          setting: "value",
        },
      };
      await writeFileContent(join(testDir, "opencode.json"), JSON.stringify(jsonData));

      const opencodeMcp = await OpencodeMcp.fromFile({
        baseDir: testDir,
      });

      expect(opencodeMcp.getJson()).toEqual({
        customConfig: {
          setting: "value",
        },
        mcp: {},
      });
    });

    it("should create instance from file with custom baseDir", async () => {
      const customDir = join(testDir, "custom");
      await ensureDir(customDir);

      const jsonData = {
        mcp: {
          git: {
            type: "local",
            command: ["node", "git-server.js"],
            environment: {},
            enabled: true,
          },
        },
      };
      await writeFileContent(join(customDir, "opencode.json"), JSON.stringify(jsonData));

      const opencodeMcp = await OpencodeMcp.fromFile({
        baseDir: customDir,
      });

      expect(opencodeMcp.getFilePath()).toBe(join(customDir, "opencode.json"));
      expect(opencodeMcp.getJson()).toEqual(jsonData);
    });

    it("should handle validation when validate is true", async () => {
      const jsonData = {
        mcp: {
          "valid-server": {
            type: "local",
            command: ["node", "server.js"],
            environment: {},
            enabled: true,
          },
        },
      };
      await writeFileContent(join(testDir, "opencode.json"), JSON.stringify(jsonData));

      const opencodeMcp = await OpencodeMcp.fromFile({
        baseDir: testDir,
        validate: true,
      });

      expect(opencodeMcp.getJson()).toEqual(jsonData);
    });

    it("should skip validation when validate is false", async () => {
      const jsonData = {
        mcp: {},
      };
      await writeFileContent(join(testDir, "opencode.json"), JSON.stringify(jsonData));

      const opencodeMcp = await OpencodeMcp.fromFile({
        baseDir: testDir,
        validate: false,
      });

      expect(opencodeMcp.getJson()).toEqual(jsonData);
    });

    it("should create instance from file in global mode", async () => {
      const jsonData = {
        mcp: {
          filesystem: {
            type: "local",
            command: ["npx", "-y", "@modelcontextprotocol/server-filesystem", testDir],
            environment: {},
            enabled: true,
          },
        },
      };
      await writeFileContent(join(testDir, "opencode.json"), JSON.stringify(jsonData, null, 2));

      const opencodeMcp = await OpencodeMcp.fromFile({
        baseDir: testDir,
        global: true,
      });

      expect(opencodeMcp).toBeInstanceOf(OpencodeMcp);
      expect(opencodeMcp.getJson()).toEqual(jsonData);
      expect(opencodeMcp.getFilePath()).toBe(join(testDir, "opencode.json"));
    });

    it("should create instance from file in local mode (default)", async () => {
      const jsonData = {
        mcp: {
          git: {
            type: "local",
            command: ["node", "git-server.js"],
            environment: {},
            enabled: true,
          },
        },
      };
      await writeFileContent(join(testDir, "opencode.json"), JSON.stringify(jsonData));

      const opencodeMcp = await OpencodeMcp.fromFile({
        baseDir: testDir,
        global: false,
      });

      expect(opencodeMcp.getFilePath()).toBe(join(testDir, "opencode.json"));
      expect(opencodeMcp.getJson()).toEqual(jsonData);
    });

    it("should initialize global config file if it does not exist", async () => {
      const opencodeMcp = await OpencodeMcp.fromFile({
        baseDir: testDir,
        global: true,
      });

      expect(opencodeMcp).toBeInstanceOf(OpencodeMcp);
      expect(opencodeMcp.getJson()).toEqual({ mcp: {} });
      expect(opencodeMcp.getFilePath()).toBe(join(testDir, "opencode.json"));
    });

    it("should preserve non-mcp properties in global mode", async () => {
      const existingGlobalConfig = {
        mcp: {
          "old-server": {
            type: "local",
            command: ["node", "old-server.js"],
            environment: {},
            enabled: true,
          },
        },
        userSettings: {
          theme: "dark",
          fontSize: 14,
        },
        version: "1.0.0",
      };
      await writeFileContent(
        join(testDir, "opencode.json"),
        JSON.stringify(existingGlobalConfig, null, 2),
      );

      const opencodeMcp = await OpencodeMcp.fromFile({
        baseDir: testDir,
        global: true,
      });

      const json = opencodeMcp.getJson();
      expect(json.mcp).toEqual({
        "old-server": {
          type: "local",
          command: ["node", "old-server.js"],
          environment: {},
          enabled: true,
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

      const opencodeMcp = await OpencodeMcp.fromRulesyncMcp({
        baseDir: testDir,
        rulesyncMcp,
      });

      expect(opencodeMcp).toBeInstanceOf(OpencodeMcp);
      // fromRulesyncMcp converts standard MCP format to OpenCode format
      expect(opencodeMcp.getJson()).toEqual({
        mcp: {
          "test-server": {
            type: "local",
            command: ["node", "test-server.js"],
            enabled: true,
          },
        },
      });
      expect(opencodeMcp.getRelativeDirPath()).toBe(".");
      expect(opencodeMcp.getRelativeFilePath()).toBe("opencode.json");
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
      const opencodeMcp = await OpencodeMcp.fromRulesyncMcp({
        baseDir: customDir,
        rulesyncMcp,
      });

      expect(opencodeMcp.getFilePath()).toBe(join(customDir, "opencode.json"));
      // fromRulesyncMcp converts standard MCP format to OpenCode format
      expect(opencodeMcp.getJson()).toEqual({
        mcp: {
          "custom-server": {
            type: "local",
            command: ["python", "server.py"],
            enabled: true,
            environment: {
              PYTHONPATH: "/custom/path",
            },
          },
        },
      });
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

      const opencodeMcp = await OpencodeMcp.fromRulesyncMcp({
        baseDir: testDir,
        rulesyncMcp,
        validate: true,
      });

      // fromRulesyncMcp converts standard MCP format to OpenCode format
      expect(opencodeMcp.getJson()).toEqual({
        mcp: {
          "validated-server": {
            type: "local",
            command: ["node", "validated-server.js"],
            enabled: true,
          },
        },
      });
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

      const opencodeMcp = await OpencodeMcp.fromRulesyncMcp({
        baseDir: testDir,
        rulesyncMcp,
        validate: false,
      });

      expect(opencodeMcp.getJson()).toEqual({ mcp: {} });
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

      const opencodeMcp = await OpencodeMcp.fromRulesyncMcp({
        baseDir: testDir,
        rulesyncMcp,
      });

      expect(opencodeMcp.getJson()).toEqual({ mcp: {} });
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

      const opencodeMcp = await OpencodeMcp.fromRulesyncMcp({
        baseDir: testDir,
        rulesyncMcp,
        global: true,
      });

      expect(opencodeMcp).toBeInstanceOf(OpencodeMcp);
      // fromRulesyncMcp converts standard MCP format to OpenCode format
      expect(opencodeMcp.getJson()).toEqual({
        mcp: {
          "global-server": {
            type: "local",
            command: ["node", "global-server.js"],
            enabled: true,
          },
        },
      });
      expect(opencodeMcp.getRelativeDirPath()).toBe(".");
      expect(opencodeMcp.getRelativeFilePath()).toBe("opencode.json");
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

      const opencodeMcp = await OpencodeMcp.fromRulesyncMcp({
        baseDir: testDir,
        rulesyncMcp,
        global: false,
      });

      expect(opencodeMcp.getFilePath()).toBe(join(testDir, "opencode.json"));
      // fromRulesyncMcp converts standard MCP format to OpenCode format
      expect(opencodeMcp.getJson()).toEqual({
        mcp: {
          "local-server": {
            type: "local",
            command: ["python", "local-server.py"],
            enabled: true,
          },
        },
      });
      expect(opencodeMcp.getRelativeDirPath()).toBe(".");
      expect(opencodeMcp.getRelativeFilePath()).toBe("opencode.json");
    });

    it("should preserve non-mcp properties when updating global config", async () => {
      const existingGlobalConfig = {
        mcp: {
          "old-server": {
            type: "local",
            command: ["node", "old-server.js"],
            environment: {},
            enabled: true,
          },
        },
        userSettings: {
          theme: "dark",
        },
        version: "1.0.0",
      };
      await writeFileContent(
        join(testDir, "opencode.json"),
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

      const opencodeMcp = await OpencodeMcp.fromRulesyncMcp({
        baseDir: testDir,
        rulesyncMcp,
        global: true,
      });

      const json = opencodeMcp.getJson();
      // fromRulesyncMcp converts standard MCP format to OpenCode format
      expect(json.mcp).toEqual({
        "new-server": {
          type: "local",
          command: ["python", "new-server.py"],
          enabled: true,
        },
      });
      expect((json as any).userSettings).toEqual({
        theme: "dark",
      });
      expect((json as any).version).toBe("1.0.0");
    });

    it("should merge mcp when updating global config", async () => {
      const existingGlobalConfig = {
        mcp: {
          "existing-server": {
            type: "local",
            command: ["node", "existing-server.js"],
            environment: {},
            enabled: true,
          },
        },
        customProperty: "value",
      };
      await writeFileContent(
        join(testDir, "opencode.json"),
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

      const opencodeMcp = await OpencodeMcp.fromRulesyncMcp({
        baseDir: testDir,
        rulesyncMcp,
        global: true,
      });

      const json = opencodeMcp.getJson();
      // Should replace mcp entirely, not merge individual servers
      // fromRulesyncMcp converts standard MCP format to OpenCode format
      expect(json.mcp).toEqual({
        "new-server": {
          type: "local",
          command: ["python", "new-server.py"],
          enabled: true,
        },
        "another-server": {
          type: "local",
          command: ["node", "another.js"],
          enabled: true,
        },
      });
      expect((json as any).customProperty).toBe("value");
    });
  });

  describe("toRulesyncMcp", () => {
    it("should convert to RulesyncMcp with default configuration", () => {
      const jsonData = {
        mcp: {
          filesystem: {
            type: "local",
            command: ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
            environment: {},
            enabled: true,
          },
        },
      };
      const opencodeMcp = new OpencodeMcp({
        relativeDirPath: ".",
        relativeFilePath: "opencode.json",
        fileContent: JSON.stringify(jsonData),
      });

      const rulesyncMcp = opencodeMcp.toRulesyncMcp();

      expect(rulesyncMcp).toBeInstanceOf(RulesyncMcp);
      expect(rulesyncMcp.getFileContent()).toBe(
        JSON.stringify({ mcpServers: jsonData.mcp }, null, 2),
      );
      expect(rulesyncMcp.getRelativeDirPath()).toBe(RULESYNC_RELATIVE_DIR_PATH);
      expect(rulesyncMcp.getRelativeFilePath()).toBe(".mcp.json");
    });

    it("should preserve file content when converting to RulesyncMcp", () => {
      const jsonData = {
        mcp: {
          "complex-server": {
            type: "local",
            command: ["node", "complex-server.js", "--port", "3000"],
            environment: {
              NODE_ENV: "production",
              DEBUG: "mcp:*",
            },
            enabled: true,
          },
        },
      };
      const opencodeMcp = new OpencodeMcp({
        baseDir: "/test/dir",
        relativeDirPath: ".",
        relativeFilePath: "opencode.json",
        fileContent: JSON.stringify(jsonData),
      });

      const rulesyncMcp = opencodeMcp.toRulesyncMcp();

      expect(rulesyncMcp.getBaseDir()).toBe("/test/dir");
      expect(JSON.parse(rulesyncMcp.getFileContent())).toEqual({ mcpServers: jsonData.mcp });
    });

    it("should handle empty mcp object when converting", () => {
      const jsonData = {
        mcp: {},
      };
      const opencodeMcp = new OpencodeMcp({
        relativeDirPath: ".",
        relativeFilePath: "opencode.json",
        fileContent: JSON.stringify(jsonData),
      });

      const rulesyncMcp = opencodeMcp.toRulesyncMcp();

      expect(JSON.parse(rulesyncMcp.getFileContent())).toEqual({ mcpServers: {} });
    });

    it("should extract only mcp when converting to RulesyncMcp", () => {
      const jsonData = {
        mcp: {
          "test-server": {
            type: "local",
            command: ["node", "server.js"],
            environment: {},
            enabled: true,
          },
        },
        userSettings: {
          theme: "light",
        },
        version: "2.0.0",
      };
      const opencodeMcp = new OpencodeMcp({
        relativeDirPath: ".",
        relativeFilePath: "opencode.json",
        fileContent: JSON.stringify(jsonData),
      });

      const rulesyncMcp = opencodeMcp.toRulesyncMcp();

      const exportedJson = JSON.parse(rulesyncMcp.getFileContent());
      expect(exportedJson).toEqual({
        mcpServers: {
          "test-server": {
            type: "local",
            command: ["node", "server.js"],
            environment: {},
            enabled: true,
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
        mcp: {
          "test-server": {
            type: "local",
            command: ["node", "server.js"],
            environment: {},
            enabled: true,
          },
        },
      };
      const opencodeMcp = new OpencodeMcp({
        relativeDirPath: ".",
        relativeFilePath: "opencode.json",
        fileContent: JSON.stringify(jsonData),
        validate: false, // Skip validation in constructor to test method directly
      });

      const result = opencodeMcp.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should always return success (no validation logic implemented)", () => {
      const jsonData = {
        mcp: {},
      };
      const opencodeMcp = new OpencodeMcp({
        relativeDirPath: ".",
        relativeFilePath: "opencode.json",
        fileContent: JSON.stringify(jsonData),
        validate: false,
      });

      const result = opencodeMcp.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return success for complex MCP configuration", () => {
      const jsonData = {
        mcp: {
          filesystem: {
            type: "local",
            command: ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/workspace"],
            environment: {
              NODE_ENV: "development",
            },
            enabled: true,
          },
          git: {
            type: "local",
            command: ["node", "git-server.js"],
            environment: {},
            enabled: true,
          },
          sqlite: {
            type: "local",
            command: ["python", "sqlite-server.py", "--database", "/path/to/db.sqlite"],
            environment: {
              PYTHONPATH: "/custom/path",
              DEBUG: "true",
            },
            enabled: true,
          },
        },
        globalSettings: {
          timeout: 30000,
          retries: 3,
        },
      };
      const opencodeMcp = new OpencodeMcp({
        relativeDirPath: ".",
        relativeFilePath: "opencode.json",
        fileContent: JSON.stringify(jsonData),
        validate: false,
      });

      const result = opencodeMcp.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });

  describe("integration", () => {
    it("should handle complete workflow: fromFile -> toRulesyncMcp -> fromRulesyncMcp", async () => {
      const originalJsonData = {
        mcp: {
          "workflow-server": {
            type: "local",
            command: ["node", "workflow-server.js", "--config", "config.json"],
            environment: {
              NODE_ENV: "test",
            },
            enabled: true,
          },
        },
      };
      await writeFileContent(
        join(testDir, "opencode.json"),
        JSON.stringify(originalJsonData, null, 2),
      );

      // Step 1: Load from file
      const originalOpencodeMcp = await OpencodeMcp.fromFile({
        baseDir: testDir,
      });

      // Step 2: Convert to RulesyncMcp
      const rulesyncMcp = originalOpencodeMcp.toRulesyncMcp();

      // Step 3: Create new OpencodeMcp from RulesyncMcp
      const newOpencodeMcp = await OpencodeMcp.fromRulesyncMcp({
        baseDir: testDir,
        rulesyncMcp,
      });

      // Note: toRulesyncMcp exports OpenCode format as-is, and fromRulesyncMcp converts it
      // Since OpenCode format already has type: "local" and command as array,
      // the conversion produces the same result
      // Note: environment is only included if env was present in source
      expect(newOpencodeMcp.getJson()).toEqual({
        mcp: {
          "workflow-server": {
            type: "local",
            command: ["node", "workflow-server.js", "--config", "config.json"],
            enabled: true,
          },
        },
      });
      expect(newOpencodeMcp.getFilePath()).toBe(join(testDir, "opencode.json"));
    });

    it("should maintain data consistency across transformations", async () => {
      const complexJsonData = {
        mcp: {
          "primary-server": {
            type: "local",
            command: ["node", "primary.js", "--mode", "production"],
            environment: {
              NODE_ENV: "production",
              LOG_LEVEL: "info",
              API_KEY: "secret",
            },
            enabled: true,
          },
          "secondary-server": {
            type: "local",
            command: ["python", "secondary.py", "--workers", "4"],
            environment: {
              PYTHONPATH: "/app/lib",
            },
            enabled: true,
          },
        },
        config: {
          timeout: 60000,
          maxRetries: 5,
          logLevel: "debug",
        },
      };

      // Create OpencodeMcp
      const opencodeMcp = new OpencodeMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "opencode.json",
        fileContent: JSON.stringify(complexJsonData),
      });

      // Convert to RulesyncMcp
      const rulesyncMcp = opencodeMcp.toRulesyncMcp();

      // Verify only mcp is in exported data
      const exportedJson = JSON.parse(rulesyncMcp.getFileContent());
      expect(exportedJson.mcpServers).toBeDefined();
      expect((exportedJson as any).config).toBeUndefined();
    });

    it("should handle complete workflow in global mode", async () => {
      const originalJsonData = {
        mcp: {
          "global-workflow-server": {
            type: "local",
            command: ["node", "global-server.js"],
            environment: {},
            enabled: true,
          },
        },
      };
      await writeFileContent(
        join(testDir, "opencode.json"),
        JSON.stringify(originalJsonData, null, 2),
      );

      // Step 1: Load from global config
      const originalOpencodeMcp = await OpencodeMcp.fromFile({
        baseDir: testDir,
        global: true,
      });

      // Step 2: Convert to RulesyncMcp
      const rulesyncMcp = originalOpencodeMcp.toRulesyncMcp();

      // Step 3: Create new OpencodeMcp from RulesyncMcp in global mode
      const newOpencodeMcp = await OpencodeMcp.fromRulesyncMcp({
        baseDir: testDir,
        rulesyncMcp,
        global: true,
      });

      // Note: toRulesyncMcp exports OpenCode format as-is, and fromRulesyncMcp converts it
      // Since OpenCode format already has type: "local" and command as array,
      // the conversion produces the same result
      // Note: environment is only included if env was present in source
      expect(newOpencodeMcp.getJson()).toEqual({
        mcp: {
          "global-workflow-server": {
            type: "local",
            command: ["node", "global-server.js"],
            enabled: true,
          },
        },
      });
      expect(newOpencodeMcp.getFilePath()).toBe(join(testDir, "opencode.json"));
    });
  });

  describe("error handling", () => {
    it("should handle malformed JSON in existing file gracefully", async () => {
      await writeFileContent(join(testDir, "opencode.json"), "{ invalid json }");

      await expect(
        OpencodeMcp.fromFile({
          baseDir: testDir,
        }),
      ).rejects.toThrow();
    });

    it("should handle malformed JSON in global config gracefully", async () => {
      await writeFileContent(join(testDir, "opencode.json"), "{ invalid: json }");

      await expect(
        OpencodeMcp.fromFile({
          baseDir: testDir,
          global: true,
        }),
      ).rejects.toThrow();
    });

    it("should handle null mcp in existing file", async () => {
      const jsonData = {
        mcp: null,
      };
      await writeFileContent(join(testDir, "opencode.json"), JSON.stringify(jsonData));

      const opencodeMcp = await OpencodeMcp.fromFile({
        baseDir: testDir,
      });

      expect(opencodeMcp.getJson().mcp).toEqual({});
    });

    it("should handle undefined mcp in existing file", async () => {
      const jsonData = {
        otherProperty: "value",
      };
      await writeFileContent(join(testDir, "opencode.json"), JSON.stringify(jsonData));

      const opencodeMcp = await OpencodeMcp.fromFile({
        baseDir: testDir,
      });

      expect(opencodeMcp.getJson().mcp).toEqual({});
      expect((opencodeMcp.getJson() as any).otherProperty).toBe("value");
    });

    it("should handle empty file", async () => {
      await writeFileContent(join(testDir, "opencode.json"), "");

      await expect(
        OpencodeMcp.fromFile({
          baseDir: testDir,
        }),
      ).rejects.toThrow();
    });

    it("should handle file with only whitespace", async () => {
      await writeFileContent(join(testDir, "opencode.json"), "   \n\t  ");

      await expect(
        OpencodeMcp.fromFile({
          baseDir: testDir,
        }),
      ).rejects.toThrow();
    });
  });
});
