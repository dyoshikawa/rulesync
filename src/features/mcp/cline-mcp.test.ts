import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { ClineMcp } from "./cline-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

describe("ClineMcp", () => {
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
          "@anthropic-ai/mcp-server-git": {
            command: "node",
            args: ["path/to/git-server.js"],
          },
        },
      });

      const clineMcp = new ClineMcp({
        relativeDirPath: ".cline",
        relativeFilePath: "mcp.json",
        fileContent: validJsonContent,
      });

      expect(clineMcp).toBeInstanceOf(ClineMcp);
      expect(clineMcp.getRelativeDirPath()).toBe(".cline");
      expect(clineMcp.getRelativeFilePath()).toBe("mcp.json");
      expect(clineMcp.getFileContent()).toBe(validJsonContent);
    });

    it("should create instance with custom baseDir", () => {
      const validJsonContent = JSON.stringify({
        mcpServers: {},
      });

      const clineMcp = new ClineMcp({
        baseDir: "/custom/path",
        relativeDirPath: ".cline",
        relativeFilePath: "mcp.json",
        fileContent: validJsonContent,
      });

      expect(clineMcp.getFilePath()).toBe("/custom/path/.cline/mcp.json");
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

      const clineMcp = new ClineMcp({
        relativeDirPath: ".cline",
        relativeFilePath: "mcp.json",
        fileContent: validJsonContent,
      });

      expect(clineMcp.getJson()).toEqual(jsonData);
    });

    it("should handle empty JSON object", () => {
      const emptyJsonContent = JSON.stringify({});

      const clineMcp = new ClineMcp({
        relativeDirPath: ".cline",
        relativeFilePath: "mcp.json",
        fileContent: emptyJsonContent,
      });

      expect(clineMcp.getJson()).toEqual({});
    });

    it("should validate content by default", () => {
      const validJsonContent = JSON.stringify({
        mcpServers: {},
      });

      expect(() => {
        const _instance = new ClineMcp({
          relativeDirPath: ".cline",
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
        const _instance = new ClineMcp({
          relativeDirPath: ".cline",
          relativeFilePath: "mcp.json",
          fileContent: validJsonContent,
          validate: false,
        });
      }).not.toThrow();
    });

    it("should throw error for invalid JSON content", () => {
      const invalidJsonContent = "{ invalid json }";

      expect(() => {
        const _instance = new ClineMcp({
          relativeDirPath: ".cline",
          relativeFilePath: "mcp.json",
          fileContent: invalidJsonContent,
        });
      }).toThrow();
    });
  });

  describe("fromFile", () => {
    it("should create instance from file with default parameters", async () => {
      const clineDir = join(testDir, ".cline");
      await ensureDir(clineDir);

      const jsonData = {
        mcpServers: {
          filesystem: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-filesystem", clineDir],
          },
        },
      };
      await writeFileContent(join(clineDir, "mcp.json"), JSON.stringify(jsonData, null, 2));

      const clineMcp = await ClineMcp.fromFile({
        baseDir: testDir,
      });

      expect(clineMcp).toBeInstanceOf(ClineMcp);
      expect(clineMcp.getJson()).toEqual(jsonData);
      expect(clineMcp.getFilePath()).toBe(join(testDir, ".cline", "mcp.json"));
    });

    it("should create instance from file with custom baseDir", async () => {
      const customDir = join(testDir, "custom");
      const clineDir = join(customDir, ".cline");
      await ensureDir(clineDir);

      const jsonData = {
        mcpServers: {
          git: {
            command: "node",
            args: ["git-server.js"],
          },
        },
      };
      await writeFileContent(join(clineDir, "mcp.json"), JSON.stringify(jsonData));

      const clineMcp = await ClineMcp.fromFile({
        baseDir: customDir,
      });

      expect(clineMcp.getFilePath()).toBe(join(customDir, ".cline", "mcp.json"));
      expect(clineMcp.getJson()).toEqual(jsonData);
    });

    it("should handle validation when validate is true", async () => {
      const clineDir = join(testDir, ".cline");
      await ensureDir(clineDir);

      const jsonData = {
        mcpServers: {
          "valid-server": {
            command: "node",
            args: ["server.js"],
          },
        },
      };
      await writeFileContent(join(clineDir, "mcp.json"), JSON.stringify(jsonData));

      const clineMcp = await ClineMcp.fromFile({
        baseDir: testDir,
        validate: true,
      });

      expect(clineMcp.getJson()).toEqual(jsonData);
    });

    it("should skip validation when validate is false", async () => {
      const clineDir = join(testDir, ".cline");
      await ensureDir(clineDir);

      const jsonData = {
        mcpServers: {},
      };
      await writeFileContent(join(clineDir, "mcp.json"), JSON.stringify(jsonData));

      const clineMcp = await ClineMcp.fromFile({
        baseDir: testDir,
        validate: false,
      });

      expect(clineMcp.getJson()).toEqual(jsonData);
    });

    it("should throw error if file does not exist", async () => {
      await expect(
        ClineMcp.fromFile({
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
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const clineMcp = ClineMcp.fromRulesyncMcp({
        rulesyncMcp,
      });

      expect(clineMcp).toBeInstanceOf(ClineMcp);
      expect(clineMcp.getJson()).toEqual(jsonData);
      expect(clineMcp.getRelativeDirPath()).toBe(".cline");
      expect(clineMcp.getRelativeFilePath()).toBe("mcp.json");
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
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const clineMcp = ClineMcp.fromRulesyncMcp({
        baseDir: "/target/dir",
        rulesyncMcp,
      });

      expect(clineMcp.getFilePath()).toBe("/target/dir/.cline/mcp.json");
      expect(clineMcp.getJson()).toEqual(jsonData);
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
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const clineMcp = ClineMcp.fromRulesyncMcp({
        rulesyncMcp,
        validate: true,
      });

      expect(clineMcp.getJson()).toEqual(jsonData);
    });

    it("should skip validation when validate is false", () => {
      const jsonData = {
        mcpServers: {},
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const clineMcp = ClineMcp.fromRulesyncMcp({
        rulesyncMcp,
        validate: false,
      });

      expect(clineMcp.getJson()).toEqual(jsonData);
    });

    it("should handle empty mcpServers object", () => {
      const jsonData = {
        mcpServers: {},
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const clineMcp = ClineMcp.fromRulesyncMcp({
        rulesyncMcp,
      });

      expect(clineMcp.getJson()).toEqual(jsonData);
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
      const clineMcp = new ClineMcp({
        relativeDirPath: ".cline",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const rulesyncMcp = clineMcp.toRulesyncMcp();

      expect(rulesyncMcp).toBeInstanceOf(RulesyncMcp);
      expect(rulesyncMcp.getFileContent()).toBe(JSON.stringify(jsonData));
      expect(rulesyncMcp.getRelativeDirPath()).toBe(RULESYNC_RELATIVE_DIR_PATH);
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
      const clineMcp = new ClineMcp({
        baseDir: "/test/dir",
        relativeDirPath: ".cline",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const rulesyncMcp = clineMcp.toRulesyncMcp({ outputBaseDir: "/test/dir" });

      expect(rulesyncMcp.getBaseDir()).toBe("/test/dir");
      expect(JSON.parse(rulesyncMcp.getFileContent())).toEqual(jsonData);
    });

    it("should handle empty mcpServers object when converting", () => {
      const jsonData = {
        mcpServers: {},
      };
      const clineMcp = new ClineMcp({
        relativeDirPath: ".cline",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const rulesyncMcp = clineMcp.toRulesyncMcp();

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
      const clineMcp = new ClineMcp({
        relativeDirPath: ".cline",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(jsonData),
        validate: false, // Skip validation in constructor to test method directly
      });

      const result = clineMcp.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should always return success (no validation logic implemented)", () => {
      const jsonData = {
        mcpServers: {},
      };
      const clineMcp = new ClineMcp({
        relativeDirPath: ".cline",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(jsonData),
        validate: false,
      });

      const result = clineMcp.validate();

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
      const clineMcp = new ClineMcp({
        relativeDirPath: ".cline",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(jsonData),
        validate: false,
      });

      const result = clineMcp.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });

  describe("integration", () => {
    it("should handle complete workflow: fromFile -> toRulesyncMcp -> fromRulesyncMcp", async () => {
      const clineDir = join(testDir, ".cline");
      await ensureDir(clineDir);

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
      await writeFileContent(join(clineDir, "mcp.json"), JSON.stringify(originalJsonData, null, 2));

      // Step 1: Load from file
      const originalClineMcp = await ClineMcp.fromFile({
        baseDir: testDir,
      });

      // Step 2: Convert to RulesyncMcp
      const rulesyncMcp = originalClineMcp.toRulesyncMcp();

      // Step 3: Create new ClineMcp from RulesyncMcp
      const newClineMcp = ClineMcp.fromRulesyncMcp({
        baseDir: testDir,
        rulesyncMcp,
      });

      // Verify data integrity
      expect(newClineMcp.getJson()).toEqual(originalJsonData);
      expect(newClineMcp.getFilePath()).toBe(join(testDir, ".cline", "mcp.json"));
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

      // Create ClineMcp
      const clineMcp = new ClineMcp({
        baseDir: "/project",
        relativeDirPath: ".cline",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(complexJsonData),
      });

      // Convert to RulesyncMcp and back
      const rulesyncMcp = clineMcp.toRulesyncMcp();
      const newClineMcp = ClineMcp.fromRulesyncMcp({
        baseDir: "/project",
        rulesyncMcp,
      });

      // Verify all data is preserved
      expect(newClineMcp.getJson()).toEqual(complexJsonData);
      expect(newClineMcp.getFilePath()).toBe("/project/.cline/mcp.json");
    });
  });
});
