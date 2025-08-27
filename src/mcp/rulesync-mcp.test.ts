import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import {
  RulesyncMcp,
  RulesyncMcpFrontmatter,
  RulesyncMcpFrontmatterSchema,
  RulesyncMcpServerFrontmatterSchema,
} from "./rulesync-mcp.js";

describe("RulesyncMcp", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("constructor", () => {
    it("should create instance with valid frontmatter", () => {
      const frontmatter: RulesyncMcpFrontmatter = {
        name: "Test MCP Config",
        description: "A test MCP configuration",
        servers: {
          "test-server": {
            command: "python",
            args: ["-m", "test_server"],
            env: { API_KEY: "test-key" },
          },
        },
      };

      const mcp = new RulesyncMcp({
        frontmatter,
        body: "Additional documentation about the MCP servers",
        baseDir: testDir,
        relativeDirPath: ".rulesync/mcp",
        relativeFilePath: "config.md",
        fileContent: `---
name: "Test MCP Config"
description: "A test MCP configuration"
servers:
  test-server:
    command: python
    args: ["-m", "test_server"]
    env:
      API_KEY: test-key
---

Additional documentation about the MCP servers`,
      });

      expect(mcp).toBeInstanceOf(RulesyncMcp);
      expect(mcp.getRelativeDirPath()).toBe(".rulesync/mcp");
      expect(mcp.getRelativeFilePath()).toBe("config.md");
      expect(mcp.getBody()).toBe("Additional documentation about the MCP servers");
    });

    it("should create instance with multiple servers", () => {
      const frontmatter: RulesyncMcpFrontmatter = {
        name: "Multi-Server Config",
        description: "Configuration with multiple servers",
        servers: {
          "local-server": {
            command: "node",
            args: ["server.js"],
          },
          "remote-server": {
            url: "https://api.example.com/mcp",
            headers: { Authorization: "Bearer token" },
          },
        },
      };

      const mcp = new RulesyncMcp({
        frontmatter,
        body: "",
        baseDir: testDir,
        relativeDirPath: ".rulesync/mcp",
        relativeFilePath: "multi.md",
        fileContent: "content",
      });

      expect(mcp.getServerNames()).toEqual(["local-server", "remote-server"]);
    });

    it("should create instance with server targets", () => {
      const frontmatter: RulesyncMcpFrontmatter = {
        name: "Targeted Servers",
        description: "Servers with specific tool targets",
        servers: {
          "claude-only": {
            targets: ["claudecode"],
            command: "claude-server",
          },
          "multi-target": {
            targets: ["cursor", "cline", "roo"],
            command: "multi-server",
          },
        },
      };

      const mcp = new RulesyncMcp({
        frontmatter,
        body: "",
        baseDir: testDir,
        relativeDirPath: ".rulesync/mcp",
        relativeFilePath: "targeted.md",
        fileContent: "content",
      });

      expect(mcp.shouldIncludeServerForTarget("claude-only", "claudecode")).toBe(true);
      expect(mcp.shouldIncludeServerForTarget("claude-only", "cursor")).toBe(false);
      expect(mcp.shouldIncludeServerForTarget("multi-target", "cursor")).toBe(true);
      expect(mcp.shouldIncludeServerForTarget("multi-target", "cline")).toBe(true);
    });

    it("should validate frontmatter by default", () => {
      const invalidFrontmatter = {
        // missing required fields
        servers: {},
      } as unknown as RulesyncMcpFrontmatter;

      expect(() => {
        const _mcp = new RulesyncMcp({
          frontmatter: invalidFrontmatter,
          body: "Test body",
          baseDir: testDir,
          relativeDirPath: ".rulesync/mcp",
          relativeFilePath: "invalid.md",
          fileContent: "Invalid content",
        });
      }).toThrow();
    });

    it("should skip validation when validate=false", () => {
      const invalidFrontmatter = {
        servers: {},
      } as unknown as RulesyncMcpFrontmatter;

      expect(() => {
        const _mcp = new RulesyncMcp({
          frontmatter: invalidFrontmatter,
          body: "Test body",
          baseDir: testDir,
          relativeDirPath: ".rulesync/mcp",
          relativeFilePath: "invalid.md",
          fileContent: "Invalid content",
          validate: false,
        });
      }).not.toThrow();
    });
  });

  describe("getFrontmatter", () => {
    it("should return the frontmatter object", () => {
      const frontmatter: RulesyncMcpFrontmatter = {
        name: "Test Config",
        description: "Test description",
        targets: ["claudecode"],
        servers: {
          "test-server": {
            command: "test",
            targets: ["claudecode", "cursor"],
          },
        },
      };

      const mcp = new RulesyncMcp({
        frontmatter,
        body: "Test body",
        baseDir: testDir,
        relativeDirPath: ".rulesync/mcp",
        relativeFilePath: "test.md",
        fileContent: "Test content",
      });

      const retrievedFrontmatter = mcp.getFrontmatter();
      expect(retrievedFrontmatter).toEqual(frontmatter);
      expect(retrievedFrontmatter.servers["test-server"]?.targets).toEqual([
        "claudecode",
        "cursor",
      ]);
    });
  });

  describe("toMcpConfig", () => {
    it("should convert to standard MCP config format", () => {
      const frontmatter: RulesyncMcpFrontmatter = {
        name: "Test Config",
        description: "Test description",
        servers: {
          server1: {
            command: "python",
            args: ["-m", "server"],
            env: { KEY: "value" },
          },
          server2: {
            url: "https://example.com/mcp",
            headers: { Authorization: "Bearer token" },
          },
        },
      };

      const mcp = new RulesyncMcp({
        frontmatter,
        body: "",
        baseDir: testDir,
        relativeDirPath: ".rulesync/mcp",
        relativeFilePath: "test.md",
        fileContent: "",
      });

      const config = mcp.toMcpConfig();
      expect(config).toHaveProperty("mcpServers");
      expect(config.mcpServers).toHaveProperty("server1");
      expect(config.mcpServers).toHaveProperty("server2");
      expect(config.mcpServers.server1?.command).toBe("python");
      expect(config.mcpServers.server2?.url).toBe("https://example.com/mcp");
    });

    it("should preserve targets in converted config", () => {
      const frontmatter: RulesyncMcpFrontmatter = {
        name: "Test Config",
        description: "Test description",
        servers: {
          "targeted-server": {
            targets: ["claudecode", "cursor"],
            command: "server",
          },
        },
      };

      const mcp = new RulesyncMcp({
        frontmatter,
        body: "",
        baseDir: testDir,
        relativeDirPath: ".rulesync/mcp",
        relativeFilePath: "test.md",
        fileContent: "",
      });

      const config = mcp.toMcpConfig();
      expect(config.mcpServers["targeted-server"]?.targets).toEqual(["claudecode", "cursor"]);
    });
  });

  describe("getServerNames", () => {
    it("should return all server names", () => {
      const frontmatter: RulesyncMcpFrontmatter = {
        name: "Test",
        description: "Test",
        servers: {
          "server-a": { command: "a" },
          "server-b": { command: "b" },
          "server-c": { url: "https://c.com" },
        },
      };

      const mcp = new RulesyncMcp({
        frontmatter,
        body: "",
        baseDir: testDir,
        relativeDirPath: ".rulesync/mcp",
        relativeFilePath: "test.md",
        fileContent: "",
      });

      expect(mcp.getServerNames()).toEqual(["server-a", "server-b", "server-c"]);
    });
  });

  describe("getServer", () => {
    it("should return specific server configuration", () => {
      const frontmatter: RulesyncMcpFrontmatter = {
        name: "Test",
        description: "Test",
        servers: {
          "test-server": {
            command: "test",
            args: ["arg1", "arg2"],
            env: { KEY: "value" },
          },
        },
      };

      const mcp = new RulesyncMcp({
        frontmatter,
        body: "",
        baseDir: testDir,
        relativeDirPath: ".rulesync/mcp",
        relativeFilePath: "test.md",
        fileContent: "",
      });

      const server = mcp.getServer("test-server");
      expect(server).toBeDefined();
      expect(server?.command).toBe("test");
      expect(server?.args).toEqual(["arg1", "arg2"]);
    });

    it("should return undefined for non-existent server", () => {
      const frontmatter: RulesyncMcpFrontmatter = {
        name: "Test",
        description: "Test",
        servers: {},
      };

      const mcp = new RulesyncMcp({
        frontmatter,
        body: "",
        baseDir: testDir,
        relativeDirPath: ".rulesync/mcp",
        relativeFilePath: "test.md",
        fileContent: "",
      });

      expect(mcp.getServer("non-existent")).toBeUndefined();
    });
  });

  describe("shouldIncludeServerForTarget", () => {
    it("should include server with no targets for all tools", () => {
      const frontmatter: RulesyncMcpFrontmatter = {
        name: "Test",
        description: "Test",
        servers: {
          universal: {
            command: "server",
          },
        },
      };

      const mcp = new RulesyncMcp({
        frontmatter,
        body: "",
        baseDir: testDir,
        relativeDirPath: ".rulesync/mcp",
        relativeFilePath: "test.md",
        fileContent: "",
      });

      expect(mcp.shouldIncludeServerForTarget("universal", "claudecode")).toBe(true);
      expect(mcp.shouldIncludeServerForTarget("universal", "cursor")).toBe(true);
      expect(mcp.shouldIncludeServerForTarget("universal", "any-tool")).toBe(true);
    });

    it("should include server with wildcard target for all tools", () => {
      const frontmatter: RulesyncMcpFrontmatter = {
        name: "Test",
        description: "Test",
        servers: {
          wildcard: {
            targets: ["*"],
            command: "server",
          },
        },
      };

      const mcp = new RulesyncMcp({
        frontmatter,
        body: "",
        baseDir: testDir,
        relativeDirPath: ".rulesync/mcp",
        relativeFilePath: "test.md",
        fileContent: "",
      });

      expect(mcp.shouldIncludeServerForTarget("wildcard", "claudecode")).toBe(true);
      expect(mcp.shouldIncludeServerForTarget("wildcard", "any-tool")).toBe(true);
    });

    it("should only include server for specified targets", () => {
      const frontmatter: RulesyncMcpFrontmatter = {
        name: "Test",
        description: "Test",
        servers: {
          specific: {
            targets: ["claudecode", "cursor"],
            command: "server",
          },
        },
      };

      const mcp = new RulesyncMcp({
        frontmatter,
        body: "",
        baseDir: testDir,
        relativeDirPath: ".rulesync/mcp",
        relativeFilePath: "test.md",
        fileContent: "",
      });

      expect(mcp.shouldIncludeServerForTarget("specific", "claudecode")).toBe(true);
      expect(mcp.shouldIncludeServerForTarget("specific", "cursor")).toBe(true);
      expect(mcp.shouldIncludeServerForTarget("specific", "cline")).toBe(false);
    });

    it("should return false for non-existent server", () => {
      const frontmatter: RulesyncMcpFrontmatter = {
        name: "Test",
        description: "Test",
        servers: {},
      };

      const mcp = new RulesyncMcp({
        frontmatter,
        body: "",
        baseDir: testDir,
        relativeDirPath: ".rulesync/mcp",
        relativeFilePath: "test.md",
        fileContent: "",
      });

      expect(mcp.shouldIncludeServerForTarget("non-existent", "claudecode")).toBe(false);
    });
  });

  describe("validate", () => {
    it("should return success for valid frontmatter", () => {
      const frontmatter: RulesyncMcpFrontmatter = {
        name: "Valid Config",
        description: "Valid configuration",
        servers: {
          "valid-server": {
            command: "server",
          },
        },
      };

      const mcp = new RulesyncMcp({
        frontmatter,
        body: "Valid body",
        baseDir: testDir,
        relativeDirPath: ".rulesync/mcp",
        relativeFilePath: "valid.md",
        fileContent: "Valid content",
        validate: false,
      });

      const result = mcp.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return error for empty servers", () => {
      const frontmatter: RulesyncMcpFrontmatter = {
        name: "Empty Servers",
        description: "No servers defined",
        servers: {},
      };

      const mcp = new RulesyncMcp({
        frontmatter,
        body: "",
        baseDir: testDir,
        relativeDirPath: ".rulesync/mcp",
        relativeFilePath: "empty.md",
        fileContent: "",
        validate: false,
      });

      const result = mcp.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("At least one MCP server must be defined");
    });

    it("should return error for server without command or url", () => {
      const frontmatter: RulesyncMcpFrontmatter = {
        name: "Invalid Server",
        description: "Server without required fields",
        servers: {
          invalid: {
            env: { KEY: "value" },
          } as any,
        },
      };

      const mcp = new RulesyncMcp({
        frontmatter,
        body: "",
        baseDir: testDir,
        relativeDirPath: ".rulesync/mcp",
        relativeFilePath: "invalid.md",
        fileContent: "",
        validate: false,
      });

      const result = mcp.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain(
        "must have either 'command' for local servers or 'url'/'httpUrl' for remote servers",
      );
    });

    it("should validate all transport types", () => {
      const frontmatter: RulesyncMcpFrontmatter = {
        name: "Transport Types",
        description: "Various transport types",
        servers: {
          stdio: {
            command: "server",
            transport: "stdio",
          },
          sse: {
            url: "https://example.com/sse",
            type: "sse",
          },
          http: {
            httpUrl: "https://example.com/http",
            transport: "http",
          },
        },
      };

      const mcp = new RulesyncMcp({
        frontmatter,
        body: "",
        baseDir: testDir,
        relativeDirPath: ".rulesync/mcp",
        relativeFilePath: "transports.md",
        fileContent: "",
      });

      const result = mcp.validate();
      expect(result.success).toBe(true);
    });
  });

  describe("fromFilePath", () => {
    it("should load from markdown file with frontmatter", async () => {
      const mcpDir = join(testDir, ".rulesync", "mcp");
      await mkdir(mcpDir, { recursive: true });

      const filePath = join(mcpDir, "test-config.md");
      const fileContent = `---
name: "Test MCP Configuration"
description: "Configuration loaded from file"
servers:
  github:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
    env:
      GITHUB_TOKEN: "\${GITHUB_TOKEN}"
  database:
    url: "https://db.example.com/mcp"
    headers:
      Authorization: "Bearer token"
---

This is the documentation for the MCP servers.

## GitHub Server
Provides access to GitHub API operations.

## Database Server
Connects to the database MCP endpoint.`;

      await writeFile(filePath, fileContent);

      const mcp = await RulesyncMcp.fromFilePath({ filePath });

      expect(mcp).toBeInstanceOf(RulesyncMcp);
      expect(mcp.getFrontmatter().name).toBe("Test MCP Configuration");
      expect(mcp.getFrontmatter().description).toBe("Configuration loaded from file");
      expect(mcp.getServerNames()).toEqual(["github", "database"]);
      expect(mcp.getBody()).toContain("This is the documentation");
    });

    it("should load from JSON file (backward compatibility)", async () => {
      const mcpDir = join(testDir, ".rulesync", "mcp");
      await mkdir(mcpDir, { recursive: true });

      const filePath = join(mcpDir, ".mcp.json");
      const jsonContent = {
        mcpServers: {
          "json-server": {
            command: "python",
            args: ["-m", "server"],
            env: { API_KEY: "test" },
          },
        },
      };

      await writeFile(filePath, JSON.stringify(jsonContent, null, 2));

      const mcp = await RulesyncMcp.fromFilePath({ filePath });

      expect(mcp).toBeInstanceOf(RulesyncMcp);
      expect(mcp.getFrontmatter().name).toBe(".mcp");
      expect(mcp.getFrontmatter().description).toBe("MCP configuration imported from JSON");
      expect(mcp.getServerNames()).toEqual(["json-server"]);
    });

    it("should handle invalid JSON file", async () => {
      const mcpDir = join(testDir, ".rulesync", "mcp");
      await mkdir(mcpDir, { recursive: true });

      const filePath = join(mcpDir, "invalid.json");
      await writeFile(filePath, "{ invalid json }");

      await expect(RulesyncMcp.fromFilePath({ filePath })).rejects.toThrow();
    });

    it("should handle invalid frontmatter", async () => {
      const mcpDir = join(testDir, ".rulesync", "mcp");
      await mkdir(mcpDir, { recursive: true });

      const filePath = join(mcpDir, "invalid.md");
      const fileContent = `---
# Missing required fields
servers: {}
---

Content`;

      await writeFile(filePath, fileContent);

      await expect(RulesyncMcp.fromFilePath({ filePath })).rejects.toThrow("Invalid frontmatter");
    });
  });

  describe("fromMcpConfig", () => {
    it("should create from standard MCP config object", () => {
      const config = {
        mcpServers: {
          server1: {
            command: "node",
            args: ["server.js"],
          },
          server2: {
            url: "https://api.example.com/mcp",
          },
        },
      };

      const mcp = RulesyncMcp.fromMcpConfig(
        config,
        "Imported Config",
        "Imported from standard format",
      );

      expect(mcp).toBeInstanceOf(RulesyncMcp);
      expect(mcp.getFrontmatter().name).toBe("Imported Config");
      expect(mcp.getFrontmatter().description).toBe("Imported from standard format");
      expect(mcp.getServerNames()).toEqual(["server1", "server2"]);
    });

    it("should use default name and description", () => {
      const config = {
        mcpServers: {
          test: { command: "test" },
        },
      };

      const mcp = RulesyncMcp.fromMcpConfig(config);

      expect(mcp.getFrontmatter().name).toBe("MCP Configuration");
      expect(mcp.getFrontmatter().description).toBe("Model Context Protocol server configuration");
    });
  });

  describe("schema validation", () => {
    it("should validate RulesyncMcpFrontmatterSchema with required fields", () => {
      const validFrontmatter = {
        name: "Valid",
        description: "Valid description",
        servers: {
          test: { command: "test" },
        },
      };

      const invalidFrontmatter1 = {
        // missing name
        description: "Invalid",
        servers: {},
      };

      const invalidFrontmatter2 = {
        name: "Invalid",
        // missing description
        servers: {},
      };

      const invalidFrontmatter3 = {
        name: "Invalid",
        description: "Invalid",
        // missing servers
      };

      // Valid case should not throw
      expect(() => {
        RulesyncMcpFrontmatterSchema.parse(validFrontmatter);
      }).not.toThrow();

      // Invalid cases should throw
      [invalidFrontmatter1, invalidFrontmatter2, invalidFrontmatter3].forEach((invalid, index) => {
        expect(
          () => {
            RulesyncMcpFrontmatterSchema.parse(invalid);
          },
          `Invalid frontmatter ${index + 1} should throw`,
        ).toThrow();
      });
    });

    it("should validate server configuration options", () => {
      const validServer = {
        command: "server",
        args: ["arg1"],
        env: { KEY: "value" },
        disabled: false,
        timeout: 30000,
        trust: true,
        cwd: "/path",
        transport: "stdio",
        alwaysAllow: ["tool1"],
        tools: ["tool2"],
      };

      expect(() => {
        RulesyncMcpServerFrontmatterSchema.parse(validServer);
      }).not.toThrow();
    });
  });

  describe("edge cases", () => {
    it("should handle empty body", () => {
      const frontmatter: RulesyncMcpFrontmatter = {
        name: "Empty Body",
        description: "Config with empty body",
        servers: {
          test: { command: "test" },
        },
      };

      const mcp = new RulesyncMcp({
        frontmatter,
        body: "",
        baseDir: testDir,
        relativeDirPath: ".rulesync/mcp",
        relativeFilePath: "empty.md",
        fileContent: "File content",
      });

      expect(mcp.getBody()).toBe("");
    });

    it("should handle servers with complex environment variables", () => {
      const frontmatter: RulesyncMcpFrontmatter = {
        name: "Complex Env",
        description: "Complex environment variables",
        servers: {
          complex: {
            command: "server",
            env: {
              PATH: "/usr/bin:/usr/local/bin",
              API_KEY: "very-long-key-with-special-chars!@#$%",
              JSON_CONFIG: '{"key": "value", "nested": {"prop": 123}}',
            },
          },
        },
      };

      const mcp = new RulesyncMcp({
        frontmatter,
        body: "",
        baseDir: testDir,
        relativeDirPath: ".rulesync/mcp",
        relativeFilePath: "complex.md",
        fileContent: "",
      });

      const server = mcp.getServer("complex");
      expect(server?.env?.JSON_CONFIG).toContain('{"key": "value"');
    });

    it("should handle servers with all possible fields", () => {
      const frontmatter: RulesyncMcpFrontmatter = {
        name: "Full Config",
        description: "All fields populated",
        targets: ["claudecode", "cursor"],
        servers: {
          full: {
            targets: ["*"],
            command: "server",
            args: ["--verbose", "--port", "8080"],
            url: "https://backup.url",
            httpUrl: "https://http.url",
            env: { KEY: "value" },
            disabled: false,
            networkTimeout: 60000,
            timeout: 30000,
            trust: true,
            cwd: "/workspace",
            transport: "stdio",
            type: "sse",
            alwaysAllow: ["tool1", "tool2"],
            tools: ["tool3", "tool4"],
            headers: { "X-Custom": "header" },
          },
        },
      };

      const mcp = new RulesyncMcp({
        frontmatter,
        body: "Full configuration",
        baseDir: testDir,
        relativeDirPath: ".rulesync/mcp",
        relativeFilePath: "full.md",
        fileContent: "",
      });

      const result = mcp.validate();
      expect(result.success).toBe(true);

      const config = mcp.toMcpConfig();
      expect(config.mcpServers.full).toHaveProperty("command");
      expect(config.mcpServers.full).toHaveProperty("args");
      expect(config.mcpServers.full).toHaveProperty("env");
    });

    it("should handle very long server names", () => {
      const longName = "x".repeat(100);
      const frontmatter: RulesyncMcpFrontmatter = {
        name: "Long Names",
        description: "Very long server names",
        servers: {
          [longName]: { command: "server" },
        },
      };

      const mcp = new RulesyncMcp({
        frontmatter,
        body: "",
        baseDir: testDir,
        relativeDirPath: ".rulesync/mcp",
        relativeFilePath: "long.md",
        fileContent: "",
      });

      expect(mcp.getServerNames()).toContain(longName);
    });

    it("should handle special characters in server names", () => {
      const frontmatter: RulesyncMcpFrontmatter = {
        name: "Special Names",
        description: "Special character server names",
        servers: {
          "server-with-dashes": { command: "test" },
          server_with_underscores: { command: "test" },
          "server.with.dots": { command: "test" },
          "server@special": { command: "test" },
        },
      };

      const mcp = new RulesyncMcp({
        frontmatter,
        body: "",
        baseDir: testDir,
        relativeDirPath: ".rulesync/mcp",
        relativeFilePath: "special.md",
        fileContent: "",
      });

      expect(mcp.getServerNames().length).toBe(4);
    });
  });

  describe("inheritance from RulesyncFile", () => {
    it("should properly extend RulesyncFile", () => {
      const frontmatter: RulesyncMcpFrontmatter = {
        name: "Inheritance Test",
        description: "Testing inheritance",
        servers: {
          test: { command: "test" },
        },
      };

      const mcp = new RulesyncMcp({
        frontmatter,
        body: "Inheritance body",
        baseDir: testDir,
        relativeDirPath: ".rulesync/mcp",
        relativeFilePath: "inheritance.md",
        fileContent: "Inheritance file content",
      });

      // Test inherited methods
      expect(mcp.getBody()).toBe("Inheritance body");
      expect(mcp.getRelativeDirPath()).toBe(".rulesync/mcp");
      expect(mcp.getRelativeFilePath()).toBe("inheritance.md");
      expect(mcp.getFileContent()).toBe("Inheritance file content");
      expect(mcp.getFilePath()).toContain(".rulesync/mcp/inheritance.md");
    });
  });
});
