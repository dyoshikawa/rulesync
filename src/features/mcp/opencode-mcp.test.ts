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

      expect(paths.relativeDirPath).toBe(join(".config", "opencode"));
      expect(paths.relativeFilePath).toBe("opencode.json");
    });
  });

  describe("isDeletable", () => {
    it("should always return false because opencode.json may contain other settings", () => {
      const opencodeMcp = new OpencodeMcp({
        relativeDirPath: ".",
        relativeFilePath: "opencode.json",
        fileContent: JSON.stringify({ mcp: {} }),
      });

      expect(opencodeMcp.isDeletable()).toBe(false);
    });

    it("should return false when created via forDeletion with global: true", () => {
      const opencodeMcp = OpencodeMcp.forDeletion({
        relativeDirPath: join(".config", "opencode"),
        relativeFilePath: "opencode.json",
        global: true,
      });

      expect(opencodeMcp.isDeletable()).toBe(false);
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
      expect(opencodeMcp.getFilePath()).toBe(join(testDir, "opencode.jsonc"));
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
      const globalPath = join(testDir, ".config", "opencode", "opencode.json");

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
      await writeFileContent(globalPath, JSON.stringify(jsonData, null, 2));

      const opencodeMcp = await OpencodeMcp.fromFile({
        baseDir: testDir,
        global: true,
      });

      expect(opencodeMcp).toBeInstanceOf(OpencodeMcp);
      expect(opencodeMcp.getJson()).toEqual(jsonData);
      expect(opencodeMcp.getFilePath()).toBe(globalPath);
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
      expect(opencodeMcp.getFilePath()).toBe(
        join(testDir, ".config", "opencode", "opencode.jsonc"),
      );
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
        join(testDir, ".config", "opencode", "opencode.json"),
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
      expect(opencodeMcp.getRelativeFilePath()).toBe("opencode.jsonc");
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

      expect(opencodeMcp.getFilePath()).toBe(join(customDir, "opencode.jsonc"));
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
      expect(opencodeMcp.getRelativeDirPath()).toBe(join(".config", "opencode"));
      expect(opencodeMcp.getRelativeFilePath()).toBe("opencode.jsonc");
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

      expect(opencodeMcp.getFilePath()).toBe(join(testDir, "opencode.jsonc"));
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
      expect(opencodeMcp.getRelativeFilePath()).toBe("opencode.jsonc");
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
        join(testDir, ".config", "opencode", "opencode.json"),
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
        join(testDir, ".config", "opencode", "opencode.json"),
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

    it("should convert enabledTools to top-level tools map with server prefix", async () => {
      const jsonData = {
        mcpServers: {
          "my-server": {
            command: "node",
            args: ["server.js"],
            enabledTools: ["search", "list"],
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

      expect(opencodeMcp.getJson()).toEqual({
        mcp: {
          "my-server": {
            type: "local",
            command: ["node", "server.js"],
            enabled: true,
          },
        },
        tools: {
          "my-server_search": true,
          "my-server_list": true,
        },
      });
    });

    it("should convert disabledTools to top-level tools map with server prefix", async () => {
      const jsonData = {
        mcpServers: {
          "my-server": {
            command: "node",
            args: ["server.js"],
            disabledTools: ["search", "list"],
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

      expect(opencodeMcp.getJson()).toEqual({
        mcp: {
          "my-server": {
            type: "local",
            command: ["node", "server.js"],
            enabled: true,
          },
        },
        tools: {
          "my-server_search": false,
          "my-server_list": false,
        },
      });
    });

    it("should convert both enabledTools and disabledTools to top-level tools map", async () => {
      const jsonData = {
        mcpServers: {
          "my-server": {
            command: "node",
            args: ["server.js"],
            enabledTools: ["search"],
            disabledTools: ["list"],
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

      expect(opencodeMcp.getJson()).toEqual({
        mcp: {
          "my-server": {
            type: "local",
            command: ["node", "server.js"],
            enabled: true,
          },
        },
        tools: {
          "my-server_search": true,
          "my-server_list": false,
        },
      });
    });

    it("should convert enabledTools/disabledTools for multiple servers", async () => {
      const jsonData = {
        mcpServers: {
          "server-a": {
            command: "node",
            args: ["a.js"],
            disabledTools: ["search"],
          },
          "server-b": {
            command: "node",
            args: ["b.js"],
            enabledTools: ["list"],
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

      expect(opencodeMcp.getJson()).toEqual({
        mcp: {
          "server-a": {
            type: "local",
            command: ["node", "a.js"],
            enabled: true,
          },
          "server-b": {
            type: "local",
            command: ["node", "b.js"],
            enabled: true,
          },
        },
        tools: {
          "server-a_search": false,
          "server-b_list": true,
        },
      });
    });

    it("should convert enabledTools/disabledTools for remote servers", async () => {
      const jsonData = {
        mcpServers: {
          "remote-server": {
            type: "sse",
            url: "https://example.com/mcp",
            enabledTools: ["fetch"],
            disabledTools: ["search"],
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

      expect(opencodeMcp.getJson()).toEqual({
        mcp: {
          "remote-server": {
            type: "remote",
            url: "https://example.com/mcp",
            enabled: true,
          },
        },
        tools: {
          "remote-server_fetch": true,
          "remote-server_search": false,
        },
      });
    });

    it("should not include tools key when no enabledTools/disabledTools are specified", async () => {
      const jsonData = {
        mcpServers: {
          "test-server": {
            command: "node",
            args: ["server.js"],
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

      expect(opencodeMcp.getJson()).toEqual({
        mcp: {
          "test-server": {
            type: "local",
            command: ["node", "server.js"],
            enabled: true,
          },
        },
      });
      expect(opencodeMcp.getJson().tools).toBeUndefined();
    });

    it("should fully override tools and not preserve existing tools from file", async () => {
      const existingConfig = {
        mcp: {
          "old-server": {
            type: "local",
            command: ["node", "old.js"],
            enabled: true,
          },
        },
        tools: {
          "old-server_search": false,
          unrelated_tool: true,
        },
      };
      await writeFileContent(
        join(testDir, "opencode.json"),
        JSON.stringify(existingConfig, null, 2),
      );

      const jsonData = {
        mcpServers: {
          "new-server": {
            command: "node",
            args: ["new.js"],
            disabledTools: ["list"],
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

      // Should fully override: only new server tools, no preserved unrelated tools
      expect(opencodeMcp.getJson().tools).toEqual({
        "new-server_list": false,
      });
    });

    it("should remove stale tools key when new config has no enabledTools/disabledTools", async () => {
      const existingConfig = {
        mcp: {
          "old-server": {
            type: "local",
            command: ["node", "old.js"],
            enabled: true,
          },
        },
        tools: {
          "old-server_search": false,
          unrelated_tool: true,
        },
      };
      await writeFileContent(
        join(testDir, "opencode.json"),
        JSON.stringify(existingConfig, null, 2),
      );

      const jsonData = {
        mcpServers: {
          "new-server": {
            command: "node",
            args: ["new.js"],
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

      // tools key should be removed entirely when no enabledTools/disabledTools
      expect(opencodeMcp.getJson().tools).toBeUndefined();
    });

    it("should read existing opencode.jsonc file and preserve it", async () => {
      const jsoncContent = `{
  // Existing server configuration
  "mcp": {
    "existingServer": {
      "type": "local",
      "command": ["node", "existing.js"],
      "enabled": true
    }
  }
}`;
      await writeFileContent(join(testDir, "opencode.jsonc"), jsoncContent);

      const jsonData = {
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
        fileContent: JSON.stringify(jsonData),
      });

      const opencodeMcp = await OpencodeMcp.fromRulesyncMcp({
        baseDir: testDir,
        rulesyncMcp,
      });

      // Should have both the new server from rulesyncMcp and preserve other properties
      const newServer = opencodeMcp.getJson().mcp?.["new-server"];
      expect(newServer).toBeDefined();
      if (newServer?.type === "local") {
        expect(newServer.type).toBe("local");
      }
      // Note: existing server is replaced because we're updating mcp section
      // This is expected behavior as we're regenerating the mcp config
    });

    it("should prefer opencode.jsonc over opencode.json when generating from RulesyncMcp", async () => {
      const jsonContent = {
        mcp: {
          "json-server": {
            type: "local",
            command: ["node", "json.js"],
            enabled: true,
          },
        },
      };
      const jsoncContent = `{
  "mcp": {
    "jsonc-server": {
      "type": "local",
      "command": ["node", "jsonc.js"],
      "enabled": true
    }
  }
}`;
      await writeFileContent(join(testDir, "opencode.json"), JSON.stringify(jsonContent));
      await writeFileContent(join(testDir, "opencode.jsonc"), jsoncContent);

      const rulesyncMcpData = {
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
        fileContent: JSON.stringify(rulesyncMcpData),
      });

      const opencodeMcp = await OpencodeMcp.fromRulesyncMcp({
        baseDir: testDir,
        rulesyncMcp,
      });

      // Should use content from jsonc file
      expect(opencodeMcp.getRelativeFilePath()).toContain("jsonc");
    });

    it("should create opencode.jsonc as preferred format when no existing files", async () => {
      const rulesyncMcpData = {
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
        fileContent: JSON.stringify(rulesyncMcpData),
      });

      const opencodeMcp = await OpencodeMcp.fromRulesyncMcp({
        baseDir: testDir,
        rulesyncMcp,
      });

      // When creating new, should prefer jsonc
      expect(opencodeMcp.getRelativeFilePath()).toBe("opencode.jsonc");
    });
  });

  describe("toRulesyncMcp", () => {
    it("should convert to RulesyncMcp with standard format (local -> stdio)", () => {
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
      // Should convert to standard format: type: "stdio", command: string, args: string[]
      expect(JSON.parse(rulesyncMcp.getFileContent())).toEqual({
        mcpServers: {
          filesystem: {
            type: "stdio",
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
            env: {},
          },
        },
      });
      expect(rulesyncMcp.getRelativeDirPath()).toBe(RULESYNC_RELATIVE_DIR_PATH);
      expect(rulesyncMcp.getRelativeFilePath()).toBe(".mcp.json");
    });

    it("should convert environment to env and preserve baseDir", () => {
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
      expect(JSON.parse(rulesyncMcp.getFileContent())).toEqual({
        mcpServers: {
          "complex-server": {
            type: "stdio",
            command: "node",
            args: ["complex-server.js", "--port", "3000"],
            env: {
              NODE_ENV: "production",
              DEBUG: "mcp:*",
            },
          },
        },
      });
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
            type: "stdio",
            command: "node",
            args: ["server.js"],
            env: {},
          },
        },
      });
      expect((exportedJson as any).userSettings).toBeUndefined();
      expect((exportedJson as any).version).toBeUndefined();
    });

    it("should convert remote type to sse", () => {
      const jsonData = {
        mcp: {
          "remote-server": {
            type: "remote",
            url: "https://example.com/mcp",
            headers: {
              Authorization: "Bearer token",
            },
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

      expect(JSON.parse(rulesyncMcp.getFileContent())).toEqual({
        mcpServers: {
          "remote-server": {
            type: "sse",
            url: "https://example.com/mcp",
            headers: {
              Authorization: "Bearer token",
            },
          },
        },
      });
    });

    it("should convert disabled servers (enabled: false -> disabled: true)", () => {
      const jsonData = {
        mcp: {
          "disabled-server": {
            type: "local",
            command: ["node", "server.js"],
            enabled: false,
          },
        },
      };
      const opencodeMcp = new OpencodeMcp({
        relativeDirPath: ".",
        relativeFilePath: "opencode.json",
        fileContent: JSON.stringify(jsonData),
      });

      const rulesyncMcp = opencodeMcp.toRulesyncMcp();

      expect(JSON.parse(rulesyncMcp.getFileContent())).toEqual({
        mcpServers: {
          "disabled-server": {
            type: "stdio",
            command: "node",
            args: ["server.js"],
            disabled: true,
          },
        },
      });
    });

    it("should preserve cwd when converting", () => {
      const jsonData = {
        mcp: {
          "cwd-server": {
            type: "local",
            command: ["node", "server.js"],
            cwd: "/custom/path",
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

      expect(JSON.parse(rulesyncMcp.getFileContent())).toEqual({
        mcpServers: {
          "cwd-server": {
            type: "stdio",
            command: "node",
            args: ["server.js"],
            cwd: "/custom/path",
          },
        },
      });
    });

    it("should throw error when command array is empty", () => {
      const jsonData = {
        mcp: {
          "empty-command-server": {
            type: "local",
            command: [],
            enabled: true,
          },
        },
      };
      const opencodeMcp = new OpencodeMcp({
        relativeDirPath: ".",
        relativeFilePath: "opencode.json",
        fileContent: JSON.stringify(jsonData),
        validate: false,
      });

      expect(() => opencodeMcp.toRulesyncMcp()).toThrow(
        'Server "empty-command-server" has an empty command array',
      );
    });

    it("should convert tools map to enabledTools per server (strip prefix)", () => {
      const jsonData = {
        mcp: {
          "my-server": {
            type: "local",
            command: ["node", "server.js"],
            enabled: true,
          },
        },
        tools: {
          "my-server_search": true,
          "my-server_list": true,
        },
      };
      const opencodeMcp = new OpencodeMcp({
        relativeDirPath: ".",
        relativeFilePath: "opencode.json",
        fileContent: JSON.stringify(jsonData),
      });

      const rulesyncMcp = opencodeMcp.toRulesyncMcp();

      expect(JSON.parse(rulesyncMcp.getFileContent())).toEqual({
        mcpServers: {
          "my-server": {
            type: "stdio",
            command: "node",
            args: ["server.js"],
            enabledTools: ["search", "list"],
          },
        },
      });
    });

    it("should convert tools map to disabledTools per server (strip prefix)", () => {
      const jsonData = {
        mcp: {
          "my-server": {
            type: "local",
            command: ["node", "server.js"],
            enabled: true,
          },
        },
        tools: {
          "my-server_search": false,
          "my-server_list": false,
        },
      };
      const opencodeMcp = new OpencodeMcp({
        relativeDirPath: ".",
        relativeFilePath: "opencode.json",
        fileContent: JSON.stringify(jsonData),
      });

      const rulesyncMcp = opencodeMcp.toRulesyncMcp();

      expect(JSON.parse(rulesyncMcp.getFileContent())).toEqual({
        mcpServers: {
          "my-server": {
            type: "stdio",
            command: "node",
            args: ["server.js"],
            disabledTools: ["search", "list"],
          },
        },
      });
    });

    it("should convert tools map to both enabledTools and disabledTools per server", () => {
      const jsonData = {
        mcp: {
          "my-server": {
            type: "local",
            command: ["node", "server.js"],
            enabled: true,
          },
        },
        tools: {
          "my-server_search": true,
          "my-server_list": false,
          "my-server_read": true,
        },
      };
      const opencodeMcp = new OpencodeMcp({
        relativeDirPath: ".",
        relativeFilePath: "opencode.json",
        fileContent: JSON.stringify(jsonData),
      });

      const rulesyncMcp = opencodeMcp.toRulesyncMcp();

      expect(JSON.parse(rulesyncMcp.getFileContent())).toEqual({
        mcpServers: {
          "my-server": {
            type: "stdio",
            command: "node",
            args: ["server.js"],
            enabledTools: ["search", "read"],
            disabledTools: ["list"],
          },
        },
      });
    });

    it("should only assign tools to the correct server by prefix", () => {
      const jsonData = {
        mcp: {
          "server-a": {
            type: "local",
            command: ["node", "a.js"],
            enabled: true,
          },
          "server-b": {
            type: "local",
            command: ["node", "b.js"],
            enabled: true,
          },
        },
        tools: {
          "server-a_search": false,
          "server-b_list": true,
          unrelated_tool: false,
        },
      };
      const opencodeMcp = new OpencodeMcp({
        relativeDirPath: ".",
        relativeFilePath: "opencode.json",
        fileContent: JSON.stringify(jsonData),
      });

      const rulesyncMcp = opencodeMcp.toRulesyncMcp();

      expect(JSON.parse(rulesyncMcp.getFileContent())).toEqual({
        mcpServers: {
          "server-a": {
            type: "stdio",
            command: "node",
            args: ["a.js"],
            disabledTools: ["search"],
          },
          "server-b": {
            type: "stdio",
            command: "node",
            args: ["b.js"],
            enabledTools: ["list"],
          },
        },
      });
    });

    it("should handle tools on remote servers", () => {
      const jsonData = {
        mcp: {
          "remote-server": {
            type: "remote",
            url: "https://example.com/mcp",
            enabled: true,
          },
        },
        tools: {
          "remote-server_search": false,
          "remote-server_fetch": true,
        },
      };
      const opencodeMcp = new OpencodeMcp({
        relativeDirPath: ".",
        relativeFilePath: "opencode.json",
        fileContent: JSON.stringify(jsonData),
      });

      const rulesyncMcp = opencodeMcp.toRulesyncMcp();

      expect(JSON.parse(rulesyncMcp.getFileContent())).toEqual({
        mcpServers: {
          "remote-server": {
            type: "sse",
            url: "https://example.com/mcp",
            enabledTools: ["fetch"],
            disabledTools: ["search"],
          },
        },
      });
    });

    it("should not include enabledTools/disabledTools when tools map is empty", () => {
      const jsonData = {
        mcp: {
          "my-server": {
            type: "local",
            command: ["node", "server.js"],
            enabled: true,
          },
        },
        tools: {},
      };
      const opencodeMcp = new OpencodeMcp({
        relativeDirPath: ".",
        relativeFilePath: "opencode.json",
        fileContent: JSON.stringify(jsonData),
      });

      const rulesyncMcp = opencodeMcp.toRulesyncMcp();

      expect(JSON.parse(rulesyncMcp.getFileContent())).toEqual({
        mcpServers: {
          "my-server": {
            type: "stdio",
            command: "node",
            args: ["server.js"],
          },
        },
      });
    });

    it("should not include enabledTools/disabledTools when no tools key exists", () => {
      const jsonData = {
        mcp: {
          "my-server": {
            type: "local",
            command: ["node", "server.js"],
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

      expect(JSON.parse(rulesyncMcp.getFileContent())).toEqual({
        mcpServers: {
          "my-server": {
            type: "stdio",
            command: "node",
            args: ["server.js"],
          },
        },
      });
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

    it("should return success for configuration with tools map", () => {
      const jsonData = {
        mcp: {
          "my-server": {
            type: "local",
            command: ["node", "server.js"],
            enabled: true,
          },
        },
        tools: {
          "my-server_search": true,
          "my-server_list": false,
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

      // Step 2: Convert to RulesyncMcp (now converts to standard format)
      const rulesyncMcp = originalOpencodeMcp.toRulesyncMcp();

      // Verify RulesyncMcp has standard format
      const rulesyncJson = JSON.parse(rulesyncMcp.getFileContent());
      expect(rulesyncJson.mcpServers["workflow-server"]).toEqual({
        type: "stdio",
        command: "node",
        args: ["workflow-server.js", "--config", "config.json"],
        env: {
          NODE_ENV: "test",
        },
      });

      // Step 3: Create new OpencodeMcp from RulesyncMcp
      const newOpencodeMcp = await OpencodeMcp.fromRulesyncMcp({
        baseDir: testDir,
        rulesyncMcp,
      });

      // After round-trip, should be back to OpenCode format
      expect(newOpencodeMcp.getJson()).toEqual({
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
        join(testDir, ".config", "opencode", "opencode.json"),
        JSON.stringify(originalJsonData, null, 2),
      );

      // Step 1: Load from global config
      const originalOpencodeMcp = await OpencodeMcp.fromFile({
        baseDir: testDir,
        global: true,
      });

      // Step 2: Convert to RulesyncMcp (now converts to standard format)
      const rulesyncMcp = originalOpencodeMcp.toRulesyncMcp();

      // Verify RulesyncMcp has standard format
      const rulesyncJson = JSON.parse(rulesyncMcp.getFileContent());
      expect(rulesyncJson.mcpServers["global-workflow-server"]).toEqual({
        type: "stdio",
        command: "node",
        args: ["global-server.js"],
        env: {},
      });

      // Step 3: Create new OpencodeMcp from RulesyncMcp in global mode
      const newOpencodeMcp = await OpencodeMcp.fromRulesyncMcp({
        baseDir: testDir,
        rulesyncMcp,
        global: true,
      });

      // After round-trip, should be back to OpenCode format
      expect(newOpencodeMcp.getJson()).toEqual({
        mcp: {
          "global-workflow-server": {
            type: "local",
            command: ["node", "global-server.js"],
            environment: {},
            enabled: true,
          },
        },
      });
      expect(newOpencodeMcp.getFilePath()).toBe(
        join(testDir, ".config", "opencode", "opencode.json"),
      );
    });

    it("should round-trip enabledTools/disabledTools through OpenCode format", async () => {
      // Start with OpenCode format: mcp + tools map
      const originalJsonData = {
        mcp: {
          "my-server": {
            type: "local",
            command: ["node", "server.js"],
            enabled: true,
          },
        },
        tools: {
          "my-server_search": true,
          "my-server_list": false,
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

      // Verify RulesyncMcp has enabledTools/disabledTools
      const rulesyncJson = JSON.parse(rulesyncMcp.getFileContent());
      expect(rulesyncJson.mcpServers["my-server"]).toEqual({
        type: "stdio",
        command: "node",
        args: ["server.js"],
        enabledTools: ["search"],
        disabledTools: ["list"],
      });

      // Step 3: Convert back to OpenCode format
      const newOpencodeMcp = await OpencodeMcp.fromRulesyncMcp({
        baseDir: testDir,
        rulesyncMcp,
      });

      // After round-trip, should be back to OpenCode format with tools map
      expect(newOpencodeMcp.getJson()).toEqual({
        mcp: {
          "my-server": {
            type: "local",
            command: ["node", "server.js"],
            enabled: true,
          },
        },
        tools: {
          "my-server_search": true,
          "my-server_list": false,
        },
      });
    });

    it("should round-trip enabledTools/disabledTools from rulesync format", async () => {
      // Start with rulesync format
      const rulesyncData = {
        mcpServers: {
          "server-a": {
            command: "node",
            args: ["a.js"],
            enabledTools: ["search", "read"],
            disabledTools: ["write"],
          },
          "server-b": {
            type: "sse",
            url: "https://example.com/mcp",
            disabledTools: ["delete"],
          },
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(rulesyncData),
      });

      // Step 1: Convert to OpenCode
      const opencodeMcp = await OpencodeMcp.fromRulesyncMcp({
        baseDir: testDir,
        rulesyncMcp,
      });

      // Verify OpenCode format has tools map
      expect(opencodeMcp.getJson().tools).toEqual({
        "server-a_search": true,
        "server-a_read": true,
        "server-a_write": false,
        "server-b_delete": false,
      });

      // Step 2: Convert back to rulesync
      const backToRulesync = opencodeMcp.toRulesyncMcp();
      const backJson = JSON.parse(backToRulesync.getFileContent());

      expect(backJson.mcpServers["server-a"].enabledTools).toEqual(["search", "read"]);
      expect(backJson.mcpServers["server-a"].disabledTools).toEqual(["write"]);
      expect(backJson.mcpServers["server-b"].disabledTools).toEqual(["delete"]);
    });
  });

  describe("error handling", () => {
    it("should handle missing files by returning default empty mcp", async () => {
      // When both jsonc and json are missing, should return default mcp
      const opencodeMcp = await OpencodeMcp.fromFile({
        baseDir: testDir,
      });

      expect(opencodeMcp.getJson().mcp).toEqual({});
    });

    it("should handle missing files in global mode by returning default empty mcp", async () => {
      // When global files don't exist, should return default mcp
      const opencodeMcp = await OpencodeMcp.fromFile({
        baseDir: testDir,
        global: true,
      });

      expect(opencodeMcp.getJson().mcp).toEqual({});
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

    it("should read opencode.jsonc file with comments", async () => {
      const jsoncContent = `{
  // This is a comment
  "mcp": {
    "exampleServer": {
      "type": "local",
      "command": ["npx", "example"],
      "enabled": true
    }
  }
}`;
      await writeFileContent(join(testDir, "opencode.jsonc"), jsoncContent);

      const opencodeMcp = await OpencodeMcp.fromFile({
        baseDir: testDir,
      });

      const exampleServer = opencodeMcp.getJson().mcp?.exampleServer;
      expect(exampleServer).toBeDefined();
      if (exampleServer?.type === "local") {
        expect(exampleServer.type).toBe("local");
        expect((exampleServer as any).command).toEqual(["npx", "example"]);
      }
    });

    it("should prefer opencode.jsonc over opencode.json when both exist", async () => {
      const jsonContent = {
        mcp: {
          fromJson: {
            type: "local",
            command: ["json"],
            enabled: true,
          },
        },
      };
      const jsoncContent = `{
  "mcp": {
    "fromJsonc": {
      "type": "local",
      "command": ["jsonc"],
      "enabled": true
    }
  }
}`;
      await writeFileContent(join(testDir, "opencode.json"), JSON.stringify(jsonContent));
      await writeFileContent(join(testDir, "opencode.jsonc"), jsoncContent);

      const opencodeMcp = await OpencodeMcp.fromFile({
        baseDir: testDir,
      });

      expect(opencodeMcp.getJson().mcp?.fromJsonc).toBeDefined();
      expect(opencodeMcp.getJson().mcp?.fromJson).toBeUndefined();
    });

    it("should fall back to opencode.json when opencode.jsonc does not exist", async () => {
      const jsonContent = {
        mcp: {
          fromJson: {
            type: "local",
            command: ["json"],
            enabled: true,
          },
        },
      };
      await writeFileContent(join(testDir, "opencode.json"), JSON.stringify(jsonContent));

      const opencodeMcp = await OpencodeMcp.fromFile({
        baseDir: testDir,
      });

      expect(opencodeMcp.getJson().mcp?.fromJson).toBeDefined();
    });

    it("should read opencode.jsonc in global mode", async () => {
      const jsoncContent = `{
  "mcp": {
    "globalServer": {
      "type": "local",
      "command": ["npx", "global"],
      "enabled": true
    }
  }
}`;
      await writeFileContent(join(testDir, ".config", "opencode", "opencode.jsonc"), jsoncContent);

      const opencodeMcp = await OpencodeMcp.fromFile({
        baseDir: testDir,
        global: true,
      });

      expect(opencodeMcp.getJson().mcp?.globalServer).toBeDefined();
    });

    it("should prefer opencode.jsonc over opencode.json in global mode", async () => {
      const jsonContent = {
        mcp: {
          fromJson: {
            type: "local",
            command: ["json"],
            enabled: true,
          },
        },
      };
      const jsoncContent = `{
  "mcp": {
    "fromJsonc": {
      "type": "local",
      "command": ["jsonc"],
      "enabled": true
    }
  }
}`;
      await writeFileContent(
        join(testDir, ".config", "opencode", "opencode.json"),
        JSON.stringify(jsonContent),
      );
      await writeFileContent(join(testDir, ".config", "opencode", "opencode.jsonc"), jsoncContent);

      const opencodeMcp = await OpencodeMcp.fromFile({
        baseDir: testDir,
        global: true,
      });

      expect(opencodeMcp.getJson().mcp?.fromJsonc).toBeDefined();
      expect(opencodeMcp.getJson().mcp?.fromJson).toBeUndefined();
    });
  });
});
