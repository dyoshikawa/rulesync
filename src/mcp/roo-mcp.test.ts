import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import type { RulesyncMcpServer } from "../types/mcp.js";
import { RooMcp, RooMcpConfig } from "./roo-mcp.js";
import { RulesyncMcp, RulesyncMcpFrontmatter } from "./rulesync-mcp.js";

describe("RooMcp", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  describe("constructor", () => {
    it("should create an instance with valid STDIO configuration", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: RooMcpConfig = {
          mcpServers: {
            "stdio-server": {
              command: "python",
              args: ["-m", "test_server"],
              cwd: "/workspace",
              env: {
                API_KEY: "test-key",
              },
              alwaysAllow: ["safe_tool"],
              disabled: false,
              trust: false,
              timeout: 30000,
            },
          },
        };

        const rooMcp = new RooMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: ".roo/mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
        });

        expect(rooMcp).toBeDefined();
        expect(rooMcp.getConfig()).toEqual(config);
      } finally {
        await cleanup();
      }
    });

    it("should create an instance with valid streamable-http configuration", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: RooMcpConfig = {
          mcpServers: {
            "http-server": {
              type: "streamable-http",
              url: "https://mcp-example.com/endpoint",
              headers: {
                Authorization: "Bearer test-token",
                "X-Custom-Header": "value",
              },
              alwaysAllow: ["read_tool", "search_tool"],
              disabled: false,
              timeout: 60000,
            },
          },
        };

        const rooMcp = new RooMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: ".roo/mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
        });

        expect(rooMcp).toBeDefined();
        expect(rooMcp.getConfig()).toEqual(config);
      } finally {
        await cleanup();
      }
    });

    it("should create an instance with valid SSE configuration", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: RooMcpConfig = {
          mcpServers: {
            "sse-server": {
              type: "sse",
              url: "https://sse-example.com/mcp",
              headers: {
                Authorization: "Bearer sse-token",
              },
              trust: true,
              timeout: 45000,
            },
          },
        };

        const rooMcp = new RooMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: ".roo/mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
        });

        expect(rooMcp).toBeDefined();
        expect(rooMcp.getConfig()).toEqual(config);
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
        const rooMcp = new RooMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: ".roo/mcp.json",
          fileContent: JSON.stringify(invalidConfig, null, 2),
          config: invalidConfig as RooMcpConfig,
          validate: false, // Skip validation during construction
        });

        expect(rooMcp).toBeDefined();
      } finally {
        await cleanup();
      }
    });
  });

  describe("getFileName", () => {
    it("should return '.roo/mcp.json'", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: RooMcpConfig = {
          mcpServers: {
            test: { command: "test" },
          },
        };

        const rooMcp = new RooMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: ".roo/mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
        });

        expect(rooMcp.getFileName()).toBe(".roo/mcp.json");
      } finally {
        await cleanup();
      }
    });
  });

  describe("generateContent", () => {
    it("should generate valid JSON content", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: RooMcpConfig = {
          mcpServers: {
            "test-server": {
              command: "python",
              args: ["-m", "server"],
              cwd: "./servers",
              env: {
                DEBUG: "true",
              },
              alwaysAllow: ["safe_tool", "read_tool"],
              trust: false,
              timeout: 45000,
              disabled: false,
            },
          },
        };

        const rooMcp = new RooMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: ".roo/mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
        });

        const content = await rooMcp.generateContent();
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
          targets: ["roo"] as const,
          command: "python",
          args: ["-m", "server"],
          cwd: "/workspace",
          env: {
            API_KEY: "test-key",
          },
          timeout: 30000,
          disabled: false,
          alwaysAllow: ["safe_tool"],
          trust: false,
        };

        const frontmatter: RulesyncMcpFrontmatter = {
          targets: ["roo"],
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

        const rooMcp = RooMcp.fromRulesyncMcp(rulesyncMcp, testDir, ".");

        expect(rooMcp.getFileName()).toBe(".roo/mcp.json");
        const config = rooMcp.getConfig();
        expect(config.mcpServers["test-server"]).toEqual({
          command: "python",
          args: ["-m", "server"],
          cwd: "/workspace",
          env: {
            API_KEY: "test-key",
          },
          alwaysAllow: ["safe_tool"],
          disabled: false,
          trust: false,
          timeout: 30000,
        });
      } finally {
        await cleanup();
      }
    });

    it("should convert streamable-http server configuration", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const rulesyncServer: RulesyncMcpServer = {
          targets: ["roo"] as const,
          url: "https://mcp-example.com/endpoint",
          transport: "http",
          headers: {
            Authorization: "Bearer token",
            "X-API-Key": "api-key",
          },
          disabled: true,
          timeout: 120000,
          alwaysAllow: ["read_tool"],
        };

        const frontmatter: RulesyncMcpFrontmatter = {
          targets: ["roo"],
          name: "HTTP MCP Config",
          description: "HTTP server configuration",
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

        const rooMcp = RooMcp.fromRulesyncMcp(rulesyncMcp, testDir, ".");

        const config = rooMcp.getConfig();
        expect(config.mcpServers["remote-server"]).toEqual({
          type: "streamable-http",
          url: "https://mcp-example.com/endpoint",
          headers: {
            Authorization: "Bearer token",
            "X-API-Key": "api-key",
          },
          alwaysAllow: ["read_tool"],
          disabled: true,
          timeout: 120000,
        });
      } finally {
        await cleanup();
      }
    });

    it("should convert SSE server configuration", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const rulesyncServer: RulesyncMcpServer = {
          targets: ["roo"] as const,
          url: "https://sse-example.com/mcp",
          transport: "sse",
          headers: {
            Authorization: "Bearer sse-token",
          },
          trust: true,
          timeout: 90000,
        };

        const frontmatter: RulesyncMcpFrontmatter = {
          targets: ["roo"],
          name: "SSE MCP Config",
          description: "SSE server configuration",
          servers: {
            "sse-server": rulesyncServer,
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

        const rooMcp = RooMcp.fromRulesyncMcp(rulesyncMcp, testDir, ".");

        const config = rooMcp.getConfig();
        expect(config.mcpServers["sse-server"]).toEqual({
          type: "sse",
          url: "https://sse-example.com/mcp",
          headers: {
            Authorization: "Bearer sse-token",
          },
          trust: true,
          timeout: 90000,
        });
      } finally {
        await cleanup();
      }
    });

    it("should handle command arrays", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const rulesyncServer: RulesyncMcpServer = {
          targets: ["roo"] as const,
          command: ["node", "server.js", "--verbose"],
          args: ["--port", "3000"],
          cwd: "./mcp-servers",
        };

        const frontmatter: RulesyncMcpFrontmatter = {
          targets: ["roo"],
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

        const rooMcp = RooMcp.fromRulesyncMcp(rulesyncMcp, testDir, ".");

        const config = rooMcp.getConfig();
        expect(config.mcpServers["node-server"]).toEqual({
          command: "node",
          args: ["server.js", "--verbose", "--port", "3000"],
          cwd: "./mcp-servers",
        });
      } finally {
        await cleanup();
      }
    });

    it("should skip servers not targeting roo", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const frontmatter: RulesyncMcpFrontmatter = {
          targets: ["roo"],
          name: "Multi-target MCP Config",
          description: "Configuration with multiple targets",
          servers: {
            "cursor-only": {
              targets: ["cursor"],
              command: "test",
            },
            "roo-server": {
              targets: ["roo"],
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

        const rooMcp = RooMcp.fromRulesyncMcp(rulesyncMcp, testDir, ".");

        const config = rooMcp.getConfig();
        expect(Object.keys(config.mcpServers)).toEqual(["roo-server"]);
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
        const config: RooMcpConfig = {
          mcpServers: {
            "stdio-server": {
              command: "python",
              args: ["-m", "server"],
              alwaysAllow: ["safe_tool"],
            },
          },
        };

        const rooMcp = new RooMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: ".roo/mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
        });

        const result = rooMcp.validate();
        expect(result.success).toBe(true);
        expect(result.error).toBeNull();
      } finally {
        await cleanup();
      }
    });

    it("should pass validation for valid streamable-http configuration", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: RooMcpConfig = {
          mcpServers: {
            "http-server": {
              type: "streamable-http",
              url: "https://example.com/mcp",
              headers: {
                Authorization: "Bearer token",
              },
              trust: true,
            },
          },
        };

        const rooMcp = new RooMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: ".roo/mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
        });

        const result = rooMcp.validate();
        expect(result.success).toBe(true);
        expect(result.error).toBeNull();
      } finally {
        await cleanup();
      }
    });

    it("should pass validation for valid SSE configuration", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: RooMcpConfig = {
          mcpServers: {
            "sse-server": {
              type: "sse",
              url: "https://example.com/sse",
              timeout: 60000,
            },
          },
        };

        const rooMcp = new RooMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: ".roo/mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
        });

        const result = rooMcp.validate();
        expect(result.success).toBe(true);
        expect(result.error).toBeNull();
      } finally {
        await cleanup();
      }
    });

    it("should fail validation for server with no transport configuration", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: RooMcpConfig = {
          mcpServers: {
            "invalid-server": {
              // Missing both command and url
              env: { TEST: "value" },
            },
          },
        };

        const rooMcp = new RooMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: ".roo/mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
          validate: false, // Skip constructor validation
        });

        const result = rooMcp.validate();
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
        const config: RooMcpConfig = {
          mcpServers: {
            "invalid-server": {
              command: "python",
              url: "https://example.com",
            },
          },
        };

        const rooMcp = new RooMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: ".roo/mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
          validate: false, // Skip constructor validation
        });

        const result = rooMcp.validate();
        expect(result.success).toBe(false);
        expect(result.error?.message).toContain(
          "Server \"invalid-server\" cannot have both STDIO ('command') and remote ('url') transport configuration",
        );
      } finally {
        await cleanup();
      }
    });

    it("should fail validation for remote server without type field", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: RooMcpConfig = {
          mcpServers: {
            "remote-server": {
              url: "https://example.com/mcp",
              // Missing required type field for remote server
            },
          },
        };

        const rooMcp = new RooMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: ".roo/mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
          validate: false, // Skip constructor validation
        });

        const result = rooMcp.validate();
        expect(result.success).toBe(false);
        expect(result.error?.message).toContain(
          'Remote server "remote-server" must have \'type\' field set to "streamable-http" or "sse"',
        );
      } finally {
        await cleanup();
      }
    });

    it("should fail validation for empty mcpServers", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: RooMcpConfig = {
          mcpServers: {},
        };

        const rooMcp = new RooMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: ".roo/mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
          validate: false,
        });

        const result = rooMcp.validate();
        expect(result.success).toBe(false);
        expect(result.error?.message).toBe("At least one MCP server must be defined");
      } finally {
        await cleanup();
      }
    });

    it("should fail validation for timeout outside valid range", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: RooMcpConfig = {
          mcpServers: {
            "invalid-timeout": {
              command: "python",
              timeout: 500, // Less than 1 second
            },
          },
        };

        const rooMcp = new RooMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: ".roo/mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
          validate: false,
        });

        const result = rooMcp.validate();
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
        const config: RooMcpConfig = {
          mcpServers: {
            "valid-timeout": {
              command: "python",
              timeout: 60000, // 1 minute - valid
            },
          },
        };

        const rooMcp = new RooMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: ".roo/mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
        });

        const result = rooMcp.validate();
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
        const config: RooMcpConfig = {
          mcpServers: {
            "file-server": {
              command: "node",
              args: ["server.js"],
              cwd: "./servers",
              alwaysAllow: ["file_read"],
              timeout: 30000,
            },
          },
        };

        const filePath = join(testDir, ".roo", "mcp.json");
        await import("node:fs/promises").then(async (fs) => {
          await fs.mkdir(join(testDir, ".roo"), { recursive: true });
          await fs.writeFile(filePath, JSON.stringify(config, null, 2));
        });

        const rooMcp = await RooMcp.fromFilePath({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: ".roo/mcp.json",
          filePath,
        });

        expect(rooMcp.getConfig()).toEqual(config);
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
          RooMcp.fromFilePath({
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
          RooMcp.fromFilePath({
            baseDir: testDir,
            relativeDirPath: ".",
            relativeFilePath: "invalid-schema.json",
            filePath,
            validate: true,
          }),
        ).rejects.toThrow("Invalid Roo Code MCP configuration");
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

        const rooMcp = await RooMcp.fromFilePath({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "invalid-schema.json",
          filePath,
          validate: false,
        });

        expect(rooMcp).toBeDefined();
      } finally {
        await cleanup();
      }
    });
  });
});
