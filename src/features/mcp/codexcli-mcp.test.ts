import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { CodexcliMcp } from "./codexcli-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

describe("CodexcliMcp", () => {
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
    it("should throw error for local mode", () => {
      expect(() => CodexcliMcp.getSettablePaths()).toThrow(
        "CodexcliMcp only supports global mode. Please pass { global: true }.",
      );
    });

    it("should return correct paths for global mode", () => {
      const paths = CodexcliMcp.getSettablePaths({ global: true });

      expect(paths.relativeDirPath).toBe(".codex");
      expect(paths.relativeFilePath).toBe("config.toml");
    });
  });

  describe("constructor", () => {
    it("should create instance with valid TOML content", () => {
      const validTomlContent = `[mcpServers.filesystem]
command = "npx"
args = ["-y", "@anthropic-ai/mcp-server-filesystem", "/workspace"]
`;

      const codexcliMcp = new CodexcliMcp({
        relativeDirPath: ".codex",
        relativeFilePath: "config.toml",
        fileContent: validTomlContent,
      });

      expect(codexcliMcp).toBeInstanceOf(CodexcliMcp);
      expect(codexcliMcp.getRelativeDirPath()).toBe(".codex");
      expect(codexcliMcp.getRelativeFilePath()).toBe("config.toml");
      expect(codexcliMcp.getFileContent()).toBe(validTomlContent);
    });

    it("should create instance with custom baseDir", () => {
      const validTomlContent = `[mcpServers]
`;

      const codexcliMcp = new CodexcliMcp({
        baseDir: "/custom/path",
        relativeDirPath: ".codex",
        relativeFilePath: "config.toml",
        fileContent: validTomlContent,
      });

      expect(codexcliMcp.getFilePath()).toBe("/custom/path/.codex/config.toml");
    });

    it("should parse TOML content correctly", () => {
      const tomlContent = `[mcpServers."test-server"]
command = "node"
args = ["server.js"]

[mcpServers."test-server".env]
NODE_ENV = "development"
`;

      const codexcliMcp = new CodexcliMcp({
        relativeDirPath: ".codex",
        relativeFilePath: "config.toml",
        fileContent: tomlContent,
      });

      const json = codexcliMcp.getToml();
      expect(json.mcpServers).toBeDefined();
      expect((json.mcpServers as any)["test-server"]).toEqual({
        command: "node",
        args: ["server.js"],
        env: {
          NODE_ENV: "development",
        },
      });
    });

    it("should handle empty TOML object", () => {
      const emptyTomlContent = "";

      const codexcliMcp = new CodexcliMcp({
        relativeDirPath: ".codex",
        relativeFilePath: "config.toml",
        fileContent: emptyTomlContent,
      });

      expect(codexcliMcp.getToml()).toEqual({});
    });

    it("should validate content by default", () => {
      const validTomlContent = `[mcpServers]
`;

      expect(() => {
        const _instance = new CodexcliMcp({
          relativeDirPath: ".codex",
          relativeFilePath: "config.toml",
          fileContent: validTomlContent,
        });
      }).not.toThrow();
    });

    it("should skip validation when validate is false", () => {
      const validTomlContent = `[mcpServers]
`;

      expect(() => {
        const _instance = new CodexcliMcp({
          relativeDirPath: ".codex",
          relativeFilePath: "config.toml",
          fileContent: validTomlContent,
          validate: false,
        });
      }).not.toThrow();
    });

    it("should throw error for invalid TOML content", () => {
      const invalidTomlContent = "[invalid toml\nkey = ";

      expect(() => {
        const _instance = new CodexcliMcp({
          relativeDirPath: ".codex",
          relativeFilePath: "config.toml",
          fileContent: invalidTomlContent,
        });
      }).toThrow();
    });

    it("should preserve existing TOML content structure", () => {
      const tomlWithComments = `# Codex configuration
[general]
theme = "dark"

# MCP Servers
[mcpServers.filesystem]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
`;

      const codexcliMcp = new CodexcliMcp({
        relativeDirPath: ".codex",
        relativeFilePath: "config.toml",
        fileContent: tomlWithComments,
      });

      const json = codexcliMcp.getToml();
      expect((json as any).general).toEqual({ theme: "dark" });
      expect((json.mcpServers as any)?.filesystem).toBeDefined();
    });
  });

  describe("fromFile", () => {
    it("should throw error for local mode", async () => {
      const tomlData = `[mcpServers.filesystem]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-filesystem", "${testDir}"]
`;
      await ensureDir(join(testDir, ".codex"));
      await writeFileContent(join(testDir, ".codex/config.toml"), tomlData);

      await expect(
        CodexcliMcp.fromFile({
          baseDir: testDir,
          global: false,
        }),
      ).rejects.toThrow("CodexcliMcp only supports global mode. Please pass { global: true }.");
    });

    it("should create instance from file in global mode", async () => {
      const tomlData = `[mcpServers.filesystem]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-filesystem", "${testDir}"]
`;
      await ensureDir(join(testDir, ".codex"));
      await writeFileContent(join(testDir, ".codex/config.toml"), tomlData);

      const codexcliMcp = await CodexcliMcp.fromFile({
        baseDir: testDir,
        global: true,
      });

      expect(codexcliMcp).toBeInstanceOf(CodexcliMcp);
      expect((codexcliMcp.getToml().mcpServers as any)?.filesystem).toBeDefined();
      expect(codexcliMcp.getFilePath()).toBe(join(testDir, ".codex/config.toml"));
    });

    it("should create instance from file with custom baseDir", async () => {
      const customDir = join(testDir, "custom");
      await ensureDir(join(customDir, ".codex"));

      const tomlData = `[mcpServers.git]
command = "node"
args = ["git-server.js"]
`;
      await writeFileContent(join(customDir, ".codex/config.toml"), tomlData);

      const codexcliMcp = await CodexcliMcp.fromFile({
        baseDir: customDir,
        global: true,
      });

      expect(codexcliMcp.getFilePath()).toBe(join(customDir, ".codex/config.toml"));
      expect((codexcliMcp.getToml().mcpServers as any)?.git).toBeDefined();
    });

    it("should handle validation when validate is true", async () => {
      const tomlData = `[mcpServers."valid-server"]
command = "node"
args = ["server.js"]
`;
      await ensureDir(join(testDir, ".codex"));
      await writeFileContent(join(testDir, ".codex/config.toml"), tomlData);

      const codexcliMcp = await CodexcliMcp.fromFile({
        baseDir: testDir,
        validate: true,
        global: true,
      });

      expect((codexcliMcp.getToml().mcpServers as any)?.["valid-server"]).toBeDefined();
    });

    it("should skip validation when validate is false", async () => {
      const tomlData = `[mcpServers]
`;
      await ensureDir(join(testDir, ".codex"));
      await writeFileContent(join(testDir, ".codex/config.toml"), tomlData);

      const codexcliMcp = await CodexcliMcp.fromFile({
        baseDir: testDir,
        validate: false,
        global: true,
      });

      expect(codexcliMcp.getToml().mcpServers).toBeDefined();
    });

    it("should throw error if file does not exist", async () => {
      await expect(
        CodexcliMcp.fromFile({
          baseDir: testDir,
          global: true,
        }),
      ).rejects.toThrow();
    });
  });

  describe("fromRulesyncMcp", () => {
    it("should throw error for local mode", async () => {
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

      await expect(
        CodexcliMcp.fromRulesyncMcp({
          rulesyncMcp,
          global: false,
        }),
      ).rejects.toThrow("CodexcliMcp only supports global mode. Please pass { global: true }.");
    });

    it("should create instance from RulesyncMcp in global mode with new file", async () => {
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

      const codexcliMcp = await CodexcliMcp.fromRulesyncMcp({
        baseDir: testDir,
        rulesyncMcp,
        global: true,
      });

      expect(codexcliMcp).toBeInstanceOf(CodexcliMcp);
      expect(codexcliMcp.getToml().mcp_servers).toEqual(jsonData.mcpServers);
      expect(codexcliMcp.getRelativeDirPath()).toBe(".codex");
      expect(codexcliMcp.getRelativeFilePath()).toBe("config.toml");
    });

    it("should preserve existing TOML content when adding MCP servers", async () => {
      // Create existing config.toml with some content
      const existingToml = `[general]
theme = "dark"
language = "en"

[editor]
fontSize = 14
`;
      await ensureDir(join(testDir, ".codex"));
      await writeFileContent(join(testDir, ".codex/config.toml"), existingToml);

      const jsonData = {
        mcpServers: {
          "new-server": {
            command: "node",
            args: ["new-server.js"],
          },
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const codexcliMcp = await CodexcliMcp.fromRulesyncMcp({
        baseDir: testDir,
        rulesyncMcp,
        global: true,
      });

      const json = codexcliMcp.getToml();
      expect(json.general).toEqual({ theme: "dark", language: "en" });
      expect(json.editor).toEqual({ fontSize: 14 });
      expect(json.mcp_servers).toEqual(jsonData.mcpServers);
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

      const codexcliMcp = await CodexcliMcp.fromRulesyncMcp({
        baseDir: testDir,
        rulesyncMcp,
        global: true,
      });

      expect(codexcliMcp.getFilePath()).toBe(join(testDir, ".codex/config.toml"));
      expect(codexcliMcp.getToml().mcp_servers).toEqual(jsonData.mcpServers);
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

      const codexcliMcp = await CodexcliMcp.fromRulesyncMcp({
        baseDir: testDir,
        rulesyncMcp,
        validate: true,
        global: true,
      });

      expect(codexcliMcp.getToml().mcp_servers).toEqual(jsonData.mcpServers);
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

      const codexcliMcp = await CodexcliMcp.fromRulesyncMcp({
        baseDir: testDir,
        rulesyncMcp,
        validate: false,
        global: true,
      });

      expect(codexcliMcp.getToml().mcp_servers).toEqual({});
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

      const codexcliMcp = await CodexcliMcp.fromRulesyncMcp({
        baseDir: testDir,
        rulesyncMcp,
        global: true,
      });

      expect(codexcliMcp.getToml().mcp_servers).toEqual({});
    });

    it("should handle complex nested MCP server configuration", async () => {
      const jsonData = {
        mcpServers: {
          "complex-server": {
            command: "node",
            args: ["complex-server.js", "--port", "3000", "--ssl"],
            env: {
              NODE_ENV: "production",
              DEBUG: "mcp:*",
              SSL_CERT: "/path/to/cert",
            },
          },
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const codexcliMcp = await CodexcliMcp.fromRulesyncMcp({
        baseDir: testDir,
        rulesyncMcp,
        global: true,
      });

      expect(codexcliMcp.getToml().mcp_servers).toEqual(jsonData.mcpServers);
    });
  });

  describe("toRulesyncMcp", () => {
    it("should convert to RulesyncMcp with default configuration", () => {
      const tomlContent = `[mcp_servers.filesystem]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
`;
      const codexcliMcp = new CodexcliMcp({
        relativeDirPath: ".codex",
        relativeFilePath: "config.toml",
        fileContent: tomlContent,
      });

      const rulesyncMcp = codexcliMcp.toRulesyncMcp();

      expect(rulesyncMcp).toBeInstanceOf(RulesyncMcp);
      expect(rulesyncMcp.getRelativeDirPath()).toBe(RULESYNC_RELATIVE_DIR_PATH);
      expect(rulesyncMcp.getRelativeFilePath()).toBe(".mcp.json");

      const json = JSON.parse(rulesyncMcp.getFileContent());
      expect((json.mcpServers as any)?.filesystem).toBeDefined();
    });

    it("should preserve MCP server data when converting to RulesyncMcp", () => {
      const tomlContent = `[mcp_servers."complex-server"]
command = "node"
args = ["complex-server.js", "--port", "3000"]

[mcp_servers."complex-server".env]
NODE_ENV = "production"
DEBUG = "mcp:*"

[mcp_servers."another-server"]
command = "python"
args = ["another-server.py"]
`;
      const codexcliMcp = new CodexcliMcp({
        baseDir: "/test/dir",
        relativeDirPath: ".codex",
        relativeFilePath: "config.toml",
        fileContent: tomlContent,
      });

      const rulesyncMcp = codexcliMcp.toRulesyncMcp();

      expect(rulesyncMcp.getBaseDir()).toBe("/test/dir");

      const json = JSON.parse(rulesyncMcp.getFileContent());
      expect(json.mcpServers?.["complex-server"]).toEqual({
        command: "node",
        args: ["complex-server.js", "--port", "3000"],
        env: {
          NODE_ENV: "production",
          DEBUG: "mcp:*",
        },
      });
      expect(json.mcpServers?.["another-server"]).toEqual({
        command: "python",
        args: ["another-server.py"],
      });
    });

    it("should only include mcpServers in RulesyncMcp output", () => {
      const tomlContent = `[general]
theme = "dark"

[mcp_servers.filesystem]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]

[editor]
fontSize = 14
`;
      const codexcliMcp = new CodexcliMcp({
        relativeDirPath: ".codex",
        relativeFilePath: "config.toml",
        fileContent: tomlContent,
      });

      const rulesyncMcp = codexcliMcp.toRulesyncMcp();

      const json = JSON.parse(rulesyncMcp.getFileContent());
      expect(json.mcpServers).toBeDefined();
      expect(json.general).toBeUndefined();
      expect(json.editor).toBeUndefined();
    });

    it("should handle empty mcpServers when converting", () => {
      const tomlContent = `[general]
theme = "dark"
`;
      const codexcliMcp = new CodexcliMcp({
        relativeDirPath: ".codex",
        relativeFilePath: "config.toml",
        fileContent: tomlContent,
      });

      const rulesyncMcp = codexcliMcp.toRulesyncMcp();

      const json = JSON.parse(rulesyncMcp.getFileContent());
      expect(json.mcpServers).toEqual({});
    });
  });

  describe("validate", () => {
    it("should return successful validation result", () => {
      const tomlContent = `[mcpServers."test-server"]
command = "node"
args = ["server.js"]
`;
      const codexcliMcp = new CodexcliMcp({
        relativeDirPath: ".codex",
        relativeFilePath: "config.toml",
        fileContent: tomlContent,
        validate: false,
      });

      const result = codexcliMcp.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should always return success (no validation logic implemented)", () => {
      const tomlContent = `[mcpServers]
`;
      const codexcliMcp = new CodexcliMcp({
        relativeDirPath: ".codex",
        relativeFilePath: "config.toml",
        fileContent: tomlContent,
        validate: false,
      });

      const result = codexcliMcp.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return success for complex MCP configuration", () => {
      const tomlContent = `[mcpServers.filesystem]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"]

[mcpServers.filesystem.env]
NODE_ENV = "development"

[mcpServers.git]
command = "node"
args = ["git-server.js"]

[mcpServers.sqlite]
command = "python"
args = ["sqlite-server.py", "--database", "/path/to/db.sqlite"]

[mcpServers.sqlite.env]
PYTHONPATH = "/custom/path"
DEBUG = "true"
`;
      const codexcliMcp = new CodexcliMcp({
        relativeDirPath: ".codex",
        relativeFilePath: "config.toml",
        fileContent: tomlContent,
        validate: false,
      });

      const result = codexcliMcp.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });

  describe("integration", () => {
    it("should handle complete workflow: fromFile -> toRulesyncMcp -> fromRulesyncMcp", async () => {
      const originalTomlData = `[mcp_servers."workflow-server"]
command = "node"
args = ["workflow-server.js", "--config", "config.json"]

[mcp_servers."workflow-server".env]
NODE_ENV = "test"
`;
      await ensureDir(join(testDir, ".codex"));
      await writeFileContent(join(testDir, ".codex/config.toml"), originalTomlData);

      // Step 1: Load from file
      const originalCodexcliMcp = await CodexcliMcp.fromFile({
        baseDir: testDir,
        global: true,
      });

      // Step 2: Convert to RulesyncMcp
      const rulesyncMcp = originalCodexcliMcp.toRulesyncMcp();

      // Step 3: Create new CodexcliMcp from RulesyncMcp
      const newCodexcliMcp = await CodexcliMcp.fromRulesyncMcp({
        baseDir: testDir,
        rulesyncMcp,
        global: true,
      });

      // Verify data integrity for mcpServers
      const originalJson = originalCodexcliMcp.getToml();
      const newJson = newCodexcliMcp.getToml();
      expect(newJson.mcpServers).toEqual(originalJson.mcpServers);
      expect(newCodexcliMcp.getFilePath()).toBe(join(testDir, ".codex/config.toml"));
    });

    it("should maintain MCP server data consistency across transformations", async () => {
      const complexTomlData = `[mcp_servers."primary-server"]
command = "node"
args = ["primary.js", "--mode", "production"]

[mcp_servers."primary-server".env]
NODE_ENV = "production"
LOG_LEVEL = "info"
API_KEY = "secret"

[mcp_servers."secondary-server"]
command = "python"
args = ["secondary.py", "--workers", "4"]

[mcp_servers."secondary-server".env]
PYTHONPATH = "/app/lib"
`;

      // Create CodexcliMcp
      const codexcliMcp = new CodexcliMcp({
        baseDir: testDir,
        relativeDirPath: ".codex",
        relativeFilePath: "config.toml",
        fileContent: complexTomlData,
      });

      // Convert to RulesyncMcp and back
      const rulesyncMcp = codexcliMcp.toRulesyncMcp();
      const newCodexcliMcp = await CodexcliMcp.fromRulesyncMcp({
        baseDir: testDir,
        rulesyncMcp,
        global: true,
      });

      // Verify mcpServers data is preserved
      const originalMcpServers = codexcliMcp.getToml().mcp_servers;
      const newMcpServers = newCodexcliMcp.getToml().mcp_servers;
      expect(newMcpServers).toEqual(originalMcpServers);
      expect(newCodexcliMcp.getFilePath()).toBe(join(testDir, ".codex/config.toml"));
    });

    it("should preserve existing non-MCP TOML content through full workflow", async () => {
      const originalTomlData = `[general]
theme = "dark"
language = "en"

[mcp_servers.filesystem]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]

[editor]
fontSize = 14
`;
      await ensureDir(join(testDir, ".codex"));
      await writeFileContent(join(testDir, ".codex/config.toml"), originalTomlData);

      // Load from file
      const originalCodexcliMcp = await CodexcliMcp.fromFile({
        baseDir: testDir,
        global: true,
      });

      // Convert to RulesyncMcp
      const rulesyncMcp = originalCodexcliMcp.toRulesyncMcp();

      // Create new CodexcliMcp from RulesyncMcp (this should preserve existing content)
      const newCodexcliMcp = await CodexcliMcp.fromRulesyncMcp({
        baseDir: testDir,
        rulesyncMcp,
        global: true,
      });

      const newJson = newCodexcliMcp.getToml();
      expect((newJson as any).general).toEqual({ theme: "dark", language: "en" });
      expect((newJson as any).editor).toEqual({ fontSize: 14 });
      expect((newJson.mcp_servers as any)?.filesystem).toBeDefined();
    });
  });
});
