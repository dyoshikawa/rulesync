import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import type { RulesyncMcpServer } from "../types/mcp.js";
import { RulesyncMcp, RulesyncMcpFrontmatter } from "./rulesync-mcp.js";
import { WindsurfMcp, WindsurfMcpConfig } from "./windsurf-mcp.js";

describe("WindsurfMcp", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  describe("constructor", () => {
    it("should create an instance with valid STDIO configuration", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: WindsurfMcpConfig = {
          mcpServers: {
            "stdio-server": {
              command: "python",
              args: ["-m", "test_server"],
              env: {
                API_KEY: "test-key",
              },
            },
          },
        };

        const windsurfMcp = new WindsurfMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "mcp_config.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
        });

        expect(windsurfMcp).toBeDefined();
        expect(windsurfMcp.getConfig()).toEqual(config);
      } finally {
        await cleanup();
      }
    });

    it("should create an instance with valid SSE configuration", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: WindsurfMcpConfig = {
          mcpServers: {
            "sse-server": {
              serverUrl: "https://mcp-example.com/sse",
              env: {
                TOKEN: "test-token",
              },
            },
          },
        };

        const windsurfMcp = new WindsurfMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "mcp_config.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
        });

        expect(windsurfMcp).toBeDefined();
        expect(windsurfMcp.getConfig()).toEqual(config);
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
              // Missing both command and serverUrl
              args: ["arg1"],
            },
          },
        };

        // Schema validation is passed, but transport validation occurs in validate()
        const windsurfMcp = new WindsurfMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "mcp_config.json",
          fileContent: JSON.stringify(invalidConfig, null, 2),
          config: invalidConfig as WindsurfMcpConfig,
          validate: false, // Skip validation during construction
        });

        expect(windsurfMcp).toBeDefined();
      } finally {
        await cleanup();
      }
    });
  });

  describe("getFileName", () => {
    it("should return 'mcp_config.json'", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: WindsurfMcpConfig = {
          mcpServers: {
            test: { command: "test" },
          },
        };

        const windsurfMcp = new WindsurfMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "mcp_config.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
        });

        expect(windsurfMcp.getFileName()).toBe("mcp_config.json");
      } finally {
        await cleanup();
      }
    });
  });

  describe("generateContent", () => {
    it("should generate valid JSON content", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: WindsurfMcpConfig = {
          mcpServers: {
            "test-server": {
              command: "python",
              args: ["-m", "server"],
              env: {
                DEBUG: "true",
              },
            },
          },
        };

        const windsurfMcp = new WindsurfMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "mcp_config.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
        });

        const content = await windsurfMcp.generateContent();
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
          targets: ["windsurf"] as const,
          command: "python",
          args: ["-m", "server"],
          env: {
            API_KEY: "test-key",
          },
        };

        const frontmatter: RulesyncMcpFrontmatter = {
          targets: ["windsurf"],
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

        const windsurfMcp = WindsurfMcp.fromRulesyncMcp(rulesyncMcp, testDir, ".");

        expect(windsurfMcp.getFileName()).toBe("mcp_config.json");
        const config = windsurfMcp.getConfig();
        expect(config.mcpServers["test-server"]).toEqual({
          command: "python",
          args: ["-m", "server"],
          env: {
            API_KEY: "test-key",
          },
        });
      } finally {
        await cleanup();
      }
    });

    it("should convert SSE server configuration", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const rulesyncServer: RulesyncMcpServer = {
          targets: ["windsurf"] as const,
          url: "https://mcp-example.com/sse",
          env: {
            TOKEN: "test-token",
          },
        };

        const frontmatter: RulesyncMcpFrontmatter = {
          targets: ["windsurf"],
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

        const windsurfMcp = WindsurfMcp.fromRulesyncMcp(rulesyncMcp, testDir, ".");

        const config = windsurfMcp.getConfig();
        expect(config.mcpServers["remote-server"]).toEqual({
          serverUrl: "https://mcp-example.com/sse",
          env: {
            TOKEN: "test-token",
          },
        });
      } finally {
        await cleanup();
      }
    });

    it("should handle command arrays", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const rulesyncServer: RulesyncMcpServer = {
          targets: ["windsurf"] as const,
          command: ["node", "server.js", "--verbose"],
          args: ["--port", "3000"],
        };

        const frontmatter: RulesyncMcpFrontmatter = {
          targets: ["windsurf"],
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

        const windsurfMcp = WindsurfMcp.fromRulesyncMcp(rulesyncMcp, testDir, ".");

        const config = windsurfMcp.getConfig();
        expect(config.mcpServers["node-server"]).toEqual({
          command: "node",
          args: ["server.js", "--verbose", "--port", "3000"],
        });
      } finally {
        await cleanup();
      }
    });

    it("should skip servers not targeting windsurf", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const frontmatter: RulesyncMcpFrontmatter = {
          targets: ["windsurf"],
          name: "Multi-target MCP Config",
          description: "Configuration with multiple targets",
          servers: {
            "cursor-only": {
              targets: ["cursor"],
              command: "test",
            },
            "windsurf-server": {
              targets: ["windsurf"],
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

        const windsurfMcp = WindsurfMcp.fromRulesyncMcp(rulesyncMcp, testDir, ".");

        const config = windsurfMcp.getConfig();
        expect(Object.keys(config.mcpServers)).toEqual(["windsurf-server"]);
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
        const config: WindsurfMcpConfig = {
          mcpServers: {
            "stdio-server": {
              command: "python",
              args: ["-m", "server"],
            },
          },
        };

        const windsurfMcp = new WindsurfMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "mcp_config.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
        });

        const result = windsurfMcp.validate();
        expect(result.success).toBe(true);
        expect(result.error).toBeNull();
      } finally {
        await cleanup();
      }
    });

    it("should pass validation for valid SSE configuration", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: WindsurfMcpConfig = {
          mcpServers: {
            "sse-server": {
              serverUrl: "https://example.com/sse",
              env: {
                Authorization: "Bearer token",
              },
            },
          },
        };

        const windsurfMcp = new WindsurfMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "mcp_config.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
        });

        const result = windsurfMcp.validate();
        expect(result.success).toBe(true);
        expect(result.error).toBeNull();
      } finally {
        await cleanup();
      }
    });

    it("should fail validation for server with no transport configuration", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: WindsurfMcpConfig = {
          mcpServers: {
            "invalid-server": {
              // Missing both command and serverUrl
              env: { TEST: "value" },
            },
          },
        };

        const windsurfMcp = new WindsurfMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "mcp_config.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
          validate: false, // Skip constructor validation
        });

        const result = windsurfMcp.validate();
        expect(result.success).toBe(false);
        expect(result.error?.message).toContain(
          "Server \"invalid-server\" must have either 'command' (for STDIO) or 'serverUrl' (for SSE) transport configuration",
        );
      } finally {
        await cleanup();
      }
    });

    it("should fail validation for server with both transport configurations", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: WindsurfMcpConfig = {
          mcpServers: {
            "invalid-server": {
              command: "python",
              serverUrl: "https://example.com/sse",
            },
          },
        };

        const windsurfMcp = new WindsurfMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "mcp_config.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
          validate: false, // Skip constructor validation
        });

        const result = windsurfMcp.validate();
        expect(result.success).toBe(false);
        expect(result.error?.message).toContain(
          "Server \"invalid-server\" cannot have both STDIO ('command') and remote ('serverUrl') transport configuration",
        );
      } finally {
        await cleanup();
      }
    });

    it("should fail validation for empty mcpServers", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: WindsurfMcpConfig = {
          mcpServers: {},
        };

        const windsurfMcp = new WindsurfMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "mcp_config.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
          validate: false,
        });

        const result = windsurfMcp.validate();
        expect(result.success).toBe(false);
        expect(result.error?.message).toBe("At least one MCP server must be defined");
      } finally {
        await cleanup();
      }
    });
  });

  describe("fromFilePath", () => {
    it("should load valid configuration from file", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: WindsurfMcpConfig = {
          mcpServers: {
            "file-server": {
              command: "node",
              args: ["server.js"],
            },
          },
        };

        const filePath = join(testDir, "mcp_config.json");
        await import("node:fs/promises").then((fs) =>
          fs.writeFile(filePath, JSON.stringify(config, null, 2)),
        );

        const windsurfMcp = await WindsurfMcp.fromFilePath({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "mcp_config.json",
          filePath,
        });

        expect(windsurfMcp.getConfig()).toEqual(config);
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
          WindsurfMcp.fromFilePath({
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
          WindsurfMcp.fromFilePath({
            baseDir: testDir,
            relativeDirPath: ".",
            relativeFilePath: "invalid-schema.json",
            filePath,
            validate: true,
          }),
        ).rejects.toThrow("Invalid Windsurf MCP configuration");
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

        const windsurfMcp = await WindsurfMcp.fromFilePath({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "invalid-schema.json",
          filePath,
          validate: false,
        });

        expect(windsurfMcp).toBeDefined();
      } finally {
        await cleanup();
      }
    });
  });
});
