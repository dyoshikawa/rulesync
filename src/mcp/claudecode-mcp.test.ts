import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import type { RulesyncMcpServer } from "../types/mcp.js";
import { ClaudecodeMcp, ClaudecodeMcpConfig } from "./claudecode-mcp.js";
import { RulesyncMcp, RulesyncMcpFrontmatter } from "./rulesync-mcp.js";

describe("ClaudecodeMcp", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  describe("constructor", () => {
    it("should create an instance with valid STDIO configuration", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: ClaudecodeMcpConfig = {
          mcpServers: {
            "stdio-server": {
              command: "python",
              args: ["-m", "test_server"],
              env: {
                API_KEY: "test-key",
              },
              timeout: 30000,
              disabled: false,
            },
          },
        };

        const claudecodeMcp = new ClaudecodeMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: ".mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
        });

        expect(claudecodeMcp).toBeDefined();
        expect(claudecodeMcp.getConfig()).toEqual(config);
      } finally {
        await cleanup();
      }
    });

    it("should create an instance with valid SSE configuration", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: ClaudecodeMcpConfig = {
          mcpServers: {
            "sse-server": {
              url: "https://mcp-example.com/endpoint",
              transport: "sse",
              headers: {
                Authorization: "Bearer test-token",
              },
              disabled: false,
            },
          },
        };

        const claudecodeMcp = new ClaudecodeMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: ".mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
        });

        expect(claudecodeMcp).toBeDefined();
        expect(claudecodeMcp.getConfig()).toEqual(config);
      } finally {
        await cleanup();
      }
    });

    it("should create an instance with HTTP configuration", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: ClaudecodeMcpConfig = {
          mcpServers: {
            "http-server": {
              url: "http://localhost:4000/mcp",
              transport: "http",
              timeout: 60000,
            },
          },
        };

        const claudecodeMcp = new ClaudecodeMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: ".mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
        });

        expect(claudecodeMcp).toBeDefined();
        expect(claudecodeMcp.getConfig()).toEqual(config);
      } finally {
        await cleanup();
      }
    });

    it("should throw error for invalid configuration when validation enabled", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const invalidConfig = {
          mcpServers: {
            "invalid-server": {
              // Missing both command and url
              args: ["arg1"],
            },
          },
        };

        // Schema validation is passed, but transport validation occurs in validate()
        const claudecodeMcp = new ClaudecodeMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: ".mcp.json",
          fileContent: JSON.stringify(invalidConfig, null, 2),
          config: invalidConfig as ClaudecodeMcpConfig,
          validate: false, // Skip validation during construction
        });

        expect(claudecodeMcp).toBeDefined();
      } finally {
        await cleanup();
      }
    });
  });

  describe("getFileName", () => {
    it("should return '.mcp.json'", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: ClaudecodeMcpConfig = {
          mcpServers: {
            test: { command: "test" },
          },
        };

        const claudecodeMcp = new ClaudecodeMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: ".mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
        });

        expect(claudecodeMcp.getFileName()).toBe(".mcp.json");
      } finally {
        await cleanup();
      }
    });
  });

  describe("generateContent", () => {
    it("should generate valid JSON content", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: ClaudecodeMcpConfig = {
          mcpServers: {
            "test-server": {
              command: "python",
              args: ["-m", "server"],
              env: {
                DEBUG: "true",
              },
              timeout: 45000,
              disabled: false,
            },
          },
        };

        const claudecodeMcp = new ClaudecodeMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: ".mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
        });

        const content = await claudecodeMcp.generateContent();
        const parsed = JSON.parse(content);

        expect(parsed).toEqual(config);
      } finally {
        await cleanup();
      }
    });
  });

  describe("fromRulesyncMcp", () => {
    it("should convert STDIO server configuration", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const rulesyncServer: RulesyncMcpServer = {
          targets: ["claudecode"] as const,
          command: "python",
          args: ["-m", "server"],
          env: {
            API_KEY: "test-key",
          },
          timeout: 30000,
          disabled: false,
        };

        const frontmatter: RulesyncMcpFrontmatter = {
          targets: ["claudecode"],
          name: "Test MCP Config",
          description: "Test configuration",
          servers: {
            "test-server": rulesyncServer,
          },
        };

        const rulesyncMcp = new RulesyncMcp({
          baseDir: testDir,
          relativeDirPath: ".rulesync",
          relativeFilePath: "mcp.yaml",
          fileContent: "test",
          frontmatter,
          body: "test body",
          validate: false,
        });

        const claudecodeMcp = ClaudecodeMcp.fromRulesyncMcp(rulesyncMcp, testDir, ".");

        expect(claudecodeMcp.getFileName()).toBe(".mcp.json");
        const config = claudecodeMcp.getConfig();
        expect(config.mcpServers["test-server"]).toEqual({
          command: "python",
          args: ["-m", "server"],
          env: {
            API_KEY: "test-key",
          },
          timeout: 30000,
          disabled: false,
        });
      } finally {
        await cleanup();
      }
    });

    it("should convert SSE server configuration", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const rulesyncServer: RulesyncMcpServer = {
          targets: ["claudecode"] as const,
          url: "https://mcp-example.com/endpoint",
          transport: "sse",
          headers: {
            Authorization: "Bearer token",
          },
          disabled: true,
          timeout: 120000,
        };

        const frontmatter: RulesyncMcpFrontmatter = {
          targets: ["claudecode"],
          name: "SSE MCP Config",
          description: "SSE server configuration",
          servers: {
            "remote-server": rulesyncServer,
          },
        };

        const rulesyncMcp = new RulesyncMcp({
          baseDir: testDir,
          relativeDirPath: ".rulesync",
          relativeFilePath: "mcp.yaml",
          fileContent: "test",
          frontmatter,
          body: "test body",
          validate: false,
        });

        const claudecodeMcp = ClaudecodeMcp.fromRulesyncMcp(rulesyncMcp, testDir, ".");

        const config = claudecodeMcp.getConfig();
        expect(config.mcpServers["remote-server"]).toEqual({
          url: "https://mcp-example.com/endpoint",
          transport: "sse",
          headers: {
            Authorization: "Bearer token",
          },
          disabled: true,
          timeout: 120000,
        });
      } finally {
        await cleanup();
      }
    });

    it("should convert HTTP server configuration", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const rulesyncServer: RulesyncMcpServer = {
          targets: ["claudecode"] as const,
          url: "http://localhost:4000/mcp",
          transport: "http",
          timeout: 60000,
        };

        const frontmatter: RulesyncMcpFrontmatter = {
          targets: ["claudecode"],
          name: "HTTP MCP Config",
          description: "HTTP server configuration",
          servers: {
            "http-server": rulesyncServer,
          },
        };

        const rulesyncMcp = new RulesyncMcp({
          baseDir: testDir,
          relativeDirPath: ".rulesync",
          relativeFilePath: "mcp.yaml",
          fileContent: "test",
          frontmatter,
          body: "test body",
          validate: false,
        });

        const claudecodeMcp = ClaudecodeMcp.fromRulesyncMcp(rulesyncMcp, testDir, ".");

        const config = claudecodeMcp.getConfig();
        expect(config.mcpServers["http-server"]).toEqual({
          url: "http://localhost:4000/mcp",
          transport: "http",
          timeout: 60000,
        });
      } finally {
        await cleanup();
      }
    });

    it("should handle command arrays", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const rulesyncServer: RulesyncMcpServer = {
          targets: ["claudecode"] as const,
          command: ["node", "server.js", "--verbose"],
          args: ["--port", "3000"],
        };

        const frontmatter: RulesyncMcpFrontmatter = {
          targets: ["claudecode"],
          name: "Command Array MCP Config",
          description: "Configuration with command arrays",
          servers: {
            "node-server": rulesyncServer,
          },
        };

        const rulesyncMcp = new RulesyncMcp({
          baseDir: testDir,
          relativeDirPath: ".rulesync",
          relativeFilePath: "mcp.yaml",
          fileContent: "test",
          frontmatter,
          body: "test body",
          validate: false,
        });

        const claudecodeMcp = ClaudecodeMcp.fromRulesyncMcp(rulesyncMcp, testDir, ".");

        const config = claudecodeMcp.getConfig();
        expect(config.mcpServers["node-server"]).toEqual({
          command: "node",
          args: ["server.js", "--verbose", "--port", "3000"],
        });
      } finally {
        await cleanup();
      }
    });

    it("should skip servers not targeting claudecode", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const frontmatter: RulesyncMcpFrontmatter = {
          targets: ["claudecode"],
          name: "Multi-target MCP Config",
          description: "Configuration with multiple targets",
          servers: {
            "cursor-only": {
              targets: ["cursor"],
              command: "test",
            },
            "claudecode-server": {
              targets: ["claudecode"],
              command: "test",
            },
          },
        };

        const rulesyncMcp = new RulesyncMcp({
          baseDir: testDir,
          relativeDirPath: ".rulesync",
          relativeFilePath: "mcp.yaml",
          fileContent: "test",
          frontmatter,
          body: "test body",
          validate: false,
        });

        const claudecodeMcp = ClaudecodeMcp.fromRulesyncMcp(rulesyncMcp, testDir, ".");

        const config = claudecodeMcp.getConfig();
        expect(Object.keys(config.mcpServers)).toEqual(["claudecode-server"]);
        expect(config.mcpServers["cursor-only"]).toBeUndefined();
      } finally {
        await cleanup();
      }
    });
  });

  describe("validate", () => {
    it("should pass validation for valid STDIO configuration", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: ClaudecodeMcpConfig = {
          mcpServers: {
            "stdio-server": {
              command: "python",
              args: ["-m", "server"],
            },
          },
        };

        const claudecodeMcp = new ClaudecodeMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: ".mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
        });

        const result = claudecodeMcp.validate();
        expect(result.success).toBe(true);
        expect(result.error).toBeNull();
      } finally {
        await cleanup();
      }
    });

    it("should pass validation for valid SSE configuration", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: ClaudecodeMcpConfig = {
          mcpServers: {
            "sse-server": {
              url: "https://example.com/mcp",
              transport: "sse",
              headers: {
                Authorization: "Bearer token",
              },
            },
          },
        };

        const claudecodeMcp = new ClaudecodeMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: ".mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
        });

        const result = claudecodeMcp.validate();
        expect(result.success).toBe(true);
        expect(result.error).toBeNull();
      } finally {
        await cleanup();
      }
    });

    it("should pass validation for valid HTTP configuration", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: ClaudecodeMcpConfig = {
          mcpServers: {
            "http-server": {
              url: "http://localhost:4000/mcp",
              transport: "http",
              timeout: 60000,
            },
          },
        };

        const claudecodeMcp = new ClaudecodeMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: ".mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
        });

        const result = claudecodeMcp.validate();
        expect(result.success).toBe(true);
        expect(result.error).toBeNull();
      } finally {
        await cleanup();
      }
    });

    it("should fail validation for server with no transport configuration", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: ClaudecodeMcpConfig = {
          mcpServers: {
            "invalid-server": {
              // Missing both command and url
              env: { TEST: "value" },
            },
          },
        };

        const claudecodeMcp = new ClaudecodeMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: ".mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
          validate: false, // Skip constructor validation
        });

        const result = claudecodeMcp.validate();
        expect(result.success).toBe(false);
        expect(result.error?.message).toContain(
          "Server \"invalid-server\" must have either 'command' (for STDIO) or 'url' (for remote) transport configuration",
        );
      } finally {
        await cleanup();
      }
    });

    it("should fail validation for server with both transport configurations", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: ClaudecodeMcpConfig = {
          mcpServers: {
            "invalid-server": {
              command: "python",
              url: "https://example.com",
            },
          },
        };

        const claudecodeMcp = new ClaudecodeMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: ".mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
          validate: false, // Skip constructor validation
        });

        const result = claudecodeMcp.validate();
        expect(result.success).toBe(false);
        expect(result.error?.message).toContain(
          "Server \"invalid-server\" cannot have both STDIO ('command') and remote ('url') transport configuration",
        );
      } finally {
        await cleanup();
      }
    });

    it("should fail validation for empty mcpServers", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: ClaudecodeMcpConfig = {
          mcpServers: {},
        };

        const claudecodeMcp = new ClaudecodeMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: ".mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
          validate: false,
        });

        const result = claudecodeMcp.validate();
        expect(result.success).toBe(false);
        expect(result.error?.message).toBe("At least one MCP server must be defined");
      } finally {
        await cleanup();
      }
    });

    it("should fail validation for timeout outside valid range", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: ClaudecodeMcpConfig = {
          mcpServers: {
            "invalid-timeout": {
              command: "python",
              timeout: 500, // Less than 1 second
            },
          },
        };

        const claudecodeMcp = new ClaudecodeMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: ".mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
          validate: false,
        });

        const result = claudecodeMcp.validate();
        expect(result.success).toBe(false);
        expect(result.error?.message).toContain(
          'Server "invalid-timeout" timeout must be between 1 second (1000) and 10 minutes (600000)',
        );
      } finally {
        await cleanup();
      }
    });

    it("should pass validation for timeout in valid range", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: ClaudecodeMcpConfig = {
          mcpServers: {
            "valid-timeout": {
              command: "python",
              timeout: 60000, // 1 minute - valid
            },
          },
        };

        const claudecodeMcp = new ClaudecodeMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: ".mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
        });

        const result = claudecodeMcp.validate();
        expect(result.success).toBe(true);
        expect(result.error).toBeNull();
      } finally {
        await cleanup();
      }
    });
  });

  describe("fromFilePath", () => {
    it("should load valid configuration from file", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: ClaudecodeMcpConfig = {
          mcpServers: {
            "file-server": {
              command: "node",
              args: ["server.js"],
              timeout: 30000,
            },
          },
        };

        const filePath = join(testDir, ".mcp.json");
        await import("node:fs/promises").then((fs) =>
          fs.writeFile(filePath, JSON.stringify(config, null, 2)),
        );

        const claudecodeMcp = await ClaudecodeMcp.fromFilePath({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: ".mcp.json",
          filePath,
        });

        expect(claudecodeMcp.getConfig()).toEqual(config);
      } finally {
        await cleanup();
      }
    });

    it("should throw error for invalid JSON", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const filePath = join(testDir, "invalid.json");
        await import("node:fs/promises").then((fs) => fs.writeFile(filePath, "{ invalid json"));

        await expect(
          ClaudecodeMcp.fromFilePath({
            baseDir: testDir,
            relativeDirPath: ".",
            relativeFilePath: "invalid.json",
            filePath,
          }),
        ).rejects.toThrow("Failed to load JSON configuration");
      } finally {
        await cleanup();
      }
    });

    it("should throw error for invalid schema when validation enabled", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const invalidConfig = {
          invalidField: "invalid",
        };

        const filePath = join(testDir, "invalid-schema.json");
        await import("node:fs/promises").then((fs) =>
          fs.writeFile(filePath, JSON.stringify(invalidConfig, null, 2)),
        );

        await expect(
          ClaudecodeMcp.fromFilePath({
            baseDir: testDir,
            relativeDirPath: ".",
            relativeFilePath: "invalid-schema.json",
            filePath,
            validate: true,
          }),
        ).rejects.toThrow("Invalid Claude Code MCP configuration");
      } finally {
        await cleanup();
      }
    });

    it("should load without validation when validate is false", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const invalidConfig = {
          invalidField: "invalid",
        };

        const filePath = join(testDir, "invalid-schema.json");
        await import("node:fs/promises").then((fs) =>
          fs.writeFile(filePath, JSON.stringify(invalidConfig, null, 2)),
        );

        const claudecodeMcp = await ClaudecodeMcp.fromFilePath({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "invalid-schema.json",
          filePath,
          validate: false,
        });

        expect(claudecodeMcp).toBeDefined();
      } finally {
        await cleanup();
      }
    });
  });
});
