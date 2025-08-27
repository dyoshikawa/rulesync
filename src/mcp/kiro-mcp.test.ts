import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import type { RulesyncMcpServer } from "../types/mcp.js";
import { KiroMcp, KiroMcpConfig } from "./kiro-mcp.js";
import { RulesyncMcp, RulesyncMcpFrontmatter } from "./rulesync-mcp.js";

describe("KiroMcp", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  describe("constructor", () => {
    it("should create an instance with valid STDIO configuration", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: KiroMcpConfig = {
          mcpServers: {
            "stdio-server": {
              command: "python",
              args: ["-m", "aws_mcp_server"],
              env: {
                AWS_PROFILE: "dev",
                AWS_REGION: "us-east-1",
              },
              timeout: 30000,
              disabled: false,
              autoApprove: ["describe_instances", "list_buckets"],
            },
          },
        };

        const kiroMcp = new KiroMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: ".kiro/mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
        });

        expect(kiroMcp).toBeDefined();
        expect(kiroMcp.getConfig()).toEqual(config);
      } finally {
        await cleanup();
      }
    });

    it("should create an instance with valid SSE configuration", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: KiroMcpConfig = {
          mcpServers: {
            "sse-server": {
              url: "https://inventory.example.com/mcp",
              transport: "sse",
              timeout: 120000,
              disabled: false,
            },
          },
        };

        const kiroMcp = new KiroMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: ".kiro/mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
        });

        expect(kiroMcp).toBeDefined();
        expect(kiroMcp.getConfig()).toEqual(config);
      } finally {
        await cleanup();
      }
    });

    it("should create an instance with streamable-http configuration", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: KiroMcpConfig = {
          mcpServers: {
            "http-server": {
              url: "http://localhost:4000/mcp",
              transport: "streamable-http",
              timeout: 60000,
            },
          },
        };

        const kiroMcp = new KiroMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: ".kiro/mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
        });

        expect(kiroMcp).toBeDefined();
        expect(kiroMcp.getConfig()).toEqual(config);
      } finally {
        await cleanup();
      }
    });

    it("should create an instance with AWS integration configuration", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: KiroMcpConfig = {
          mcpServers: {
            "aws-tools": {
              command: "python",
              args: ["-m", "aws_mcp_server"],
              env: {
                AWS_PROFILE: "dev",
                AWS_REGION: "us-east-1",
                AWS_SDK_LOAD_CONFIG: "1",
              },
              timeout: 180000,
              autoApprove: ["describe_instances", "list_buckets"],
              autoBlock: ["delete_bucket", "terminate_instances"],
            },
          },
        };

        const kiroMcp = new KiroMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: ".kiro/mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
        });

        expect(kiroMcp).toBeDefined();
        expect(kiroMcp.getConfig()).toEqual(config);
      } finally {
        await cleanup();
      }
    });

    it("should support alternative spelling for autoApprove/autoBlock", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: KiroMcpConfig = {
          mcpServers: {
            "alt-spelling-server": {
              command: "uvx",
              args: ["awslabs.aws-documentation-mcp-server@latest"],
              env: {
                FASTMCP_LOG_LEVEL: "ERROR",
              },
              autoapprove: ["search_documentation", "list_services"],
              autoblock: ["delete_resource"],
            },
          },
        };

        const kiroMcp = new KiroMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: ".kiro/mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
        });

        expect(kiroMcp).toBeDefined();
        expect(kiroMcp.getConfig()).toEqual(config);
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
        const kiroMcp = new KiroMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: ".kiro/mcp.json",
          fileContent: JSON.stringify(invalidConfig, null, 2),
          config: invalidConfig as KiroMcpConfig,
          validate: false, // Skip validation during construction
        });

        expect(kiroMcp).toBeDefined();
      } finally {
        await cleanup();
      }
    });
  });

  describe("getFileName", () => {
    it("should return '.kiro/mcp.json'", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: KiroMcpConfig = {
          mcpServers: {
            test: { command: "test" },
          },
        };

        const kiroMcp = new KiroMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: ".kiro/mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
        });

        expect(kiroMcp.getFileName()).toBe(".kiro/mcp.json");
      } finally {
        await cleanup();
      }
    });
  });

  describe("generateContent", () => {
    it("should generate valid JSON content", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: KiroMcpConfig = {
          mcpServers: {
            "test-server": {
              command: "python",
              args: ["-m", "server"],
              env: {
                AWS_PROFILE: "development",
                DEBUG: "true",
              },
              timeout: 45000,
              disabled: false,
              autoApprove: ["safe_tool"],
            },
          },
        };

        const kiroMcp = new KiroMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: ".kiro/mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
        });

        const content = await kiroMcp.generateContent();
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
          targets: ["kiro"] as const,
          command: "python",
          args: ["-m", "aws_server"],
          env: {
            AWS_PROFILE: "dev",
            AWS_REGION: "us-east-1",
          },
          timeout: 30000,
          disabled: false,
          autoApprove: ["describe_instances"],
        };

        const frontmatter: RulesyncMcpFrontmatter = {
          targets: ["kiro"],
          name: "Test Kiro MCP Config",
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

        const kiroMcp = KiroMcp.fromRulesyncMcp(rulesyncMcp, testDir, ".");

        expect(kiroMcp.getFileName()).toBe(".kiro/mcp.json");
        const config = kiroMcp.getConfig();
        expect(config.mcpServers["test-server"]).toEqual({
          command: "python",
          args: ["-m", "aws_server"],
          env: {
            AWS_PROFILE: "dev",
            AWS_REGION: "us-east-1",
          },
          timeout: 30000,
          disabled: false,
          autoApprove: ["describe_instances"],
        });
      } finally {
        await cleanup();
      }
    });

    it("should convert SSE server configuration", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const rulesyncServer: RulesyncMcpServer = {
          targets: ["kiro"] as const,
          url: "https://inventory.example.com/mcp",
          transport: "sse",
          timeout: 120000,
          disabled: true,
          autoBlock: ["dangerous_operation"],
        };

        const frontmatter: RulesyncMcpFrontmatter = {
          targets: ["kiro"],
          name: "SSE Kiro MCP Config",
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

        const kiroMcp = KiroMcp.fromRulesyncMcp(rulesyncMcp, testDir, ".");

        const config = kiroMcp.getConfig();
        expect(config.mcpServers["remote-server"]).toEqual({
          url: "https://inventory.example.com/mcp",
          transport: "sse",
          timeout: 120000,
          disabled: true,
          autoBlock: ["dangerous_operation"],
        });
      } finally {
        await cleanup();
      }
    });

    it("should convert streamable-http server configuration", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const rulesyncServer: RulesyncMcpServer = {
          targets: ["kiro"] as const,
          url: "http://localhost:4000/mcp",
          // eslint-disable-next-line no-type-assertion/no-type-assertion
          transport: "streamable-http" as any,
          timeout: 60000,
        };

        const frontmatter: RulesyncMcpFrontmatter = {
          targets: ["kiro"],
          name: "HTTP Kiro MCP Config",
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

        const kiroMcp = KiroMcp.fromRulesyncMcp(rulesyncMcp, testDir, ".");

        const config = kiroMcp.getConfig();
        expect(config.mcpServers["http-server"]).toEqual({
          url: "http://localhost:4000/mcp",
          transport: "streamable-http",
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
          targets: ["kiro"] as const,
          command: ["node", "server.js", "--verbose"],
          args: ["--port", "3000"],
        };

        const frontmatter: RulesyncMcpFrontmatter = {
          targets: ["kiro"],
          name: "Command Array Kiro MCP Config",
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

        const kiroMcp = KiroMcp.fromRulesyncMcp(rulesyncMcp, testDir, ".");

        const config = kiroMcp.getConfig();
        expect(config.mcpServers["node-server"]).toEqual({
          command: "node",
          args: ["server.js", "--verbose", "--port", "3000"],
        });
      } finally {
        await cleanup();
      }
    });

    it("should skip servers not targeting kiro", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const frontmatter: RulesyncMcpFrontmatter = {
          targets: ["kiro"],
          name: "Multi-target MCP Config",
          description: "Configuration with multiple targets",
          servers: {
            "cursor-only": {
              targets: ["cursor"],
              command: "test",
            },
            "kiro-server": {
              targets: ["kiro"],
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

        const kiroMcp = KiroMcp.fromRulesyncMcp(rulesyncMcp, testDir, ".");

        const config = kiroMcp.getConfig();
        expect(Object.keys(config.mcpServers)).toEqual(["kiro-server"]);
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
        const config: KiroMcpConfig = {
          mcpServers: {
            "stdio-server": {
              command: "python",
              args: ["-m", "server"],
            },
          },
        };

        const kiroMcp = new KiroMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: ".kiro/mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
        });

        const result = kiroMcp.validate();
        expect(result.success).toBe(true);
        expect(result.error).toBeNull();
      } finally {
        await cleanup();
      }
    });

    it("should pass validation for valid SSE configuration", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: KiroMcpConfig = {
          mcpServers: {
            "sse-server": {
              url: "https://example.com/mcp",
              transport: "sse",
            },
          },
        };

        const kiroMcp = new KiroMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: ".kiro/mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
        });

        const result = kiroMcp.validate();
        expect(result.success).toBe(true);
        expect(result.error).toBeNull();
      } finally {
        await cleanup();
      }
    });

    it("should pass validation for valid streamable-http configuration", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: KiroMcpConfig = {
          mcpServers: {
            "http-server": {
              url: "http://localhost:4000/mcp",
              transport: "streamable-http",
              timeout: 60000,
            },
          },
        };

        const kiroMcp = new KiroMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: ".kiro/mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
        });

        const result = kiroMcp.validate();
        expect(result.success).toBe(true);
        expect(result.error).toBeNull();
      } finally {
        await cleanup();
      }
    });

    it("should fail validation for server with no transport configuration", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: KiroMcpConfig = {
          mcpServers: {
            "invalid-server": {
              // Missing both command and url
              env: { TEST: "value" },
            },
          },
        };

        const kiroMcp = new KiroMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: ".kiro/mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
          validate: false, // Skip constructor validation
        });

        const result = kiroMcp.validate();
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
        const config: KiroMcpConfig = {
          mcpServers: {
            "invalid-server": {
              command: "python",
              url: "https://example.com",
            },
          },
        };

        const kiroMcp = new KiroMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: ".kiro/mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
          validate: false, // Skip constructor validation
        });

        const result = kiroMcp.validate();
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
        const config: KiroMcpConfig = {
          mcpServers: {},
        };

        const kiroMcp = new KiroMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: ".kiro/mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
          validate: false,
        });

        const result = kiroMcp.validate();
        expect(result.success).toBe(false);
        expect(result.error?.message).toBe("At least one MCP server must be defined");
      } finally {
        await cleanup();
      }
    });

    it("should fail validation for timeout outside valid range", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: KiroMcpConfig = {
          mcpServers: {
            "invalid-timeout": {
              command: "python",
              timeout: 500, // Less than 1 second
            },
          },
        };

        const kiroMcp = new KiroMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: ".kiro/mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
          validate: false,
        });

        const result = kiroMcp.validate();
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
        const config: KiroMcpConfig = {
          mcpServers: {
            "valid-timeout": {
              command: "python",
              timeout: 60000, // 1 minute - valid
            },
          },
        };

        const kiroMcp = new KiroMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: ".kiro/mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
        });

        const result = kiroMcp.validate();
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
        const config: KiroMcpConfig = {
          mcpServers: {
            "file-server": {
              command: "node",
              args: ["server.js"],
              timeout: 30000,
              autoApprove: ["safe_operation"],
            },
          },
        };

        const filePath = join(testDir, ".kiro", "mcp.json");
        await import("node:fs/promises").then(async (fs) => {
          await fs.mkdir(join(testDir, ".kiro"), { recursive: true });
          await fs.writeFile(filePath, JSON.stringify(config, null, 2));
        });

        const kiroMcp = await KiroMcp.fromFilePath({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: ".kiro/mcp.json",
          filePath,
        });

        expect(kiroMcp.getConfig()).toEqual(config);
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
          KiroMcp.fromFilePath({
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
          KiroMcp.fromFilePath({
            baseDir: testDir,
            relativeDirPath: ".",
            relativeFilePath: "invalid-schema.json",
            filePath,
            validate: true,
          }),
        ).rejects.toThrow("Invalid Kiro MCP configuration");
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

        const kiroMcp = await KiroMcp.fromFilePath({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "invalid-schema.json",
          filePath,
          validate: false,
        });

        expect(kiroMcp).toBeDefined();
      } finally {
        await cleanup();
      }
    });
  });
});