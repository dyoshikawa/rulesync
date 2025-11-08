import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../utils/file.js";
import { AmazonqcliMcp } from "./amazonqcli-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

describe("AmazonqcliMcp", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should create instance with default parameters", () => {
      const validJsonContent = JSON.stringify({
        mcpServers: {
          "@anthropic-ai/mcp-server-filesystem": {
            command: "npx",
            args: ["-y", "@anthropic-ai/mcp-server-filesystem", "/workspace"],
          },
        },
      });

      const amazonqcliMcp = new AmazonqcliMcp({
        relativeDirPath: ".amazonq",
        relativeFilePath: "mcp.json",
        fileContent: validJsonContent,
      });

      expect(amazonqcliMcp).toBeInstanceOf(AmazonqcliMcp);
      expect(amazonqcliMcp.getRelativeDirPath()).toBe(".amazonq");
      expect(amazonqcliMcp.getRelativeFilePath()).toBe("mcp.json");
      expect(amazonqcliMcp.getFileContent()).toBe(validJsonContent);
    });

    it("should create instance with custom baseDir", () => {
      const validJsonContent = JSON.stringify({
        mcpServers: {},
      });

      const amazonqcliMcp = new AmazonqcliMcp({
        baseDir: "/custom/path",
        relativeDirPath: ".amazonq",
        relativeFilePath: "mcp.json",
        fileContent: validJsonContent,
      });

      expect(amazonqcliMcp.getFilePath()).toBe("/custom/path/.amazonq/mcp.json");
    });

    it("should parse JSON content correctly", () => {
      const jsonData = {
        mcpServers: {
          "test-server": {
            command: "node",
            args: ["server.js"],
            env: {
              NODE_ENV: "development",
            },
          },
        },
      };
      const validJsonContent = JSON.stringify(jsonData);

      const amazonqcliMcp = new AmazonqcliMcp({
        relativeDirPath: ".amazonq",
        relativeFilePath: "mcp.json",
        fileContent: validJsonContent,
      });

      expect(amazonqcliMcp.getJson()).toEqual(jsonData);
    });

    it("should handle empty JSON object", () => {
      const emptyJsonContent = JSON.stringify({});

      const amazonqcliMcp = new AmazonqcliMcp({
        relativeDirPath: ".amazonq",
        relativeFilePath: "mcp.json",
        fileContent: emptyJsonContent,
      });

      expect(amazonqcliMcp.getJson()).toEqual({});
    });

    it("should validate content by default", () => {
      const validJsonContent = JSON.stringify({
        mcpServers: {},
      });

      expect(() => {
        const _instance = new AmazonqcliMcp({
          relativeDirPath: ".amazonq",
          relativeFilePath: "mcp.json",
          fileContent: validJsonContent,
        });
      }).not.toThrow();
    });

    it("should skip validation when validate is false", () => {
      const validJsonContent = JSON.stringify({
        mcpServers: {},
      });

      expect(() => {
        const _instance = new AmazonqcliMcp({
          relativeDirPath: ".amazonq",
          relativeFilePath: "mcp.json",
          fileContent: validJsonContent,
          validate: false,
        });
      }).not.toThrow();
    });

    it("should throw error for invalid JSON content", () => {
      const invalidJsonContent = "{ invalid json }";

      expect(() => {
        const _instance = new AmazonqcliMcp({
          relativeDirPath: ".amazonq",
          relativeFilePath: "mcp.json",
          fileContent: invalidJsonContent,
        });
      }).toThrow();
    });
  });

  describe("fromFile", () => {
    it("should create instance from file with default parameters", async () => {
      const amazonqDir = join(testDir, ".amazonq");
      await ensureDir(amazonqDir);

      const jsonData = {
        mcpServers: {
          filesystem: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-filesystem", testDir],
          },
        },
      };
      await writeFileContent(join(amazonqDir, "mcp.json"), JSON.stringify(jsonData, null, 2));

      const amazonqcliMcp = await AmazonqcliMcp.fromFile({
        baseDir: testDir,
      });

      expect(amazonqcliMcp).toBeInstanceOf(AmazonqcliMcp);
      expect(amazonqcliMcp.getJson()).toEqual(jsonData);
      expect(amazonqcliMcp.getFilePath()).toBe(join(testDir, ".amazonq/mcp.json"));
    });

    it("should create instance from file with custom baseDir", async () => {
      const customDir = join(testDir, "custom");
      const amazonqDir = join(customDir, ".amazonq");
      await ensureDir(amazonqDir);

      const jsonData = {
        mcpServers: {
          git: {
            command: "node",
            args: ["git-server.js"],
          },
        },
      };
      await writeFileContent(join(amazonqDir, "mcp.json"), JSON.stringify(jsonData));

      const amazonqcliMcp = await AmazonqcliMcp.fromFile({
        baseDir: customDir,
      });

      expect(amazonqcliMcp.getFilePath()).toBe(join(customDir, ".amazonq/mcp.json"));
      expect(amazonqcliMcp.getJson()).toEqual(jsonData);
    });

    it("should handle validation when validate is true", async () => {
      const amazonqDir = join(testDir, ".amazonq");
      await ensureDir(amazonqDir);

      const jsonData = {
        mcpServers: {
          "valid-server": {
            command: "node",
            args: ["server.js"],
          },
        },
      };
      await writeFileContent(join(amazonqDir, "mcp.json"), JSON.stringify(jsonData));

      const amazonqcliMcp = await AmazonqcliMcp.fromFile({
        baseDir: testDir,
        validate: true,
      });

      expect(amazonqcliMcp.getJson()).toEqual(jsonData);
    });

    it("should skip validation when validate is false", async () => {
      const amazonqDir = join(testDir, ".amazonq");
      await ensureDir(amazonqDir);

      const jsonData = {
        mcpServers: {},
      };
      await writeFileContent(join(amazonqDir, "mcp.json"), JSON.stringify(jsonData));

      const amazonqcliMcp = await AmazonqcliMcp.fromFile({
        baseDir: testDir,
        validate: false,
      });

      expect(amazonqcliMcp.getJson()).toEqual(jsonData);
    });

    it("should throw error if file does not exist", async () => {
      await expect(
        AmazonqcliMcp.fromFile({
          baseDir: testDir,
        }),
      ).rejects.toThrow();
    });
  });

  describe("fromRulesyncMcp", () => {
    it("should create instance from RulesyncMcp with default parameters", () => {
      const jsonData = {
        mcpServers: {
          "test-server": {
            command: "node",
            args: ["test-server.js"],
          },
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const amazonqcliMcp = AmazonqcliMcp.fromRulesyncMcp({
        rulesyncMcp,
      });

      expect(amazonqcliMcp).toBeInstanceOf(AmazonqcliMcp);
      expect(amazonqcliMcp.getJson()).toEqual(jsonData);
      expect(amazonqcliMcp.getRelativeDirPath()).toBe(".amazonq");
      expect(amazonqcliMcp.getRelativeFilePath()).toBe("mcp.json");
    });

    it("should create instance from RulesyncMcp with custom baseDir", () => {
      const jsonData = {
        mcpServers: {
          "custom-server": {
            command: "python",
            args: ["server.py"],
            env: {
              PYTHONPATH: "/custom/path",
            },
          },
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        baseDir: "/custom/base",
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const amazonqcliMcp = AmazonqcliMcp.fromRulesyncMcp({
        baseDir: "/target/dir",
        rulesyncMcp,
      });

      expect(amazonqcliMcp.getFilePath()).toBe("/target/dir/.amazonq/mcp.json");
      expect(amazonqcliMcp.getJson()).toEqual(jsonData);
    });

    it("should handle validation when validate is true", () => {
      const jsonData = {
        mcpServers: {
          "validated-server": {
            command: "node",
            args: ["validated-server.js"],
          },
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const amazonqcliMcp = AmazonqcliMcp.fromRulesyncMcp({
        rulesyncMcp,
        validate: true,
      });

      expect(amazonqcliMcp.getJson()).toEqual(jsonData);
    });

    it("should skip validation when validate is false", () => {
      const jsonData = {
        mcpServers: {},
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const amazonqcliMcp = AmazonqcliMcp.fromRulesyncMcp({
        rulesyncMcp,
        validate: false,
      });

      expect(amazonqcliMcp.getJson()).toEqual(jsonData);
    });

    it("should handle empty mcpServers object", () => {
      const jsonData = {
        mcpServers: {},
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const amazonqcliMcp = AmazonqcliMcp.fromRulesyncMcp({
        rulesyncMcp,
      });

      expect(amazonqcliMcp.getJson()).toEqual(jsonData);
    });
  });

  describe("toRulesyncMcp", () => {
    it("should convert to RulesyncMcp with default configuration", () => {
      const jsonData = {
        mcpServers: {
          filesystem: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
          },
        },
      };
      const amazonqcliMcp = new AmazonqcliMcp({
        relativeDirPath: ".amazonq",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const rulesyncMcp = amazonqcliMcp.toRulesyncMcp();

      expect(rulesyncMcp).toBeInstanceOf(RulesyncMcp);
      expect(rulesyncMcp.getFileContent()).toBe(JSON.stringify(jsonData));
      expect(rulesyncMcp.getRelativeDirPath()).toBe(".rulesync");
      expect(rulesyncMcp.getRelativeFilePath()).toBe(".mcp.json");
    });

    it("should preserve file content when converting to RulesyncMcp", () => {
      const jsonData = {
        mcpServers: {
          "complex-server": {
            command: "node",
            args: ["complex-server.js", "--port", "3000"],
            env: {
              NODE_ENV: "production",
              DEBUG: "mcp:*",
            },
          },
          "another-server": {
            command: "python",
            args: ["another-server.py"],
          },
        },
      };
      const amazonqcliMcp = new AmazonqcliMcp({
        baseDir: "/test/dir",
        relativeDirPath: ".amazonq",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const rulesyncMcp = amazonqcliMcp.toRulesyncMcp();

      expect(rulesyncMcp.getBaseDir()).toBe("/test/dir");
      expect(JSON.parse(rulesyncMcp.getFileContent())).toEqual(jsonData);
    });

    it("should handle empty mcpServers object when converting", () => {
      const jsonData = {
        mcpServers: {},
      };
      const amazonqcliMcp = new AmazonqcliMcp({
        relativeDirPath: ".amazonq",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const rulesyncMcp = amazonqcliMcp.toRulesyncMcp();

      expect(JSON.parse(rulesyncMcp.getFileContent())).toEqual(jsonData);
    });
  });

  describe("validate", () => {
    it("should return successful validation result", () => {
      const jsonData = {
        mcpServers: {
          "test-server": {
            command: "node",
            args: ["server.js"],
          },
        },
      };
      const amazonqcliMcp = new AmazonqcliMcp({
        relativeDirPath: ".amazonq",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(jsonData),
        validate: false, // Skip validation in constructor to test method directly
      });

      const result = amazonqcliMcp.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should always return success (no validation logic implemented)", () => {
      const jsonData = {
        mcpServers: {},
      };
      const amazonqcliMcp = new AmazonqcliMcp({
        relativeDirPath: ".amazonq",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(jsonData),
        validate: false,
      });

      const result = amazonqcliMcp.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return success for complex MCP configuration", () => {
      const jsonData = {
        mcpServers: {
          filesystem: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"],
            env: {
              NODE_ENV: "development",
            },
          },
          git: {
            command: "node",
            args: ["git-server.js"],
          },
          sqlite: {
            command: "python",
            args: ["sqlite-server.py", "--database", "/path/to/db.sqlite"],
            env: {
              PYTHONPATH: "/custom/path",
              DEBUG: "true",
            },
          },
        },
        globalSettings: {
          timeout: 30000,
          retries: 3,
        },
      };
      const amazonqcliMcp = new AmazonqcliMcp({
        relativeDirPath: ".amazonq",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(jsonData),
        validate: false,
      });

      const result = amazonqcliMcp.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });

  describe("integration", () => {
    it("should handle complete workflow: fromFile -> toRulesyncMcp -> fromRulesyncMcp", async () => {
      const amazonqDir = join(testDir, ".amazonq");
      await ensureDir(amazonqDir);

      const originalJsonData = {
        mcpServers: {
          "workflow-server": {
            command: "node",
            args: ["workflow-server.js", "--config", "config.json"],
            env: {
              NODE_ENV: "test",
            },
          },
        },
      };
      await writeFileContent(
        join(amazonqDir, "mcp.json"),
        JSON.stringify(originalJsonData, null, 2),
      );

      // Step 1: Load from file
      const originalAmazonqcliMcp = await AmazonqcliMcp.fromFile({
        baseDir: testDir,
      });

      // Step 2: Convert to RulesyncMcp
      const rulesyncMcp = originalAmazonqcliMcp.toRulesyncMcp();

      // Step 3: Create new AmazonqcliMcp from RulesyncMcp
      const newAmazonqcliMcp = AmazonqcliMcp.fromRulesyncMcp({
        baseDir: testDir,
        rulesyncMcp,
      });

      // Verify data integrity
      expect(newAmazonqcliMcp.getJson()).toEqual(originalJsonData);
      expect(newAmazonqcliMcp.getFilePath()).toBe(join(testDir, ".amazonq/mcp.json"));
    });

    it("should maintain data consistency across transformations", () => {
      const complexJsonData = {
        mcpServers: {
          "primary-server": {
            command: "node",
            args: ["primary.js", "--mode", "production"],
            env: {
              NODE_ENV: "production",
              LOG_LEVEL: "info",
              API_KEY: "secret",
            },
          },
          "secondary-server": {
            command: "python",
            args: ["secondary.py", "--workers", "4"],
            env: {
              PYTHONPATH: "/app/lib",
            },
          },
        },
        config: {
          timeout: 60000,
          maxRetries: 5,
          logLevel: "debug",
        },
      };

      // Create AmazonqcliMcp
      const amazonqcliMcp = new AmazonqcliMcp({
        baseDir: "/project",
        relativeDirPath: ".amazonq",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(complexJsonData),
      });

      // Convert to RulesyncMcp and back
      const rulesyncMcp = amazonqcliMcp.toRulesyncMcp();
      const newAmazonqcliMcp = AmazonqcliMcp.fromRulesyncMcp({
        baseDir: "/project",
        rulesyncMcp,
      });

      // Verify all data is preserved
      expect(newAmazonqcliMcp.getJson()).toEqual(complexJsonData);
      expect(newAmazonqcliMcp.getFilePath()).toBe("/project/.amazonq/mcp.json");
    });
  });
});
