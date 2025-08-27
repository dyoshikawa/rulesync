import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import type { RulesyncMcpServer } from "../types/mcp.js";
import { AmazonQCliMcpConfig, AmazonqcliMcp } from "./amazonqcli-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

describe("AmazonqcliMcp", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  describe("constructor", () => {
    it("should create an instance with valid configuration", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: AmazonQCliMcpConfig = {
          mcpServers: {
            "test-server": {
              command: "python",
              args: ["-m", "test_server"],
              autoApprove: ["test-tool"],
            },
          },
        };

        const amazonqMcp = new AmazonqcliMcp({
          baseDir: testDir,
          relativeDirPath: ".amazonq",
          relativeFilePath: "mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
        });

        expect(amazonqMcp).toBeDefined();
        expect(amazonqMcp.getConfig()).toEqual(config);
      } finally {
        await cleanup();
      }
    });

    it("should throw error with invalid configuration", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        expect(() => {
          const instance = new AmazonqcliMcp({
            baseDir: testDir,
            relativeDirPath: ".amazonq",
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
        const amazonqMcp = new AmazonqcliMcp({
          baseDir: testDir,
          relativeDirPath: ".amazonq",
          relativeFilePath: "mcp.json",
          fileContent: "{}",
          // @ts-expect-error - Testing invalid config
          config: { invalidField: "test" },
          validate: false,
        });

        expect(amazonqMcp).toBeDefined();
      } finally {
        await cleanup();
      }
    });
  });

  describe("getFileName", () => {
    it("should return correct filename for Amazon Q CLI", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: AmazonQCliMcpConfig = {
          mcpServers: {
            "test-server": {
              command: "test",
            },
          },
        };

        const amazonqMcp = new AmazonqcliMcp({
          baseDir: testDir,
          relativeDirPath: ".amazonq",
          relativeFilePath: "mcp.json",
          fileContent: JSON.stringify(config),
          config,
        });

        expect(amazonqMcp.getFileName()).toBe(".amazonq/mcp.json");
      } finally {
        await cleanup();
      }
    });
  });

  describe("generateContent", () => {
    it("should generate valid JSON content", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: AmazonQCliMcpConfig = {
          mcpServers: {
            "python-tools": {
              command: "python",
              args: ["-m", "my_mcp_server", "--port", "8080"],
              env: {
                PYTHONPATH: "/path/to/modules",
                DEBUG: "true",
              },
              autoApprove: ["tool1", "tool2"],
            },
          },
        };

        const amazonqMcp = new AmazonqcliMcp({
          baseDir: testDir,
          relativeDirPath: ".amazonq",
          relativeFilePath: "mcp.json",
          fileContent: JSON.stringify(config),
          config,
        });

        const content = await amazonqMcp.generateContent();
        const parsed = JSON.parse(content);

        expect(parsed).toEqual(config);
        expect(parsed.mcpServers["python-tools"].autoApprove).toEqual(["tool1", "tool2"]);
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
            "amazon-only": {
              command: "python",
              args: ["-m", "amazon_server"],
              alwaysAllow: ["test-tool"],
              targets: ["amazonqcli"],
            } as RulesyncMcpServer,
            "other-tool": {
              command: "node",
              args: ["server.js"],
              targets: ["cursor"],
            } as RulesyncMcpServer,
            universal: {
              command: "universal",
              alwaysAllow: ["universal-tool"],
              // No targets specified - should be included
            } as RulesyncMcpServer,
          },
        };

        const rulesyncMcp = RulesyncMcp.fromMcpConfig(rulesyncConfig, "Test Config");
        const amazonqMcp = AmazonqcliMcp.fromRulesyncMcp(rulesyncMcp, testDir, ".amazonq");

        const config = amazonqMcp.getConfig();

        // Should include amazon-only and universal servers
        expect(Object.keys(config.mcpServers)).toContain("amazon-only");
        expect(Object.keys(config.mcpServers)).toContain("universal");
        expect(Object.keys(config.mcpServers)).not.toContain("other-tool");

        // Should map alwaysAllow to autoApprove
        expect(config.mcpServers["amazon-only"]?.autoApprove).toEqual(["test-tool"]);
        expect(config.mcpServers["universal"]?.autoApprove).toEqual(["universal-tool"]);
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
              args: ["-m", "wildcard_server"],
              targets: ["*"] as const,
            } as RulesyncMcpServer,
          },
        };

        const rulesyncMcp = RulesyncMcp.fromMcpConfig(rulesyncConfig, "Wildcard Config");
        const amazonqMcp = AmazonqcliMcp.fromRulesyncMcp(rulesyncMcp, testDir, ".amazonq");

        const config = amazonqMcp.getConfig();
        expect(Object.keys(config.mcpServers)).toContain("wildcard-server");
      } finally {
        await cleanup();
      }
    });
  });

  describe("validate", () => {
    it("should pass validation with valid configuration", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: AmazonQCliMcpConfig = {
          mcpServers: {
            "valid-server": {
              command: "python",
              args: ["-m", "test_server"],
            },
          },
        };

        const amazonqMcp = new AmazonqcliMcp({
          baseDir: testDir,
          relativeDirPath: ".amazonq",
          relativeFilePath: "mcp.json",
          fileContent: JSON.stringify(config),
          config,
        });

        const result = amazonqMcp.validate();
        expect(result.success).toBe(true);
        expect(result.error).toBeNull();
      } finally {
        await cleanup();
      }
    });

    it("should fail validation when no servers defined", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: AmazonQCliMcpConfig = {
          mcpServers: {},
        };

        const amazonqMcp = new AmazonqcliMcp({
          baseDir: testDir,
          relativeDirPath: ".amazonq",
          relativeFilePath: "mcp.json",
          fileContent: JSON.stringify(config),
          config,
          validate: false, // Skip validation in constructor
        });

        const result = amazonqMcp.validate();
        expect(result.success).toBe(false);
        expect(result.error?.message).toContain("At least one MCP server must be defined");
      } finally {
        await cleanup();
      }
    });

    it("should fail validation when server has no command", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: AmazonQCliMcpConfig = {
          mcpServers: {
            "invalid-server": {
              args: ["-m", "test_server"],
              // Missing command field
            },
          },
        };

        const amazonqMcp = new AmazonqcliMcp({
          baseDir: testDir,
          relativeDirPath: ".amazonq",
          relativeFilePath: "mcp.json",
          fileContent: JSON.stringify(config),
          config,
          validate: false, // Skip validation in constructor
        });

        const result = amazonqMcp.validate();
        expect(result.success).toBe(false);
        expect(result.error?.message).toContain("must have a 'command' field");
      } finally {
        await cleanup();
      }
    });
  });

  describe("fromFilePath", () => {
    it("should load from valid JSON file", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: AmazonQCliMcpConfig = {
          mcpServers: {
            "file-server": {
              command: "npx",
              args: ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"],
              timeout: 60000,
              autoApprove: ["read_file", "list_directory"],
            },
          },
        };

        const configPath = join(testDir, "mcp.json");
        const fs = await import("node:fs/promises");
        await fs.writeFile(configPath, JSON.stringify(config, null, 2));

        const amazonqMcp = await AmazonqcliMcp.fromFilePath({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "mcp.json",
          filePath: configPath,
        });

        expect(amazonqMcp).toBeDefined();
        expect(amazonqMcp.getConfig()).toEqual(config);
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
          AmazonqcliMcp.fromFilePath({
            baseDir: testDir,
            relativeDirPath: ".",
            relativeFilePath: "invalid.json",
            filePath: configPath,
          }),
        ).rejects.toThrow("Invalid Amazon Q CLI MCP configuration");
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

        const amazonqMcp = await AmazonqcliMcp.fromFilePath({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "invalid.json",
          filePath: configPath,
          validate: false,
        });

        expect(amazonqMcp).toBeDefined();
      } finally {
        await cleanup();
      }
    });
  });

  describe("command field handling", () => {
    it("should handle string command", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: AmazonQCliMcpConfig = {
          mcpServers: {
            "string-command": {
              command: "python",
            },
          },
        };

        const amazonqMcp = new AmazonqcliMcp({
          baseDir: testDir,
          relativeDirPath: ".amazonq",
          relativeFilePath: "mcp.json",
          fileContent: JSON.stringify(config),
          config,
        });

        expect(amazonqMcp.getConfig().mcpServers["string-command"]?.command).toBe("python");
      } finally {
        await cleanup();
      }
    });

    it("should handle array command", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: AmazonQCliMcpConfig = {
          mcpServers: {
            "array-command": {
              command: ["python", "-m", "server"],
            },
          },
        };

        const amazonqMcp = new AmazonqcliMcp({
          baseDir: testDir,
          relativeDirPath: ".amazonq",
          relativeFilePath: "mcp.json",
          fileContent: JSON.stringify(config),
          config,
        });

        expect(amazonqMcp.getConfig().mcpServers["array-command"]?.command).toEqual([
          "python",
          "-m",
          "server",
        ]);
      } finally {
        await cleanup();
      }
    });
  });
});
