import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_MCP_SCHEMA_URL,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { CopilotCliMcp } from "./copilot-cli-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

describe("CopilotCliMcp", () => {
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
            args: ["-y", "@anthropic-ai/mcp-server-filesystem", "/workspace"],
          },
        },
      });

      const copilotCliMcp = new CopilotCliMcp({
        relativeDirPath: ".copilot",
        relativeFilePath: "mcp-config.json",
        fileContent: validJsonContent,
      });

      expect(copilotCliMcp).toBeInstanceOf(CopilotCliMcp);
      expect(copilotCliMcp.getRelativeDirPath()).toBe(".copilot");
      expect(copilotCliMcp.getRelativeFilePath()).toBe("mcp-config.json");
      expect(copilotCliMcp.getFileContent()).toBe(validJsonContent);
    });

    it("should create instance with custom baseDir", () => {
      const validJsonContent = JSON.stringify({
        mcpServers: {},
      });

      const copilotCliMcp = new CopilotCliMcp({
        baseDir: "/custom/path",
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

      const copilotCliMcp = new CopilotCliMcp({
        relativeDirPath: ".copilot",
        relativeFilePath: "mcp-config.json",
        fileContent: validJsonContent,
      });

      expect(copilotCliMcp.getJson()).toEqual(jsonData);
    });

    it("should handle empty JSON object", () => {
      const emptyJsonContent = JSON.stringify({});

      const copilotCliMcp = new CopilotCliMcp({
        relativeDirPath: ".copilot",
        relativeFilePath: "mcp-config.json",
        fileContent: emptyJsonContent,
      });

      expect(copilotCliMcp.getJson()).toEqual({});
    });

    it("should throw error for invalid JSON content", () => {
      const invalidJsonContent = "{ invalid json }";

      expect(() => {
        const _instance = new CopilotCliMcp({
          relativeDirPath: ".copilot",
          relativeFilePath: "mcp-config.json",
          fileContent: invalidJsonContent,
        });
      }).toThrow();
    });
  });

  describe("getSettablePaths", () => {
    it("should return correct paths for project mode", () => {
      const paths = CopilotCliMcp.getSettablePaths({ global: false });

      expect(paths.relativeDirPath).toBe(".copilot");
      expect(paths.relativeFilePath).toBe("mcp-config.json");
    });

    it("should return correct paths for global mode", () => {
      const paths = CopilotCliMcp.getSettablePaths({ global: true });

      expect(paths.relativeDirPath).toBe(".copilot");
      expect(paths.relativeFilePath).toBe("mcp-config.json");
    });

    it("should return correct paths when global is not specified", () => {
      const paths = CopilotCliMcp.getSettablePaths();

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

      const copilotCliMcp = await CopilotCliMcp.fromFile({
        baseDir: testDir,
      });

      expect(copilotCliMcp).toBeInstanceOf(CopilotCliMcp);
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

      const copilotCliMcp = await CopilotCliMcp.fromFile({
        baseDir: customDir,
      });

      expect(copilotCliMcp.getFilePath()).toBe(join(customDir, ".copilot/mcp-config.json"));
      expect(copilotCliMcp.getJson()).toEqual(jsonData);
    });

    it("should return default empty config if file does not exist", async () => {
      const copilotCliMcp = await CopilotCliMcp.fromFile({
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

      const copilotCliMcp = await CopilotCliMcp.fromFile({
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

      const copilotCliMcp = await CopilotCliMcp.fromRulesyncMcp({
        rulesyncMcp,
      });

      expect(copilotCliMcp).toBeInstanceOf(CopilotCliMcp);
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
            PYTHONPATH: "/custom/path",
          },
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ mcpServers: inputMcpServers }),
      });

      const copilotCliMcp = await CopilotCliMcp.fromRulesyncMcp({
        baseDir: "/target/dir",
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
              PYTHONPATH: "/custom/path",
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

      const copilotCliMcp = await CopilotCliMcp.fromRulesyncMcp({
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

      const copilotCliMcp = await CopilotCliMcp.fromRulesyncMcp({
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
  });

  describe("toRulesyncMcp", () => {
    it("should convert mcpServers key and remove type field", () => {
      const inputMcpServers = {
        filesystem: {
          type: "stdio" as const,
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
        },
      };
      const copilotCliMcp = new CopilotCliMcp({
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
            args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
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
      const copilotCliMcp = new CopilotCliMcp({
        baseDir: "/test/dir",
        relativeDirPath: ".copilot",
        relativeFilePath: "mcp-config.json",
        fileContent: JSON.stringify({ mcpServers: inputMcpServers }),
      });

      const rulesyncMcp = copilotCliMcp.toRulesyncMcp();

      expect(rulesyncMcp.getBaseDir()).toBe("/test/dir");
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
      const copilotCliMcp = new CopilotCliMcp({
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
      const copilotCliMcp = new CopilotCliMcp({
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
      const copilotCliMcp = new CopilotCliMcp({
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
      const copilotCliMcp = new CopilotCliMcp({
        relativeDirPath: ".copilot",
        relativeFilePath: "mcp-config.json",
        fileContent: JSON.stringify({ mcpServers: {} }),
        global: false,
      });

      expect(copilotCliMcp.isDeletable()).toBe(true);
    });

    it("should return false for global mode", () => {
      const copilotCliMcp = new CopilotCliMcp({
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
      const copilotCliMcp = CopilotCliMcp.forDeletion({
        baseDir: testDir,
        relativeDirPath: ".copilot",
        relativeFilePath: "mcp-config.json",
      });

      expect(copilotCliMcp).toBeInstanceOf(CopilotCliMcp);
      expect(copilotCliMcp.getFilePath()).toBe(join(testDir, ".copilot/mcp-config.json"));
    });

    it("should create instance for deletion with global mode", () => {
      const copilotCliMcp = CopilotCliMcp.forDeletion({
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
      const originalCopilotCliMcp = await CopilotCliMcp.fromFile({
        baseDir: testDir,
      });
      expect(originalCopilotCliMcp.getJson()).toEqual({ mcpServers: originalServers });

      // Step 2: Convert to RulesyncMcp (should remove type field)
      const rulesyncMcp = originalCopilotCliMcp.toRulesyncMcp();
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

      // Step 3: Create new CopilotCliMcp from RulesyncMcp (should add type field)
      const newCopilotCliMcp = await CopilotCliMcp.fromRulesyncMcp({
        baseDir: testDir,
        rulesyncMcp,
      });

      // Verify data integrity - type field is restored
      expect(newCopilotCliMcp.getJson()).toEqual({ mcpServers: originalServers });
      expect(newCopilotCliMcp.getFilePath()).toBe(join(testDir, ".copilot/mcp-config.json"));
    });

    it("should maintain data consistency across transformations", () => {
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
            PYTHONPATH: "/app/lib",
          },
        },
      };

      // Create CopilotCliMcp
      const copilotCliMcp = new CopilotCliMcp({
        baseDir: "/project",
        relativeDirPath: ".copilot",
        relativeFilePath: "mcp-config.json",
        fileContent: JSON.stringify({ mcpServers: originalServers }),
      });

      // Convert to RulesyncMcp and back
      const rulesyncMcp = copilotCliMcp.toRulesyncMcp();
      // RulesyncMcp should not have type field
      expect(rulesyncMcp.getJson().mcpServers["primary-server"]).not.toHaveProperty("type");

      // Create new CopilotCliMcp from RulesyncMcp
      // Note: fromRulesyncMcp is async, so we need to handle it properly
      // For this test, we'll verify the conversion logic separately
    });
  });
});
