import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../utils/file.js";
import { CopilotMcp } from "./copilot-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

describe("CopilotMcp", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
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
        mcpServers: {},
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
        mcpServers: {},
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
        mcpServers: {},
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

  describe("fromFilePath", () => {
    it("should create instance from file with default parameters", async () => {
      const vscodeDir = join(testDir, ".vscode");
      await ensureDir(vscodeDir);

      const jsonData = {
        mcpServers: {
          filesystem: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-filesystem", testDir],
          },
        },
      };
      await writeFileContent(join(vscodeDir, "mcp.json"), JSON.stringify(jsonData, null, 2));

      const copilotMcp = await CopilotMcp.fromFilePath({
        baseDir: testDir,
      });

      expect(copilotMcp).toBeInstanceOf(CopilotMcp);
      expect(copilotMcp.getJson()).toEqual(jsonData);
      expect(copilotMcp.getFilePath()).toBe(join(".", ".vscode/mcp.json"));
    });

    it("should create instance from file with custom baseDir", async () => {
      const customDir = join(testDir, "custom");
      const vscodeDir = join(customDir, ".vscode");
      await ensureDir(vscodeDir);

      const jsonData = {
        mcpServers: {
          git: {
            command: "node",
            args: ["git-server.js"],
          },
        },
      };
      await writeFileContent(join(vscodeDir, "mcp.json"), JSON.stringify(jsonData));

      const copilotMcp = await CopilotMcp.fromFilePath({
        baseDir: customDir,
      });

      expect(copilotMcp.getFilePath()).toBe(join(".", ".vscode/mcp.json"));
      expect(copilotMcp.getJson()).toEqual(jsonData);
    });

    it("should handle validation when validate is true", async () => {
      const vscodeDir = join(testDir, ".vscode");
      await ensureDir(vscodeDir);

      const jsonData = {
        mcpServers: {
          "valid-server": {
            command: "node",
            args: ["server.js"],
          },
        },
      };
      await writeFileContent(join(vscodeDir, "mcp.json"), JSON.stringify(jsonData));

      const copilotMcp = await CopilotMcp.fromFilePath({
        baseDir: testDir,
        validate: true,
      });

      expect(copilotMcp.getJson()).toEqual(jsonData);
    });

    it("should skip validation when validate is false", async () => {
      const vscodeDir = join(testDir, ".vscode");
      await ensureDir(vscodeDir);

      const jsonData = {
        mcpServers: {},
      };
      await writeFileContent(join(vscodeDir, "mcp.json"), JSON.stringify(jsonData));

      const copilotMcp = await CopilotMcp.fromFilePath({
        baseDir: testDir,
        validate: false,
      });

      expect(copilotMcp.getJson()).toEqual(jsonData);
    });

    it("should throw error if file does not exist", async () => {
      await expect(
        CopilotMcp.fromFilePath({
          baseDir: testDir,
        }),
      ).rejects.toThrow();
    });
  });

  describe("fromRulesyncMcp", () => {
    it("should create instance from RulesyncMcp with default parameters", () => {
      const jsonData = {
        mcpServers: {
          "test-server": {
            command: "node",
            args: ["test-server.js"],
          },
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const copilotMcp = CopilotMcp.fromRulesyncMcp({
        rulesyncMcp,
      });

      expect(copilotMcp).toBeInstanceOf(CopilotMcp);
      expect(copilotMcp.getJson()).toEqual(jsonData);
      expect(copilotMcp.getRelativeDirPath()).toBe(".vscode");
      expect(copilotMcp.getRelativeFilePath()).toBe("mcp.json");
    });

    it("should create instance from RulesyncMcp with custom baseDir", () => {
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
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const copilotMcp = CopilotMcp.fromRulesyncMcp({
        baseDir: "/target/dir",
        rulesyncMcp,
      });

      expect(copilotMcp.getFilePath()).toBe("/target/dir/.vscode/mcp.json");
      expect(copilotMcp.getJson()).toEqual(jsonData);
    });

    it("should handle validation when validate is true", () => {
      const jsonData = {
        mcpServers: {
          "validated-server": {
            command: "node",
            args: ["validated-server.js"],
          },
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const copilotMcp = CopilotMcp.fromRulesyncMcp({
        rulesyncMcp,
        validate: true,
      });

      expect(copilotMcp.getJson()).toEqual(jsonData);
    });

    it("should skip validation when validate is false", () => {
      const jsonData = {
        mcpServers: {},
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const copilotMcp = CopilotMcp.fromRulesyncMcp({
        rulesyncMcp,
        validate: false,
      });

      expect(copilotMcp.getJson()).toEqual(jsonData);
    });

    it("should handle empty mcpServers object", () => {
      const jsonData = {
        mcpServers: {},
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const copilotMcp = CopilotMcp.fromRulesyncMcp({
        rulesyncMcp,
      });

      expect(copilotMcp.getJson()).toEqual(jsonData);
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
      const copilotMcp = new CopilotMcp({
        relativeDirPath: ".vscode",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const rulesyncMcp = copilotMcp.toRulesyncMcp();

      expect(rulesyncMcp).toBeInstanceOf(RulesyncMcp);
      expect(rulesyncMcp.getFileContent()).toBe(JSON.stringify(jsonData));
      expect(rulesyncMcp.getRelativeDirPath()).toBe(".rulesync");
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
      const copilotMcp = new CopilotMcp({
        baseDir: "/test/dir",
        relativeDirPath: ".vscode",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const rulesyncMcp = copilotMcp.toRulesyncMcp();

      expect(rulesyncMcp.getBaseDir()).toBe("/test/dir");
      expect(JSON.parse(rulesyncMcp.getFileContent())).toEqual(jsonData);
    });

    it("should handle empty mcpServers object when converting", () => {
      const jsonData = {
        mcpServers: {},
      };
      const copilotMcp = new CopilotMcp({
        relativeDirPath: ".vscode",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const rulesyncMcp = copilotMcp.toRulesyncMcp();

      expect(JSON.parse(rulesyncMcp.getFileContent())).toEqual(jsonData);
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
        mcpServers: {},
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
    it("should handle complete workflow: fromFilePath -> toRulesyncMcp -> fromRulesyncMcp", async () => {
      const vscodeDir = join(testDir, ".vscode");
      await ensureDir(vscodeDir);

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
        join(vscodeDir, "mcp.json"),
        JSON.stringify(originalJsonData, null, 2),
      );

      // Step 1: Load from file
      const originalCopilotMcp = await CopilotMcp.fromFilePath({
        baseDir: testDir,
      });

      // Step 2: Convert to RulesyncMcp
      const rulesyncMcp = originalCopilotMcp.toRulesyncMcp();

      // Step 3: Create new CopilotMcp from RulesyncMcp
      const newCopilotMcp = CopilotMcp.fromRulesyncMcp({
        baseDir: testDir,
        rulesyncMcp,
      });

      // Verify data integrity
      expect(newCopilotMcp.getJson()).toEqual(originalJsonData);
      expect(newCopilotMcp.getFilePath()).toBe(join(testDir, ".vscode/mcp.json"));
    });

    it("should maintain data consistency across transformations", () => {
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

      // Create CopilotMcp
      const copilotMcp = new CopilotMcp({
        baseDir: "/project",
        relativeDirPath: ".vscode",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(complexJsonData),
      });

      // Convert to RulesyncMcp and back
      const rulesyncMcp = copilotMcp.toRulesyncMcp();
      const newCopilotMcp = CopilotMcp.fromRulesyncMcp({
        baseDir: "/project",
        rulesyncMcp,
      });

      // Verify all data is preserved
      expect(newCopilotMcp.getJson()).toEqual(complexJsonData);
      expect(newCopilotMcp.getFilePath()).toBe("/project/.vscode/mcp.json");
    });
  });
});
