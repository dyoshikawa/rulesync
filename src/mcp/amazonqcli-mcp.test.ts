import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import { AmazonqcliMcp, AmazonqcliMcpConfig } from "./amazonqcli-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

describe("AmazonqcliMcp", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("constructor", () => {
    it("should create instance with valid configuration", () => {
      const config: AmazonqcliMcpConfig = {
        mcpServers: {
          "test-server": {
            command: "python",
            args: ["-m", "test_server"],
            env: { API_KEY: "test-key" },
            timeout: 30000,
            disabled: false,
            autoApprove: ["safe_tool"],
          },
        },
      };

      const mcp = new AmazonqcliMcp({
        baseDir: testDir,
        relativeDirPath: ".amazonq",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(config, null, 2),
        config,
      });

      expect(mcp).toBeInstanceOf(AmazonqcliMcp);
      expect(mcp.getConfig()).toEqual(config);
    });

    it("should create instance with empty configuration", () => {
      const mcp = new AmazonqcliMcp({
        baseDir: testDir,
        relativeDirPath: ".amazonq",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ mcpServers: {} }, null, 2),
      });

      expect(mcp).toBeInstanceOf(AmazonqcliMcp);
      expect(mcp.getConfig()).toEqual({ mcpServers: {} });
    });
  });

  describe("getFileName", () => {
    it("should return the correct filename", () => {
      const mcp = new AmazonqcliMcp({
        baseDir: testDir,
        relativeDirPath: ".amazonq",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ mcpServers: {} }, null, 2),
      });

      expect(mcp.getFileName()).toBe(".amazonq/mcp.json");
    });
  });

  describe("generateContent", () => {
    it("should generate JSON content with proper formatting", async () => {
      const config: AmazonqcliMcpConfig = {
        mcpServers: {
          "github-server": {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-github"],
            env: {
              GITHUB_TOKEN: "${GITHUB_TOKEN}",
            },
            autoApprove: ["create_repository", "list_issues"],
          },
          "database-server": {
            command: "python",
            args: ["-m", "db_mcp_server"],
            timeout: 60000,
            disabled: false,
          },
        },
      };

      const mcp = new AmazonqcliMcp({
        baseDir: testDir,
        relativeDirPath: ".amazonq",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(config, null, 2),
        config,
      });

      const content = await mcp.generateContent();
      const parsedContent = JSON.parse(content);

      expect(parsedContent).toEqual(config);
      expect(content).toContain('"mcpServers"');
      expect(content).toContain('"github-server"');
      expect(content).toContain('"autoApprove"');
    });

    it("should generate empty configuration", async () => {
      const mcp = new AmazonqcliMcp({
        baseDir: testDir,
        relativeDirPath: ".amazonq",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ mcpServers: {} }, null, 2),
      });

      const content = await mcp.generateContent();
      const parsedContent = JSON.parse(content);

      expect(parsedContent).toEqual({ mcpServers: {} });
    });
  });

  describe("fromRulesyncMcp", () => {
    it("should convert RulesyncMcp to AmazonqcliMcp", () => {
      const rulesyncMcp = new RulesyncMcp({
        baseDir: ".",
        relativeDirPath: ".rulesync/mcp",
        relativeFilePath: "config.md",
        frontmatter: {
          name: "Test MCP Config",
          description: "Test configuration",
          servers: {
            "python-server": {
              targets: ["amazonqcli"],
              command: "python",
              args: ["-m", "mcp_server"],
              env: { DEBUG: "true" },
              timeout: 30000,
              alwaysAllow: ["safe_tool", "read_only"],
            },
            "excluded-server": {
              targets: ["cline"],
              command: "node",
              args: ["server.js"],
            },
            "universal-server": {
              command: "docker",
              args: ["run", "mcp-server"],
            },
          },
        },
        body: "",
        fileContent: "",
      });

      const amazonqMcp = AmazonqcliMcp.fromRulesyncMcp(rulesyncMcp);
      const config = amazonqMcp.getConfig();

      // Should include python-server (targets includes amazonqcli)
      expect(config.mcpServers["python-server"]).toBeDefined();
      expect(config.mcpServers["python-server"]?.command).toBe("python");
      expect(config.mcpServers["python-server"]?.args).toEqual(["-m", "mcp_server"]);
      expect(config.mcpServers["python-server"]?.env).toEqual({ DEBUG: "true" });
      expect(config.mcpServers["python-server"]?.timeout).toBe(30000);
      expect(config.mcpServers["python-server"]?.autoApprove).toEqual(["safe_tool", "read_only"]);

      // Should exclude excluded-server (targets doesn't include amazonqcli)
      expect(config.mcpServers["excluded-server"]).toBeUndefined();

      // Should include universal-server (no targets specified)
      expect(config.mcpServers["universal-server"]).toBeDefined();
      expect(config.mcpServers["universal-server"]?.command).toBe("docker");
    });

    it("should handle wildcard targets", () => {
      const rulesyncMcp = new RulesyncMcp({
        baseDir: ".",
        relativeDirPath: ".rulesync/mcp",
        relativeFilePath: "config.md",
        frontmatter: {
          name: "Wildcard Config",
          description: "Test wildcard targets",
          servers: {
            "wildcard-server": {
              targets: ["*"],
              command: "python",
              args: ["server.py"],
            },
          },
        },
        body: "",
        fileContent: "",
      });

      const amazonqMcp = AmazonqcliMcp.fromRulesyncMcp(rulesyncMcp);
      const config = amazonqMcp.getConfig();

      expect(config.mcpServers["wildcard-server"]).toBeDefined();
      expect(config.mcpServers["wildcard-server"]?.command).toBe("python");
    });
  });

  describe("fromFilePath", () => {
    it("should load configuration from JSON file", async () => {
      const configPath = join(testDir, ".amazonq", "mcp.json");
      const config: AmazonqcliMcpConfig = {
        mcpServers: {
          "file-server": {
            command: "node",
            args: ["file-server.js"],
            env: { PORT: "8080" },
            timeout: 15000,
            autoApprove: ["read_file"],
          },
        },
      };

      await mkdir(join(testDir, ".amazonq"), { recursive: true });
      await writeFile(configPath, JSON.stringify(config, null, 2));

      const mcp = await AmazonqcliMcp.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".amazonq",
        relativeFilePath: "mcp.json",
        filePath: configPath,
        validate: true,
      });

      expect(mcp).toBeInstanceOf(AmazonqcliMcp);
      expect(mcp.getConfig()).toEqual(config);
    });

    it("should handle invalid JSON gracefully", async () => {
      const configPath = join(testDir, ".amazonq", "mcp.json");
      await mkdir(join(testDir, ".amazonq"), { recursive: true });
      await writeFile(configPath, "{ invalid json }");

      await expect(
        AmazonqcliMcp.fromFilePath({
          baseDir: testDir,
          relativeDirPath: ".amazonq",
          relativeFilePath: "mcp.json",
          filePath: configPath,
          validate: true,
        }),
      ).rejects.toThrow();
    });
  });

  describe("validate", () => {
    it("should validate correct configuration", () => {
      const config: AmazonqcliMcpConfig = {
        mcpServers: {
          "valid-server": {
            command: "python",
            args: ["server.py"],
            env: { KEY: "value" },
            timeout: 5000,
            disabled: false,
            autoApprove: ["tool1", "tool2"],
          },
        },
      };

      const mcp = new AmazonqcliMcp({
        baseDir: testDir,
        relativeDirPath: ".amazonq",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(config, null, 2),
        config,
      });

      const result = mcp.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should reject server without command when not disabled", () => {
      const config: AmazonqcliMcpConfig = {
        mcpServers: {
          "invalid-server": {
            args: ["server.py"],
          } as any,
        },
      };

      expect(() => {
         
        new AmazonqcliMcp({
          baseDir: testDir,
          relativeDirPath: ".amazonq",
          relativeFilePath: "mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
          validate: true,
        });
      }).toThrow("must have a 'command' field or be marked as 'disabled'");
    });

    it("should accept disabled server without command", () => {
      const config: AmazonqcliMcpConfig = {
        mcpServers: {
          "disabled-server": {
            disabled: true,
          },
        },
      };

      const mcp = new AmazonqcliMcp({
        baseDir: testDir,
        relativeDirPath: ".amazonq",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(config, null, 2),
        config,
      });

      const result = mcp.validate();
      expect(result.success).toBe(true);
    });

    it("should reject invalid args type", () => {
      const config: AmazonqcliMcpConfig = {
        mcpServers: {
          "invalid-server": {
            command: "python",
            args: "not-an-array" as any,
          },
        },
      };

      expect(() => {
         
        new AmazonqcliMcp({
          baseDir: testDir,
          relativeDirPath: ".amazonq",
          relativeFilePath: "mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
          validate: true,
        });
      }).toThrow("'args' must be an array");
    });

    it("should reject non-string args items", () => {
      const config: AmazonqcliMcpConfig = {
        mcpServers: {
          "invalid-server": {
            command: "python",
            args: ["valid", 123, "arg"] as any,
          },
        },
      };

      expect(() => {
         
        new AmazonqcliMcp({
          baseDir: testDir,
          relativeDirPath: ".amazonq",
          relativeFilePath: "mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
          validate: true,
        });
      }).toThrow("all args must be strings");
    });

    it("should reject invalid autoApprove type", () => {
      const config: AmazonqcliMcpConfig = {
        mcpServers: {
          "invalid-server": {
            command: "python",
            autoApprove: "not-an-array" as any,
          },
        },
      };

      expect(() => {
         
        new AmazonqcliMcp({
          baseDir: testDir,
          relativeDirPath: ".amazonq",
          relativeFilePath: "mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
          validate: true,
        });
      }).toThrow("'autoApprove' must be an array");
    });

    it("should reject non-positive timeout", () => {
      const config: AmazonqcliMcpConfig = {
        mcpServers: {
          "invalid-server": {
            command: "python",
            timeout: -1000,
          },
        },
      };

      expect(() => {
         
        new AmazonqcliMcp({
          baseDir: testDir,
          relativeDirPath: ".amazonq",
          relativeFilePath: "mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
          validate: true,
        });
      }).toThrow("'timeout' must be a positive number");
    });

    it("should reject non-boolean disabled", () => {
      const config: AmazonqcliMcpConfig = {
        mcpServers: {
          "invalid-server": {
            command: "python",
            disabled: "yes" as any,
          },
        },
      };

      expect(() => {
         
        new AmazonqcliMcp({
          baseDir: testDir,
          relativeDirPath: ".amazonq",
          relativeFilePath: "mcp.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
          validate: true,
        });
      }).toThrow("'disabled' must be a boolean");
    });
  });

  describe("setConfig and getConfig", () => {
    it("should update configuration", () => {
      const mcp = new AmazonqcliMcp({
        baseDir: testDir,
        relativeDirPath: ".amazonq",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ mcpServers: {} }, null, 2),
      });

      const newConfig: AmazonqcliMcpConfig = {
        mcpServers: {
          "new-server": {
            command: "node",
            args: ["server.js"],
          },
        },
      };

      mcp.setConfig(newConfig);
      expect(mcp.getConfig()).toEqual(newConfig);
    });
  });
});
