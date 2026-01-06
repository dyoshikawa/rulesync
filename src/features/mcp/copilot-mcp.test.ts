import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { CopilotMcp } from "./copilot-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

describe("CopilotMcp", () => {
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
        servers: {
          "@anthropic-ai/mcp-server-filesystem": {
            command: "npx",
            args: ["-y", "@anthropic-ai/mcp-server-filesystem", "/workspace"],
          },
        },
      });

      const copilotMcp = new CopilotMcp({
        relativeDirPath: ".vscode",
        relativeFilePath: "mcp.json",
        fileContent: validJsonContent,
      });

      expect(copilotMcp).toBeInstanceOf(CopilotMcp);
      expect(copilotMcp.getRelativeDirPath()).toBe(".vscode");
      expect(copilotMcp.getRelativeFilePath()).toBe("mcp.json");
      expect(copilotMcp.getFileContent()).toBe(validJsonContent);
    });

    it("should create instance with custom baseDir", () => {
      const validJsonContent = JSON.stringify({
        servers: {},
      });

      const copilotMcp = new CopilotMcp({
        baseDir: "/custom/path",
        relativeDirPath: ".vscode",
        relativeFilePath: "mcp.json",
        fileContent: validJsonContent,
      });

      expect(copilotMcp.getFilePath()).toBe("/custom/path/.vscode/mcp.json");
    });

    it("should parse JSON content correctly", () => {
      const jsonData = {
        servers: {
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

      const copilotMcp = new CopilotMcp({
        relativeDirPath: ".vscode",
        relativeFilePath: "mcp.json",
        fileContent: validJsonContent,
      });

      expect(copilotMcp.getJson()).toEqual(jsonData);
    });

    it("should handle empty JSON object", () => {
      const emptyJsonContent = JSON.stringify({});

      const copilotMcp = new CopilotMcp({
        relativeDirPath: ".vscode",
        relativeFilePath: "mcp.json",
        fileContent: emptyJsonContent,
      });

      expect(copilotMcp.getJson()).toEqual({});
    });

    it("should validate content by default", () => {
      const validJsonContent = JSON.stringify({
        servers: {},
      });

      expect(() => {
        const _instance = new CopilotMcp({
          relativeDirPath: ".vscode",
          relativeFilePath: "mcp.json",
          fileContent: validJsonContent,
        });
      }).not.toThrow();
    });

    it("should skip validation when validate is false", () => {
      const validJsonContent = JSON.stringify({
        servers: {},
      });

      expect(() => {
        const _instance = new CopilotMcp({
          relativeDirPath: ".vscode",
          relativeFilePath: "mcp.json",
          fileContent: validJsonContent,
          validate: false,
        });
      }).not.toThrow();
    });

    it("should throw error for invalid JSON content", () => {
      const invalidJsonContent = "{ invalid json }";

      expect(() => {
        const _instance = new CopilotMcp({
          relativeDirPath: ".vscode",
          relativeFilePath: "mcp.json",
          fileContent: invalidJsonContent,
        });
      }).toThrow();
    });
  });

  describe("fromFile", () => {
    it("should create instance from file with default parameters", async () => {
      const vscodeDir = join(testDir, ".vscode");
      await ensureDir(vscodeDir);

      const jsonData = {
        servers: {
          filesystem: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-filesystem", testDir],
          },
        },
      };
      await writeFileContent(join(vscodeDir, "mcp.json"), JSON.stringify(jsonData, null, 2));

      const copilotMcp = await CopilotMcp.fromFile({
        baseDir: testDir,
      });

      expect(copilotMcp).toBeInstanceOf(CopilotMcp);
      expect(copilotMcp.getJson()).toEqual(jsonData);
      expect(copilotMcp.getFilePath()).toBe(join(testDir, ".vscode/mcp.json"));
    });

    it("should create instance from file with custom baseDir", async () => {
      const customDir = join(testDir, "custom");
      const vscodeDir = join(customDir, ".vscode");
      await ensureDir(vscodeDir);

      const jsonData = {
        servers: {
          git: {
            command: "node",
            args: ["git-server.js"],
          },
        },
      };
      await writeFileContent(join(vscodeDir, "mcp.json"), JSON.stringify(jsonData));

      const copilotMcp = await CopilotMcp.fromFile({
        baseDir: customDir,
      });

      expect(copilotMcp.getFilePath()).toBe(join(customDir, ".vscode/mcp.json"));
      expect(copilotMcp.getJson()).toEqual(jsonData);
    });

    it("should handle validation when validate is true", async () => {
      const vscodeDir = join(testDir, ".vscode");
      await ensureDir(vscodeDir);

      const jsonData = {
        servers: {
          "valid-server": {
            command: "node",
            args: ["server.js"],
          },
        },
      };
      await writeFileContent(join(vscodeDir, "mcp.json"), JSON.stringify(jsonData));

      const copilotMcp = await CopilotMcp.fromFile({
        baseDir: testDir,
        validate: true,
      });

      expect(copilotMcp.getJson()).toEqual(jsonData);
    });

    it("should skip validation when validate is false", async () => {
      const vscodeDir = join(testDir, ".vscode");
      await ensureDir(vscodeDir);

      const jsonData = {
        servers: {},
      };
      await writeFileContent(join(vscodeDir, "mcp.json"), JSON.stringify(jsonData));

      const copilotMcp = await CopilotMcp.fromFile({
        baseDir: testDir,
        validate: false,
      });

      expect(copilotMcp.getJson()).toEqual(jsonData);
    });

    it("should throw error if file does not exist", async () => {
      await expect(
        CopilotMcp.fromFile({
          baseDir: testDir,
        }),
      ).rejects.toThrow();
    });
  });

  describe("fromRulesyncMcp", () => {
    it("should convert mcpServers key to servers key", () => {
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

      const copilotMcp = CopilotMcp.fromRulesyncMcp({
        rulesyncMcp,
      });

      expect(copilotMcp).toBeInstanceOf(CopilotMcp);
      // Output should have servers key, not mcpServers
      expect(copilotMcp.getJson()).toEqual({ servers: inputMcpServers });
      expect(copilotMcp.getJson()).not.toHaveProperty("mcpServers");
      expect(copilotMcp.getRelativeDirPath()).toBe(".vscode");
      expect(copilotMcp.getRelativeFilePath()).toBe("mcp.json");
    });

    it("should create instance from RulesyncMcp with custom baseDir", () => {
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
        baseDir: "/custom/base",
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ mcpServers: inputMcpServers }),
      });

      const copilotMcp = CopilotMcp.fromRulesyncMcp({
        baseDir: "/target/dir",
        rulesyncMcp,
      });

      expect(copilotMcp.getFilePath()).toBe("/target/dir/.vscode/mcp.json");
      // Output should have servers key
      expect(copilotMcp.getJson()).toEqual({ servers: inputMcpServers });
    });

    it("should handle validation when validate is true", () => {
      const inputMcpServers = {
        "validated-server": {
          command: "node",
          args: ["validated-server.js"],
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ mcpServers: inputMcpServers }),
      });

      const copilotMcp = CopilotMcp.fromRulesyncMcp({
        rulesyncMcp,
        validate: true,
      });

      expect(copilotMcp.getJson()).toEqual({ servers: inputMcpServers });
    });

    it("should skip validation when validate is false", () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ mcpServers: {} }),
      });

      const copilotMcp = CopilotMcp.fromRulesyncMcp({
        rulesyncMcp,
        validate: false,
      });

      expect(copilotMcp.getJson()).toEqual({ servers: {} });
    });

    it("should handle empty mcpServers object", () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ mcpServers: {} }),
      });

      const copilotMcp = CopilotMcp.fromRulesyncMcp({
        rulesyncMcp,
      });

      expect(copilotMcp.getJson()).toEqual({ servers: {} });
    });
  });

  describe("toRulesyncMcp", () => {
    it("should convert servers key to mcpServers key", () => {
      const inputServers = {
        filesystem: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
        },
      };
      const copilotMcp = new CopilotMcp({
        relativeDirPath: ".vscode",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ servers: inputServers }),
      });

      const rulesyncMcp = copilotMcp.toRulesyncMcp();

      expect(rulesyncMcp).toBeInstanceOf(RulesyncMcp);
      // Output should have mcpServers key, not servers
      expect(rulesyncMcp.getJson()).toEqual({ mcpServers: inputServers });
      expect(rulesyncMcp.getRelativeDirPath()).toBe(RULESYNC_RELATIVE_DIR_PATH);
      expect(rulesyncMcp.getRelativeFilePath()).toBe(".mcp.json");
    });

    it("should preserve server data when converting to RulesyncMcp", () => {
      const inputServers = {
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
      };
      const copilotMcp = new CopilotMcp({
        baseDir: "/test/dir",
        relativeDirPath: ".vscode",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ servers: inputServers }),
      });

      const rulesyncMcp = copilotMcp.toRulesyncMcp({ outputBaseDir: "/test/dir" });

      expect(rulesyncMcp.getBaseDir()).toBe("/test/dir");
      expect(rulesyncMcp.getJson()).toEqual({ mcpServers: inputServers });
    });

    it("should handle empty servers object when converting", () => {
      const copilotMcp = new CopilotMcp({
        relativeDirPath: ".vscode",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ servers: {} }),
      });

      const rulesyncMcp = copilotMcp.toRulesyncMcp();

      expect(rulesyncMcp.getJson()).toEqual({ mcpServers: {} });
    });

    it("should handle missing servers key", () => {
      const copilotMcp = new CopilotMcp({
        relativeDirPath: ".vscode",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({}),
      });

      const rulesyncMcp = copilotMcp.toRulesyncMcp();

      expect(rulesyncMcp.getJson()).toEqual({ mcpServers: {} });
    });
  });

  describe("validate", () => {
    it("should return successful validation result", () => {
      const jsonData = {
        servers: {
          "test-server": {
            command: "node",
            args: ["server.js"],
          },
        },
      };
      const copilotMcp = new CopilotMcp({
        relativeDirPath: ".vscode",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(jsonData),
        validate: false, // Skip validation in constructor to test method directly
      });

      const result = copilotMcp.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should always return success (no validation logic implemented)", () => {
      const jsonData = {
        servers: {},
      };
      const copilotMcp = new CopilotMcp({
        relativeDirPath: ".vscode",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(jsonData),
        validate: false,
      });

      const result = copilotMcp.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return success for complex MCP configuration", () => {
      const jsonData = {
        servers: {
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
      const copilotMcp = new CopilotMcp({
        relativeDirPath: ".vscode",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(jsonData),
        validate: false,
      });

      const result = copilotMcp.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });

  describe("integration", () => {
    it("should handle complete workflow: fromFile -> toRulesyncMcp -> fromRulesyncMcp", async () => {
      const vscodeDir = join(testDir, ".vscode");
      await ensureDir(vscodeDir);

      const originalServers = {
        "workflow-server": {
          command: "node",
          args: ["workflow-server.js", "--config", "config.json"],
          env: {
            NODE_ENV: "test",
          },
        },
      };
      await writeFileContent(
        join(vscodeDir, "mcp.json"),
        JSON.stringify({ servers: originalServers }, null, 2),
      );

      // Step 1: Load from file (has servers key)
      const originalCopilotMcp = await CopilotMcp.fromFile({
        baseDir: testDir,
      });
      expect(originalCopilotMcp.getJson()).toEqual({ servers: originalServers });

      // Step 2: Convert to RulesyncMcp (should have mcpServers key)
      const rulesyncMcp = originalCopilotMcp.toRulesyncMcp();
      expect(rulesyncMcp.getJson()).toEqual({ mcpServers: originalServers });

      // Step 3: Create new CopilotMcp from RulesyncMcp (should have servers key again)
      const newCopilotMcp = CopilotMcp.fromRulesyncMcp({
        baseDir: testDir,
        rulesyncMcp,
      });

      // Verify data integrity - servers key is preserved through round-trip
      expect(newCopilotMcp.getJson()).toEqual({ servers: originalServers });
      expect(newCopilotMcp.getFilePath()).toBe(join(testDir, ".vscode/mcp.json"));
    });

    it("should maintain data consistency across transformations", () => {
      const originalServers = {
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
      };

      // Create CopilotMcp with servers key
      const copilotMcp = new CopilotMcp({
        baseDir: "/project",
        relativeDirPath: ".vscode",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ servers: originalServers }),
      });

      // Convert to RulesyncMcp and back
      const rulesyncMcp = copilotMcp.toRulesyncMcp();
      // RulesyncMcp should have mcpServers key
      expect(rulesyncMcp.getJson()).toEqual({ mcpServers: originalServers });

      const newCopilotMcp = CopilotMcp.fromRulesyncMcp({
        baseDir: "/project",
        rulesyncMcp,
      });

      // Verify all data is preserved with servers key
      expect(newCopilotMcp.getJson()).toEqual({ servers: originalServers });
      expect(newCopilotMcp.getFilePath()).toBe("/project/.vscode/mcp.json");
    });
  });
});
