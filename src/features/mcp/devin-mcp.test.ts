import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_MCP_SCHEMA_URL,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { DevinMcp } from "./devin-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

describe("DevinMcp", () => {
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
    it("should return project paths by default", () => {
      const paths = DevinMcp.getSettablePaths();

      expect(paths.relativeDirPath).toBe(".windsurf");
      expect(paths.relativeFilePath).toBe("mcp_config.json");
    });

    it("should return project paths when global is false", () => {
      const paths = DevinMcp.getSettablePaths({ global: false });

      expect(paths.relativeDirPath).toBe(".windsurf");
      expect(paths.relativeFilePath).toBe("mcp_config.json");
    });

    it("should return the codeium global paths when global is true", () => {
      const paths = DevinMcp.getSettablePaths({ global: true });

      expect(paths.relativeDirPath).toBe(join(".codeium", "windsurf"));
      expect(paths.relativeFilePath).toBe("mcp_config.json");
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

      const devinMcp = new DevinMcp({
        relativeDirPath: ".windsurf",
        relativeFilePath: "mcp_config.json",
        fileContent: validJsonContent,
      });

      expect(devinMcp).toBeInstanceOf(DevinMcp);
      expect(devinMcp.getRelativeDirPath()).toBe(".windsurf");
      expect(devinMcp.getRelativeFilePath()).toBe("mcp_config.json");
      expect(devinMcp.getFileContent()).toBe(validJsonContent);
    });

    it("should create instance with custom outputRoot", () => {
      const validJsonContent = JSON.stringify({ mcpServers: {} });

      const devinMcp = new DevinMcp({
        outputRoot: "/custom/path",
        relativeDirPath: ".windsurf",
        relativeFilePath: "mcp_config.json",
        fileContent: validJsonContent,
      });

      expect(devinMcp.getFilePath()).toBe("/custom/path/.windsurf/mcp_config.json");
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

      const devinMcp = new DevinMcp({
        relativeDirPath: ".windsurf",
        relativeFilePath: "mcp_config.json",
        fileContent: validJsonContent,
      });

      expect(devinMcp.getJson()).toEqual(jsonData);
    });

    it("should handle empty JSON object", () => {
      const emptyJsonContent = JSON.stringify({});

      const devinMcp = new DevinMcp({
        relativeDirPath: ".windsurf",
        relativeFilePath: "mcp_config.json",
        fileContent: emptyJsonContent,
      });

      expect(devinMcp.getJson()).toEqual({});
    });

    it("should validate content by default", () => {
      const validJsonContent = JSON.stringify({ mcpServers: {} });

      expect(() => {
        const _instance = new DevinMcp({
          relativeDirPath: ".windsurf",
          relativeFilePath: "mcp_config.json",
          fileContent: validJsonContent,
        });
      }).not.toThrow();
    });

    it("should skip validation when validate is false", () => {
      const validJsonContent = JSON.stringify({ mcpServers: {} });

      expect(() => {
        const _instance = new DevinMcp({
          relativeDirPath: ".windsurf",
          relativeFilePath: "mcp_config.json",
          fileContent: validJsonContent,
          validate: false,
        });
      }).not.toThrow();
    });

    it("should throw error for invalid JSON content", () => {
      const invalidJsonContent = "{ invalid json }";

      expect(() => {
        const _instance = new DevinMcp({
          relativeDirPath: ".windsurf",
          relativeFilePath: "mcp_config.json",
          fileContent: invalidJsonContent,
        });
      }).toThrow();
    });
  });

  describe("fromFile", () => {
    it("should create instance from project file with default parameters", async () => {
      const devinDir = join(testDir, ".windsurf");
      await ensureDir(devinDir);

      const jsonData = {
        mcpServers: {
          filesystem: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-filesystem", devinDir],
          },
        },
      };
      await writeFileContent(join(devinDir, "mcp_config.json"), JSON.stringify(jsonData, null, 2));

      const devinMcp = await DevinMcp.fromFile({
        outputRoot: testDir,
      });

      expect(devinMcp).toBeInstanceOf(DevinMcp);
      expect(devinMcp.getJson()).toEqual(jsonData);
      expect(devinMcp.getFilePath()).toBe(join(testDir, ".windsurf", "mcp_config.json"));
    });

    it("should initialize empty mcpServers if project file does not exist", async () => {
      const devinMcp = await DevinMcp.fromFile({
        outputRoot: testDir,
      });

      expect(devinMcp).toBeInstanceOf(DevinMcp);
      expect(devinMcp.getJson()).toEqual({ mcpServers: {} });
      expect(devinMcp.getFilePath()).toBe(join(testDir, ".windsurf", "mcp_config.json"));
    });

    it("should create instance from custom outputRoot", async () => {
      const customDir = join(testDir, "custom");
      const devinDir = join(customDir, ".windsurf");
      await ensureDir(devinDir);

      const jsonData = {
        mcpServers: {
          git: {
            command: "node",
            args: ["git-server.js"],
          },
        },
      };
      await writeFileContent(join(devinDir, "mcp_config.json"), JSON.stringify(jsonData));

      const devinMcp = await DevinMcp.fromFile({
        outputRoot: customDir,
      });

      expect(devinMcp.getFilePath()).toBe(join(customDir, ".windsurf", "mcp_config.json"));
      expect(devinMcp.getJson()).toEqual(jsonData);
    });

    it("should skip validation when validate is false", async () => {
      const devinDir = join(testDir, ".windsurf");
      await ensureDir(devinDir);
      await writeFileContent(join(devinDir, "mcp_config.json"), JSON.stringify({ mcpServers: {} }));

      const devinMcp = await DevinMcp.fromFile({
        outputRoot: testDir,
        validate: false,
      });

      expect(devinMcp.getJson()).toEqual({ mcpServers: {} });
    });

    it("should create instance from global file at the codeium path", async () => {
      const globalDir = join(testDir, ".codeium", "windsurf");
      await ensureDir(globalDir);

      const jsonData = {
        mcpServers: {
          filesystem: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-filesystem", globalDir],
          },
        },
      };
      await writeFileContent(join(globalDir, "mcp_config.json"), JSON.stringify(jsonData, null, 2));

      const devinMcp = await DevinMcp.fromFile({
        outputRoot: testDir,
        global: true,
      });

      expect(devinMcp).toBeInstanceOf(DevinMcp);
      expect(devinMcp.getJson()).toEqual(jsonData);
      expect(devinMcp.getFilePath()).toBe(join(testDir, ".codeium", "windsurf", "mcp_config.json"));
      expect(devinMcp.getRelativeDirPath()).toBe(join(".codeium", "windsurf"));
    });

    it("should initialize empty global config if it does not exist", async () => {
      const devinMcp = await DevinMcp.fromFile({
        outputRoot: testDir,
        global: true,
      });

      expect(devinMcp.getJson()).toEqual({ mcpServers: {} });
      expect(devinMcp.getFilePath()).toBe(join(testDir, ".codeium", "windsurf", "mcp_config.json"));
    });

    it("should preserve non-mcpServers properties in global mode", async () => {
      const globalDir = join(testDir, ".codeium", "windsurf");
      await ensureDir(globalDir);
      const existing = {
        mcpServers: {
          "old-server": {
            command: "node",
            args: ["old-server.js"],
          },
        },
        otherSetting: { value: 42 },
      };
      await writeFileContent(join(globalDir, "mcp_config.json"), JSON.stringify(existing, null, 2));

      const devinMcp = await DevinMcp.fromFile({
        outputRoot: testDir,
        global: true,
      });

      const json = devinMcp.getJson();
      expect(json.mcpServers).toEqual({
        "old-server": {
          command: "node",
          args: ["old-server.js"],
        },
      });
      expect((json as any).otherSetting).toEqual({ value: 42 });
    });

    it("should throw error for malformed JSON in existing file", async () => {
      const devinDir = join(testDir, ".windsurf");
      await ensureDir(devinDir);
      await writeFileContent(join(devinDir, "mcp_config.json"), "{ invalid json }");

      await expect(
        DevinMcp.fromFile({
          outputRoot: testDir,
        }),
      ).rejects.toThrow();
    });
  });

  describe("fromRulesyncMcp", () => {
    it("should write mcpServers from RulesyncMcp with default parameters", async () => {
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

      const devinMcp = await DevinMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
      });

      expect(devinMcp).toBeInstanceOf(DevinMcp);
      expect(devinMcp.getJson()).toEqual(jsonData);
      expect(devinMcp.getRelativeDirPath()).toBe(".windsurf");
      expect(devinMcp.getRelativeFilePath()).toBe("mcp_config.json");
    });

    it("should strip codex-only envVars from devin output", async () => {
      const jsonData = {
        mcpServers: {
          pal: {
            type: "stdio",
            command: "uvx",
            args: ["pal-mcp-server"],
            envVars: ["OPENAI_API_KEY"],
          },
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const devinMcp = await DevinMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
      });

      const json = devinMcp.getJson() as any;
      expect(json.mcpServers.pal).toBeDefined();
      expect(json.mcpServers.pal.envVars).toBeUndefined();
      expect(json.mcpServers.pal.command).toBe("uvx");
      expect(json.mcpServers.pal.args).toEqual(["pal-mcp-server"]);
    });

    it("should write mcpServers from RulesyncMcp in global mode at the codeium path", async () => {
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

      const devinMcp = await DevinMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });

      expect(devinMcp.getJson()).toEqual(jsonData);
      expect(devinMcp.getRelativeDirPath()).toBe(join(".codeium", "windsurf"));
      expect(devinMcp.getFilePath()).toBe(join(testDir, ".codeium", "windsurf", "mcp_config.json"));
    });

    it("should preserve existing non-mcpServers properties when updating", async () => {
      const devinDir = join(testDir, ".windsurf");
      await ensureDir(devinDir);
      const existing = {
        mcpServers: {
          "old-server": { command: "node", args: ["old.js"] },
        },
        someOtherKey: "keep-me",
      };
      await writeFileContent(join(devinDir, "mcp_config.json"), JSON.stringify(existing, null, 2));

      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            "new-server": { command: "python", args: ["new.py"] },
          },
        }),
      });

      const devinMcp = await DevinMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
      });

      const json = devinMcp.getJson();
      expect(json.mcpServers).toEqual({
        "new-server": { command: "python", args: ["new.py"] },
      });
      expect((json as any).someOtherKey).toBe("keep-me");
    });

    it("should handle empty mcpServers object", async () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({ mcpServers: {} }),
      });

      const devinMcp = await DevinMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
      });

      expect(devinMcp.getJson()).toEqual({ mcpServers: {} });
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
      const devinMcp = new DevinMcp({
        relativeDirPath: ".windsurf",
        relativeFilePath: "mcp_config.json",
        fileContent: JSON.stringify(jsonData),
      });

      const rulesyncMcp = devinMcp.toRulesyncMcp();

      expect(rulesyncMcp).toBeInstanceOf(RulesyncMcp);
      expect(rulesyncMcp.getFileContent()).toBe(
        JSON.stringify(
          {
            $schema: RULESYNC_MCP_SCHEMA_URL,
            ...jsonData,
          },
          null,
          2,
        ),
      );
      expect(rulesyncMcp.getRelativeDirPath()).toBe(RULESYNC_RELATIVE_DIR_PATH);
      expect(rulesyncMcp.getRelativeFilePath()).toBe("mcp.json");
    });

    it("should extract only mcpServers, dropping tool-specific top-level keys", () => {
      const jsonData = {
        mcpServers: {
          "test-server": {
            command: "node",
            args: ["server.js"],
          },
        },
        userSettings: { theme: "light" },
        version: "2.0.0",
      };
      const devinMcp = new DevinMcp({
        relativeDirPath: ".windsurf",
        relativeFilePath: "mcp_config.json",
        fileContent: JSON.stringify(jsonData),
      });

      const rulesyncMcp = devinMcp.toRulesyncMcp();

      const exportedJson = JSON.parse(rulesyncMcp.getFileContent());
      expect(exportedJson).toEqual({
        $schema: RULESYNC_MCP_SCHEMA_URL,
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

    it("should handle empty mcpServers object when converting", () => {
      const devinMcp = new DevinMcp({
        relativeDirPath: ".windsurf",
        relativeFilePath: "mcp_config.json",
        fileContent: JSON.stringify({ mcpServers: {} }),
      });

      const rulesyncMcp = devinMcp.toRulesyncMcp();

      expect(JSON.parse(rulesyncMcp.getFileContent())).toEqual({
        $schema: RULESYNC_MCP_SCHEMA_URL,
        mcpServers: {},
      });
    });
  });

  describe("validate", () => {
    it("should always return success", () => {
      const devinMcp = new DevinMcp({
        relativeDirPath: ".windsurf",
        relativeFilePath: "mcp_config.json",
        fileContent: JSON.stringify({ mcpServers: {} }),
        validate: false,
      });

      const result = devinMcp.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });

  describe("forDeletion", () => {
    it("should create minimal instance for deletion (project)", () => {
      const devinMcp = DevinMcp.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".windsurf",
        relativeFilePath: "mcp_config.json",
      });

      expect(devinMcp).toBeInstanceOf(DevinMcp);
      expect(devinMcp.getJson()).toEqual({});
      expect(devinMcp.getFilePath()).toBe(join(testDir, ".windsurf", "mcp_config.json"));
      expect(devinMcp.isDeletable()).toBe(true);
    });

    it("should create minimal instance for deletion at the global codeium path", () => {
      const devinMcp = DevinMcp.forDeletion({
        outputRoot: testDir,
        relativeDirPath: join(".codeium", "windsurf"),
        relativeFilePath: "mcp_config.json",
        global: true,
      });

      expect(devinMcp.getJson()).toEqual({});
      expect(devinMcp.getFilePath()).toBe(join(testDir, ".codeium", "windsurf", "mcp_config.json"));
      expect(devinMcp.getRelativeDirPath()).toBe(join(".codeium", "windsurf"));
    });
  });

  describe("integration", () => {
    it("should handle complete workflow: fromFile -> toRulesyncMcp -> fromRulesyncMcp", async () => {
      const devinDir = join(testDir, ".windsurf");
      await ensureDir(devinDir);

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
      await writeFileContent(
        join(devinDir, "mcp_config.json"),
        JSON.stringify(originalJsonData, null, 2),
      );

      const originalDevinMcp = await DevinMcp.fromFile({
        outputRoot: testDir,
      });
      const rulesyncMcp = originalDevinMcp.toRulesyncMcp();
      const newDevinMcp = await DevinMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
      });

      expect(newDevinMcp.getJson()).toEqual(originalJsonData);
      expect(newDevinMcp.getFilePath()).toBe(join(testDir, ".windsurf", "mcp_config.json"));
    });
  });
});
