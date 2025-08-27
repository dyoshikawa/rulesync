import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import type { RulesyncMcpServer } from "../types/mcp.js";
import { AugmentcodeMcp, AugmentcodeMcpConfig } from "./augmentcode-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

describe("AugmentcodeMcp", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  describe("constructor", () => {
    it("should create an instance with valid standard configuration", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: AugmentcodeMcpConfig = {
          mcpServers: {
            "test-server": {
              command: "python",
              args: ["-m", "test_server"],
              env: { API_KEY: "test-key" },
            },
          },
        };

        const augmentMcp = new AugmentcodeMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
        });

        expect(augmentMcp).toBeDefined();
        expect(augmentMcp.getConfig()).toEqual(config);
      } finally {
        await cleanup();
      }
    });

    it("should create an instance with VS Code settings format", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: AugmentcodeMcpConfig = {
          "augment.advanced": {
            mcpServers: [
              {
                name: "sqlite",
                command: "uvx",
                args: ["mcp-server-sqlite", "--db-path", "/path/to/test.db"],
              },
            ],
          },
        };

        const augmentMcp = new AugmentcodeMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
        });

        expect(augmentMcp).toBeDefined();
        expect(augmentMcp.getConfig()).toEqual(config);
      } finally {
        await cleanup();
      }
    });

    it("should throw error with invalid configuration", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        expect(() => {
          const instance = new AugmentcodeMcp({
            baseDir: testDir,
            relativeDirPath: ".",
            relativeFilePath: "mcp.json",
            fileContent: "{}",
            config: { invalidField: "test" } as unknown as AugmentcodeMcpConfig,
          });
          void instance;
        }).toThrow();
      } finally {
        await cleanup();
      }
    });

    it("should not validate when validate is false", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const augmentMcp = new AugmentcodeMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "mcp.json",
          fileContent: "{}",
          config: { invalidField: "test" } as unknown as AugmentcodeMcpConfig,
          validate: false,
        });

        expect(augmentMcp).toBeDefined();
      } finally {
        await cleanup();
      }
    });
  });

  describe("getFileName", () => {
    it("should return correct filename", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: AugmentcodeMcpConfig = { mcpServers: {} };

        const augmentMcp = new AugmentcodeMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
        });

        expect(augmentMcp.getFileName()).toBe(".mcp.json");
      } finally {
        await cleanup();
      }
    });
  });

  describe("generateContent", () => {
    it("should generate valid JSON content", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: AugmentcodeMcpConfig = {
          mcpServers: {
            "sqlite-server": {
              command: "uvx",
              args: ["mcp-server-sqlite", "--db-path", "./test.db"],
              env: { LOG_LEVEL: "info" },
            },
          },
        };

        const augmentMcp = new AugmentcodeMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
        });

        const content = await augmentMcp.generateContent();
        const parsed = JSON.parse(content);
        expect(parsed).toEqual(config);
      } finally {
        await cleanup();
      }
    });
  });

  describe("fromRulesyncMcp", () => {
    it("should convert from RulesyncMcp with target filtering", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const rulesyncConfig = {
          mcpServers: {
            "augmentcode-server": {
              command: "python",
              args: ["-m", "server"],
              env: { API_KEY: "secret" },
              targets: ["augmentcode"],
            } as RulesyncMcpServer,
            "excluded-server": {
              command: "node",
              targets: ["claudecode"],
            } as RulesyncMcpServer,
            "wildcard-server": {
              command: "uvx",
              args: ["mcp-server"],
              targets: ["*"],
            } as RulesyncMcpServer,
          },
        };

        const rulesyncMcp = RulesyncMcp.fromMcpConfig(rulesyncConfig, "Test Config");
        const augmentMcp = AugmentcodeMcp.fromRulesyncMcp(rulesyncMcp, testDir, ".");

        const generatedConfig = augmentMcp.getConfig();

        // Should include augmentcode-server and wildcard-server, exclude excluded-server
        if ("mcpServers" in generatedConfig) {
          expect(generatedConfig.mcpServers).toHaveProperty("augmentcode-server");
          expect(generatedConfig.mcpServers).not.toHaveProperty("excluded-server");
          expect(generatedConfig.mcpServers).toHaveProperty("wildcard-server");

          // Check converted fields
          expect(generatedConfig.mcpServers["augmentcode-server"]).toMatchObject({
            command: "python",
            args: ["-m", "server"],
            env: { API_KEY: "secret" },
          });
        }
      } finally {
        await cleanup();
      }
    });

    it("should handle remote server configurations", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const rulesyncConfig = {
          mcpServers: {
            "remote-server": {
              url: "https://api.example.com/mcp",
              transport: "sse",
              headers: { Authorization: "Bearer token" },
              env: { API_KEY: "secret" },
              targets: ["augmentcode"],
            } as RulesyncMcpServer,
          },
        };

        const rulesyncMcp = RulesyncMcp.fromMcpConfig(rulesyncConfig, "Remote Config");
        const augmentMcp = AugmentcodeMcp.fromRulesyncMcp(rulesyncMcp, testDir, ".");

        const generatedConfig = augmentMcp.getConfig();

        if ("mcpServers" in generatedConfig) {
          expect(generatedConfig.mcpServers["remote-server"]).toMatchObject({
            url: "https://api.example.com/mcp",
            transport: "sse",
            headers: { Authorization: "Bearer token", API_KEY: "secret" },
          });
        }
      } finally {
        await cleanup();
      }
    });

    it("should handle disabled and timeout configurations", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const rulesyncConfig = {
          mcpServers: {
            "config-server": {
              command: "node",
              args: ["server.js"],
              disabled: true,
              timeout: 5000,
              networkTimeout: 90000,
              targets: ["augmentcode"],
            } as RulesyncMcpServer,
          },
        };

        const rulesyncMcp = RulesyncMcp.fromMcpConfig(rulesyncConfig, "Config Test");
        const augmentMcp = AugmentcodeMcp.fromRulesyncMcp(rulesyncMcp, testDir, ".");

        const generatedConfig = augmentMcp.getConfig();

        if ("mcpServers" in generatedConfig) {
          expect(generatedConfig.mcpServers["config-server"]).toMatchObject({
            command: "node",
            args: ["server.js"],
            enabled: false, // disabled: true -> enabled: false
            timeout: 5000,
            retries: 3, // networkTimeout 90000ms / 30000ms = 3
          });
        }
      } finally {
        await cleanup();
      }
    });
  });

  describe("validate", () => {
    it("should validate correct configuration", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: AugmentcodeMcpConfig = {
          mcpServers: {
            "test-server": {
              command: "python",
            },
          },
        };

        const augmentMcp = new AugmentcodeMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
        });

        const result = augmentMcp.validate();
        expect(result.success).toBe(true);
        expect(result.error).toBeNull();
      } finally {
        await cleanup();
      }
    });

    it("should fail validation with empty servers", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: AugmentcodeMcpConfig = { mcpServers: {} };

        const augmentMcp = new AugmentcodeMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
        });

        const result = augmentMcp.validate();
        expect(result.success).toBe(false);
        expect(result.error?.message).toBe("At least one MCP server must be defined");
      } finally {
        await cleanup();
      }
    });

    it("should validate VS Code settings format", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: AugmentcodeMcpConfig = {
          "augment.advanced": {
            mcpServers: [
              {
                name: "sqlite",
                command: "uvx",
              },
            ],
          },
        };

        const augmentMcp = new AugmentcodeMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
        });

        const result = augmentMcp.validate();
        expect(result.success).toBe(true);
        expect(result.error).toBeNull();
      } finally {
        await cleanup();
      }
    });

    it("should fail validation with empty VS Code servers array", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: AugmentcodeMcpConfig = {
          "augment.advanced": {
            mcpServers: [],
          },
        };

        const augmentMcp = new AugmentcodeMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
        });

        const result = augmentMcp.validate();
        expect(result.success).toBe(false);
        expect(result.error?.message).toBe("At least one MCP server must be defined");
      } finally {
        await cleanup();
      }
    });
  });

  describe("fromFilePath", () => {
    it("should load from standard format file", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: AugmentcodeMcpConfig = {
          mcpServers: {
            "file-server": {
              command: "npx",
              args: ["-y", "@modelcontextprotocol/server-filesystem"],
            },
          },
        };

        const filePath = join(testDir, "mcp.json");
        await writeFile(filePath, JSON.stringify(config, null, 2), "utf-8");

        const augmentMcp = await AugmentcodeMcp.fromFilePath({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "mcp.json",
          filePath,
        });

        expect(augmentMcp).toBeDefined();
        expect(augmentMcp.getConfig()).toEqual(config);
      } finally {
        await cleanup();
      }
    });

    it("should load from VS Code settings format file", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: AugmentcodeMcpConfig = {
          "augment.advanced": {
            mcpServers: [
              {
                name: "github",
                command: "npx",
                args: ["-y", "@modelcontextprotocol/server-github"],
                env: { GITHUB_TOKEN: "token" },
              },
            ],
          },
        };

        const filePath = join(testDir, "settings.json");
        await writeFile(filePath, JSON.stringify(config, null, 2), "utf-8");

        const augmentMcp = await AugmentcodeMcp.fromFilePath({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "settings.json",
          filePath,
        });

        expect(augmentMcp).toBeDefined();
        expect(augmentMcp.getConfig()).toEqual(config);
      } finally {
        await cleanup();
      }
    });

    it("should throw error with invalid JSON", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const filePath = join(testDir, "invalid.json");
        await writeFile(filePath, "invalid json content", "utf-8");

        await expect(
          AugmentcodeMcp.fromFilePath({
            baseDir: testDir,
            relativeDirPath: ".",
            relativeFilePath: "invalid.json",
            filePath,
          }),
        ).rejects.toThrow();
      } finally {
        await cleanup();
      }
    });

    it("should throw error with invalid configuration when validate=true", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const invalidConfig = { invalidField: "test" };
        const filePath = join(testDir, "invalid-config.json");
        await writeFile(filePath, JSON.stringify(invalidConfig, null, 2), "utf-8");

        await expect(
          AugmentcodeMcp.fromFilePath({
            baseDir: testDir,
            relativeDirPath: ".",
            relativeFilePath: "invalid-config.json",
            filePath,
            validate: true,
          }),
        ).rejects.toThrow("Invalid AugmentCode MCP configuration");
      } finally {
        await cleanup();
      }
    });

    it("should not validate with validate=false", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const invalidConfig = { invalidField: "test" };
        const filePath = join(testDir, "invalid-config.json");
        await writeFile(filePath, JSON.stringify(invalidConfig, null, 2), "utf-8");

        const augmentMcp = await AugmentcodeMcp.fromFilePath({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "invalid-config.json",
          filePath,
          validate: false,
        });

        expect(augmentMcp).toBeDefined();
      } finally {
        await cleanup();
      }
    });
  });

  describe("Remote server configurations", () => {
    it("should handle SSE transport", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const rulesyncConfig = {
          mcpServers: {
            "sse-server": {
              url: "https://api.example.com/sse",
              transport: "sse",
              headers: { Authorization: "Bearer token" },
              targets: ["augmentcode"],
            } as RulesyncMcpServer,
          },
        };

        const rulesyncMcp = RulesyncMcp.fromMcpConfig(rulesyncConfig, "SSE Test");
        const augmentMcp = AugmentcodeMcp.fromRulesyncMcp(rulesyncMcp, testDir, ".");

        const generatedConfig = augmentMcp.getConfig();

        if ("mcpServers" in generatedConfig) {
          expect(generatedConfig.mcpServers["sse-server"]).toMatchObject({
            url: "https://api.example.com/sse",
            transport: "sse",
            headers: { Authorization: "Bearer token" },
          });
        }
      } finally {
        await cleanup();
      }
    });

    it("should handle HTTP transport", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const rulesyncConfig = {
          mcpServers: {
            "http-server": {
              httpUrl: "http://localhost:4000/mcp",
              headers: { "X-API-Key": "secret" },
              targets: ["augmentcode"],
            } as RulesyncMcpServer,
          },
        };

        const rulesyncMcp = RulesyncMcp.fromMcpConfig(rulesyncConfig, "HTTP Test");
        const augmentMcp = AugmentcodeMcp.fromRulesyncMcp(rulesyncMcp, testDir, ".");

        const generatedConfig = augmentMcp.getConfig();

        if ("mcpServers" in generatedConfig) {
          expect(generatedConfig.mcpServers["http-server"]).toMatchObject({
            url: "http://localhost:4000/mcp",
            transport: "http",
            headers: { "X-API-Key": "secret" },
          });
        }
      } finally {
        await cleanup();
      }
    });
  });
});
