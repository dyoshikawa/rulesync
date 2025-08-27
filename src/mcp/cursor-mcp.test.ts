import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import type { RulesyncMcpServer } from "../types/mcp.js";
import { CursorMcp, CursorMcpConfig } from "./cursor-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

describe("CursorMcp", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  describe("constructor", () => {
    it("should create an instance with valid STDIO configuration", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: CursorMcpConfig = {
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

        const cursorMcp = new CursorMcp({
          baseDir: testDir,
          relativeDirPath: ".cursor",
          relativeFilePath: "mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
        });

        expect(cursorMcp).toBeDefined();
        expect(cursorMcp.getConfig()).toEqual(config);
      } finally {
        await cleanup();
      }
    });

    it("should create an instance with valid SSE configuration", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: CursorMcpConfig = {
          mcpServers: {
            "sse-server": {
              url: "http://localhost:3030",
              type: "sse",
              env: {
                API_TOKEN: "test-token",
              },
            },
          },
        };

        const cursorMcp = new CursorMcp({
          baseDir: testDir,
          relativeDirPath: ".cursor",
          relativeFilePath: "mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
        });

        expect(cursorMcp).toBeDefined();
        expect(cursorMcp.getConfig()).toEqual(config);
      } finally {
        await cleanup();
      }
    });

    it("should create an instance with valid streamable-http configuration", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: CursorMcpConfig = {
          mcpServers: {
            "http-server": {
              url: "https://api.example.com/mcp",
              type: "streamable-http",
              cwd: "/working/dir",
            },
          },
        };

        const cursorMcp = new CursorMcp({
          baseDir: testDir,
          relativeDirPath: ".cursor",
          relativeFilePath: "mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
        });

        expect(cursorMcp).toBeDefined();
        expect(cursorMcp.getConfig()).toEqual(config);
      } finally {
        await cleanup();
      }
    });

    it("should throw error with invalid configuration", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        expect(() => {
          const instance = new CursorMcp({
            baseDir: testDir,
            relativeDirPath: ".cursor",
            relativeFilePath: "mcp.json",
            fileContent: "{}",
            // @ts-expect-error - Testing invalid config
            config: { invalidField: "test" },
          });
          // This line should not be reached if constructor throws
          expect(instance).toBeDefined();
        }).toThrow();
      } finally {
        await cleanup();
      }
    });

    it("should skip validation when validate=false", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const cursorMcp = new CursorMcp({
          baseDir: testDir,
          relativeDirPath: ".cursor",
          relativeFilePath: "mcp.json",
          fileContent: "{}",
          // @ts-expect-error - Testing invalid config
          config: { invalidField: "test" },
          validate: false,
        });

        expect(cursorMcp).toBeDefined();
      } finally {
        await cleanup();
      }
    });
  });

  describe("getFileName", () => {
    it("should return correct filename for Cursor", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: CursorMcpConfig = {
          mcpServers: {
            "test-server": {
              command: "test",
            },
          },
        };

        const cursorMcp = new CursorMcp({
          baseDir: testDir,
          relativeDirPath: ".cursor",
          relativeFilePath: "mcp.json",
          fileContent: JSON.stringify(config),
          config,
        });

        expect(cursorMcp.getFileName()).toBe(".cursor/mcp.json");
      } finally {
        await cleanup();
      }
    });
  });

  describe("generateContent", () => {
    it("should generate valid JSON content for STDIO server", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: CursorMcpConfig = {
          mcpServers: {
            "stdio-tools": {
              command: "npx",
              args: ["-y", "mcp-server"],
              env: {
                NODE_ENV: "development",
                API_KEY: "test-key",
              },
              cwd: "/workspace",
            },
          },
        };

        const cursorMcp = new CursorMcp({
          baseDir: testDir,
          relativeDirPath: ".cursor",
          relativeFilePath: "mcp.json",
          fileContent: JSON.stringify(config),
          config,
        });

        const content = await cursorMcp.generateContent();
        const parsed = JSON.parse(content);

        expect(parsed).toEqual(config);
        expect(parsed.mcpServers["stdio-tools"].command).toBe("npx");
        expect(parsed.mcpServers["stdio-tools"].args).toEqual(["-y", "mcp-server"]);
      } finally {
        await cleanup();
      }
    });

    it("should generate valid JSON content for remote server", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: CursorMcpConfig = {
          mcpServers: {
            "remote-api": {
              url: "https://api.example.com/mcp",
              type: "streamable-http",
              env: {
                AUTH_TOKEN: "bearer-token",
              },
            },
          },
        };

        const cursorMcp = new CursorMcp({
          baseDir: testDir,
          relativeDirPath: ".cursor",
          relativeFilePath: "mcp.json",
          fileContent: JSON.stringify(config),
          config,
        });

        const content = await cursorMcp.generateContent();
        const parsed = JSON.parse(content);

        expect(parsed).toEqual(config);
        expect(parsed.mcpServers["remote-api"].url).toBe("https://api.example.com/mcp");
        expect(parsed.mcpServers["remote-api"].type).toBe("streamable-http");
      } finally {
        await cleanup();
      }
    });
  });

  describe("fromRulesyncMcp", () => {
    it("should convert STDIO server from RulesyncMcp", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const rulesyncConfig = {
          mcpServers: {
            "stdio-server": {
              command: "python",
              args: ["-m", "test_server"],
              env: {
                PYTHONPATH: "/path/to/modules",
              },
              alwaysAllow: ["test-tool"], // Should be omitted in Cursor
              targets: ["cursor"],
            } as RulesyncMcpServer,
          },
        };

        const rulesyncMcp = RulesyncMcp.fromMcpConfig(rulesyncConfig, "Test Config");
        const cursorMcp = CursorMcp.fromRulesyncMcp(rulesyncMcp, testDir, ".cursor");

        const config = cursorMcp.getConfig();

        expect(Object.keys(config.mcpServers)).toContain("stdio-server");
        const server = config.mcpServers["stdio-server"];
        expect(server?.command).toBe("python");
        expect(server?.args).toEqual(["-m", "test_server"]);
        expect(server?.env).toEqual({ PYTHONPATH: "/path/to/modules" });
        // alwaysAllow should not be present in Cursor config
        expect("alwaysAllow" in server!).toBe(false);
      } finally {
        await cleanup();
      }
    });

    it("should convert SSE server from RulesyncMcp", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const rulesyncConfig = {
          mcpServers: {
            "sse-server": {
              url: "https://api.example.com/sse",
              transport: "sse",
              env: {
                API_KEY: "test-key",
              },
              targets: ["cursor"],
            } as RulesyncMcpServer,
          },
        };

        const rulesyncMcp = RulesyncMcp.fromMcpConfig(rulesyncConfig, "SSE Config");
        const cursorMcp = CursorMcp.fromRulesyncMcp(rulesyncMcp, testDir, ".cursor");

        const config = cursorMcp.getConfig();

        expect(Object.keys(config.mcpServers)).toContain("sse-server");
        const server = config.mcpServers["sse-server"];
        expect(server?.url).toBe("https://api.example.com/sse");
        expect(server?.type).toBe("sse");
        expect(server?.env).toEqual({ API_KEY: "test-key" });
      } finally {
        await cleanup();
      }
    });

    it("should convert HTTP server from RulesyncMcp", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const rulesyncConfig = {
          mcpServers: {
            "http-server": {
              httpUrl: "https://api.example.com/http",
              cwd: "/working/dir",
              targets: ["cursor"],
            } as RulesyncMcpServer,
          },
        };

        const rulesyncMcp = RulesyncMcp.fromMcpConfig(rulesyncConfig, "HTTP Config");
        const cursorMcp = CursorMcp.fromRulesyncMcp(rulesyncMcp, testDir, ".cursor");

        const config = cursorMcp.getConfig();

        expect(Object.keys(config.mcpServers)).toContain("http-server");
        const server = config.mcpServers["http-server"];
        expect(server?.url).toBe("https://api.example.com/http");
        expect(server?.type).toBe("streamable-http");
        expect(server?.cwd).toBe("/working/dir");
      } finally {
        await cleanup();
      }
    });

    it("should handle command array conversion", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const rulesyncConfig = {
          mcpServers: {
            "array-command": {
              command: ["npx", "-y", "mcp-server", "--verbose"],
              args: ["--config", "production"],
              targets: ["cursor"],
            } as RulesyncMcpServer,
          },
        };

        const rulesyncMcp = RulesyncMcp.fromMcpConfig(rulesyncConfig, "Array Command Config");
        const cursorMcp = CursorMcp.fromRulesyncMcp(rulesyncMcp, testDir, ".cursor");

        const config = cursorMcp.getConfig();

        expect(Object.keys(config.mcpServers)).toContain("array-command");
        const server = config.mcpServers["array-command"];
        expect(server?.command).toBe("npx");
        // Should merge array elements and args
        expect(server?.args).toEqual(["-y", "mcp-server", "--verbose", "--config", "production"]);
      } finally {
        await cleanup();
      }
    });

    it("should filter servers based on targets", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const rulesyncConfig = {
          mcpServers: {
            "cursor-only": {
              command: "python",
              targets: ["cursor"],
            } as RulesyncMcpServer,
            "other-tool": {
              command: "node",
              targets: ["claudecode"],
            } as RulesyncMcpServer,
            universal: {
              command: "universal",
              // No targets specified - should be included
            } as RulesyncMcpServer,
          },
        };

        const rulesyncMcp = RulesyncMcp.fromMcpConfig(rulesyncConfig, "Target Filter Config");
        const cursorMcp = CursorMcp.fromRulesyncMcp(rulesyncMcp, testDir, ".cursor");

        const config = cursorMcp.getConfig();

        expect(Object.keys(config.mcpServers)).toContain("cursor-only");
        expect(Object.keys(config.mcpServers)).toContain("universal");
        expect(Object.keys(config.mcpServers)).not.toContain("other-tool");
      } finally {
        await cleanup();
      }
    });

    it("should handle wildcard targets", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const rulesyncConfig = {
          mcpServers: {
            "wildcard-server": {
              command: "python",
              targets: ["*"] as const,
            } as RulesyncMcpServer,
          },
        };

        const rulesyncMcp = RulesyncMcp.fromMcpConfig(rulesyncConfig, "Wildcard Config");
        const cursorMcp = CursorMcp.fromRulesyncMcp(rulesyncMcp, testDir, ".cursor");

        const config = cursorMcp.getConfig();
        expect(Object.keys(config.mcpServers)).toContain("wildcard-server");
      } finally {
        await cleanup();
      }
    });
  });

  describe("validate", () => {
    it("should pass validation with valid STDIO configuration", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: CursorMcpConfig = {
          mcpServers: {
            "valid-stdio": {
              command: "python",
              args: ["-m", "test_server"],
            },
          },
        };

        const cursorMcp = new CursorMcp({
          baseDir: testDir,
          relativeDirPath: ".cursor",
          relativeFilePath: "mcp.json",
          fileContent: JSON.stringify(config),
          config,
        });

        const result = cursorMcp.validate();
        expect(result.success).toBe(true);
        expect(result.error).toBeNull();
      } finally {
        await cleanup();
      }
    });

    it("should pass validation with valid remote configuration", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: CursorMcpConfig = {
          mcpServers: {
            "valid-remote": {
              url: "https://api.example.com/mcp",
              type: "sse",
            },
          },
        };

        const cursorMcp = new CursorMcp({
          baseDir: testDir,
          relativeDirPath: ".cursor",
          relativeFilePath: "mcp.json",
          fileContent: JSON.stringify(config),
          config,
        });

        const result = cursorMcp.validate();
        expect(result.success).toBe(true);
        expect(result.error).toBeNull();
      } finally {
        await cleanup();
      }
    });

    it("should fail validation when no servers defined", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: CursorMcpConfig = {
          mcpServers: {},
        };

        const cursorMcp = new CursorMcp({
          baseDir: testDir,
          relativeDirPath: ".cursor",
          relativeFilePath: "mcp.json",
          fileContent: JSON.stringify(config),
          config,
          validate: false, // Skip validation in constructor
        });

        const result = cursorMcp.validate();
        expect(result.success).toBe(false);
        expect(result.error?.message).toContain("At least one MCP server must be defined");
      } finally {
        await cleanup();
      }
    });

    it("should fail validation when server has neither command nor url", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: CursorMcpConfig = {
          mcpServers: {
            "invalid-server": {
              args: ["-m", "test_server"],
              // Missing both command and url
            },
          },
        };

        const cursorMcp = new CursorMcp({
          baseDir: testDir,
          relativeDirPath: ".cursor",
          relativeFilePath: "mcp.json",
          fileContent: JSON.stringify(config),
          config,
          validate: false, // Skip validation in constructor
        });

        const result = cursorMcp.validate();
        expect(result.success).toBe(false);
        expect(result.error?.message).toContain(
          "must have either 'command' (for STDIO) or 'url' (for remote) transport configuration",
        );
      } finally {
        await cleanup();
      }
    });

    it("should fail validation when server has both command and url", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: CursorMcpConfig = {
          mcpServers: {
            "conflicting-server": {
              command: "python",
              url: "https://api.example.com/mcp",
              // Both command and url specified
            },
          },
        };

        const cursorMcp = new CursorMcp({
          baseDir: testDir,
          relativeDirPath: ".cursor",
          relativeFilePath: "mcp.json",
          fileContent: JSON.stringify(config),
          config,
          validate: false, // Skip validation in constructor
        });

        const result = cursorMcp.validate();
        expect(result.success).toBe(false);
        expect(result.error?.message).toContain(
          "cannot have both STDIO ('command') and remote ('url') transport configuration",
        );
      } finally {
        await cleanup();
      }
    });

    it("should pass validation for remote server without explicit type", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: CursorMcpConfig = {
          mcpServers: {
            "remote-no-type": {
              url: "https://api.example.com/mcp",
              // No type specified - should still be valid
            },
          },
        };

        const cursorMcp = new CursorMcp({
          baseDir: testDir,
          relativeDirPath: ".cursor",
          relativeFilePath: "mcp.json",
          fileContent: JSON.stringify(config),
          config,
        });

        const result = cursorMcp.validate();
        expect(result.success).toBe(true);
        expect(result.error).toBeNull();
      } finally {
        await cleanup();
      }
    });
  });

  describe("fromFilePath", () => {
    it("should load from valid JSON file with STDIO server", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: CursorMcpConfig = {
          mcpServers: {
            filesystem: {
              command: "npx",
              args: ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"],
              env: {
                NODE_ENV: "production",
              },
            },
          },
        };

        const configPath = join(testDir, "mcp.json");
        const fs = await import("node:fs/promises");
        await fs.writeFile(configPath, JSON.stringify(config, null, 2));

        const cursorMcp = await CursorMcp.fromFilePath({
          baseDir: testDir,
          relativeDirPath: ".cursor",
          relativeFilePath: "mcp.json",
          filePath: configPath,
        });

        expect(cursorMcp).toBeDefined();
        expect(cursorMcp.getConfig()).toEqual(config);
      } finally {
        await cleanup();
      }
    });

    it("should load from valid JSON file with remote server", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: CursorMcpConfig = {
          mcpServers: {
            "remote-api": {
              url: "https://api.example.com/mcp",
              type: "streamable-http",
              env: {
                AUTH_TOKEN: "bearer-token",
              },
            },
          },
        };

        const configPath = join(testDir, "remote-mcp.json");
        const fs = await import("node:fs/promises");
        await fs.writeFile(configPath, JSON.stringify(config, null, 2));

        const cursorMcp = await CursorMcp.fromFilePath({
          baseDir: testDir,
          relativeDirPath: ".cursor",
          relativeFilePath: "remote-mcp.json",
          filePath: configPath,
        });

        expect(cursorMcp).toBeDefined();
        expect(cursorMcp.getConfig()).toEqual(config);
      } finally {
        await cleanup();
      }
    });

    it("should throw error for invalid JSON file", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const invalidConfig = {
          invalidField: "test",
        };

        const configPath = join(testDir, "invalid.json");
        const fs = await import("node:fs/promises");
        await fs.writeFile(configPath, JSON.stringify(invalidConfig));

        await expect(
          CursorMcp.fromFilePath({
            baseDir: testDir,
            relativeDirPath: ".cursor",
            relativeFilePath: "invalid.json",
            filePath: configPath,
          }),
        ).rejects.toThrow("Invalid Cursor MCP configuration");
      } finally {
        await cleanup();
      }
    });

    it("should skip validation when validate=false", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const invalidConfig = {
          invalidField: "test",
        };

        const configPath = join(testDir, "invalid.json");
        const fs = await import("node:fs/promises");
        await fs.writeFile(configPath, JSON.stringify(invalidConfig));

        const cursorMcp = await CursorMcp.fromFilePath({
          baseDir: testDir,
          relativeDirPath: ".cursor",
          relativeFilePath: "invalid.json",
          filePath: configPath,
          validate: false,
        });

        expect(cursorMcp).toBeDefined();
      } finally {
        await cleanup();
      }
    });
  });
});
