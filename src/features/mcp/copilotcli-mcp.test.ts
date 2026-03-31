import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_MCP_FILE_NAME,
  RULESYNC_MCP_SCHEMA_URL,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { CopilotcliMcp } from "./copilotcli-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

describe("CopilotcliMcp", () => {
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

  describe("constructor", () => {
    it("should create instance with default parameters", () => {
      const validJsonContent = JSON.stringify({
        mcpServers: {
          filesystem: {
            type: "stdio",
            command: "npx",
            args: ["-y", "@anthropic-ai/mcp-server-filesystem", join(testDir, "workspace")],
          },
        },
      });

      const copilotCliMcp = new CopilotcliMcp({
        relativeDirPath: ".copilot",
        relativeFilePath: "mcp-config.json",
        fileContent: validJsonContent,
      });

      expect(copilotCliMcp).toBeInstanceOf(CopilotcliMcp);
      expect(copilotCliMcp.getRelativeDirPath()).toBe(".copilot");
      expect(copilotCliMcp.getRelativeFilePath()).toBe("mcp-config.json");
      expect(copilotCliMcp.getFileContent()).toBe(validJsonContent);
    });

    it("should create instance with custom baseDir", () => {
      const validJsonContent = JSON.stringify({
        mcpServers: {},
      });

      const copilotCliMcp = new CopilotcliMcp({
        baseDir: join(testDir, "custom"),
        relativeDirPath: ".copilot",
        relativeFilePath: "mcp-config.json",
        fileContent: validJsonContent,
      });

      // Use path.join for cross-platform compatibility
      expect(copilotCliMcp.getFilePath()).toContain("custom");
      expect(copilotCliMcp.getFilePath()).toContain(".copilot");
      expect(copilotCliMcp.getFilePath()).toContain("mcp-config.json");
    });

    it("should parse JSON content correctly", () => {
      const jsonData = {
        mcpServers: {
          "test-server": {
            type: "stdio" as const,
            command: "node",
            args: ["server.js"],
            env: {
              NODE_ENV: "development",
            },
          },
        },
      };
      const validJsonContent = JSON.stringify(jsonData);

      const copilotCliMcp = new CopilotcliMcp({
        relativeDirPath: ".copilot",
        relativeFilePath: "mcp-config.json",
        fileContent: validJsonContent,
      });

      expect(copilotCliMcp.getJson()).toEqual(jsonData);
    });

    it("should handle empty JSON object", () => {
      const emptyJsonContent = JSON.stringify({});

      const copilotCliMcp = new CopilotcliMcp({
        relativeDirPath: ".copilot",
        relativeFilePath: "mcp-config.json",
        fileContent: emptyJsonContent,
      });

      expect(copilotCliMcp.getJson()).toEqual({});
    });

    it("should throw error for invalid JSON content", () => {
      const invalidJsonContent = "{ invalid json }";

      expect(() => {
        const _instance = new CopilotcliMcp({
          relativeDirPath: ".copilot",
          relativeFilePath: "mcp-config.json",
          fileContent: invalidJsonContent,
        });
      }).toThrow();
    });
  });

  describe("getSettablePaths", () => {
    it("should return correct paths for project mode", () => {
      const paths = CopilotcliMcp.getSettablePaths({ global: false });

      expect(paths.relativeDirPath).toBe(".copilot");
      expect(paths.relativeFilePath).toBe("mcp-config.json");
    });

    it("should return correct paths for global mode", () => {
      const paths = CopilotcliMcp.getSettablePaths({ global: true });

      expect(paths.relativeDirPath).toBe(".copilot");
      expect(paths.relativeFilePath).toBe("mcp-config.json");
    });

    it("should return correct paths when global is not specified", () => {
      const paths = CopilotcliMcp.getSettablePaths();

      expect(paths.relativeDirPath).toBe(".copilot");
      expect(paths.relativeFilePath).toBe("mcp-config.json");
    });
  });

  describe("fromFile", () => {
    it("should create instance from file with default parameters", async () => {
      const copilotDir = join(testDir, ".copilot");
      await ensureDir(copilotDir);

      const jsonData = {
        mcpServers: {
          filesystem: {
            type: "stdio" as const,
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-filesystem", testDir],
          },
        },
      };
      await writeFileContent(
        join(copilotDir, "mcp-config.json"),
        JSON.stringify(jsonData, null, 2),
      );

      const copilotCliMcp = await CopilotcliMcp.fromFile({
        baseDir: testDir,
      });

      expect(copilotCliMcp).toBeInstanceOf(CopilotcliMcp);
      expect(copilotCliMcp.getJson()).toEqual(jsonData);
      expect(copilotCliMcp.getFilePath()).toBe(join(testDir, ".copilot/mcp-config.json"));
    });

    it("should create instance from file with custom baseDir", async () => {
      const customDir = join(testDir, "custom");
      const copilotDir = join(customDir, ".copilot");
      await ensureDir(copilotDir);

      const jsonData = {
        mcpServers: {
          git: {
            type: "stdio" as const,
            command: "node",
            args: ["git-server.js"],
          },
        },
      };
      await writeFileContent(join(copilotDir, "mcp-config.json"), JSON.stringify(jsonData));

      const copilotCliMcp = await CopilotcliMcp.fromFile({
        baseDir: customDir,
      });

      expect(copilotCliMcp.getFilePath()).toBe(join(customDir, ".copilot/mcp-config.json"));
      expect(copilotCliMcp.getJson()).toEqual(jsonData);
    });

    it("should return default empty config if file does not exist", async () => {
      const copilotCliMcp = await CopilotcliMcp.fromFile({
        baseDir: testDir,
      });

      expect(copilotCliMcp.getJson()).toEqual({ mcpServers: {} });
    });

    it("should handle global mode", async () => {
      const copilotDir = join(testDir, ".copilot");
      await ensureDir(copilotDir);

      const jsonData = {
        mcpServers: {
          "global-server": {
            type: "stdio" as const,
            command: "npx",
            args: ["global-server"],
          },
        },
      };
      await writeFileContent(
        join(copilotDir, "mcp-config.json"),
        JSON.stringify(jsonData, null, 2),
      );

      const copilotCliMcp = await CopilotcliMcp.fromFile({
        baseDir: testDir,
        global: true,
      });

      expect(copilotCliMcp.getJson()).toEqual(jsonData);
      // Verify global mode via isDeletable (returns false for global mode)
      expect(copilotCliMcp.isDeletable()).toBe(false);
    });
  });

  describe("fromRulesyncMcp", () => {
    it("should convert mcpServers key and add type field", async () => {
      const inputMcpServers = {
        "test-server": {
          command: "node",
          args: ["test-server.js"],
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ mcpServers: inputMcpServers }),
      });

      const copilotCliMcp = await CopilotcliMcp.fromRulesyncMcp({
        rulesyncMcp,
      });

      expect(copilotCliMcp).toBeInstanceOf(CopilotcliMcp);
      // Output should have mcpServers key with type field added
      expect(copilotCliMcp.getJson()).toEqual({
        mcpServers: {
          "test-server": {
            type: "stdio",
            command: "node",
            args: ["test-server.js"],
          },
        },
      });
      expect(copilotCliMcp.getRelativeDirPath()).toBe(".copilot");
      expect(copilotCliMcp.getRelativeFilePath()).toBe("mcp-config.json");
    });

    it("should preserve env field when converting", async () => {
      const inputMcpServers = {
        "custom-server": {
          command: "python",
          args: ["server.py"],
          env: {
            PYTHONPATH: join(testDir, "custom"),
          },
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ mcpServers: inputMcpServers }),
      });

      const targetDir = join(testDir, "target");
      const copilotCliMcp = await CopilotcliMcp.fromRulesyncMcp({
        baseDir: targetDir,
        rulesyncMcp,
      });

      expect(copilotCliMcp.getFilePath()).toContain("target");
      expect(copilotCliMcp.getJson()).toEqual({
        mcpServers: {
          "custom-server": {
            type: "stdio",
            command: "python",
            args: ["server.py"],
            env: {
              PYTHONPATH: join(testDir, "custom"),
            },
          },
        },
      });
    });

    it("should handle empty mcpServers object", async () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ mcpServers: {} }),
      });

      const copilotCliMcp = await CopilotcliMcp.fromRulesyncMcp({
        rulesyncMcp,
      });

      expect(copilotCliMcp.getJson()).toEqual({ mcpServers: {} });
    });

    it("should handle global mode", async () => {
      const inputMcpServers = {
        "global-server": {
          command: "npx",
          args: ["global-mcp-server"],
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ mcpServers: inputMcpServers }),
      });

      const copilotCliMcp = await CopilotcliMcp.fromRulesyncMcp({
        baseDir: testDir,
        rulesyncMcp,
        global: true,
      });

      // Verify global mode via isDeletable (returns false for global mode)
      expect(copilotCliMcp.isDeletable()).toBe(false);
      expect(copilotCliMcp.getJson()).toEqual({
        mcpServers: {
          "global-server": {
            type: "stdio",
            command: "npx",
            args: ["global-mcp-server"],
          },
        },
      });
    });

    it("should throw error when server has no command", async () => {
      const inputMcpServers = {
        "no-command-server": {
          // No command provided
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ mcpServers: inputMcpServers }),
      });

      await expect(
        CopilotcliMcp.fromRulesyncMcp({
          rulesyncMcp,
        }),
      ).rejects.toThrow('MCP server "no-command-server" is missing a command');
    });

    it("should throw error when stdio server has unknown fields but no command", async () => {
      const inputMcpServers = {
        "unknown-fields-no-command": {
          url: "http://localhost:3000/mcp",
          headers: {
            Authorization: "Bearer test-token",
          },
          unknown_field: "value",
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ mcpServers: inputMcpServers }),
      });

      await expect(
        CopilotcliMcp.fromRulesyncMcp({
          rulesyncMcp,
        }),
      ).rejects.toThrow('MCP server "unknown-fields-no-command" is missing a command');
    });

    it("should handle command as array and merge remaining elements into args", async () => {
      const inputMcpServers = {
        "array-command-server": {
          command: ["npx", "-y", "@anthropic-ai/mcp-server-filesystem"],
          args: [join(testDir, "workspace")],
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ mcpServers: inputMcpServers }),
      });

      const copilotCliMcp = await CopilotcliMcp.fromRulesyncMcp({
        rulesyncMcp,
      });

      expect(copilotCliMcp.getJson()).toEqual({
        mcpServers: {
          "array-command-server": {
            type: "stdio",
            command: "npx",
            args: ["-y", "@anthropic-ai/mcp-server-filesystem", join(testDir, "workspace")],
          },
        },
      });
    });

    it("should preserve http and sse servers without requiring command", async () => {
      const inputMcpServers = {
        "http-server": {
          type: "http" as const,
          url: "http://localhost:3000/mcp",
          headers: {
            Authorization: "Bearer token",
          },
          tools: ["search"],
        },
        "sse-server": {
          type: "sse" as const,
          url: "http://localhost:4000/sse",
          headers: {
            "X-Test": "true",
          },
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ mcpServers: inputMcpServers }),
      });

      const copilotCliMcp = await CopilotcliMcp.fromRulesyncMcp({
        rulesyncMcp,
      });

      expect(copilotCliMcp.getJson()).toEqual({
        mcpServers: inputMcpServers,
      });
    });

    it("should preserve transport-based remote servers and add type field", async () => {
      const inputMcpServers = {
        "http-server": {
          transport: "http" as const,
          url: "http://localhost:3000/mcp",
          headers: {
            Authorization: "Bearer token",
          },
        },
        "sse-server": {
          transport: "sse" as const,
          url: "http://localhost:4000/sse",
          headers: {
            "X-Test": "true",
          },
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ mcpServers: inputMcpServers }),
      });

      const copilotCliMcp = await CopilotcliMcp.fromRulesyncMcp({
        rulesyncMcp,
      });

      expect(copilotCliMcp.getJson()).toEqual({
        mcpServers: {
          "http-server": {
            type: "http",
            ...inputMcpServers["http-server"],
          },
          "sse-server": {
            type: "sse",
            ...inputMcpServers["sse-server"],
          },
        },
      });
    });

    it("should require command for local type servers", async () => {
      const inputMcpServers = {
        "local-server": {
          type: "local" as const,
          cwd: testDir,
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ mcpServers: inputMcpServers }),
      });

      await expect(
        CopilotcliMcp.fromRulesyncMcp({
          rulesyncMcp,
        }),
      ).rejects.toThrow('MCP server "local-server" is missing a command');
    });

    it("should preserve existing non-stdio type when converting", async () => {
      const inputMcpServers = {
        "typed-server": {
          type: "http" as const,
          command: "node",
          args: ["server.js"],
          url: "http://localhost:3000/mcp",
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ mcpServers: inputMcpServers }),
      });

      const copilotCliMcp = await CopilotcliMcp.fromRulesyncMcp({
        rulesyncMcp,
      });

      expect(copilotCliMcp.getJson()).toEqual({
        mcpServers: inputMcpServers,
      });
    });
  });

  describe("toRulesyncMcp", () => {
    it("should convert mcpServers key and remove type field", () => {
      const inputMcpServers = {
        filesystem: {
          type: "stdio" as const,
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem", join(testDir, "tmp")],
        },
      };
      const copilotCliMcp = new CopilotcliMcp({
        relativeDirPath: ".copilot",
        relativeFilePath: "mcp-config.json",
        fileContent: JSON.stringify({ mcpServers: inputMcpServers }),
      });

      const rulesyncMcp = copilotCliMcp.toRulesyncMcp();

      expect(rulesyncMcp).toBeInstanceOf(RulesyncMcp);
      // Output should have mcpServers key without type field
      expect(rulesyncMcp.getJson()).toEqual({
        mcpServers: {
          filesystem: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-filesystem", join(testDir, "tmp")],
          },
        },
        $schema: RULESYNC_MCP_SCHEMA_URL,
      });
      expect(rulesyncMcp.getRelativeDirPath()).toBe(RULESYNC_RELATIVE_DIR_PATH);
      expect(rulesyncMcp.getRelativeFilePath()).toBe("mcp.json");
    });

    it("should preserve server data when converting to RulesyncMcp", () => {
      const inputMcpServers = {
        "complex-server": {
          type: "stdio" as const,
          command: "node",
          args: ["complex-server.js", "--port", "3000"],
          env: {
            NODE_ENV: "production",
            DEBUG: "mcp:*",
          },
        },
        "another-server": {
          type: "stdio" as const,
          command: "python",
          args: ["another-server.py"],
        },
      };
      const copilotCliMcp = new CopilotcliMcp({
        baseDir: join(testDir, "test"),
        relativeDirPath: ".copilot",
        relativeFilePath: "mcp-config.json",
        fileContent: JSON.stringify({ mcpServers: inputMcpServers }),
      });

      const rulesyncMcp = copilotCliMcp.toRulesyncMcp();

      expect(rulesyncMcp.getBaseDir()).toBe(join(testDir, "test"));
      expect(rulesyncMcp.getJson()).toEqual({
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
        $schema: RULESYNC_MCP_SCHEMA_URL,
      });
    });

    it("should handle empty mcpServers object when converting", () => {
      const copilotCliMcp = new CopilotcliMcp({
        relativeDirPath: ".copilot",
        relativeFilePath: "mcp-config.json",
        fileContent: JSON.stringify({ mcpServers: {} }),
      });

      const rulesyncMcp = copilotCliMcp.toRulesyncMcp();

      expect(rulesyncMcp.getJson()).toEqual({
        mcpServers: {},
        $schema: RULESYNC_MCP_SCHEMA_URL,
      });
    });

    it("should handle missing mcpServers key", () => {
      const copilotCliMcp = new CopilotcliMcp({
        relativeDirPath: ".copilot",
        relativeFilePath: "mcp-config.json",
        fileContent: JSON.stringify({}),
      });

      const rulesyncMcp = copilotCliMcp.toRulesyncMcp();

      expect(rulesyncMcp.getJson()).toEqual({
        mcpServers: {},
        $schema: RULESYNC_MCP_SCHEMA_URL,
      });
    });

    it("should preserve non-stdio type when converting back to RulesyncMcp", () => {
      const inputMcpServers = {
        "http-server": {
          type: "http" as const,
          command: "node",
          args: ["server.js"],
          url: "http://localhost:3000/mcp",
        },
      };
      const copilotCliMcp = new CopilotcliMcp({
        relativeDirPath: ".copilot",
        relativeFilePath: "mcp-config.json",
        fileContent: JSON.stringify({ mcpServers: inputMcpServers }),
      });

      const rulesyncMcp = copilotCliMcp.toRulesyncMcp();

      expect(rulesyncMcp.getJson()).toEqual({
        mcpServers: {
          "http-server": {
            type: "http",
            command: "node",
            args: ["server.js"],
            url: "http://localhost:3000/mcp",
          },
        },
        $schema: RULESYNC_MCP_SCHEMA_URL,
      });
    });
  });

  describe("validate", () => {
    it("should return successful validation result", () => {
      const jsonData = {
        mcpServers: {
          "test-server": {
            type: "stdio" as const,
            command: "node",
            args: ["server.js"],
          },
        },
      };
      const copilotCliMcp = new CopilotcliMcp({
        relativeDirPath: ".copilot",
        relativeFilePath: "mcp-config.json",
        fileContent: JSON.stringify(jsonData),
        validate: false,
      });

      const result = copilotCliMcp.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });

  describe("isDeletable", () => {
    it("should return true for project mode", () => {
      const copilotCliMcp = new CopilotcliMcp({
        relativeDirPath: ".copilot",
        relativeFilePath: "mcp-config.json",
        fileContent: JSON.stringify({ mcpServers: {} }),
        global: false,
      });

      expect(copilotCliMcp.isDeletable()).toBe(true);
    });

    it("should return false for global mode", () => {
      const copilotCliMcp = new CopilotcliMcp({
        relativeDirPath: ".copilot",
        relativeFilePath: "mcp-config.json",
        fileContent: JSON.stringify({ mcpServers: {} }),
        global: true,
      });

      expect(copilotCliMcp.isDeletable()).toBe(false);
    });
  });

  describe("forDeletion", () => {
    it("should create instance for deletion", () => {
      const copilotCliMcp = CopilotcliMcp.forDeletion({
        baseDir: testDir,
        relativeDirPath: ".copilot",
        relativeFilePath: "mcp-config.json",
      });

      expect(copilotCliMcp).toBeInstanceOf(CopilotcliMcp);
      expect(copilotCliMcp.getFilePath()).toBe(join(testDir, ".copilot/mcp-config.json"));
    });

    it("should create instance for deletion with global mode", () => {
      const copilotCliMcp = CopilotcliMcp.forDeletion({
        baseDir: testDir,
        relativeDirPath: ".copilot",
        relativeFilePath: "mcp-config.json",
        global: true,
      });

      // Verify global mode via isDeletable (returns false for global mode)
      expect(copilotCliMcp.isDeletable()).toBe(false);
    });
  });

  describe("integration", () => {
    it("should handle complete workflow: fromFile -> toRulesyncMcp -> fromRulesyncMcp", async () => {
      const copilotDir = join(testDir, ".copilot");
      await ensureDir(copilotDir);

      const originalServers = {
        "workflow-server": {
          type: "stdio" as const,
          command: "node",
          args: ["workflow-server.js", "--config", "config.json"],
          env: {
            NODE_ENV: "test",
          },
        },
      };
      await writeFileContent(
        join(copilotDir, "mcp-config.json"),
        JSON.stringify({ mcpServers: originalServers }, null, 2),
      );

      // Step 1: Load from file
      const originalCopilotcliMcp = await CopilotcliMcp.fromFile({
        baseDir: testDir,
      });
      expect(originalCopilotcliMcp.getJson()).toEqual({ mcpServers: originalServers });

      // Step 2: Convert to RulesyncMcp (should remove type field)
      const rulesyncMcp = originalCopilotcliMcp.toRulesyncMcp();
      expect(rulesyncMcp.getJson()).toEqual({
        mcpServers: {
          "workflow-server": {
            command: "node",
            args: ["workflow-server.js", "--config", "config.json"],
            env: {
              NODE_ENV: "test",
            },
          },
        },
        $schema: RULESYNC_MCP_SCHEMA_URL,
      });

      // Step 3: Create new CopilotcliMcp from RulesyncMcp (should add type field)
      const newCopilotcliMcp = await CopilotcliMcp.fromRulesyncMcp({
        baseDir: testDir,
        rulesyncMcp,
      });

      // Verify data integrity - type field is restored
      expect(newCopilotcliMcp.getJson()).toEqual({ mcpServers: originalServers });
      expect(newCopilotcliMcp.getFilePath()).toBe(join(testDir, ".copilot/mcp-config.json"));
    });

    it('should preserve unknown fields like "tools" and "url" during conversion', async () => {
      const originalServers = {
        "test-server": {
          command: "node",
          args: ["main.js"],
          tools: ["tool1", "tool2"], // Specific to Copilot CLI or other tools
          url: "http://localhost:8080", // Specific to SSE/HTTP servers
          headers: { "X-Test": "Value" },
          unknown_field: "value",
        },
      };

      const rulesyncMcp = new RulesyncMcp({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_MCP_FILE_NAME,
        fileContent: JSON.stringify({ mcpServers: originalServers }, null, 2),
      });

      const copilotCliMcp = await CopilotcliMcp.fromRulesyncMcp({
        baseDir: testDir,
        rulesyncMcp,
      });

      // Verification: All fields should be preserved, and "type": "stdio" added
      const json = copilotCliMcp.getJson();
      expect(json.mcpServers!["test-server"]).toEqual({
        ...originalServers["test-server"],
        type: "stdio",
      });

      // Round-trip back to RulesyncMcp
      const backToRulesync = copilotCliMcp.toRulesyncMcp();
      const backJson = JSON.parse(backToRulesync.getFileContent());
      expect(backJson.mcpServers["test-server"]).toEqual(originalServers["test-server"]);
    });

    it("should maintain data consistency across transformations", async () => {
      const originalServers = {
        "primary-server": {
          type: "stdio" as const,
          command: "node",
          args: ["primary.js", "--mode", "production"],
          env: {
            NODE_ENV: "production",
            LOG_LEVEL: "info",
          },
        },
        "secondary-server": {
          type: "stdio" as const,
          command: "python",
          args: ["secondary.py", "--workers", "4"],
          env: {
            PYTHONPATH: join(testDir, "app/lib"),
          },
        },
      };

      // Create CopilotcliMcp
      const copilotCliMcp = new CopilotcliMcp({
        baseDir: testDir,
        relativeDirPath: ".copilot",
        relativeFilePath: "mcp-config.json",
        fileContent: JSON.stringify({ mcpServers: originalServers }),
      });

      // Convert to RulesyncMcp
      const rulesyncMcp = copilotCliMcp.toRulesyncMcp();
      // RulesyncMcp should not have type field
      expect(rulesyncMcp.getJson().mcpServers["primary-server"]).not.toHaveProperty("type");

      // Create new CopilotcliMcp from RulesyncMcp (round-trip)
      const roundTrippedMcp = await CopilotcliMcp.fromRulesyncMcp({
        baseDir: testDir,
        rulesyncMcp,
      });

      // Verify data integrity - type field is restored and all data preserved
      expect(roundTrippedMcp.getJson()).toEqual({ mcpServers: originalServers });
    });
  });
});
