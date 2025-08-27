import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import { type JunieConfig, JunieMcp } from "./junie-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

describe("JunieMcp", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("constructor", () => {
    it("should create JunieMcp instance with valid config", () => {
      const config: JunieConfig = {
        mcpServers: {
          "test-server": {
            name: "test-server",
            command: "npx",
            args: ["-y", "test-package"],
            env: { API_KEY: "test-key" },
            transport: "stdio",
          },
        },
      };

      const junie = new JunieMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".junie/mcp_settings.json",
        fileContent: JSON.stringify(config, null, 2),
        config,
      });

      expect(junie.toolName).toBe("junie");
      expect(junie.getConfig()).toEqual(config);
    });

    it("should throw error for invalid config", () => {
      const invalidConfig = {
        mcpServers: {
          "invalid-server": {
            // Missing required 'name' field
            command: "test",
          },
        },
      };

      expect(() => {
        void new JunieMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: ".junie/mcp_settings.json",
          fileContent: JSON.stringify(invalidConfig, null, 2),
          config: invalidConfig as unknown as JunieConfig,
        });
      }).toThrow();
    });
  });

  describe("getFileName", () => {
    it("should return correct filename", () => {
      const config: JunieConfig = {
        mcpServers: {},
      };

      const junie = new JunieMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".junie/mcp_settings.json",
        fileContent: "{}",
        config,
      });

      expect(junie.getFileName()).toBe(".junie/mcp_settings.json");
    });
  });

  describe("generateContent", () => {
    it("should generate JSON content with proper indentation", async () => {
      const config: JunieConfig = {
        mcpServers: {
          "jetbrains-ide": {
            name: "jetbrains-ide",
            command: "npx",
            args: ["-y", "@jetbrains/mcp-proxy"],
            env: {
              IDE_PORT: "63342",
              LOG_ENABLED: "true",
            },
            transport: "stdio",
          },
        },
      };

      const junie = new JunieMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".junie/mcp_settings.json",
        fileContent: "",
        config,
      });

      const content = await junie.generateContent();
      const parsed = JSON.parse(content);

      expect(parsed).toEqual(config);
      expect(content).toContain('  "mcpServers":');
    });
  });

  describe("fromRulesyncMcp", () => {
    it("should convert basic STDIO server configuration", () => {
      const frontmatter = {
        name: "Test MCP",
        description: "Test configuration",
        servers: {
          "test-server": {
            command: ["python", "-m", "test_server"],
            args: ["--port", "8080"],
            env: { API_KEY: "test-key" },
            cwd: "/path/to/project",
          },
        },
      };

      const rulesyncMcp = new RulesyncMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "rulesync.mcp.md",
        frontmatter,
        body: "",
        fileContent: "test content",
        validate: false,
      });

      const junieMcp = JunieMcp.fromRulesyncMcp(rulesyncMcp, testDir, ".");

      const config = junieMcp.getConfig();
      expect(config.mcpServers["test-server"]).toEqual({
        name: "test-server",
        command: "python",
        args: ["-m", "test_server", "--port", "8080"],
        env: { API_KEY: "test-key" },
        workingDirectory: "/path/to/project",
        transport: "stdio",
      });
    });

    it("should handle string command format", () => {
      const frontmatter = {
        name: "Simple MCP",
        description: "Simple configuration",
        servers: {
          "simple-server": {
            command: "simple-cmd",
            args: ["arg1", "arg2"],
          },
        },
      };

      const rulesyncMcp = new RulesyncMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "rulesync.mcp.md",
        frontmatter,
        body: "",
        fileContent: "test content",
        validate: false,
      });

      const junieMcp = JunieMcp.fromRulesyncMcp(rulesyncMcp, testDir, ".");

      const config = junieMcp.getConfig();
      expect(config.mcpServers["simple-server"]).toEqual({
        name: "simple-server",
        command: "simple-cmd",
        args: ["arg1", "arg2"],
        transport: "stdio",
      });
    });

    it("should throw error for non-STDIO transport", () => {
      const frontmatter = {
        name: "Remote MCP",
        description: "Remote configuration",
        servers: {
          "remote-server": {
            url: "https://example.com/mcp",
            transport: "sse" as const,
          },
        },
      };

      const rulesyncMcp = new RulesyncMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "rulesync.mcp.md",
        frontmatter,
        body: "",
        fileContent: "test content",
        validate: false,
      });

      expect(() => {
        JunieMcp.fromRulesyncMcp(rulesyncMcp, testDir, ".");
      }).toThrow("Junie only supports STDIO transport with 'command' field");
    });
  });

  describe("validate", () => {
    it("should pass validation for valid config", () => {
      const config: JunieConfig = {
        mcpServers: {
          "valid-server": {
            name: "valid-server",
            command: "test-command",
            transport: "stdio",
          },
        },
      };

      const junie = new JunieMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".junie/mcp_settings.json",
        fileContent: JSON.stringify(config),
        config,
      });

      const result = junie.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBe(undefined);
    });

    it("should fail validation for empty servers", () => {
      const config: JunieConfig = {
        mcpServers: {},
      };

      const junie = new JunieMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".junie/mcp_settings.json",
        fileContent: JSON.stringify(config),
        config,
      });

      const result = junie.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toBe("At least one MCP server must be defined");
    });

    it("should fail validation for server without command", () => {
      const config = {
        mcpServers: {
          "invalid-server": {
            name: "invalid-server",
            // Missing command field
          },
        },
      };

      const junie = new JunieMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".junie/mcp_settings.json",
        fileContent: JSON.stringify(config),
        config: config as unknown as JunieConfig,
        validate: false,
      });

      const result = junie.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("Invalid input");
    });

    it("should fail validation for non-stdio transport", () => {
      const config = {
        mcpServers: {
          "invalid-transport": {
            name: "invalid-transport",
            command: "test-cmd",
            transport: "http",
          },
        },
      };

      const junie = new JunieMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".junie/mcp_settings.json",
        fileContent: JSON.stringify(config),
        config: config as unknown as JunieConfig,
        validate: false,
      });

      const result = junie.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("Invalid input");
    });
  });

  describe("fromFilePath", () => {
    it("should load valid JSON configuration from file", async () => {
      const config: JunieConfig = {
        mcpServers: {
          "file-server": {
            name: "file-server",
            command: "python",
            args: ["-m", "file_server"],
            env: { CONFIG: "test" },
          },
        },
      };

      const configPath = join(testDir, "mcp_settings.json");
      await writeFile(configPath, JSON.stringify(config, null, 2));

      const junie = await JunieMcp.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "mcp_settings.json",
        filePath: configPath,
      });

      expect(junie.getConfig()).toEqual(config);
    });

    it("should throw error for invalid JSON configuration", async () => {
      const invalidConfig = {
        mcpServers: {
          invalid: {
            // Missing required fields
          },
        },
      };

      const configPath = join(testDir, "invalid.json");
      await writeFile(configPath, JSON.stringify(invalidConfig, null, 2));

      await expect(
        JunieMcp.fromFilePath({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "invalid.json",
          filePath: configPath,
        }),
      ).rejects.toThrow("Invalid Junie MCP configuration");
    });
  });

  describe("integration test", () => {
    it("should create complete configuration file", async () => {
      const config: JunieConfig = {
        mcpServers: {
          "jetbrains-ide": {
            name: "jetbrains-ide",
            command: "npx",
            args: ["-y", "@jetbrains/mcp-proxy"],
            env: {
              IDE_PORT: "63342",
              LOG_ENABLED: "true",
            },
            transport: "stdio",
          },
          filesystem: {
            name: "filesystem",
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-filesystem", "/project/root"],
            env: {
              LOG_LEVEL: "info",
            },
            workingDirectory: "/project/root",
          },
        },
      };

      const junie = new JunieMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".junie/mcp_settings.json",
        fileContent: "",
        config,
      });

      const content = await junie.generateContent();
      const parsed = JSON.parse(content);

      expect(parsed.mcpServers).toHaveProperty("jetbrains-ide");
      expect(parsed.mcpServers).toHaveProperty("filesystem");
      expect(parsed.mcpServers["jetbrains-ide"].name).toBe("jetbrains-ide");
      expect(parsed.mcpServers["jetbrains-ide"].command).toBe("npx");
      expect(parsed.mcpServers["filesystem"].workingDirectory).toBe("/project/root");
    });

    it("should write configuration file to correct path", async () => {
      const config: JunieConfig = {
        mcpServers: {
          test: {
            name: "test",
            command: "echo",
          },
        },
      };

      const targetDir = join(testDir, ".junie");
      await mkdir(targetDir, { recursive: true });

      const junie = new JunieMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".junie/mcp_settings.json",
        fileContent: "",
        config,
      });

      const targetPath = join(testDir, ".junie", "mcp_settings.json");
      const content = await junie.generateContent();
      await writeFile(targetPath, content);

      const loadedJunie = await JunieMcp.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".junie/mcp_settings.json",
        filePath: targetPath,
      });

      expect(loadedJunie.getConfig()).toEqual(config);
    });
  });
});
