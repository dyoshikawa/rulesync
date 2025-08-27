import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import type { RulesyncMcpServer } from "../types/mcp.js";
import { CopilotMcp, CopilotMcpCodingAgentConfig, CopilotMcpEditorConfig } from "./copilot-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

describe("CopilotMcp", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  describe("constructor", () => {
    it("should create an instance with valid coding agent configuration", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: CopilotMcpCodingAgentConfig = {
          mcpServers: {
            "test-server": {
              command: "docker",
              args: ["run", "-i", "--rm", "mcp/playwright"],
              tools: ["*"],
              type: "local",
              env: {
                SENTRY_AUTH_TOKEN: "COPILOT_MCP_SENTRY_AUTH_TOKEN",
              },
            },
          },
        };

        const copilotMcp = new CopilotMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "copilot-coding-agent.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
          format: "coding-agent",
        });

        expect(copilotMcp).toBeDefined();
        expect(copilotMcp.getConfig()).toEqual(config);
        expect(copilotMcp.getFormat()).toBe("coding-agent");
      } finally {
        await cleanup();
      }
    });

    it("should create an instance with valid editor configuration", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: CopilotMcpEditorConfig = {
          inputs: [
            {
              id: "github_token",
              type: "promptString",
              description: "GitHub Personal Access Token",
              password: true,
            },
          ],
          servers: {
            github: {
              command: "docker",
              args: ["run", "-i", "--rm", "ghcr.io/github/github-mcp-server"],
              env: {
                GITHUB_PERSONAL_ACCESS_TOKEN: "${input:github_token}",
              },
            },
          },
        };

        const copilotMcp = new CopilotMcp({
          baseDir: testDir,
          relativeDirPath: ".vscode",
          relativeFilePath: "mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
          format: "editor",
        });

        expect(copilotMcp).toBeDefined();
        expect(copilotMcp.getConfig()).toEqual(config);
        expect(copilotMcp.getFormat()).toBe("editor");
      } finally {
        await cleanup();
      }
    });

    it("should throw error with invalid configuration", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        expect(() => {
          const instance = new CopilotMcp({
            baseDir: testDir,
            relativeDirPath: ".",
            relativeFilePath: "copilot.json",
            fileContent: "{}",
            // @ts-expect-error - Testing invalid config
            config: { invalidField: "test" },
            format: "coding-agent",
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
        const copilotMcp = new CopilotMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "copilot.json",
          fileContent: "{}",
          // @ts-expect-error - Testing invalid config
          config: { invalidField: "test" },
          format: "coding-agent",
          validate: false,
        });

        expect(copilotMcp).toBeDefined();
      } finally {
        await cleanup();
      }
    });
  });

  describe("getFileName", () => {
    it("should return correct filename for coding agent format", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: CopilotMcpCodingAgentConfig = {
          mcpServers: {
            "test-server": {
              command: "test",
            },
          },
        };

        const copilotMcp = new CopilotMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "copilot-coding-agent.json",
          fileContent: JSON.stringify(config),
          config,
          format: "coding-agent",
        });

        expect(copilotMcp.getFileName()).toBe("copilot-coding-agent.json");
      } finally {
        await cleanup();
      }
    });

    it("should return correct filename for editor format", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: CopilotMcpEditorConfig = {
          servers: {
            github: {
              command: "test",
            },
          },
        };

        const copilotMcp = new CopilotMcp({
          baseDir: testDir,
          relativeDirPath: ".vscode",
          relativeFilePath: "mcp.json",
          fileContent: JSON.stringify(config),
          config,
          format: "editor",
        });

        expect(copilotMcp.getFileName()).toBe(".vscode/mcp.json");
      } finally {
        await cleanup();
      }
    });
  });

  describe("generateContent", () => {
    it("should generate valid JSON content for coding agent", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: CopilotMcpCodingAgentConfig = {
          mcpServers: {
            "playwright-tools": {
              command: "docker",
              args: ["run", "-i", "--rm", "mcp/playwright"],
              tools: ["*"],
              type: "local",
              env: {
                API_TOKEN: "COPILOT_MCP_API_TOKEN",
              },
            },
          },
        };

        const copilotMcp = new CopilotMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "copilot-coding-agent.json",
          fileContent: JSON.stringify(config),
          config,
          format: "coding-agent",
        });

        const content = await copilotMcp.generateContent();
        const parsed = JSON.parse(content);

        expect(parsed).toEqual(config);
        expect(parsed.mcpServers["playwright-tools"].tools).toEqual(["*"]);
      } finally {
        await cleanup();
      }
    });

    it("should generate valid JSON content for editor format", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: CopilotMcpEditorConfig = {
          inputs: [
            {
              id: "api_key",
              type: "promptString",
              description: "API Key",
              password: true,
            },
          ],
          servers: {
            "custom-server": {
              command: "python",
              args: ["-m", "custom_server"],
              env: {
                API_KEY: "${input:api_key}",
              },
              tools: ["query", "analyze"],
            },
          },
        };

        const copilotMcp = new CopilotMcp({
          baseDir: testDir,
          relativeDirPath: ".vscode",
          relativeFilePath: "mcp.json",
          fileContent: JSON.stringify(config),
          config,
          format: "editor",
        });

        const content = await copilotMcp.generateContent();
        const parsed = JSON.parse(content);

        expect(parsed).toEqual(config);
        expect(parsed.inputs).toHaveLength(1);
        expect(parsed.servers["custom-server"].env?.API_KEY).toBe("${input:api_key}");
      } finally {
        await cleanup();
      }
    });
  });

  describe("fromRulesyncMcpCodingAgent", () => {
    it("should convert from RulesyncMcp with target filtering for coding agent", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const rulesyncConfig = {
          mcpServers: {
            "copilot-only": {
              command: "python",
              args: ["-m", "copilot_server"],
              alwaysAllow: ["test-tool"],
              targets: ["copilot"],
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
        const copilotMcp = CopilotMcp.fromRulesyncMcpCodingAgent(rulesyncMcp, testDir, ".");

        const config = copilotMcp.getConfig() as CopilotMcpCodingAgentConfig;

        // Should include copilot-only and universal servers
        expect(Object.keys(config.mcpServers)).toContain("copilot-only");
        expect(Object.keys(config.mcpServers)).toContain("universal");
        expect(Object.keys(config.mcpServers)).not.toContain("other-tool");

        // Should map alwaysAllow to tools field
        expect(config.mcpServers["copilot-only"]?.tools).toEqual(["test-tool"]);
        expect(config.mcpServers["universal"]?.tools).toEqual(["universal-tool"]);

        // Should set type to "local"
        expect(config.mcpServers["copilot-only"]?.type).toBe("local");
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
        const copilotMcp = CopilotMcp.fromRulesyncMcpCodingAgent(rulesyncMcp, testDir, ".");

        const config = copilotMcp.getConfig() as CopilotMcpCodingAgentConfig;
        expect(Object.keys(config.mcpServers)).toContain("wildcard-server");
      } finally {
        await cleanup();
      }
    });
  });

  describe("fromRulesyncMcpEditor", () => {
    it("should convert from RulesyncMcp with target filtering for editor", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const rulesyncConfig = {
          mcpServers: {
            "copilot-server": {
              command: "docker",
              args: ["run", "-i", "--rm", "ghcr.io/github/github-mcp-server"],
              env: {
                GITHUB_PERSONAL_ACCESS_TOKEN: "token",
              },
              alwaysAllow: ["create_repository", "list_issues"],
              targets: ["copilot"],
            } as RulesyncMcpServer,
          },
        };

        const rulesyncMcp = RulesyncMcp.fromMcpConfig(rulesyncConfig, "Test Config");
        const copilotMcp = CopilotMcp.fromRulesyncMcpEditor(rulesyncMcp, testDir, ".vscode");

        const config = copilotMcp.getConfig() as CopilotMcpEditorConfig;

        expect(Object.keys(config.servers)).toContain("copilot-server");
        expect(config.servers["copilot-server"]?.command).toBe("docker");
        expect(config.servers["copilot-server"]?.tools).toEqual([
          "create_repository",
          "list_issues",
        ]);
        expect(config.servers["copilot-server"]?.env?.GITHUB_PERSONAL_ACCESS_TOKEN).toBe("token");
      } finally {
        await cleanup();
      }
    });

    it("should handle URL-based servers", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const rulesyncConfig = {
          mcpServers: {
            "remote-server": {
              url: "https://api.example.com/mcp",
              alwaysAllow: ["query_api"],
              targets: ["copilot"],
            } as RulesyncMcpServer,
          },
        };

        const rulesyncMcp = RulesyncMcp.fromMcpConfig(rulesyncConfig, "Test Config");
        const copilotMcp = CopilotMcp.fromRulesyncMcpEditor(rulesyncMcp, testDir, ".vscode");

        const config = copilotMcp.getConfig() as CopilotMcpEditorConfig;

        expect(config.servers["remote-server"]?.url).toBe("https://api.example.com/mcp");
        expect(config.servers["remote-server"]?.tools).toEqual(["query_api"]);
      } finally {
        await cleanup();
      }
    });
  });

  describe("validate", () => {
    it("should pass validation with valid coding agent configuration", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: CopilotMcpCodingAgentConfig = {
          mcpServers: {
            "valid-server": {
              command: "python",
              args: ["-m", "test_server"],
              tools: ["test-tool"],
            },
          },
        };

        const copilotMcp = new CopilotMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "copilot-coding-agent.json",
          fileContent: JSON.stringify(config),
          config,
          format: "coding-agent",
        });

        const result = copilotMcp.validate();
        expect(result.success).toBe(true);
        expect(result.error).toBeNull();
      } finally {
        await cleanup();
      }
    });

    it("should pass validation with valid editor configuration", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: CopilotMcpEditorConfig = {
          servers: {
            github: {
              command: "docker",
              args: ["run", "-i", "--rm", "ghcr.io/github/github-mcp-server"],
            },
          },
        };

        const copilotMcp = new CopilotMcp({
          baseDir: testDir,
          relativeDirPath: ".vscode",
          relativeFilePath: "mcp.json",
          fileContent: JSON.stringify(config),
          config,
          format: "editor",
        });

        const result = copilotMcp.validate();
        expect(result.success).toBe(true);
        expect(result.error).toBeNull();
      } finally {
        await cleanup();
      }
    });

    it("should fail validation when no servers defined", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: CopilotMcpCodingAgentConfig = {
          mcpServers: {},
        };

        const copilotMcp = new CopilotMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "copilot-coding-agent.json",
          fileContent: JSON.stringify(config),
          config,
          format: "coding-agent",
          validate: false, // Skip validation in constructor
        });

        const result = copilotMcp.validate();
        expect(result.success).toBe(false);
        expect(result.error?.message).toContain("At least one MCP server must be defined");
      } finally {
        await cleanup();
      }
    });

    it("should fail validation when server has no command or url", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: CopilotMcpEditorConfig = {
          servers: {
            "invalid-server": {
              args: ["-m", "test_server"],
              // Missing both command and url fields
            },
          },
        };

        const copilotMcp = new CopilotMcp({
          baseDir: testDir,
          relativeDirPath: ".vscode",
          relativeFilePath: "mcp.json",
          fileContent: JSON.stringify(config),
          config,
          format: "editor",
          validate: false, // Skip validation in constructor
        });

        const result = copilotMcp.validate();
        expect(result.success).toBe(false);
        expect(result.error?.message).toContain("must have either a 'command' field");
      } finally {
        await cleanup();
      }
    });
  });

  describe("fromFilePath", () => {
    it("should load coding agent format from valid JSON file", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: CopilotMcpCodingAgentConfig = {
          mcpServers: {
            "file-server": {
              command: "npx",
              args: ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"],
              tools: ["*"],
              type: "local",
            },
          },
        };

        const configPath = join(testDir, "copilot-coding-agent.json");
        const fs = await import("node:fs/promises");
        await fs.writeFile(configPath, JSON.stringify(config, null, 2));

        const copilotMcp = await CopilotMcp.fromFilePath({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "copilot-coding-agent.json",
          filePath: configPath,
        });

        expect(copilotMcp).toBeDefined();
        expect(copilotMcp.getConfig()).toEqual(config);
        expect(copilotMcp.getFormat()).toBe("coding-agent");
      } finally {
        await cleanup();
      }
    });

    it("should load editor format from valid JSON file", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: CopilotMcpEditorConfig = {
          inputs: [
            {
              id: "test_token",
              type: "promptString",
              description: "Test Token",
            },
          ],
          servers: {
            "test-server": {
              command: "python",
              args: ["-m", "test_server"],
              env: {
                TEST_TOKEN: "${input:test_token}",
              },
            },
          },
        };

        const configPath = join(testDir, "mcp.json");
        const fs = await import("node:fs/promises");
        await fs.writeFile(configPath, JSON.stringify(config, null, 2));

        const copilotMcp = await CopilotMcp.fromFilePath({
          baseDir: testDir,
          relativeDirPath: ".vscode",
          relativeFilePath: "mcp.json",
          filePath: configPath,
        });

        expect(copilotMcp).toBeDefined();
        expect(copilotMcp.getConfig()).toEqual(config);
        expect(copilotMcp.getFormat()).toBe("editor");
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
          CopilotMcp.fromFilePath({
            baseDir: testDir,
            relativeDirPath: ".",
            relativeFilePath: "invalid.json",
            filePath: configPath,
          }),
        ).rejects.toThrow("Invalid GitHub Copilot MCP configuration");
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

        const copilotMcp = await CopilotMcp.fromFilePath({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "invalid.json",
          filePath: configPath,
          validate: false,
        });

        expect(copilotMcp).toBeDefined();
      } finally {
        await cleanup();
      }
    });
  });

  describe("format detection", () => {
    it("should detect coding agent format from mcpServers field", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config = {
          mcpServers: {
            "test-server": {
              command: "test",
            },
          },
        };

        const configPath = join(testDir, "test.json");
        const fs = await import("node:fs/promises");
        await fs.writeFile(configPath, JSON.stringify(config));

        const copilotMcp = await CopilotMcp.fromFilePath({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "test.json",
          filePath: configPath,
        });

        expect(copilotMcp.getFormat()).toBe("coding-agent");
      } finally {
        await cleanup();
      }
    });

    it("should detect editor format from servers field", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config = {
          servers: {
            "test-server": {
              command: "test",
            },
          },
        };

        const configPath = join(testDir, "test.json");
        const fs = await import("node:fs/promises");
        await fs.writeFile(configPath, JSON.stringify(config));

        const copilotMcp = await CopilotMcp.fromFilePath({
          baseDir: testDir,
          relativeDirPath: ".vscode",
          relativeFilePath: "mcp.json",
          filePath: configPath,
        });

        expect(copilotMcp.getFormat()).toBe("editor");
      } finally {
        await cleanup();
      }
    });
  });
});
