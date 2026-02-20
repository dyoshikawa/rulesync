import { basename, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_MCP_RELATIVE_FILE_PATH,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { type ValidationResult } from "../../types/ai-file.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import {
  RulesyncMcp,
  type RulesyncMcpFromFileParams,
  type RulesyncMcpParams,
} from "./rulesync-mcp.js";

describe("RulesyncMcp", () => {
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
          "test-server": {
            command: "node",
            args: ["server.js"],
          },
        },
      });

      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: validJsonContent,
      });

      expect(rulesyncMcp).toBeInstanceOf(RulesyncMcp);
      expect(rulesyncMcp.getRelativeDirPath()).toBe(RULESYNC_RELATIVE_DIR_PATH);
      expect(rulesyncMcp.getRelativeFilePath()).toBe(".mcp.json");
      expect(rulesyncMcp.getFileContent()).toBe(validJsonContent);
    });

    it("should create instance with custom baseDir", () => {
      const validJsonContent = JSON.stringify({
        mcpServers: {},
      });

      const rulesyncMcp = new RulesyncMcp({
        baseDir: "/custom/path",
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: validJsonContent,
      });

      expect(rulesyncMcp.getFilePath()).toBe(
        `/custom/path/${RULESYNC_RELATIVE_DIR_PATH}/.mcp.json`,
      );
      expect(rulesyncMcp.getBaseDir()).toBe("/custom/path");
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
          "another-server": {
            command: "python",
            args: ["server.py"],
          },
        },
      };
      const validJsonContent = JSON.stringify(jsonData);

      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: validJsonContent,
      });

      expect(rulesyncMcp.getJson()).toEqual(jsonData);
    });

    it("should handle empty JSON object", () => {
      const emptyJsonContent = JSON.stringify({});

      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: emptyJsonContent,
      });

      expect(rulesyncMcp.getJson()).toEqual({});
    });

    it("should handle complex nested JSON structure", () => {
      const complexJsonData = {
        mcpServers: {
          "complex-server": {
            command: "node",
            args: ["complex-server.js", "--port", "3000"],
            env: {
              NODE_ENV: "production",
              DEBUG: "mcp:*",
              CUSTOM_CONFIG: JSON.stringify({ nested: true, value: 42 }),
            },
            targets: ["claudecode", "cursor"],
          },
        },
        globalSettings: {
          timeout: 60000,
          retries: 3,
          logging: {
            level: "debug",
            format: "json",
            outputs: ["console", "file"],
          },
        },
        metadata: {
          version: "1.0.0",
          author: "test",
          created: new Date().toISOString(),
        },
      };
      const jsonContent = JSON.stringify(complexJsonData);

      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: jsonContent,
      });

      expect(rulesyncMcp.getJson()).toEqual(complexJsonData);
    });

    it("should validate content by default", () => {
      const validJsonContent = JSON.stringify({
        mcpServers: {},
      });

      expect(() => {
        const _instance = new RulesyncMcp({
          relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
          relativeFilePath: ".mcp.json",
          fileContent: validJsonContent,
        });
      }).not.toThrow();
    });

    it("should skip validation when validate is false", () => {
      const validJsonContent = JSON.stringify({
        mcpServers: {},
      });

      expect(() => {
        const _instance = new RulesyncMcp({
          relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
          relativeFilePath: ".mcp.json",
          fileContent: validJsonContent,
          validate: false,
        });
      }).not.toThrow();
    });

    it("should throw error for invalid JSON content", () => {
      const invalidJsonContent = "{ invalid json }";

      expect(() => {
        const _instance = new RulesyncMcp({
          relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
          relativeFilePath: ".mcp.json",
          fileContent: invalidJsonContent,
        });
      }).toThrow(SyntaxError);
    });

    it("should throw error for malformed JSON", () => {
      const malformedJsonContent = '{"key": "value",}'; // trailing comma

      expect(() => {
        const _instance = new RulesyncMcp({
          relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
          relativeFilePath: ".mcp.json",
          fileContent: malformedJsonContent,
        });
      }).toThrow(SyntaxError);
    });

    it("should handle non-object JSON content", () => {
      const stringJsonContent = JSON.stringify("string value");

      expect(() => {
        const _instance = new RulesyncMcp({
          relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
          relativeFilePath: ".mcp.json",
          fileContent: stringJsonContent,
        });
      }).not.toThrow(); // JSON.parse handles strings just fine
    });

    it("should handle array JSON content", () => {
      const arrayJsonContent = JSON.stringify([1, 2, 3]);

      expect(() => {
        const _instance = new RulesyncMcp({
          relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
          relativeFilePath: ".mcp.json",
          fileContent: arrayJsonContent,
        });
      }).not.toThrow(); // JSON.parse handles arrays just fine
    });

    it("should handle null JSON content", () => {
      const nullJsonContent = JSON.stringify(null);

      expect(() => {
        const _instance = new RulesyncMcp({
          relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
          relativeFilePath: ".mcp.json",
          fileContent: nullJsonContent,
        });
      }).not.toThrow(); // JSON.parse handles null just fine
    });

    it("should handle numeric JSON content", () => {
      const numericJsonContent = JSON.stringify(42);

      expect(() => {
        const _instance = new RulesyncMcp({
          relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
          relativeFilePath: ".mcp.json",
          fileContent: numericJsonContent,
        });
      }).not.toThrow(); // JSON.parse handles numbers just fine
    });

    it("should handle boolean JSON content", () => {
      const booleanJsonContent = JSON.stringify(true);

      expect(() => {
        const _instance = new RulesyncMcp({
          relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
          relativeFilePath: ".mcp.json",
          fileContent: booleanJsonContent,
        });
      }).not.toThrow(); // JSON.parse handles booleans just fine
    });

    it("should handle validation failure when validate is true", () => {
      // Mock validate to return failure
      class TestRulesyncMcp extends RulesyncMcp {
        validate(): ValidationResult {
          return {
            success: false,
            error: new Error("Validation failed"),
          };
        }
      }

      const validJsonContent = JSON.stringify({
        mcpServers: {},
      });

      expect(() => {
        const _instance = new TestRulesyncMcp({
          relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
          relativeFilePath: ".mcp.json",
          fileContent: validJsonContent,
          validate: true,
        });
      }).toThrow("Validation failed");
    });

    it("should skip validation failure when validate is false", () => {
      // Mock validate to return failure
      class TestRulesyncMcp extends RulesyncMcp {
        validate(): ValidationResult {
          return {
            success: false,
            error: new Error("Validation failed"),
          };
        }
      }

      const validJsonContent = JSON.stringify({
        mcpServers: {},
      });

      expect(() => {
        const _instance = new TestRulesyncMcp({
          relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
          relativeFilePath: ".mcp.json",
          fileContent: validJsonContent,
          validate: false,
        });
      }).not.toThrow();
    });
  });

  describe("validate", () => {
    it("should return successful validation result", () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({ mcpServers: {} }),
        validate: false, // Skip validation in constructor to test method directly
      });

      const result = rulesyncMcp.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should pass validation when description is missing", () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: basename(RULESYNC_MCP_RELATIVE_FILE_PATH),
        fileContent: JSON.stringify({
          mcpServers: {
            "test-server": { command: "node" },
          },
        }),
        validate: false,
      });

      const result = rulesyncMcp.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });

  describe("getJson", () => {
    it("should return parsed JSON object", () => {
      const jsonData = {
        mcpServers: {
          "test-server": {
            command: "node",
            args: ["server.js"],
          },
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const result = rulesyncMcp.getJson();

      expect(result).toEqual(jsonData);
      expect(result).toEqual(rulesyncMcp.getJson());
    });

    it("should return complex nested structure", () => {
      const complexData = {
        mcpServers: {
          primary: {
            config: {
              port: 8080,
              ssl: true,
              middleware: ["auth", "cors"],
            },
            targets: ["claudecode"],
          },
        },
        metadata: {
          tags: ["production", "api"],
          version: "2.1.0",
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(complexData),
      });

      const result = rulesyncMcp.getJson();

      expect(result).toEqual(complexData);
    });

    it("should handle primitive JSON values", () => {
      const primitiveValue = "simple string";
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(primitiveValue),
      });

      const result = rulesyncMcp.getJson();

      expect(result).toBe(primitiveValue);
    });

    it("should handle array JSON values", () => {
      const arrayValue = [1, 2, { key: "value" }, "string"];
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(arrayValue),
      });

      const result = rulesyncMcp.getJson();

      expect(result).toEqual(arrayValue);
    });

    it("should handle null JSON values", () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(null),
      });

      const result = rulesyncMcp.getJson();

      expect(result).toBeNull();
    });

    it("should handle servers with and without description fields", () => {
      const jsonData = {
        mcpServers: {
          "server-with-desc": {
            command: "node",
            description: "Has description",
          },
          "server-without-desc": {
            command: "python",
          },
        },
      };

      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const result = rulesyncMcp.getJson();

      expect(result).toEqual(jsonData);
    });
  });

  describe("fromFile", () => {
    it("should create RulesyncMcp from existing file", async () => {
      const mcpJsonPath = join(
        testDir,
        RULESYNC_RELATIVE_DIR_PATH,
        basename(RULESYNC_MCP_RELATIVE_FILE_PATH),
      );
      const jsonData = {
        mcpServers: {
          "file-server": {
            command: "node",
            args: ["file-server.js"],
            env: {
              NODE_ENV: "test",
            },
          },
        },
      };

      // Create directory structure and file
      await ensureDir(join(testDir, RULESYNC_RELATIVE_DIR_PATH));
      await writeFileContent(mcpJsonPath, JSON.stringify(jsonData, null, 2));

      const rulesyncMcp = await RulesyncMcp.fromFile({ validate: true });

      expect(rulesyncMcp).toBeInstanceOf(RulesyncMcp);
      expect(rulesyncMcp.getJson()).toEqual(jsonData);
      expect(rulesyncMcp.getBaseDir()).toBe(testDir);
      expect(rulesyncMcp.getRelativeDirPath()).toBe(RULESYNC_RELATIVE_DIR_PATH);
      expect(rulesyncMcp.getRelativeFilePath()).toBe(basename(RULESYNC_MCP_RELATIVE_FILE_PATH));
    });

    it("should create RulesyncMcp from file with validation disabled", async () => {
      const mcpJsonPath = join(
        testDir,
        RULESYNC_RELATIVE_DIR_PATH,
        basename(RULESYNC_MCP_RELATIVE_FILE_PATH),
      );
      const jsonData = {
        mcpServers: {
          "no-validation-server": {
            command: "python",
            args: ["server.py"],
          },
        },
      };

      await ensureDir(join(testDir, RULESYNC_RELATIVE_DIR_PATH));
      await writeFileContent(mcpJsonPath, JSON.stringify(jsonData));

      const rulesyncMcp = await RulesyncMcp.fromFile({ validate: false });

      expect(rulesyncMcp).toBeInstanceOf(RulesyncMcp);
      expect(rulesyncMcp.getJson()).toEqual(jsonData);
    });

    it("should use validation by default", async () => {
      const mcpJsonPath = join(
        testDir,
        RULESYNC_RELATIVE_DIR_PATH,
        basename(RULESYNC_MCP_RELATIVE_FILE_PATH),
      );
      const jsonData = {
        mcpServers: {},
      };

      await ensureDir(join(testDir, RULESYNC_RELATIVE_DIR_PATH));
      await writeFileContent(mcpJsonPath, JSON.stringify(jsonData));

      const rulesyncMcp = await RulesyncMcp.fromFile({});

      expect(rulesyncMcp).toBeInstanceOf(RulesyncMcp);
      expect(rulesyncMcp.getJson()).toEqual(jsonData);
    });

    it("should handle complex MCP server configurations", async () => {
      const mcpJsonPath = join(
        testDir,
        RULESYNC_RELATIVE_DIR_PATH,
        basename(RULESYNC_MCP_RELATIVE_FILE_PATH),
      );
      const complexMcpData = {
        mcpServers: {
          "claude-server": {
            command: "node",
            args: ["claude-server.js"],
            env: {
              NODE_ENV: "production",
              API_KEY: "secret",
            },
            targets: ["claudecode"],
          },
          "cursor-server": {
            command: "python",
            args: ["cursor-server.py", "--config", "config.json"],
            env: {
              PYTHONPATH: "/app",
            },
            targets: ["cursor"],
          },
          "multi-target-server": {
            command: "node",
            args: ["multi-server.js"],
            targets: ["claudecode", "cursor", "cline"],
          },
        },
        globalConfig: {
          timeout: 30000,
          maxConnections: 10,
        },
      };

      await ensureDir(join(testDir, RULESYNC_RELATIVE_DIR_PATH));
      await writeFileContent(mcpJsonPath, JSON.stringify(complexMcpData, null, 2));

      const rulesyncMcp = await RulesyncMcp.fromFile({ validate: true });

      expect(rulesyncMcp.getJson()).toEqual(complexMcpData);
    });

    it("should throw error if file does not exist", async () => {
      await expect(RulesyncMcp.fromFile({ validate: true })).rejects.toThrow();
    });

    it("should throw error for invalid JSON in file", async () => {
      const mcpJsonPath = join(testDir, RULESYNC_RELATIVE_DIR_PATH, ".mcp.json");
      const invalidJson = "{ invalid json content }";

      await ensureDir(join(testDir, RULESYNC_RELATIVE_DIR_PATH));
      await writeFileContent(mcpJsonPath, invalidJson);

      await expect(RulesyncMcp.fromFile({ validate: true })).rejects.toThrow(SyntaxError);
    });

    it("should handle empty file", async () => {
      const mcpJsonPath = join(testDir, RULESYNC_RELATIVE_DIR_PATH, ".mcp.json");

      await ensureDir(join(testDir, RULESYNC_RELATIVE_DIR_PATH));
      await writeFileContent(mcpJsonPath, "");

      await expect(RulesyncMcp.fromFile({ validate: true })).rejects.toThrow(SyntaxError);
    });

    it("should handle file with only whitespace", async () => {
      const mcpJsonPath = join(testDir, RULESYNC_RELATIVE_DIR_PATH, ".mcp.json");

      await ensureDir(join(testDir, RULESYNC_RELATIVE_DIR_PATH));
      await writeFileContent(mcpJsonPath, "   \n\t  \n  ");

      await expect(RulesyncMcp.fromFile({ validate: true })).rejects.toThrow(SyntaxError);
    });

    it("should prefer recommended path over legacy when both exist", async () => {
      const recommendedPath = join(
        testDir,
        RULESYNC_RELATIVE_DIR_PATH,
        basename(RULESYNC_MCP_RELATIVE_FILE_PATH),
      );
      const legacyPath = join(testDir, RULESYNC_RELATIVE_DIR_PATH, ".mcp.json");

      const recommendedData = {
        mcpServers: {
          "recommended-server": {
            command: "node",
            args: ["recommended.js"],
          },
        },
      };

      const legacyData = {
        mcpServers: {
          "legacy-server": {
            command: "node",
            args: ["legacy.js"],
          },
        },
      };

      await ensureDir(join(testDir, RULESYNC_RELATIVE_DIR_PATH));
      await writeFileContent(recommendedPath, JSON.stringify(recommendedData));
      await writeFileContent(legacyPath, JSON.stringify(legacyData));

      const rulesyncMcp = await RulesyncMcp.fromFile({ validate: true });

      expect(rulesyncMcp.getJson()).toEqual(recommendedData);
      expect(rulesyncMcp.getRelativeFilePath()).toBe(basename(RULESYNC_MCP_RELATIVE_FILE_PATH));
    });

    it("should use legacy path when recommended does not exist", async () => {
      const legacyPath = join(testDir, RULESYNC_RELATIVE_DIR_PATH, ".mcp.json");

      const legacyData = {
        mcpServers: {
          "legacy-server": {
            command: "node",
            args: ["legacy.js"],
          },
        },
      };

      await ensureDir(join(testDir, RULESYNC_RELATIVE_DIR_PATH));
      await writeFileContent(legacyPath, JSON.stringify(legacyData));

      const rulesyncMcp = await RulesyncMcp.fromFile({ validate: true });

      expect(rulesyncMcp.getJson()).toEqual(legacyData);
      expect(rulesyncMcp.getRelativeFilePath()).toBe(".mcp.json");
    });

    it("should use recommended path when neither exists (for error message)", async () => {
      await expect(RulesyncMcp.fromFile({ validate: true })).rejects.toThrow();
    });
  });

  describe("type exports and schema", () => {
    it("should export RulesyncMcpParams type", () => {
      const params: RulesyncMcpParams = {
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({}),
      };

      expect(params).toBeDefined();
    });

    it("should export RulesyncMcpFromFileParams type", () => {
      const params: RulesyncMcpFromFileParams = {
        validate: true,
      };

      expect(params).toBeDefined();
    });

    it("should have correct type definitions for parameters", () => {
      const constructorParams: RulesyncMcpParams = {
        baseDir: "/custom",
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: "{}",
        validate: false,
      };

      const fromFileParams: RulesyncMcpFromFileParams = {
        validate: false,
      };

      expect(constructorParams.baseDir).toBe("/custom");
      expect(fromFileParams.validate).toBe(false);
    });
  });

  describe("inheritance and method coverage", () => {
    it("should be instance of RulesyncFile", () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({}),
      });

      expect(rulesyncMcp.constructor.name).toBe("RulesyncMcp");
    });

    it("should have correct property types inherited from base classes", () => {
      const jsonData = { mcpServers: {} };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      expect(typeof rulesyncMcp.getJson()).toBe("object");
      expect(typeof rulesyncMcp.getFilePath()).toBe("string");
      expect(typeof rulesyncMcp.getFileContent()).toBe("string");
      expect(typeof rulesyncMcp.getRelativeDirPath()).toBe("string");
      expect(typeof rulesyncMcp.getRelativeFilePath()).toBe("string");
      expect(typeof rulesyncMcp.getBaseDir()).toBe("string");
      expect(typeof rulesyncMcp.getRelativePathFromCwd()).toBe("string");
    });

    it("should call parent constructor correctly", () => {
      const jsonData = { mcpServers: { test: { command: "node" } } };
      const rulesyncMcp = new RulesyncMcp({
        baseDir: "/test/base",
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      expect(rulesyncMcp.getBaseDir()).toBe("/test/base");
      expect(rulesyncMcp.getRelativeDirPath()).toBe(RULESYNC_RELATIVE_DIR_PATH);
      expect(rulesyncMcp.getRelativeFilePath()).toBe(".mcp.json");
      expect(rulesyncMcp.getFileContent()).toBe(JSON.stringify(jsonData));
    });
  });

  describe("stripMcpServerFields", () => {
    it("should return the same instance when no fields to strip", () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            "test-server": {
              command: "node",
              args: ["server.js"],
              enabledTools: ["search"],
            },
          },
        }),
      });

      const result = rulesyncMcp.stripMcpServerFields([]);

      expect(result).toBe(rulesyncMcp);
    });

    it("should strip enabledTools from all servers", () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            "server-a": {
              command: "node",
              args: ["a.js"],
              enabledTools: ["search", "list"],
            },
            "server-b": {
              command: "python",
              args: ["b.py"],
              enabledTools: ["read"],
            },
          },
        }),
      });

      const result = rulesyncMcp.stripMcpServerFields(["enabledTools"]);

      expect(result).not.toBe(rulesyncMcp);
      const json = result.getJson();
      expect(json.mcpServers["server-a"]).toEqual({ command: "node", args: ["a.js"] });
      expect(json.mcpServers["server-b"]).toEqual({ command: "python", args: ["b.py"] });
    });

    it("should strip disabledTools from all servers", () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            "my-server": {
              command: "node",
              args: ["server.js"],
              disabledTools: ["write", "delete"],
            },
          },
        }),
      });

      const result = rulesyncMcp.stripMcpServerFields(["disabledTools"]);

      const json = result.getJson();
      expect(json.mcpServers["my-server"]).toEqual({ command: "node", args: ["server.js"] });
    });

    it("should strip both enabledTools and disabledTools", () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            "my-server": {
              command: "node",
              args: ["server.js"],
              enabledTools: ["search"],
              disabledTools: ["delete"],
            },
          },
        }),
      });

      const result = rulesyncMcp.stripMcpServerFields(["enabledTools", "disabledTools"]);

      const json = result.getJson();
      expect(json.mcpServers["my-server"]).toEqual({ command: "node", args: ["server.js"] });
    });

    it("should preserve other server fields when stripping", () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            "my-server": {
              command: "node",
              args: ["server.js"],
              env: { NODE_ENV: "production" },
              disabled: true,
              enabledTools: ["search"],
              disabledTools: ["delete"],
            },
          },
        }),
      });

      const result = rulesyncMcp.stripMcpServerFields(["enabledTools", "disabledTools"]);

      const json = result.getJson();
      expect(json.mcpServers["my-server"]).toEqual({
        command: "node",
        args: ["server.js"],
        env: { NODE_ENV: "production" },
        disabled: true,
      });
    });

    it("should not modify the original instance", () => {
      const originalData = {
        mcpServers: {
          "my-server": {
            command: "node",
            args: ["server.js"],
            enabledTools: ["search"],
          },
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(originalData),
      });

      rulesyncMcp.stripMcpServerFields(["enabledTools"]);

      expect(rulesyncMcp.getJson()).toEqual(originalData);
    });

    it("should preserve baseDir and paths in the new instance", () => {
      const rulesyncMcp = new RulesyncMcp({
        baseDir: "/custom/path",
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            "my-server": {
              command: "node",
              enabledTools: ["search"],
            },
          },
        }),
      });

      const result = rulesyncMcp.stripMcpServerFields(["enabledTools"]);

      expect(result.getBaseDir()).toBe("/custom/path");
      expect(result.getRelativeDirPath()).toBe(RULESYNC_RELATIVE_DIR_PATH);
      expect(result.getRelativeFilePath()).toBe(".mcp.json");
    });

    it("should handle servers without the fields being stripped", () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            "my-server": {
              command: "node",
              args: ["server.js"],
            },
          },
        }),
      });

      const result = rulesyncMcp.stripMcpServerFields(["enabledTools", "disabledTools"]);

      const json = result.getJson();
      expect(json.mcpServers["my-server"]).toEqual({ command: "node", args: ["server.js"] });
    });

    it("should also strip fields from getFileContent and getMcpServers", () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            "my-server": {
              command: "node",
              args: ["server.js"],
              enabledTools: ["search"],
            },
          },
        }),
      });

      const result = rulesyncMcp.stripMcpServerFields(["enabledTools"]);

      // getFileContent should also reflect stripped fields
      const parsedContent = JSON.parse(result.getFileContent());
      expect(parsedContent.mcpServers["my-server"].enabledTools).toBeUndefined();

      // getMcpServers should also reflect stripped fields
      const servers = result.getMcpServers();
      expect((servers["my-server"] as any).enabledTools).toBeUndefined();
    });
  });

  describe("integration and edge cases", () => {
    it("should handle large JSON structures", () => {
      const largeJsonData = {
        mcpServers: Array.from({ length: 100 }, (_, i) => [
          `server-${i}`,
          {
            command: "node",
            args: [`server-${i}.js`, `--port`, `${3000 + i}`],
            env: {
              NODE_ENV: "production",
              SERVER_ID: `server-${i}`,
              PORT: `${3000 + i}`,
            },
            targets: ["claudecode", "cursor"],
          },
        ]).reduce(
          (acc, [key, value]) => {
            if (typeof key === "string") {
              acc[key] = value;
            }
            return acc;
          },
          {} as Record<string, unknown>,
        ),
        globalSettings: {
          timeout: 60000,
          maxConnections: 1000,
          retries: 5,
        },
      };

      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(largeJsonData),
      });

      expect(rulesyncMcp.getJson()).toEqual(largeJsonData);
      expect(Object.keys((rulesyncMcp.getJson() as any).mcpServers)).toHaveLength(100);
    });

    it("should handle special characters and unicode in JSON", () => {
      const unicodeJsonData = {
        mcpServers: {
          "unicode-server": {
            command: "node",
            args: ["unicode-server.js"],
            env: {
              UNICODE_TEST: "Hello 世界 🌍 العالم мир",
              SPECIAL_CHARS: "!@#$%^&*()_+-=[]{}|;':\",./<>?",
              ESCAPED_QUOTES: "He said \"Hello\" and she said 'Hi'",
            },
            description: "Unicode test server with émojis 😄 and special chars",
          },
        },
      };

      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(unicodeJsonData),
      });

      // getJson() returns the raw JSON without filtering
      expect(rulesyncMcp.getJson()).toEqual(unicodeJsonData);
    });

    it("should preserve exact JSON structure through round-trip", () => {
      const originalJsonData = {
        mcpServers: {
          "test-server": {
            command: "node",
            args: ["server.js"],
            env: {
              NODE_ENV: "test",
            },
            targets: ["claudecode"],
          },
        },
        metadata: {
          version: "1.0.0",
          created: "2024-01-01T00:00:00.000Z",
        },
      };

      const rulesyncMcp1 = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(originalJsonData),
      });

      // Create second instance from first instance's content
      const rulesyncMcp2 = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(rulesyncMcp1.getJson()),
      });

      expect(rulesyncMcp2.getJson()).toEqual(originalJsonData);
      expect(rulesyncMcp2.getJson()).toEqual(rulesyncMcp1.getJson());
    });

    it("should work correctly with different file extensions", () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "custom-config.json",
        fileContent: JSON.stringify({ mcpServers: {} }),
      });

      expect(rulesyncMcp.getRelativeFilePath()).toBe("custom-config.json");
      expect(rulesyncMcp.getFilePath()).toBe(
        join(testDir, `${RULESYNC_RELATIVE_DIR_PATH}/custom-config.json`),
      );
    });

    it("should work correctly with different directory paths", () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: "custom-dir",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({ mcpServers: {} }),
      });

      expect(rulesyncMcp.getRelativeDirPath()).toBe("custom-dir");
      expect(rulesyncMcp.getFilePath()).toBe(join(testDir, "custom-dir/.mcp.json"));
    });

    it("should handle deeply nested JSON structures", () => {
      const deeplyNestedData = {
        mcpServers: {
          "nested-server": {
            command: "node",
            args: ["server.js"],
            config: {
              level1: {
                level2: {
                  level3: {
                    level4: {
                      level5: {
                        value: "deeply nested value",
                        array: [1, 2, { nested: true }],
                      },
                    },
                  },
                },
              },
            },
          },
        },
      };

      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(deeplyNestedData),
      });

      expect(rulesyncMcp.getJson()).toEqual(deeplyNestedData);
    });
  });
});
