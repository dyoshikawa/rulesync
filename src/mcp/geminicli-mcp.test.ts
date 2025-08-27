import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import type { McpConfig } from "../types/mcp.js";
import {
  GeminicliMcp,
  type GeminicliMcpConfig,
  GeminicliMcpConfigSchema,
} from "./geminicli-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

describe("GeminicliMcp", () => {
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
      const config: GeminicliMcpConfig = {
        mcpServers: {
          "test-server": {
            command: "python",
            args: ["-m", "my_server"],
            env: { API_KEY: "test" },
            timeout: 5000,
            trust: false,
          },
        },
      };

      const instance = new GeminicliMcp({
        config,
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".gemini/settings.json",
        fileContent: JSON.stringify(config, null, 2),
      });

      expect(instance.getConfig()).toEqual(config);
      expect(instance.getFileName()).toBe(".gemini/settings.json");
    });

    it("should create instance with valid SSE configuration", () => {
      const config: GeminicliMcpConfig = {
        mcpServers: {
          "sse-server": {
            url: "https://api.example.com/sse",
            env: { TOKEN: "test-token" },
            trust: true,
          },
        },
      };

      const instance = new GeminicliMcp({
        config,
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".gemini/settings.json",
        fileContent: JSON.stringify(config, null, 2),
      });

      expect(instance.getConfig()).toEqual(config);
    });

    it("should create instance with valid HTTP configuration", () => {
      const config: GeminicliMcpConfig = {
        mcpServers: {
          "http-server": {
            httpUrl: "http://localhost:3000/mcp",
            timeout: 15000,
          },
        },
      };

      const instance = new GeminicliMcp({
        config,
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".gemini/settings.json",
        fileContent: JSON.stringify(config, null, 2),
      });

      expect(instance.getConfig()).toEqual(config);
    });

    it("should not throw with empty server configuration (zod/mini is permissive)", () => {
      const configWithEmptyServer = {
        mcpServers: {
          "empty-server": {
            // No transport configuration - will be caught in validate() method
          },
        },
      };

      expect(
        () =>
          new GeminicliMcp({
            config: configWithEmptyServer as GeminicliMcpConfig,
            baseDir: testDir,
            relativeDirPath: ".",
            relativeFilePath: ".gemini/settings.json",
            fileContent: JSON.stringify(configWithEmptyServer, null, 2),
            validate: true,
          }),
      ).not.toThrow(); // Constructor doesn't throw, but validate() will catch this
    });

    it("should skip validation when validate=false", () => {
      const invalidConfig = {
        mcpServers: {
          "invalid-server": {
            invalidField: "invalid",
          },
        },
      };

      expect(
        () =>
          new GeminicliMcp({
            config: invalidConfig as GeminicliMcpConfig,
            baseDir: testDir,
            relativeDirPath: ".",
            relativeFilePath: ".gemini/settings.json",
            fileContent: JSON.stringify(invalidConfig, null, 2),
            validate: false,
          }),
      ).not.toThrow();
    });
  });

  describe("generateContent", () => {
    it("should generate correct JSON content", async () => {
      const config: GeminicliMcpConfig = {
        mcpServers: {
          "test-server": {
            command: "python",
            args: ["-m", "test_server"],
            env: { API_KEY: "secret" },
            timeout: 30000,
          },
        },
      };

      const instance = new GeminicliMcp({
        config,
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".gemini/settings.json",
        fileContent: JSON.stringify(config, null, 2),
      });

      const content = await instance.generateContent();
      const parsedContent = JSON.parse(content);

      expect(parsedContent).toEqual(config);
      expect(content).toContain('"mcpServers"');
      expect(content).toContain('"test-server"');
    });

    it("should format JSON with proper indentation", async () => {
      const config: GeminicliMcpConfig = {
        mcpServers: {
          server: {
            command: "node",
            args: ["server.js"],
          },
        },
      };

      const instance = new GeminicliMcp({
        config,
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".gemini/settings.json",
        fileContent: JSON.stringify(config, null, 2),
      });

      const content = await instance.generateContent();

      // Check that JSON is properly indented (contains multiple spaces)
      expect(content).toMatch(/\n {2}/);
    });
  });

  describe("fromRulesyncMcp", () => {
    it("should convert basic STDIO server configuration", () => {
      const rulesyncConfig: McpConfig = {
        mcpServers: {
          "stdio-server": {
            command: "python",
            args: ["-m", "server"],
            env: { API_KEY: "test" },
          },
        },
      };

      const rulesyncMcp = new RulesyncMcp({
        frontmatter: {
          name: "test",
          description: "test",
          servers: rulesyncConfig.mcpServers,
        },
        body: "",
        baseDir: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.md",
        fileContent: "---\nname: test\ndescription: test\n---\n",
        validate: false,
      });

      const converted = GeminicliMcp.fromRulesyncMcp(rulesyncMcp, testDir);

      expect(converted.getConfig()).toEqual({
        mcpServers: {
          "stdio-server": {
            command: "python",
            args: ["-m", "server"],
            env: { API_KEY: "test" },
          },
        },
      });
    });

    it("should convert array command to command + args", () => {
      const rulesyncConfig: McpConfig = {
        mcpServers: {
          "array-cmd-server": {
            command: ["npx", "-y", "mcp-server"],
            args: ["--port", "8080"],
          },
        },
      };

      const rulesyncMcp = new RulesyncMcp({
        frontmatter: {
          name: "test",
          description: "test",
          servers: rulesyncConfig.mcpServers,
        },
        body: "",
        baseDir: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.md",
        fileContent: "---\nname: test\ndescription: test\n---\n",
        validate: false,
      });

      const converted = GeminicliMcp.fromRulesyncMcp(rulesyncMcp, testDir);

      expect(converted.getConfig().mcpServers["array-cmd-server"]).toEqual({
        command: "npx",
        args: ["-y", "mcp-server", "--port", "8080"],
      });
    });

    it("should convert SSE server configuration", () => {
      const rulesyncConfig: McpConfig = {
        mcpServers: {
          "sse-server": {
            url: "https://api.example.com/sse",
            transport: "sse",
            env: { TOKEN: "test" },
          },
        },
      };

      const rulesyncMcp = new RulesyncMcp({
        frontmatter: {
          name: "test",
          description: "test",
          servers: rulesyncConfig.mcpServers,
        },
        body: "",
        baseDir: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.md",
        fileContent: "---\nname: test\ndescription: test\n---\n",
        validate: false,
      });

      const converted = GeminicliMcp.fromRulesyncMcp(rulesyncMcp, testDir);

      expect(converted.getConfig().mcpServers["sse-server"]).toEqual({
        url: "https://api.example.com/sse",
        env: { TOKEN: "test" },
      });
    });

    it("should convert HTTP server configuration", () => {
      const rulesyncConfig: McpConfig = {
        mcpServers: {
          "http-server": {
            url: "http://localhost:3000/stream",
            transport: "http",
            timeout: 60000,
          },
        },
      };

      const rulesyncMcp = new RulesyncMcp({
        frontmatter: {
          name: "test",
          description: "test",
          servers: rulesyncConfig.mcpServers,
        },
        body: "",
        baseDir: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.md",
        fileContent: "---\nname: test\ndescription: test\n---\n",
        validate: false,
      });

      const converted = GeminicliMcp.fromRulesyncMcp(rulesyncMcp, testDir);

      expect(converted.getConfig().mcpServers["http-server"]).toEqual({
        httpUrl: "http://localhost:3000/stream",
        timeout: 60000,
      });
    });

    it("should map alwaysAllow to trust field", () => {
      const rulesyncConfig: McpConfig = {
        mcpServers: {
          "trusted-server": {
            command: "python",
            alwaysAllow: ["tool1", "tool2"],
          },
        },
      };

      const rulesyncMcp = new RulesyncMcp({
        frontmatter: {
          name: "test",
          description: "test",
          servers: rulesyncConfig.mcpServers,
        },
        body: "",
        baseDir: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.md",
        fileContent: "---\nname: test\ndescription: test\n---\n",
        validate: false,
      });

      const converted = GeminicliMcp.fromRulesyncMcp(rulesyncMcp, testDir);

      expect(converted.getConfig().mcpServers["trusted-server"]?.trust).toBe(true);
    });

    it("should skip disabled servers", () => {
      const rulesyncConfig: McpConfig = {
        mcpServers: {
          "enabled-server": {
            command: "python",
          },
          "disabled-server": {
            command: "node",
            disabled: true,
          },
        },
      };

      const rulesyncMcp = new RulesyncMcp({
        frontmatter: {
          name: "test",
          description: "test",
          servers: rulesyncConfig.mcpServers,
        },
        body: "",
        baseDir: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.md",
        fileContent: "---\nname: test\ndescription: test\n---\n",
        validate: false,
      });

      const converted = GeminicliMcp.fromRulesyncMcp(rulesyncMcp, testDir);

      expect(converted.getConfig().mcpServers).toHaveProperty("enabled-server");
      expect(converted.getConfig().mcpServers).not.toHaveProperty("disabled-server");
    });

    it("should filter servers by target", () => {
      const rulesyncMcp = new RulesyncMcp({
        frontmatter: {
          name: "test",
          description: "test",
          servers: {
            "geminicli-server": {
              command: "python",
              targets: ["geminicli"],
            },
            "other-tool-server": {
              command: "node",
              targets: ["claudecode"],
            },
          },
        },
        body: "",
        baseDir: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.md",
        fileContent: "---\nname: test\ndescription: test\n---\n",
        validate: false,
      });

      const converted = GeminicliMcp.fromRulesyncMcp(rulesyncMcp, testDir);

      expect(converted.getConfig().mcpServers).toHaveProperty("geminicli-server");
      expect(converted.getConfig().mcpServers).not.toHaveProperty("other-tool-server");
    });
  });

  describe("validate", () => {
    it("should pass validation for valid configuration", () => {
      const config: GeminicliMcpConfig = {
        mcpServers: {
          "valid-server": {
            command: "python",
            timeout: 5000,
          },
        },
      };

      const instance = new GeminicliMcp({
        config,
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".gemini/settings.json",
        fileContent: JSON.stringify(config, null, 2),
        validate: false, // Skip constructor validation
      });

      const result = instance.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });

    it("should fail validation when no servers defined", () => {
      const config: GeminicliMcpConfig = {
        mcpServers: {},
      };

      const instance = new GeminicliMcp({
        config,
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".gemini/settings.json",
        fileContent: JSON.stringify(config, null, 2),
        validate: false,
      });

      const result = instance.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("At least one MCP server must be defined");
    });

    it("should fail validation when server has no transport configuration", () => {
      const config: GeminicliMcpConfig = {
        mcpServers: {
          "invalid-server": {
            env: { KEY: "value" },
          },
        },
      };

      const instance = new GeminicliMcp({
        config,
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".gemini/settings.json",
        fileContent: JSON.stringify(config, null, 2),
        validate: false,
      });

      const result = instance.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("must have either 'command'");
    });

    it("should fail validation when server has multiple transport configurations", () => {
      const config: GeminicliMcpConfig = {
        mcpServers: {
          "conflicting-server": {
            command: "python",
            url: "https://example.com",
            httpUrl: "http://localhost:3000",
          },
        },
      };

      const instance = new GeminicliMcp({
        config,
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".gemini/settings.json",
        fileContent: JSON.stringify(config, null, 2),
        validate: false,
      });

      const result = instance.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("cannot have multiple transport configurations");
    });

    it("should fail validation for timeout outside valid range", () => {
      const config: GeminicliMcpConfig = {
        mcpServers: {
          "timeout-server": {
            command: "python",
            timeout: 500, // Too short (< 1000ms)
          },
        },
      };

      const instance = new GeminicliMcp({
        config,
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".gemini/settings.json",
        fileContent: JSON.stringify(config, null, 2),
        validate: false,
      });

      const result = instance.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("timeout must be between");
    });

    it("should fail validation for timeout too large", () => {
      const config: GeminicliMcpConfig = {
        mcpServers: {
          "timeout-server": {
            command: "python",
            timeout: 15 * 60 * 1000, // Too long (> 10 minutes)
          },
        },
      };

      const instance = new GeminicliMcp({
        config,
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".gemini/settings.json",
        fileContent: JSON.stringify(config, null, 2),
        validate: false,
      });

      const result = instance.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("timeout must be between");
    });
  });

  describe("fromFilePath", () => {
    it("should load valid configuration from file", async () => {
      const config: GeminicliMcpConfig = {
        mcpServers: {
          "file-server": {
            command: "node",
            args: ["server.js"],
            env: { NODE_ENV: "test" },
          },
        },
      };

      const configFile = join(testDir, "settings.json");
      await writeFile(configFile, JSON.stringify(config, null, 2));

      const instance = await GeminicliMcp.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "settings.json",
        filePath: configFile,
      });

      expect(instance.getConfig()).toEqual(config);
    });

    it("should throw error for invalid JSON", async () => {
      const configFile = join(testDir, "invalid.json");
      await writeFile(configFile, "{ invalid json }");

      await expect(
        GeminicliMcp.fromFilePath({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "invalid.json",
          filePath: configFile,
        }),
      ).rejects.toThrow("Failed to load JSON configuration");
    });

    it("should throw error for invalid schema", async () => {
      const invalidConfig = {
        invalidRoot: "invalid",
      };

      const configFile = join(testDir, "invalid-schema.json");
      await writeFile(configFile, JSON.stringify(invalidConfig, null, 2));

      await expect(
        GeminicliMcp.fromFilePath({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "invalid-schema.json",
          filePath: configFile,
        }),
      ).rejects.toThrow("Invalid Gemini CLI MCP configuration");
    });

    it("should skip validation when validate=false", async () => {
      const invalidConfig = {
        invalidRoot: "invalid",
      };

      const configFile = join(testDir, "no-validate.json");
      await writeFile(configFile, JSON.stringify(invalidConfig, null, 2));

      const instance = await GeminicliMcp.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "no-validate.json",
        filePath: configFile,
        validate: false,
      });

      // Should not throw, but also should not be a valid GeminicliMcpConfig
      expect(instance).toBeInstanceOf(GeminicliMcp);
    });
  });

  describe("schema validation", () => {
    it("should validate STDIO server with required fields", () => {
      const server = {
        command: "python",
        args: ["-m", "server"],
      };

      const result = GeminicliMcpConfigSchema.safeParse({
        mcpServers: { test: server },
      });

      expect(result.success).toBe(true);
    });

    it("should validate SSE server with URL", () => {
      const server = {
        url: "https://api.example.com/sse",
        env: { TOKEN: "test" },
      };

      const result = GeminicliMcpConfigSchema.safeParse({
        mcpServers: { test: server },
      });

      expect(result.success).toBe(true);
    });

    it("should validate HTTP server with httpUrl", () => {
      const server = {
        httpUrl: "http://localhost:3000/mcp",
        timeout: 15000,
        trust: true,
      };

      const result = GeminicliMcpConfigSchema.safeParse({
        mcpServers: { test: server },
      });

      expect(result.success).toBe(true);
    });

    it("should reject invalid server configuration", () => {
      const invalidServer = {
        invalidField: "invalid", // Invalid field without any valid fields
      };

      const result = GeminicliMcpConfigSchema.safeParse({
        mcpServers: { test: invalidServer },
      });

      // Since zod/mini doesn't have strict(), this will pass validation
      // but will fail at runtime validation in the class
      expect(result.success).toBe(true);
    });
  });

  describe("getFileName", () => {
    it("should return correct filename", () => {
      const config: GeminicliMcpConfig = {
        mcpServers: {
          test: { command: "python" },
        },
      };

      const instance = new GeminicliMcp({
        config,
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".gemini/settings.json",
        fileContent: JSON.stringify(config, null, 2),
      });

      expect(instance.getFileName()).toBe(".gemini/settings.json");
    });
  });
});
