import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import { QwencodeMcp, QwencodeMcpConfig } from "./qwencode-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

describe("QwencodeMcp", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("constructor", () => {
    it("should create instance with valid STDIO configuration", () => {
      const config: QwencodeMcpConfig = {
        mcpServers: {
          "github-tools": {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-github"],
            env: {
              GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}",
            },
            includeTools: ["create_repository", "list_issues"],
          },
        },
      };

      const qwencodeMcp = new QwencodeMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".qwen/settings.json",
        fileContent: JSON.stringify(config),
        config,
      });

      expect(qwencodeMcp).toBeInstanceOf(QwencodeMcp);
      expect(qwencodeMcp.getConfig()).toEqual(config);
    });

    it("should create instance with valid SSE configuration", () => {
      const config: QwencodeMcpConfig = {
        mcpServers: {
          "remote-server": {
            url: "https://api.example.com/mcp",
            type: "sse",
            headers: {
              Authorization: "Bearer ${API_TOKEN}",
            },
            trust: false,
          },
        },
      };

      const qwencodeMcp = new QwencodeMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".qwen/settings.json",
        fileContent: JSON.stringify(config),
        config,
      });

      expect(qwencodeMcp).toBeInstanceOf(QwencodeMcp);
      expect(qwencodeMcp.getConfig()).toEqual(config);
    });

    it("should create instance with valid HTTP streaming configuration", () => {
      const config: QwencodeMcpConfig = {
        mcpServers: {
          "http-server": {
            httpUrl: "http://localhost:3000/mcp",
            type: "streamable-http",
            timeout: 30000,
            excludeTools: ["dangerous_tool"],
          },
        },
      };

      const qwencodeMcp = new QwencodeMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".qwen/settings.json",
        fileContent: JSON.stringify(config),
        config,
      });

      expect(qwencodeMcp).toBeInstanceOf(QwencodeMcp);
      expect(qwencodeMcp.getConfig()).toEqual(config);
    });

    it("should throw error for invalid configuration", () => {
      const invalidConfig = {
        mcpServers: {
          "invalid-server": {
            // Invalid timeout type
            timeout: "not-a-number",
          },
        },
      };

      expect(() => {
        return new QwencodeMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: ".qwen/settings.json",
          fileContent: JSON.stringify(invalidConfig),
          config: invalidConfig as unknown as QwencodeMcpConfig,
        });
      }).toThrow();
    });

    it("should skip validation when validate is false", () => {
      const invalidConfig = {
        mcpServers: {
          "invalid-server": {
            timeout: "not-a-number", // Invalid type
          },
        },
      };

      expect(() => {
        return new QwencodeMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: ".qwen/settings.json",
          fileContent: JSON.stringify(invalidConfig),
          config: invalidConfig as unknown as QwencodeMcpConfig,
          validate: false,
        });
      }).not.toThrow();
    });
  });

  describe("getFileName", () => {
    it("should return correct file name", () => {
      const config: QwencodeMcpConfig = {
        mcpServers: {
          "test-server": {
            command: "test",
          },
        },
      };

      const qwencodeMcp = new QwencodeMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".qwen/settings.json",
        fileContent: "{}",
        config,
      });

      expect(qwencodeMcp.getFileName()).toBe(".qwen/settings.json");
    });
  });

  describe("generateContent", () => {
    it("should generate valid JSON content", async () => {
      const config: QwencodeMcpConfig = {
        mcpServers: {
          "python-tools": {
            command: "python",
            args: ["-m", "my_mcp_server"],
            env: {
              API_KEY: "${EXTERNAL_API_KEY}",
            },
            trust: true,
            includeTools: ["safe_tool", "data_processor"],
          },
        },
      };

      const qwencodeMcp = new QwencodeMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".qwen/settings.json",
        fileContent: "{}",
        config,
      });

      const content = await qwencodeMcp.generateContent();
      const parsed = JSON.parse(content);

      expect(parsed).toEqual(config);
      expect(content).toMatch(/"mcpServers"/);
      expect(content).toMatch(/"python-tools"/);
    });
  });

  describe("validate", () => {
    it("should validate successful configuration", () => {
      const config: QwencodeMcpConfig = {
        mcpServers: {
          "valid-server": {
            command: "npx",
            args: ["server"],
            includeTools: ["tool1"],
          },
        },
      };

      const qwencodeMcp = new QwencodeMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".qwen/settings.json",
        fileContent: "{}",
        config,
      });

      const result = qwencodeMcp.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should fail validation with empty servers", () => {
      const config: QwencodeMcpConfig = {
        mcpServers: {},
      };

      const qwencodeMcp = new QwencodeMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".qwen/settings.json",
        fileContent: "{}",
        config,
      });

      const result = qwencodeMcp.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("At least one MCP server must be defined");
    });

    it("should fail validation with missing transport config", () => {
      const config: QwencodeMcpConfig = {
        mcpServers: {
          "invalid-server": {
            timeout: 5000,
          },
        },
      };

      const qwencodeMcp = new QwencodeMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".qwen/settings.json",
        fileContent: "{}",
        config,
        validate: false,
      });

      const result = qwencodeMcp.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain(
        "must have either 'command' (for STDIO) or 'url'/'httpUrl' (for remote)",
      );
    });

    it("should fail validation with conflicting transport config", () => {
      const config: QwencodeMcpConfig = {
        mcpServers: {
          "conflicting-server": {
            command: "test",
            url: "https://example.com",
          },
        },
      };

      const qwencodeMcp = new QwencodeMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".qwen/settings.json",
        fileContent: "{}",
        config,
        validate: false,
      });

      const result = qwencodeMcp.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("cannot have both STDIO");
    });

    it("should fail validation with both url and httpUrl", () => {
      const config: QwencodeMcpConfig = {
        mcpServers: {
          "dual-url-server": {
            url: "https://example.com/sse",
            httpUrl: "https://example.com/http",
          },
        },
      };

      const qwencodeMcp = new QwencodeMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".qwen/settings.json",
        fileContent: "{}",
        config,
        validate: false,
      });

      const result = qwencodeMcp.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("cannot have both 'url' and 'httpUrl'");
    });

    it("should fail validation with both includeTools and excludeTools", () => {
      const config: QwencodeMcpConfig = {
        mcpServers: {
          "conflicting-tools-server": {
            command: "test",
            includeTools: ["tool1"],
            excludeTools: ["tool2"],
          },
        },
      };

      const qwencodeMcp = new QwencodeMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".qwen/settings.json",
        fileContent: "{}",
        config,
        validate: false,
      });

      const result = qwencodeMcp.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("cannot have both 'includeTools' and 'excludeTools'");
    });

    it("should fail validation with invalid timeout range", () => {
      const config: QwencodeMcpConfig = {
        mcpServers: {
          "timeout-server": {
            command: "test",
            timeout: 100, // Too small (< 1000)
          },
        },
      };

      const qwencodeMcp = new QwencodeMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".qwen/settings.json",
        fileContent: "{}",
        config,
        validate: false,
      });

      const result = qwencodeMcp.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain(
        "timeout must be between 1 second (1000) and 10 minutes (600000)",
      );
    });
  });

  describe("fromRulesyncMcp", () => {
    it("should convert RulesyncMcp with STDIO server", () => {
      const rulesyncMcp = new RulesyncMcp({
        baseDir: testDir,
        relativeDirPath: ".rulesync/mcp",
        relativeFilePath: "test-mcp.md",
        fileContent: "",
        body: "Test MCP body",
        frontmatter: {
          targets: ["qwencode"],
          name: "Test MCP",
          description: "Test MCP configuration",
          servers: {
            "python-server": {
              targets: ["qwencode"],
              command: "python",
              args: ["-m", "server"],
              env: {
                API_KEY: "test-key",
              },
              trust: true,
              tools: ["tool1", "tool2"],
            },
          },
        },
      });

      const qwencodeMcp = QwencodeMcp.fromRulesyncMcp(rulesyncMcp, testDir, ".");

      const config = qwencodeMcp.getConfig();
      expect(config.mcpServers).toHaveProperty("python-server");

      const server = config.mcpServers["python-server"];
      expect(server).toBeDefined();
      expect(server?.command).toBe("python");
      expect(server?.args).toEqual(["-m", "server"]);
      expect(server?.env).toEqual({ API_KEY: "test-key" });
      expect(server?.trust).toBe(true);
      expect(server?.includeTools).toEqual(["tool1", "tool2"]);
    });

    it("should convert RulesyncMcp with array command", () => {
      const rulesyncMcp = new RulesyncMcp({
        baseDir: testDir,
        relativeDirPath: ".rulesync/mcp",
        relativeFilePath: "test-mcp.md",
        fileContent: "",
        body: "Test MCP body",
        frontmatter: {
          targets: ["qwencode"],
          name: "Test MCP",
          description: "Test MCP configuration",
          servers: {
            "array-command-server": {
              targets: ["qwencode"],
              command: ["npx", "-y", "server-package"],
              args: ["--config", "config.json"],
            },
          },
        },
      });

      const qwencodeMcp = QwencodeMcp.fromRulesyncMcp(rulesyncMcp, testDir, ".");

      const config = qwencodeMcp.getConfig();
      const server = config.mcpServers["array-command-server"];

      expect(server).toBeDefined();
      expect(server?.command).toBe("npx");
      expect(server?.args).toEqual(["-y", "server-package", "--config", "config.json"]);
    });

    it("should convert RulesyncMcp with httpUrl for HTTP streaming", () => {
      const rulesyncMcp = new RulesyncMcp({
        baseDir: testDir,
        relativeDirPath: ".rulesync/mcp",
        relativeFilePath: "test-mcp.md",
        fileContent: "",
        body: "Test MCP body",
        frontmatter: {
          targets: ["qwencode"],
          name: "Test MCP",
          description: "Test MCP configuration",
          servers: {
            "http-server": {
              targets: ["qwencode"],
              httpUrl: "http://localhost:3000/mcp",
              type: "streamable-http",
              headers: {
                "X-API-Key": "test-key",
              },
            },
          },
        },
      });

      const qwencodeMcp = QwencodeMcp.fromRulesyncMcp(rulesyncMcp, testDir, ".");

      const config = qwencodeMcp.getConfig();
      const server = config.mcpServers["http-server"];

      expect(server).toBeDefined();
      expect(server?.httpUrl).toBe("http://localhost:3000/mcp");
      expect(server?.type).toBe("streamable-http");
      expect(server?.headers).toEqual({ "X-API-Key": "test-key" });
    });

    it("should convert RulesyncMcp with SSE URL", () => {
      const rulesyncMcp = new RulesyncMcp({
        baseDir: testDir,
        relativeDirPath: ".rulesync/mcp",
        relativeFilePath: "test-mcp.md",
        fileContent: "",
        body: "Test MCP body",
        frontmatter: {
          targets: ["qwencode"],
          name: "Test MCP",
          description: "Test MCP configuration",
          servers: {
            "sse-server": {
              targets: ["qwencode"],
              url: "https://api.example.com/sse",
              type: "sse",
            },
          },
        },
      });

      const qwencodeMcp = QwencodeMcp.fromRulesyncMcp(rulesyncMcp, testDir, ".");

      const config = qwencodeMcp.getConfig();
      const server = config.mcpServers["sse-server"];

      expect(server).toBeDefined();
      expect(server?.url).toBe("https://api.example.com/sse");
      expect(server?.type).toBe("sse");
    });

    it("should skip servers not targeted for qwencode", () => {
      const rulesyncMcp = new RulesyncMcp({
        baseDir: testDir,
        relativeDirPath: ".rulesync/mcp",
        relativeFilePath: "test-mcp.md",
        fileContent: "",
        body: "Test MCP body",
        frontmatter: {
          targets: ["qwencode"],
          name: "Test MCP",
          description: "Test MCP configuration",
          servers: {
            "qwencode-server": {
              targets: ["qwencode"],
              command: "test",
            },
            "claude-server": {
              targets: ["claudecode"],
              command: "test2",
            },
          },
        },
      });

      const qwencodeMcp = QwencodeMcp.fromRulesyncMcp(rulesyncMcp, testDir, ".");

      const config = qwencodeMcp.getConfig();
      expect(config.mcpServers).toHaveProperty("qwencode-server");
      expect(config.mcpServers).not.toHaveProperty("claude-server");
    });

    it("should map alwaysAllow to includeTools", () => {
      const rulesyncMcp = new RulesyncMcp({
        baseDir: testDir,
        relativeDirPath: ".rulesync/mcp",
        relativeFilePath: "test-mcp.md",
        fileContent: "",
        body: "Test MCP body",
        frontmatter: {
          targets: ["qwencode"],
          name: "Test MCP",
          description: "Test MCP configuration",
          servers: {
            "always-allow-server": {
              targets: ["qwencode"],
              command: "test",
              alwaysAllow: ["safe_tool", "read_only_tool"],
            },
          },
        },
      });

      const qwencodeMcp = QwencodeMcp.fromRulesyncMcp(rulesyncMcp, testDir, ".");

      const config = qwencodeMcp.getConfig();
      const server = config.mcpServers["always-allow-server"];

      expect(server).toBeDefined();
      expect(server?.includeTools).toEqual(["safe_tool", "read_only_tool"]);
    });
  });

  describe("fromFilePath", () => {
    it("should load valid configuration from file", async () => {
      const config: QwencodeMcpConfig = {
        mcpServers: {
          "file-server": {
            command: "python",
            args: ["-m", "server"],
            timeout: 30000,
          },
        },
      };

      const configDir = join(testDir, ".qwen");
      const configPath = join(configDir, "settings.json");
      await mkdir(configDir, { recursive: true });
      await writeFile(configPath, JSON.stringify(config, null, 2));

      const qwencodeMcp = await QwencodeMcp.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".qwen",
        relativeFilePath: "settings.json",
        filePath: configPath,
      });

      expect(qwencodeMcp.getConfig()).toEqual(config);
    });

    it("should throw error for invalid configuration file", async () => {
      const invalidConfig = {
        mcpServers: {
          "invalid-server": {
            timeout: "invalid-timeout", // Should be number
          },
        },
      };

      const configDir = join(testDir, ".qwen");
      const configPath = join(configDir, "settings.json");
      await mkdir(configDir, { recursive: true });
      await writeFile(configPath, JSON.stringify(invalidConfig));

      await expect(
        QwencodeMcp.fromFilePath({
          baseDir: testDir,
          relativeDirPath: ".qwen",
          relativeFilePath: "settings.json",
          filePath: configPath,
        }),
      ).rejects.toThrow("Invalid Qwen Code MCP configuration");
    });

    it("should load configuration without validation when validate is false", async () => {
      const invalidConfig = {
        mcpServers: {
          "invalid-server": {
            timeout: "invalid-timeout",
          },
        },
      };

      const configDir = join(testDir, ".qwen");
      const configPath = join(configDir, "settings.json");
      await mkdir(configDir, { recursive: true });
      await writeFile(configPath, JSON.stringify(invalidConfig));

      const qwencodeMcp = await QwencodeMcp.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".qwen",
        relativeFilePath: "settings.json",
        filePath: configPath,
        validate: false,
      });

      // Should load without validation
      expect(qwencodeMcp).toBeInstanceOf(QwencodeMcp);
    });
  });
});
