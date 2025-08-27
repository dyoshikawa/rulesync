import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import { CodexcliMcp, CodexcliMcpConfig } from "./codexcli-mcp.js";
import { RulesyncMcp, RulesyncMcpFrontmatter } from "./rulesync-mcp.js";

describe("CodexcliMcp", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  describe("constructor", () => {
    it("should create an instance with valid local STDIO configuration", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: CodexcliMcpConfig = {
          $schema: "https://opencode.ai/config.json",
          mcp: {
            "local-server": {
              type: "local",
              command: ["python", "-m", "codex_server"],
              enabled: true,
              environment: {
                OPENAI_API_KEY: "test-key",
                CODEX_DEFAULT_MODEL: "gpt-4o-mini",
              },
              timeout: 30000,
            },
          },
        };

        const codexcliMcp = new CodexcliMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "opencode.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
        });

        expect(codexcliMcp).toBeDefined();
        expect(codexcliMcp.getConfig()).toEqual(config);
      } finally {
        await cleanup();
      }
    });

    it("should create an instance with valid remote HTTP configuration", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: CodexcliMcpConfig = {
          mcp: {
            "remote-server": {
              type: "remote",
              url: "http://localhost:8000/mcp",
              enabled: true,
              headers: {
                Authorization: "Bearer test-token",
              },
              timeout: 60000,
            },
          },
        };

        const codexcliMcp = new CodexcliMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "opencode.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
        });

        expect(codexcliMcp).toBeDefined();
        expect(codexcliMcp.getConfig()).toEqual(config);
      } finally {
        await cleanup();
      }
    });

    it("should create an instance with Docker-based configuration", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: CodexcliMcpConfig = {
          mcp: {
            "docker-server": {
              type: "local",
              command: ["docker", "run", "-i", "--rm", "-e", "OPENAI_API_KEY", "codex-mcp:latest"],
              enabled: true,
              environment: {
                OPENAI_API_KEY: "${OPENAI_API_KEY}",
              },
            },
          },
        };

        const codexcliMcp = new CodexcliMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "opencode.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
        });

        expect(codexcliMcp).toBeDefined();
        expect(codexcliMcp.getConfig()).toEqual(config);
      } finally {
        await cleanup();
      }
    });

    it("should validate configuration during construction", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        // Invalid config - missing both command and url
        const config: CodexcliMcpConfig = {
          mcp: {
            "invalid-server": {
              type: "local",
              enabled: true,
              // Missing required command field for local type
            },
          },
        };

        const codexcliMcp = new CodexcliMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "opencode.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
          validate: false, // Skip validation during construction
        });

        // Validation should fail when called explicitly
        const result = codexcliMcp.validate();
        expect(result.success).toBe(false);
        expect(result.error?.message).toContain(
          "must have either 'command' (for local) or 'url' (for remote)",
        );
      } finally {
        await cleanup();
      }
    });
  });

  describe("getFileName", () => {
    it("should return correct filename", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: CodexcliMcpConfig = {
          mcp: {
            "test-server": {
              type: "local",
              command: ["node", "server.js"],
              enabled: true,
            },
          },
        };

        const codexcliMcp = new CodexcliMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "opencode.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
        });

        expect(codexcliMcp.getFileName()).toBe("opencode.json");
      } finally {
        await cleanup();
      }
    });
  });

  describe("generateContent", () => {
    it("should generate valid JSON content", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: CodexcliMcpConfig = {
          $schema: "https://opencode.ai/config.json",
          mcp: {
            "python-server": {
              type: "local",
              command: ["python", "-m", "codex_server"],
              enabled: true,
              environment: {
                OPENAI_API_KEY: "test-key",
                DEBUG: "true",
              },
              cwd: "/path/to/server",
              timeout: 45000,
            },
          },
        };

        const codexcliMcp = new CodexcliMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "opencode.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
        });

        const content = await codexcliMcp.generateContent();
        const parsedContent = JSON.parse(content);

        expect(parsedContent).toEqual(config);
        expect(parsedContent.$schema).toBe("https://opencode.ai/config.json");
        expect(parsedContent.mcp["python-server"].type).toBe("local");
        expect(parsedContent.mcp["python-server"].command).toEqual([
          "python",
          "-m",
          "codex_server",
        ]);
      } finally {
        await cleanup();
      }
    });
  });

  describe("fromRulesyncMcp", () => {
    it("should convert from RulesyncMcp with STDIO server", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const frontmatter: RulesyncMcpFrontmatter = {
          name: "test-mcp",
          description: "Test Codex CLI MCP configuration",
          targets: ["codexcli"],
          servers: {
            "python-codex": {
              targets: ["codexcli"],
              command: "python",
              args: ["-m", "codex_wrapper"],
              env: {
                OPENAI_API_KEY: "test-key",
                CODEX_DEFAULT_MODEL: "gpt-4o",
              },
              timeout: 30000,
              disabled: false,
            },
          },
        };

        const rulesyncMcp = new RulesyncMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "rulesync-mcp.md",
          fileContent: "test content",
          frontmatter,
          body: "# Test MCP Configuration\n\nTest body content",
        });

        const codexcliMcp = CodexcliMcp.fromRulesyncMcp(rulesyncMcp, testDir, ".");

        const config = codexcliMcp.getConfig();
        expect(config.$schema).toBe("https://opencode.ai/config.json");
        expect(config.mcp["python-codex"]).toBeDefined();
        expect(config.mcp["python-codex"]?.type).toBe("local");
        expect(config.mcp["python-codex"]?.command).toEqual(["python", "-m", "codex_wrapper"]);
        expect(config.mcp["python-codex"]?.environment).toEqual({
          OPENAI_API_KEY: "test-key",
          CODEX_DEFAULT_MODEL: "gpt-4o",
        });
        expect(config.mcp["python-codex"]?.enabled).toBe(true);
      } finally {
        await cleanup();
      }
    });

    it("should convert from RulesyncMcp with remote SSE server", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const frontmatter: RulesyncMcpFrontmatter = {
          name: "remote-mcp",
          description: "Remote Codex CLI MCP configuration",
          targets: ["codexcli"],
          servers: {
            "remote-codex": {
              targets: ["codexcli"],
              url: "https://codex.example.com/sse",
              transport: "sse",
              headers: {
                Authorization: "Bearer token123",
              },
              timeout: 60000,
              disabled: false,
            },
          },
        };

        const rulesyncMcp = new RulesyncMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "rulesync-mcp.md",
          fileContent: "test content",
          frontmatter,
          body: "# Test MCP Configuration\n\nTest body content",
        });

        const codexcliMcp = CodexcliMcp.fromRulesyncMcp(rulesyncMcp, testDir, ".");

        const config = codexcliMcp.getConfig();
        expect(config.mcp["remote-codex"]).toBeDefined();
        expect(config.mcp["remote-codex"]?.type).toBe("remote");
        expect(config.mcp["remote-codex"]?.url).toBe("https://codex.example.com/sse");
        expect(config.mcp["remote-codex"]?.headers).toEqual({
          Authorization: "Bearer token123",
        });
        expect(config.mcp["remote-codex"]?.enabled).toBe(true);
      } finally {
        await cleanup();
      }
    });

    it("should handle array command conversion", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const frontmatter: RulesyncMcpFrontmatter = {
          name: "array-command-mcp",
          description: "Array command test",
          targets: ["codexcli"],
          servers: {
            "node-codex": {
              targets: ["codexcli"],
              command: ["node", "index.js", "--verbose"],
              env: {
                NODE_ENV: "development",
              },
            },
          },
        };

        const rulesyncMcp = new RulesyncMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "rulesync-mcp.md",
          fileContent: "test content",
          frontmatter,
          body: "# Test MCP Configuration\n\nTest body content",
        });

        const codexcliMcp = CodexcliMcp.fromRulesyncMcp(rulesyncMcp, testDir, ".");

        const config = codexcliMcp.getConfig();
        expect(config.mcp["node-codex"]?.command).toEqual(["node", "index.js", "--verbose"]);
        expect(config.mcp["node-codex"]?.type).toBe("local");
      } finally {
        await cleanup();
      }
    });

    it("should skip servers not targeted for codexcli", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const frontmatter: RulesyncMcpFrontmatter = {
          name: "mixed-targets-mcp",
          description: "Mixed targets test",
          targets: ["claudecode"],
          servers: {
            "other-server": {
              targets: ["claudecode"],
              command: "python",
              args: ["-m", "other_server"],
            },
          },
        };

        const rulesyncMcp = new RulesyncMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "rulesync-mcp.md",
          fileContent: "test content",
          frontmatter,
          body: "# Test MCP Configuration\n\nTest body content",
        });

        const codexcliMcp = CodexcliMcp.fromRulesyncMcp(rulesyncMcp, testDir, ".");

        const config = codexcliMcp.getConfig();
        expect(Object.keys(config.mcp)).toHaveLength(0);
      } finally {
        await cleanup();
      }
    });
  });

  describe("validate", () => {
    it("should pass validation for valid configuration", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: CodexcliMcpConfig = {
          mcp: {
            "valid-server": {
              type: "local",
              command: ["python", "-m", "server"],
              enabled: true,
              timeout: 30000,
            },
          },
        };

        const codexcliMcp = new CodexcliMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "opencode.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
        });

        const result = codexcliMcp.validate();
        expect(result.success).toBe(true);
        expect(result.error).toBeNull();
      } finally {
        await cleanup();
      }
    });

    it("should fail validation for empty server configuration", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: CodexcliMcpConfig = {
          mcp: {},
        };

        const codexcliMcp = new CodexcliMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "opencode.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
          validate: false, // Skip validation during construction
        });

        const result = codexcliMcp.validate();
        expect(result.success).toBe(false);
        expect(result.error?.message).toContain("At least one MCP server must be defined");
      } finally {
        await cleanup();
      }
    });

    it("should fail validation for server with neither command nor url", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: CodexcliMcpConfig = {
          mcp: {
            "incomplete-server": {
              type: "local",
              enabled: true,
            },
          },
        };

        const codexcliMcp = new CodexcliMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "opencode.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
          validate: false,
        });

        const result = codexcliMcp.validate();
        expect(result.success).toBe(false);
        expect(result.error?.message).toContain(
          "must have either 'command' (for local) or 'url' (for remote)",
        );
      } finally {
        await cleanup();
      }
    });

    it("should fail validation for server with both command and url", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: CodexcliMcpConfig = {
          mcp: {
            "conflicting-server": {
              type: "local",
              command: ["python", "server.py"],
              url: "http://localhost:8000",
              enabled: true,
            },
          },
        };

        const codexcliMcp = new CodexcliMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "opencode.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
          validate: false,
        });

        const result = codexcliMcp.validate();
        expect(result.success).toBe(false);
        expect(result.error?.message).toContain(
          "cannot have both local ('command') and remote ('url')",
        );
      } finally {
        await cleanup();
      }
    });

    it("should fail validation for timeout out of range", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: CodexcliMcpConfig = {
          mcp: {
            "timeout-server": {
              command: ["node", "server.js"],
              timeout: 500, // Too low
              enabled: true,
            },
          },
        };

        const codexcliMcp = new CodexcliMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "opencode.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
          validate: false,
        });

        const result = codexcliMcp.validate();
        expect(result.success).toBe(false);
        expect(result.error?.message).toContain(
          "timeout must be between 1 second (1000) and 10 minutes (600000)",
        );
      } finally {
        await cleanup();
      }
    });

    it("should fail validation for type mismatch", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: CodexcliMcpConfig = {
          mcp: {
            "type-mismatch-server": {
              type: "remote",
              command: ["python", "server.py"], // Should be url for remote
              enabled: true,
            },
          },
        };

        const codexcliMcp = new CodexcliMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "opencode.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
          validate: false,
        });

        const result = codexcliMcp.validate();
        expect(result.success).toBe(false);
        expect(result.error?.message).toContain('has local configuration but type is not "local"');
      } finally {
        await cleanup();
      }
    });
  });

  describe("fromFilePath", () => {
    it("should load valid configuration from file", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: CodexcliMcpConfig = {
          $schema: "https://opencode.ai/config.json",
          mcp: {
            "file-server": {
              type: "local",
              command: ["bun", "run", "server.ts"],
              enabled: true,
              environment: {
                NODE_ENV: "test",
              },
            },
          },
        };

        const filePath = join(testDir, "opencode.json");
        await writeFile(filePath, JSON.stringify(config, null, 2), "utf-8");

        const codexcliMcp = await CodexcliMcp.fromFilePath({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "opencode.json",
          filePath,
        });

        expect(codexcliMcp.getConfig()).toEqual(config);
        expect(codexcliMcp.getFileName()).toBe("opencode.json");
      } finally {
        await cleanup();
      }
    });

    it("should throw error for invalid JSON file", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const filePath = join(testDir, "invalid.json");
        await writeFile(filePath, "{ invalid json", "utf-8");

        await expect(
          CodexcliMcp.fromFilePath({
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

    it("should throw validation error for invalid configuration file", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const invalidConfig = {
          // Invalid structure - missing mcp field
          servers: {
            "invalid-server": {
              // Missing required fields
            },
          },
        };

        const filePath = join(testDir, "invalid-config.json");
        await writeFile(filePath, JSON.stringify(invalidConfig, null, 2), "utf-8");

        await expect(
          CodexcliMcp.fromFilePath({
            baseDir: testDir,
            relativeDirPath: ".",
            relativeFilePath: "invalid-config.json",
            filePath,
          }),
        ).rejects.toThrow("Invalid Codex CLI MCP configuration");
      } finally {
        await cleanup();
      }
    });
  });
});
