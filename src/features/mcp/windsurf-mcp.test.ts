import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_MCP_SCHEMA_URL,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import { WindsurfMcp } from "./windsurf-mcp.js";

describe("WindsurfMcp", () => {
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
      const paths = WindsurfMcp.getSettablePaths();

      expect(paths.relativeDirPath).toBe(".windsurf");
      expect(paths.relativeFilePath).toBe("mcp_config.json");
    });

    it("should return project paths when global is false", () => {
      const paths = WindsurfMcp.getSettablePaths({ global: false });

      expect(paths.relativeDirPath).toBe(".windsurf");
      expect(paths.relativeFilePath).toBe("mcp_config.json");
    });

    it("should return the codeium global paths when global is true", () => {
      const paths = WindsurfMcp.getSettablePaths({ global: true });

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

      const windsurfMcp = new WindsurfMcp({
        relativeDirPath: ".windsurf",
        relativeFilePath: "mcp_config.json",
        fileContent: validJsonContent,
      });

      expect(windsurfMcp).toBeInstanceOf(WindsurfMcp);
      expect(windsurfMcp.getRelativeDirPath()).toBe(".windsurf");
      expect(windsurfMcp.getRelativeFilePath()).toBe("mcp_config.json");
      expect(windsurfMcp.getFileContent()).toBe(validJsonContent);
    });

    it("should create instance with custom outputRoot", () => {
      const validJsonContent = JSON.stringify({ mcpServers: {} });

      const windsurfMcp = new WindsurfMcp({
        outputRoot: "/custom/path",
        relativeDirPath: ".windsurf",
        relativeFilePath: "mcp_config.json",
        fileContent: validJsonContent,
      });

      expect(windsurfMcp.getFilePath()).toBe("/custom/path/.windsurf/mcp_config.json");
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

      const windsurfMcp = new WindsurfMcp({
        relativeDirPath: ".windsurf",
        relativeFilePath: "mcp_config.json",
        fileContent: validJsonContent,
      });

      expect(windsurfMcp.getJson()).toEqual(jsonData);
    });

    it("should handle empty JSON object", () => {
      const emptyJsonContent = JSON.stringify({});

      const windsurfMcp = new WindsurfMcp({
        relativeDirPath: ".windsurf",
        relativeFilePath: "mcp_config.json",
        fileContent: emptyJsonContent,
      });

      expect(windsurfMcp.getJson()).toEqual({});
    });

    it("should validate content by default", () => {
      const validJsonContent = JSON.stringify({ mcpServers: {} });

      expect(() => {
        const _instance = new WindsurfMcp({
          relativeDirPath: ".windsurf",
          relativeFilePath: "mcp_config.json",
          fileContent: validJsonContent,
        });
      }).not.toThrow();
    });

    it("should skip validation when validate is false", () => {
      const validJsonContent = JSON.stringify({ mcpServers: {} });

      expect(() => {
        const _instance = new WindsurfMcp({
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
        const _instance = new WindsurfMcp({
          relativeDirPath: ".windsurf",
          relativeFilePath: "mcp_config.json",
          fileContent: invalidJsonContent,
        });
      }).toThrow();
    });
  });

  describe("fromFile", () => {
    it("should create instance from project file with default parameters", async () => {
      const windsurfDir = join(testDir, ".windsurf");
      await ensureDir(windsurfDir);

      const jsonData = {
        mcpServers: {
          filesystem: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-filesystem", windsurfDir],
          },
        },
      };
      await writeFileContent(
        join(windsurfDir, "mcp_config.json"),
        JSON.stringify(jsonData, null, 2),
      );

      const windsurfMcp = await WindsurfMcp.fromFile({
        outputRoot: testDir,
      });

      expect(windsurfMcp).toBeInstanceOf(WindsurfMcp);
      expect(windsurfMcp.getJson()).toEqual(jsonData);
      expect(windsurfMcp.getFilePath()).toBe(join(testDir, ".windsurf", "mcp_config.json"));
    });

    it("should initialize empty mcpServers if project file does not exist", async () => {
      const windsurfMcp = await WindsurfMcp.fromFile({
        outputRoot: testDir,
      });

      expect(windsurfMcp).toBeInstanceOf(WindsurfMcp);
      expect(windsurfMcp.getJson()).toEqual({ mcpServers: {} });
      expect(windsurfMcp.getFilePath()).toBe(join(testDir, ".windsurf", "mcp_config.json"));
    });

    it("should create instance from custom outputRoot", async () => {
      const customDir = join(testDir, "custom");
      const windsurfDir = join(customDir, ".windsurf");
      await ensureDir(windsurfDir);

      const jsonData = {
        mcpServers: {
          git: {
            command: "node",
            args: ["git-server.js"],
          },
        },
      };
      await writeFileContent(join(windsurfDir, "mcp_config.json"), JSON.stringify(jsonData));

      const windsurfMcp = await WindsurfMcp.fromFile({
        outputRoot: customDir,
      });

      expect(windsurfMcp.getFilePath()).toBe(join(customDir, ".windsurf", "mcp_config.json"));
      expect(windsurfMcp.getJson()).toEqual(jsonData);
    });

    it("should skip validation when validate is false", async () => {
      const windsurfDir = join(testDir, ".windsurf");
      await ensureDir(windsurfDir);
      await writeFileContent(
        join(windsurfDir, "mcp_config.json"),
        JSON.stringify({ mcpServers: {} }),
      );

      const windsurfMcp = await WindsurfMcp.fromFile({
        outputRoot: testDir,
        validate: false,
      });

      expect(windsurfMcp.getJson()).toEqual({ mcpServers: {} });
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

      const windsurfMcp = await WindsurfMcp.fromFile({
        outputRoot: testDir,
        global: true,
      });

      expect(windsurfMcp).toBeInstanceOf(WindsurfMcp);
      expect(windsurfMcp.getJson()).toEqual(jsonData);
      expect(windsurfMcp.getFilePath()).toBe(
        join(testDir, ".codeium", "windsurf", "mcp_config.json"),
      );
      expect(windsurfMcp.getRelativeDirPath()).toBe(join(".codeium", "windsurf"));
    });

    it("should initialize empty global config if it does not exist", async () => {
      const windsurfMcp = await WindsurfMcp.fromFile({
        outputRoot: testDir,
        global: true,
      });

      expect(windsurfMcp.getJson()).toEqual({ mcpServers: {} });
      expect(windsurfMcp.getFilePath()).toBe(
        join(testDir, ".codeium", "windsurf", "mcp_config.json"),
      );
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

      const windsurfMcp = await WindsurfMcp.fromFile({
        outputRoot: testDir,
        global: true,
      });

      const json = windsurfMcp.getJson();
      expect(json.mcpServers).toEqual({
        "old-server": {
          command: "node",
          args: ["old-server.js"],
        },
      });
      expect((json as any).otherSetting).toEqual({ value: 42 });
    });

    it("should throw error for malformed JSON in existing file", async () => {
      const windsurfDir = join(testDir, ".windsurf");
      await ensureDir(windsurfDir);
      await writeFileContent(join(windsurfDir, "mcp_config.json"), "{ invalid json }");

      await expect(
        WindsurfMcp.fromFile({
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

      const windsurfMcp = await WindsurfMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
      });

      expect(windsurfMcp).toBeInstanceOf(WindsurfMcp);
      expect(windsurfMcp.getJson()).toEqual(jsonData);
      expect(windsurfMcp.getRelativeDirPath()).toBe(".windsurf");
      expect(windsurfMcp.getRelativeFilePath()).toBe("mcp_config.json");
    });

    it("should strip codex-only envVars from windsurf output", async () => {
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

      const windsurfMcp = await WindsurfMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
      });

      const json = windsurfMcp.getJson() as any;
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

      const windsurfMcp = await WindsurfMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });

      expect(windsurfMcp.getJson()).toEqual(jsonData);
      expect(windsurfMcp.getRelativeDirPath()).toBe(join(".codeium", "windsurf"));
      expect(windsurfMcp.getFilePath()).toBe(
        join(testDir, ".codeium", "windsurf", "mcp_config.json"),
      );
    });

    it("should preserve existing non-mcpServers properties when updating", async () => {
      const windsurfDir = join(testDir, ".windsurf");
      await ensureDir(windsurfDir);
      const existing = {
        mcpServers: {
          "old-server": { command: "node", args: ["old.js"] },
        },
        someOtherKey: "keep-me",
      };
      await writeFileContent(
        join(windsurfDir, "mcp_config.json"),
        JSON.stringify(existing, null, 2),
      );

      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            "new-server": { command: "python", args: ["new.py"] },
          },
        }),
      });

      const windsurfMcp = await WindsurfMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
      });

      const json = windsurfMcp.getJson();
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

      const windsurfMcp = await WindsurfMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
      });

      expect(windsurfMcp.getJson()).toEqual({ mcpServers: {} });
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
      const windsurfMcp = new WindsurfMcp({
        relativeDirPath: ".windsurf",
        relativeFilePath: "mcp_config.json",
        fileContent: JSON.stringify(jsonData),
      });

      const rulesyncMcp = windsurfMcp.toRulesyncMcp();

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
      const windsurfMcp = new WindsurfMcp({
        relativeDirPath: ".windsurf",
        relativeFilePath: "mcp_config.json",
        fileContent: JSON.stringify(jsonData),
      });

      const rulesyncMcp = windsurfMcp.toRulesyncMcp();

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
      const windsurfMcp = new WindsurfMcp({
        relativeDirPath: ".windsurf",
        relativeFilePath: "mcp_config.json",
        fileContent: JSON.stringify({ mcpServers: {} }),
      });

      const rulesyncMcp = windsurfMcp.toRulesyncMcp();

      expect(JSON.parse(rulesyncMcp.getFileContent())).toEqual({
        $schema: RULESYNC_MCP_SCHEMA_URL,
        mcpServers: {},
      });
    });
  });

  describe("validate", () => {
    it("should always return success", () => {
      const windsurfMcp = new WindsurfMcp({
        relativeDirPath: ".windsurf",
        relativeFilePath: "mcp_config.json",
        fileContent: JSON.stringify({ mcpServers: {} }),
        validate: false,
      });

      const result = windsurfMcp.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });

  describe("forDeletion", () => {
    it("should create minimal instance for deletion (project)", () => {
      const windsurfMcp = WindsurfMcp.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".windsurf",
        relativeFilePath: "mcp_config.json",
      });

      expect(windsurfMcp).toBeInstanceOf(WindsurfMcp);
      expect(windsurfMcp.getJson()).toEqual({});
      expect(windsurfMcp.getFilePath()).toBe(join(testDir, ".windsurf", "mcp_config.json"));
      expect(windsurfMcp.isDeletable()).toBe(true);
    });

    it("should create minimal instance for deletion at the global codeium path", () => {
      const windsurfMcp = WindsurfMcp.forDeletion({
        outputRoot: testDir,
        relativeDirPath: join(".codeium", "windsurf"),
        relativeFilePath: "mcp_config.json",
        global: true,
      });

      expect(windsurfMcp.getJson()).toEqual({});
      expect(windsurfMcp.getFilePath()).toBe(
        join(testDir, ".codeium", "windsurf", "mcp_config.json"),
      );
      expect(windsurfMcp.getRelativeDirPath()).toBe(join(".codeium", "windsurf"));
    });
  });

  describe("integration", () => {
    it("should handle complete workflow: fromFile -> toRulesyncMcp -> fromRulesyncMcp", async () => {
      const windsurfDir = join(testDir, ".windsurf");
      await ensureDir(windsurfDir);

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
        join(windsurfDir, "mcp_config.json"),
        JSON.stringify(originalJsonData, null, 2),
      );

      const originalWindsurfMcp = await WindsurfMcp.fromFile({
        outputRoot: testDir,
      });
      const rulesyncMcp = originalWindsurfMcp.toRulesyncMcp();
      const newWindsurfMcp = await WindsurfMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
      });

      expect(newWindsurfMcp.getJson()).toEqual(originalJsonData);
      expect(newWindsurfMcp.getFilePath()).toBe(join(testDir, ".windsurf", "mcp_config.json"));
    });
  });
});
