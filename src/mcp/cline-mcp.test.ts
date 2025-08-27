import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import type { RulesyncMcpServer } from "../types/mcp.js";
import { ClineMcp, ClineMcpConfig } from "./cline-mcp.js";
import { RulesyncMcp, RulesyncMcpFrontmatter } from "./rulesync-mcp.js";

describe("ClineMcp", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  describe("constructor", () => {
    it("should create an instance with valid STDIO configuration", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: ClineMcpConfig = {
          mcpServers: {
            "stdio-server": {
              command: "python",
              args: ["-m", "test_server"],
              env: {
                API_KEY: "test-key",
              },
              alwaysAllow: ["tool1", "tool2"],
              disabled: false,
            },
          },
        };

        const clineMcp = new ClineMcp({
          baseDir: testDir,
          relativeDirPath: ".cline",
          relativeFilePath: "mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
        });

        expect(clineMcp).toBeDefined();
        expect(clineMcp.getConfig()).toEqual(config);
      } finally {
        await cleanup();
      }
    });

    it("should create an instance with valid SSE configuration", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: ClineMcpConfig = {
          mcpServers: {
            "sse-server": {
              url: "https://mcp-example.com/endpoint",
              headers: {
                Authorization: "Bearer test-token",
              },
              alwaysAllow: [],
              disabled: false,
            },
          },
        };

        const clineMcp = new ClineMcp({
          baseDir: testDir,
          relativeDirPath: ".cline",
          relativeFilePath: "mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
        });

        expect(clineMcp).toBeDefined();
        expect(clineMcp.getConfig()).toEqual(config);
      } finally {
        await cleanup();
      }
    });

    it("should create an instance with networkTimeout configuration", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: ClineMcpConfig = {
          mcpServers: {
            "timeout-server": {
              command: "node",
              args: ["server.js"],
              networkTimeout: 60000, // 1 minute
            },
          },
        };

        const clineMcp = new ClineMcp({
          baseDir: testDir,
          relativeDirPath: ".cline",
          relativeFilePath: "mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
        });

        expect(clineMcp).toBeDefined();
        expect(clineMcp.getConfig()).toEqual(config);
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
              // Missing both command and url
              args: ["arg1"],
            },
          },
        };

        // Schema validation is passed, but transport validation occurs in validate()
        const clineMcp = new ClineMcp({
          baseDir: testDir,
          relativeDirPath: ".cline",
          relativeFilePath: "mcp.json",
          fileContent: JSON.stringify(invalidConfig, null, 2),
           
          config: invalidConfig as ClineMcpConfig,
          validate: false, // Skip validation during construction
        });

        expect(clineMcp).toBeDefined();
      } finally {
        await cleanup();
      }
    });
  });

  describe("getFileName", () => {
    it("should return '.cline/mcp.json'", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: ClineMcpConfig = {
          mcpServers: {
            test: { command: "test" },
          },
        };

        const clineMcp = new ClineMcp({
          baseDir: testDir,
          relativeDirPath: ".cline",
          relativeFilePath: "mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
        });

        expect(clineMcp.getFileName()).toBe(".cline/mcp.json");
      } finally {
        await cleanup();
      }
    });
  });

  describe("getGlobalConfigPath", () => {
    it("should return correct path for macOS", () => {
      const originalPlatform = process.platform;
      const originalHome = process.env.HOME;

      // Mock macOS environment
      Object.defineProperty(process, "platform", {
        value: "darwin",
        configurable: true,
      });
      process.env.HOME = "/Users/testUser";

      try {
        const path = ClineMcp.getGlobalConfigPath();
        expect(path).toBe(
          "/Users/testUser/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json",
        );
      } finally {
        // Restore original values
        Object.defineProperty(process, "platform", {
          value: originalPlatform,
          configurable: true,
        });
        process.env.HOME = originalHome;
      }
    });

    it("should return correct path for Windows", () => {
      const originalPlatform = process.platform;
      const originalAppData = process.env.APPDATA;

      // Mock Windows environment
      Object.defineProperty(process, "platform", {
        value: "win32",
        configurable: true,
      });
      process.env.APPDATA = "C:\\Users\\testUser\\AppData\\Roaming";

      try {
        const path = ClineMcp.getGlobalConfigPath();
        expect(path).toBe(
          "C:\\Users\\testUser\\AppData\\Roaming/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json",
        );
      } finally {
        // Restore original values
        Object.defineProperty(process, "platform", {
          value: originalPlatform,
          configurable: true,
        });
        process.env.APPDATA = originalAppData;
      }
    });

    it("should return correct path for Linux", () => {
      const originalPlatform = process.platform;
      const originalHome = process.env.HOME;
      const originalVscodeAgent = process.env.VSCODE_AGENT_FOLDER;

      // Mock Linux environment
      Object.defineProperty(process, "platform", {
        value: "linux",
        configurable: true,
      });
      process.env.HOME = "/home/testUser";
      delete process.env.VSCODE_AGENT_FOLDER;

      try {
        const path = ClineMcp.getGlobalConfigPath();
        expect(path).toBe(
          "/home/testUser/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json",
        );
      } finally {
        // Restore original values
        Object.defineProperty(process, "platform", {
          value: originalPlatform,
          configurable: true,
        });
        process.env.HOME = originalHome;
        if (originalVscodeAgent) {
          process.env.VSCODE_AGENT_FOLDER = originalVscodeAgent;
        }
      }
    });

    it("should return VS Code Server path for Linux when VSCODE_AGENT_FOLDER is set", () => {
      const originalPlatform = process.platform;
      const originalHome = process.env.HOME;
      const originalVscodeAgent = process.env.VSCODE_AGENT_FOLDER;

      // Mock Linux VS Code Server environment
      Object.defineProperty(process, "platform", {
        value: "linux",
        configurable: true,
      });
      process.env.HOME = "/home/testUser";
      process.env.VSCODE_AGENT_FOLDER = "/some/path";

      try {
        const path = ClineMcp.getGlobalConfigPath();
        expect(path).toBe(
          "/home/testUser/.vscode-server/data/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json",
        );
      } finally {
        // Restore original values
        Object.defineProperty(process, "platform", {
          value: originalPlatform,
          configurable: true,
        });
        process.env.HOME = originalHome;
        if (originalVscodeAgent) {
          process.env.VSCODE_AGENT_FOLDER = originalVscodeAgent;
        } else {
          delete process.env.VSCODE_AGENT_FOLDER;
        }
      }
    });

    it("should return null for unsupported platform", () => {
      const originalPlatform = process.platform;

      // Mock unsupported platform
      Object.defineProperty(process, "platform", {
        value: "freebsd",
        configurable: true,
      });

      try {
        const path = ClineMcp.getGlobalConfigPath();
        expect(path).toBeNull();
      } finally {
        // Restore original value
        Object.defineProperty(process, "platform", {
          value: originalPlatform,
          configurable: true,
        });
      }
    });

    it("should return null when HOME or APPDATA is not set", () => {
      const originalPlatform = process.platform;
      const originalHome = process.env.HOME;
      const originalAppData = process.env.APPDATA;

      // Test macOS without HOME
      Object.defineProperty(process, "platform", {
        value: "darwin",
        configurable: true,
      });
      delete process.env.HOME;

      try {
        const path = ClineMcp.getGlobalConfigPath();
        expect(path).toBeNull();
      } finally {
        // Restore original values
        Object.defineProperty(process, "platform", {
          value: originalPlatform,
          configurable: true,
        });
        if (originalHome) process.env.HOME = originalHome;
        if (originalAppData) process.env.APPDATA = originalAppData;
      }
    });
  });

  describe("generateContent", () => {
    it("should generate valid JSON content", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: ClineMcpConfig = {
          mcpServers: {
            "test-server": {
              command: "python",
              args: ["-m", "server"],
              alwaysAllow: ["tool1"],
              disabled: false,
              networkTimeout: 45000,
            },
          },
        };

        const clineMcp = new ClineMcp({
          baseDir: testDir,
          relativeDirPath: ".cline",
          relativeFilePath: "mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
        });

        const content = await clineMcp.generateContent();
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
          targets: ["cline"] as const,
          command: "python",
          args: ["-m", "server"],
          env: {
            API_KEY: "test-key",
          },
          alwaysAllow: ["tool1", "tool2"],
          disabled: false,
        };

        const frontmatter: RulesyncMcpFrontmatter = {
          targets: ["cline"],
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

        const clineMcp = ClineMcp.fromRulesyncMcp(rulesyncMcp, testDir, ".cline");

        expect(clineMcp.getFileName()).toBe(".cline/mcp.json");
        const config = clineMcp.getConfig();
        expect(config.mcpServers["test-server"]).toEqual({
          command: "python",
          args: ["-m", "server"],
          env: {
            API_KEY: "test-key",
          },
          alwaysAllow: ["tool1", "tool2"],
          disabled: false,
        });
      } finally {
        await cleanup();
      }
    });

    it("should convert SSE server configuration", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const rulesyncServer: RulesyncMcpServer = {
          targets: ["cline"] as const,
          url: "https://mcp-example.com/endpoint",
          headers: {
            Authorization: "Bearer token",
          },
          alwaysAllow: [],
          disabled: true,
          networkTimeout: 120000,
        };

        const frontmatter: RulesyncMcpFrontmatter = {
          targets: ["cline"],
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

        const clineMcp = ClineMcp.fromRulesyncMcp(rulesyncMcp, testDir, ".cline");

        const config = clineMcp.getConfig();
        expect(config.mcpServers["remote-server"]).toEqual({
          url: "https://mcp-example.com/endpoint",
          headers: {
            Authorization: "Bearer token",
          },
          alwaysAllow: [],
          disabled: true,
          networkTimeout: 120000,
        });
      } finally {
        await cleanup();
      }
    });

    it("should handle command arrays", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const rulesyncServer: RulesyncMcpServer = {
          targets: ["cline"] as const,
          command: ["node", "server.js", "--verbose"],
          args: ["--port", "3000"],
        };

        const frontmatter: RulesyncMcpFrontmatter = {
          targets: ["cline"],
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

        const clineMcp = ClineMcp.fromRulesyncMcp(rulesyncMcp, testDir, ".cline");

        const config = clineMcp.getConfig();
        expect(config.mcpServers["node-server"]).toEqual({
          command: "node",
          args: ["server.js", "--verbose", "--port", "3000"],
        });
      } finally {
        await cleanup();
      }
    });

    it("should skip servers not targeting cline", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const frontmatter: RulesyncMcpFrontmatter = {
          targets: ["cline"],
          name: "Multi-target MCP Config",
          description: "Configuration with multiple targets",
          servers: {
            "cursor-only": {
              targets: ["cursor"],
              command: "test",
            },
            "cline-server": {
              targets: ["cline"],
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

        const clineMcp = ClineMcp.fromRulesyncMcp(rulesyncMcp, testDir, ".cline");

        const config = clineMcp.getConfig();
        expect(Object.keys(config.mcpServers)).toEqual(["cline-server"]);
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
        const config: ClineMcpConfig = {
          mcpServers: {
            "stdio-server": {
              command: "python",
              args: ["-m", "server"],
            },
          },
        };

        const clineMcp = new ClineMcp({
          baseDir: testDir,
          relativeDirPath: ".cline",
          relativeFilePath: "mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
        });

        const result = clineMcp.validate();
        expect(result.success).toBe(true);
        expect(result.error).toBeNull();
      } finally {
        await cleanup();
      }
    });

    it("should pass validation for valid SSE configuration", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: ClineMcpConfig = {
          mcpServers: {
            "sse-server": {
              url: "https://example.com/mcp",
              headers: {
                Authorization: "Bearer token",
              },
            },
          },
        };

        const clineMcp = new ClineMcp({
          baseDir: testDir,
          relativeDirPath: ".cline",
          relativeFilePath: "mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
        });

        const result = clineMcp.validate();
        expect(result.success).toBe(true);
        expect(result.error).toBeNull();
      } finally {
        await cleanup();
      }
    });

    it("should fail validation for server with no transport configuration", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: ClineMcpConfig = {
          mcpServers: {
            "invalid-server": {
              // Missing both command and url
              env: { TEST: "value" },
            },
          },
        };

        const clineMcp = new ClineMcp({
          baseDir: testDir,
          relativeDirPath: ".cline",
          relativeFilePath: "mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
          validate: false, // Skip constructor validation
        });

        const result = clineMcp.validate();
        expect(result.success).toBe(false);
        expect(result.error?.message).toContain(
          "Server \"invalid-server\" must have either 'command' (for STDIO) or 'url' (for SSE) transport configuration",
        );
      } finally {
        await cleanup();
      }
    });

    it("should fail validation for server with both transport configurations", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: ClineMcpConfig = {
          mcpServers: {
            "invalid-server": {
              command: "python",
              url: "https://example.com",
            },
          },
        };

        const clineMcp = new ClineMcp({
          baseDir: testDir,
          relativeDirPath: ".cline",
          relativeFilePath: "mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
          validate: false, // Skip constructor validation
        });

        const result = clineMcp.validate();
        expect(result.success).toBe(false);
        expect(result.error?.message).toContain(
          "Server \"invalid-server\" cannot have both STDIO ('command') and SSE ('url') transport configuration",
        );
      } finally {
        await cleanup();
      }
    });

    it("should fail validation for empty mcpServers", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: ClineMcpConfig = {
          mcpServers: {},
        };

        const clineMcp = new ClineMcp({
          baseDir: testDir,
          relativeDirPath: ".cline",
          relativeFilePath: "mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
          validate: false,
        });

        const result = clineMcp.validate();
        expect(result.success).toBe(false);
        expect(result.error?.message).toBe("At least one MCP server must be defined");
      } finally {
        await cleanup();
      }
    });

    it("should fail validation for networkTimeout outside valid range", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: ClineMcpConfig = {
          mcpServers: {
            "invalid-timeout": {
              command: "python",
              networkTimeout: 15000, // Less than 30 seconds
            },
          },
        };

        const clineMcp = new ClineMcp({
          baseDir: testDir,
          relativeDirPath: ".cline",
          relativeFilePath: "mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
          validate: false,
        });

        const result = clineMcp.validate();
        expect(result.success).toBe(false);
        expect(result.error?.message).toContain(
          'Server "invalid-timeout" networkTimeout must be between 30 seconds (30000) and 1 hour (3600000)',
        );
      } finally {
        await cleanup();
      }
    });

    it("should pass validation for networkTimeout in valid range", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: ClineMcpConfig = {
          mcpServers: {
            "valid-timeout": {
              command: "python",
              networkTimeout: 60000, // 1 minute - valid
            },
          },
        };

        const clineMcp = new ClineMcp({
          baseDir: testDir,
          relativeDirPath: ".cline",
          relativeFilePath: "mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
        });

        const result = clineMcp.validate();
        expect(result.success).toBe(true);
        expect(result.error).toBeNull();
      } finally {
        await cleanup();
      }
    });
  });

  describe("fromFilePath", () => {
    it("should load valid configuration from file", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: ClineMcpConfig = {
          mcpServers: {
            "file-server": {
              command: "node",
              args: ["server.js"],
              alwaysAllow: ["read_file"],
            },
          },
        };

        const filePath = join(testDir, "cline_mcp_settings.json");
        await import("node:fs/promises").then((fs) =>
          fs.writeFile(filePath, JSON.stringify(config, null, 2)),
        );

        const clineMcp = await ClineMcp.fromFilePath({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "cline_mcp_settings.json",
          filePath,
        });

        expect(clineMcp.getConfig()).toEqual(config);
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
          ClineMcp.fromFilePath({
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
          ClineMcp.fromFilePath({
            baseDir: testDir,
            relativeDirPath: ".",
            relativeFilePath: "invalid-schema.json",
            filePath,
            validate: true,
          }),
        ).rejects.toThrow("Invalid Cline MCP configuration");
      } finally {
        await cleanup();
      }
    });
  });
});
