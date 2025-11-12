import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { type ValidationResult } from "../../types/ai-file.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { CursorMcp, type CursorMcpParams } from "./cursor-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

describe("CursorMcp", () => {
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

  describe("getSettablePaths", () => {
    it("should return correct settable paths for Cursor MCP", () => {
      const paths = CursorMcp.getSettablePaths();

      expect(paths).toEqual({
        relativeDirPath: ".cursor",
        relativeFilePath: "mcp.json",
      });
    });

    it("should return consistent paths across multiple calls", () => {
      const paths1 = CursorMcp.getSettablePaths();
      const paths2 = CursorMcp.getSettablePaths();

      expect(paths1).toEqual(paths2);
      expect(paths1).not.toBe(paths2); // Should be different objects
    });
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

      const cursorMcp = new CursorMcp({
        relativeDirPath: ".cursor",
        relativeFilePath: "mcp.json",
        fileContent: validJsonContent,
      });

      expect(cursorMcp).toBeInstanceOf(CursorMcp);
      expect(cursorMcp.getRelativeDirPath()).toBe(".cursor");
      expect(cursorMcp.getRelativeFilePath()).toBe("mcp.json");
      expect(cursorMcp.getFileContent()).toBe(validJsonContent);
    });

    it("should create instance with custom baseDir", () => {
      const validJsonContent = JSON.stringify({
        mcpServers: {},
      });

      const cursorMcp = new CursorMcp({
        baseDir: "/custom/path",
        relativeDirPath: ".cursor",
        relativeFilePath: "mcp.json",
        fileContent: validJsonContent,
      });

      expect(cursorMcp.getFilePath()).toBe("/custom/path/.cursor/mcp.json");
      expect(cursorMcp.getBaseDir()).toBe("/custom/path");
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

      const cursorMcp = new CursorMcp({
        relativeDirPath: ".cursor",
        relativeFilePath: "mcp.json",
        fileContent: validJsonContent,
      });

      expect(cursorMcp.getJson()).toEqual(jsonData);
    });

    it("should handle empty JSON object", () => {
      const emptyJsonContent = JSON.stringify({});

      const cursorMcp = new CursorMcp({
        relativeDirPath: ".cursor",
        relativeFilePath: "mcp.json",
        fileContent: emptyJsonContent,
      });

      expect(cursorMcp.getJson()).toEqual({});
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
            targets: ["cursor"],
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

      const cursorMcp = new CursorMcp({
        relativeDirPath: ".cursor",
        relativeFilePath: "mcp.json",
        fileContent: jsonContent,
      });

      expect(cursorMcp.getJson()).toEqual(complexJsonData);
    });

    it("should validate content by default", () => {
      const validJsonContent = JSON.stringify({
        mcpServers: {},
      });

      expect(() => {
        const _instance = new CursorMcp({
          relativeDirPath: ".cursor",
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
        const _instance = new CursorMcp({
          relativeDirPath: ".cursor",
          relativeFilePath: "mcp.json",
          fileContent: validJsonContent,
          validate: false,
        });
      }).not.toThrow();
    });

    it("should throw error for invalid JSON content", () => {
      const invalidJsonContent = "{ invalid json }";

      expect(() => {
        const _instance = new CursorMcp({
          relativeDirPath: ".cursor",
          relativeFilePath: "mcp.json",
          fileContent: invalidJsonContent,
        });
      }).toThrow(SyntaxError);
    });

    it("should throw error for malformed JSON", () => {
      const malformedJsonContent = '{"key": "value",}'; // trailing comma

      expect(() => {
        const _instance = new CursorMcp({
          relativeDirPath: ".cursor",
          relativeFilePath: "mcp.json",
          fileContent: malformedJsonContent,
        });
      }).toThrow(SyntaxError);
    });

    it("should handle non-object JSON content", () => {
      const stringJsonContent = JSON.stringify("string value");

      expect(() => {
        const _instance = new CursorMcp({
          relativeDirPath: ".cursor",
          relativeFilePath: "mcp.json",
          fileContent: stringJsonContent,
        });
      }).not.toThrow(); // JSON.parse handles strings just fine
    });

    it("should handle array JSON content", () => {
      const arrayJsonContent = JSON.stringify([1, 2, 3]);

      expect(() => {
        const _instance = new CursorMcp({
          relativeDirPath: ".cursor",
          relativeFilePath: "mcp.json",
          fileContent: arrayJsonContent,
        });
      }).not.toThrow(); // JSON.parse handles arrays just fine
    });

    it("should handle null JSON content", () => {
      const nullJsonContent = JSON.stringify(null);

      expect(() => {
        const _instance = new CursorMcp({
          relativeDirPath: ".cursor",
          relativeFilePath: "mcp.json",
          fileContent: nullJsonContent,
        });
      }).not.toThrow(); // JSON.parse handles null just fine
    });

    it("should handle numeric JSON content", () => {
      const numericJsonContent = JSON.stringify(42);

      expect(() => {
        const _instance = new CursorMcp({
          relativeDirPath: ".cursor",
          relativeFilePath: "mcp.json",
          fileContent: numericJsonContent,
        });
      }).not.toThrow(); // JSON.parse handles numbers just fine
    });

    it("should handle boolean JSON content", () => {
      const booleanJsonContent = JSON.stringify(true);

      expect(() => {
        const _instance = new CursorMcp({
          relativeDirPath: ".cursor",
          relativeFilePath: "mcp.json",
          fileContent: booleanJsonContent,
        });
      }).not.toThrow(); // JSON.parse handles booleans just fine
    });

    it("should handle validation failure when validate is true", () => {
      // Mock validate to return failure
      class TestCursorMcp extends CursorMcp {
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
        const _instance = new TestCursorMcp({
          relativeDirPath: ".cursor",
          relativeFilePath: "mcp.json",
          fileContent: validJsonContent,
          validate: true,
        });
      }).toThrow("Validation failed");
    });
  });

  describe("validate", () => {
    it("should return successful validation result", () => {
      const cursorMcp = new CursorMcp({
        relativeDirPath: ".cursor",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ mcpServers: {} }),
        validate: false, // Skip validation in constructor to test method directly
      });

      const result = cursorMcp.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should always return success for current implementation", () => {
      const cursorMcp = new CursorMcp({
        relativeDirPath: ".cursor",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ invalid: "data" }),
        validate: false,
      });

      const result = cursorMcp.validate();

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
      const cursorMcp = new CursorMcp({
        relativeDirPath: ".cursor",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const result = cursorMcp.getJson();

      expect(result).toEqual(jsonData);
      expect(result).toBe(cursorMcp.getJson()); // Should return the same reference
    });

    it("should return empty object for empty JSON", () => {
      const cursorMcp = new CursorMcp({
        relativeDirPath: ".cursor",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({}),
      });

      const result = cursorMcp.getJson();

      expect(result).toEqual({});
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
            targets: ["cursor"],
          },
        },
        metadata: {
          tags: ["production", "api"],
          version: "2.1.0",
        },
      };
      const cursorMcp = new CursorMcp({
        relativeDirPath: ".cursor",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(complexData),
      });

      const result = cursorMcp.getJson();

      expect(result).toEqual(complexData);
    });

    it("should handle primitive JSON values", () => {
      const primitiveValue = "simple string";
      const cursorMcp = new CursorMcp({
        relativeDirPath: ".cursor",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(primitiveValue),
      });

      const result = cursorMcp.getJson();

      expect(result).toBe(primitiveValue);
    });

    it("should handle array JSON values", () => {
      const arrayValue = [1, 2, { key: "value" }, "string"];
      const cursorMcp = new CursorMcp({
        relativeDirPath: ".cursor",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(arrayValue),
      });

      const result = cursorMcp.getJson();

      expect(result).toEqual(arrayValue);
    });

    it("should handle null JSON values", () => {
      const cursorMcp = new CursorMcp({
        relativeDirPath: ".cursor",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(null),
      });

      const result = cursorMcp.getJson();

      expect(result).toBeNull();
    });
  });

  describe("fromFile", () => {
    it("should create CursorMcp from existing file", async () => {
      const mcpJsonPath = join(testDir, ".cursor", "mcp.json");
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
      await ensureDir(join(testDir, ".cursor"));
      await writeFileContent(mcpJsonPath, JSON.stringify(jsonData, null, 2));

      const cursorMcp = await CursorMcp.fromFile({ validate: true });

      expect(cursorMcp).toBeInstanceOf(CursorMcp);
      expect(cursorMcp.getJson()).toEqual(jsonData);
      expect(cursorMcp.getBaseDir()).toBe(testDir);
      expect(cursorMcp.getRelativeDirPath()).toBe(".cursor");
      expect(cursorMcp.getRelativeFilePath()).toBe("mcp.json");
    });

    it("should create CursorMcp from file with validation disabled", async () => {
      const mcpJsonPath = join(testDir, ".cursor", "mcp.json");
      const jsonData = {
        mcpServers: {
          "no-validation-server": {
            command: "python",
            args: ["server.py"],
          },
        },
      };

      await ensureDir(join(testDir, ".cursor"));
      await writeFileContent(mcpJsonPath, JSON.stringify(jsonData));

      const cursorMcp = await CursorMcp.fromFile({ validate: false });

      expect(cursorMcp).toBeInstanceOf(CursorMcp);
      expect(cursorMcp.getJson()).toEqual(jsonData);
    });

    it("should use validation by default", async () => {
      const mcpJsonPath = join(testDir, ".cursor", "mcp.json");
      const jsonData = {
        mcpServers: {},
      };

      await ensureDir(join(testDir, ".cursor"));
      await writeFileContent(mcpJsonPath, JSON.stringify(jsonData));

      const cursorMcp = await CursorMcp.fromFile({});

      expect(cursorMcp).toBeInstanceOf(CursorMcp);
      expect(cursorMcp.getJson()).toEqual(jsonData);
    });

    it("should handle complex Cursor MCP server configurations", async () => {
      const mcpJsonPath = join(testDir, ".cursor", "mcp.json");
      const complexMcpData = {
        mcpServers: {
          "cursor-server": {
            command: "node",
            args: ["cursor-server.js"],
            env: {
              NODE_ENV: "production",
              API_KEY: "secret",
            },
          },
          "ai-server": {
            command: "python",
            args: ["ai-server.py", "--config", "config.json"],
            env: {
              PYTHONPATH: "/app",
            },
          },
          "multi-target-server": {
            command: "node",
            args: ["multi-server.js"],
          },
        },
        globalConfig: {
          timeout: 30000,
          maxConnections: 10,
        },
      };

      await ensureDir(join(testDir, ".cursor"));
      await writeFileContent(mcpJsonPath, JSON.stringify(complexMcpData, null, 2));

      const cursorMcp = await CursorMcp.fromFile({ validate: true });

      expect(cursorMcp.getJson()).toEqual(complexMcpData);
    });

    it("should use custom baseDir when provided", async () => {
      const mcpJsonPath = join(testDir, ".cursor", "mcp.json");
      const jsonData = {
        mcpServers: {
          "custom-base-server": {
            command: "node",
            args: ["server.js"],
          },
        },
      };

      await ensureDir(join(testDir, ".cursor"));
      await writeFileContent(mcpJsonPath, JSON.stringify(jsonData));

      const cursorMcp = await CursorMcp.fromFile({ baseDir: testDir, validate: true });

      expect(cursorMcp).toBeInstanceOf(CursorMcp);
      expect(cursorMcp.getJson()).toEqual(jsonData);
      expect(cursorMcp.getBaseDir()).toBe(testDir);
      expect(cursorMcp.getFilePath()).toBe(join(testDir, ".cursor", "mcp.json"));
    });

    it("should throw error if file does not exist", async () => {
      await expect(CursorMcp.fromFile({ validate: true })).rejects.toThrow();
    });

    it("should throw error for invalid JSON in file", async () => {
      const mcpJsonPath = join(testDir, ".cursor", "mcp.json");
      const invalidJson = "{ invalid json content }";

      await ensureDir(join(testDir, ".cursor"));
      await writeFileContent(mcpJsonPath, invalidJson);

      await expect(CursorMcp.fromFile({ validate: true })).rejects.toThrow(SyntaxError);
    });

    it("should handle empty file", async () => {
      const mcpJsonPath = join(testDir, ".cursor", "mcp.json");

      await ensureDir(join(testDir, ".cursor"));
      await writeFileContent(mcpJsonPath, "");

      await expect(CursorMcp.fromFile({ validate: true })).rejects.toThrow(SyntaxError);
    });

    it("should handle file with only whitespace", async () => {
      const mcpJsonPath = join(testDir, ".cursor", "mcp.json");

      await ensureDir(join(testDir, ".cursor"));
      await writeFileContent(mcpJsonPath, "   \n\t  \n  ");

      await expect(CursorMcp.fromFile({ validate: true })).rejects.toThrow(SyntaxError);
    });
  });

  describe("fromRulesyncMcp", () => {
    it("should create CursorMcp from RulesyncMcp with basic config", () => {
      const rulesyncMcpData = {
        mcpServers: {
          "test-server": {
            command: "node",
            args: ["server.js"],
          },
        },
      };

      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(rulesyncMcpData),
      });

      const cursorMcp = CursorMcp.fromRulesyncMcp({
        rulesyncMcp,
        validate: true,
      });

      expect(cursorMcp).toBeInstanceOf(CursorMcp);
      expect(cursorMcp.getJson()).toEqual({
        mcpServers: rulesyncMcpData.mcpServers,
      });
      expect(cursorMcp.getBaseDir()).toBe(testDir);
      expect(cursorMcp.getRelativeDirPath()).toBe(".cursor");
      expect(cursorMcp.getRelativeFilePath()).toBe("mcp.json");
    });

    it("should handle empty RulesyncMcp", () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({}),
      });

      const cursorMcp = CursorMcp.fromRulesyncMcp({
        rulesyncMcp,
        validate: true,
      });

      expect(cursorMcp.getJson()).toEqual({
        mcpServers: {},
      });
    });

    it("should handle RulesyncMcp with complex configuration", () => {
      const rulesyncMcpData = {
        mcpServers: {
          "complex-server": {
            command: "node",
            args: ["complex-server.js", "--port", "3000"],
            env: {
              NODE_ENV: "production",
              DEBUG: "mcp:*",
            },
            targets: ["claudecode", "cursor"],
          },
          "python-server": {
            command: "python",
            args: ["python-server.py"],
            env: {
              PYTHONPATH: "/usr/local/lib/python3.9/site-packages",
            },
            targets: ["cursor"],
          },
        },
        globalSettings: {
          timeout: 60000,
          retries: 3,
        },
      };

      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(rulesyncMcpData),
      });

      const cursorMcp = CursorMcp.fromRulesyncMcp({
        rulesyncMcp,
        validate: true,
      });

      expect(cursorMcp.getJson()).toEqual({
        mcpServers: rulesyncMcpData.mcpServers,
      });
    });

    it("should use custom baseDir when provided", () => {
      const rulesyncMcpData = {
        mcpServers: {
          "custom-server": {
            command: "node",
            args: ["server.js"],
          },
        },
      };

      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(rulesyncMcpData),
      });

      const cursorMcp = CursorMcp.fromRulesyncMcp({
        baseDir: "/custom/path",
        rulesyncMcp,
        validate: true,
      });

      expect(cursorMcp.getBaseDir()).toBe("/custom/path");
      expect(cursorMcp.getFilePath()).toBe("/custom/path/.cursor/mcp.json");
    });

    it("should skip validation when validate is false", () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({ mcpServers: {} }),
      });

      expect(() => {
        const _cursorMcp = CursorMcp.fromRulesyncMcp({
          rulesyncMcp,
          validate: false,
        });
      }).not.toThrow();
    });

    it("should handle RulesyncMcp with null mcpServers", () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({ mcpServers: null }),
      });

      const cursorMcp = CursorMcp.fromRulesyncMcp({
        rulesyncMcp,
        validate: false,
      });

      expect(cursorMcp.getJson()).toEqual({
        mcpServers: {},
      });
    });

    it("should handle RulesyncMcp with undefined mcpServers", () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({ otherProperty: "value" }),
      });

      const cursorMcp = CursorMcp.fromRulesyncMcp({
        rulesyncMcp,
        validate: false,
      });

      expect(cursorMcp.getJson()).toEqual({
        mcpServers: {},
      });
    });
  });

  describe("toRulesyncMcp", () => {
    it("should convert CursorMcp to RulesyncMcp", () => {
      const cursorMcpData = {
        mcpServers: {
          "test-server": {
            command: "node",
            args: ["server.js"],
          },
        },
      };

      const cursorMcp = new CursorMcp({
        baseDir: "/test/path",
        relativeDirPath: ".cursor",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(cursorMcpData),
      });

      const rulesyncMcp = cursorMcp.toRulesyncMcp();

      expect(rulesyncMcp).toBeInstanceOf(RulesyncMcp);
      expect(rulesyncMcp.getBaseDir()).toBe("/test/path");
      expect(rulesyncMcp.getRelativeDirPath()).toBe(".cursor");
      expect(rulesyncMcp.getRelativeFilePath()).toBe("rulesync.mcp.json");
      expect(rulesyncMcp.getFileContent()).toBe(JSON.stringify(cursorMcpData));
    });

    it("should convert empty CursorMcp to RulesyncMcp", () => {
      const cursorMcp = new CursorMcp({
        relativeDirPath: ".cursor",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({}),
      });

      const rulesyncMcp = cursorMcp.toRulesyncMcp();

      expect(rulesyncMcp).toBeInstanceOf(RulesyncMcp);
      expect(rulesyncMcp.getFileContent()).toBe(JSON.stringify({}));
    });

    it("should convert complex CursorMcp to RulesyncMcp", () => {
      const complexData = {
        mcpServers: {
          server1: {
            command: "node",
            args: ["server1.js"],
            env: {
              NODE_ENV: "production",
            },
          },
          server2: {
            command: "python",
            args: ["server2.py"],
          },
        },
        globalConfig: {
          timeout: 30000,
        },
      };

      const cursorMcp = new CursorMcp({
        baseDir: "/custom",
        relativeDirPath: ".cursor",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(complexData),
      });

      const rulesyncMcp = cursorMcp.toRulesyncMcp();

      expect(rulesyncMcp.getBaseDir()).toBe("/custom");
      expect(rulesyncMcp.getFileContent()).toBe(JSON.stringify(complexData));
    });
  });

  describe("type exports and schema", () => {
    it("should export CursorMcpParams type", () => {
      const params: CursorMcpParams = {
        relativeDirPath: ".cursor",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({}),
      };

      expect(params).toBeDefined();
    });

    it("should have correct type definitions for parameters", () => {
      const constructorParams: CursorMcpParams = {
        baseDir: "/custom",
        relativeDirPath: ".cursor",
        relativeFilePath: "mcp.json",
        fileContent: "{}",
        validate: false,
      };

      expect(constructorParams.baseDir).toBe("/custom");
      expect(constructorParams.validate).toBe(false);
    });
  });

  describe("inheritance and method coverage", () => {
    it("should be instance of CursorMcp", () => {
      const cursorMcp = new CursorMcp({
        relativeDirPath: ".cursor",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({}),
      });

      expect(cursorMcp.constructor.name).toBe("CursorMcp");
    });

    it("should have correct property types inherited from base classes", () => {
      const jsonData = { mcpServers: {} };
      const cursorMcp = new CursorMcp({
        relativeDirPath: ".cursor",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      expect(typeof cursorMcp.getJson()).toBe("object");
      expect(typeof cursorMcp.getFilePath()).toBe("string");
      expect(typeof cursorMcp.getFileContent()).toBe("string");
      expect(typeof cursorMcp.getRelativeDirPath()).toBe("string");
      expect(typeof cursorMcp.getRelativeFilePath()).toBe("string");
      expect(typeof cursorMcp.getBaseDir()).toBe("string");
      expect(typeof cursorMcp.getRelativePathFromCwd()).toBe("string");
    });

    it("should call parent constructor correctly", () => {
      const jsonData = { mcpServers: { test: { command: "node" } } };
      const cursorMcp = new CursorMcp({
        baseDir: "/test/base",
        relativeDirPath: ".cursor",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      expect(cursorMcp.getBaseDir()).toBe("/test/base");
      expect(cursorMcp.getRelativeDirPath()).toBe(".cursor");
      expect(cursorMcp.getRelativeFilePath()).toBe("mcp.json");
      expect(cursorMcp.getFileContent()).toBe(JSON.stringify(jsonData));
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

      const cursorMcp = new CursorMcp({
        relativeDirPath: ".cursor",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(largeJsonData),
      });

      expect(cursorMcp.getJson()).toEqual(largeJsonData);
      expect(Object.keys((cursorMcp.getJson() as any).mcpServers)).toHaveLength(100);
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

      const cursorMcp = new CursorMcp({
        relativeDirPath: ".cursor",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(unicodeJsonData),
      });

      expect(cursorMcp.getJson()).toEqual(unicodeJsonData);
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
          },
        },
        metadata: {
          version: "1.0.0",
          created: "2024-01-01T00:00:00.000Z",
        },
      };

      const cursorMcp1 = new CursorMcp({
        relativeDirPath: ".cursor",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(originalJsonData),
      });

      // Create second instance from first instance's content
      const cursorMcp2 = new CursorMcp({
        relativeDirPath: ".cursor",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(cursorMcp1.getJson()),
      });

      expect(cursorMcp2.getJson()).toEqual(originalJsonData);
      expect(cursorMcp2.getJson()).toEqual(cursorMcp1.getJson());
    });

    it("should work correctly with different file extensions", () => {
      const cursorMcp = new CursorMcp({
        relativeDirPath: ".cursor",
        relativeFilePath: "custom-config.json",
        fileContent: JSON.stringify({ mcpServers: {} }),
      });

      expect(cursorMcp.getRelativeFilePath()).toBe("custom-config.json");
      expect(cursorMcp.getFilePath()).toBe(join(testDir, ".cursor/custom-config.json"));
    });

    it("should work correctly with different directory paths", () => {
      const cursorMcp = new CursorMcp({
        relativeDirPath: "custom-dir",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ mcpServers: {} }),
      });

      expect(cursorMcp.getRelativeDirPath()).toBe("custom-dir");
      expect(cursorMcp.getFilePath()).toBe(join(testDir, "custom-dir/mcp.json"));
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

      const cursorMcp = new CursorMcp({
        relativeDirPath: ".cursor",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(deeplyNestedData),
      });

      expect(cursorMcp.getJson()).toEqual(deeplyNestedData);
    });

    it("should handle conversion from RulesyncMcp and back", () => {
      const originalData = {
        mcpServers: {
          "roundtrip-server": {
            command: "node",
            args: ["server.js"],
            env: {
              NODE_ENV: "test",
            },
          },
        },
      };

      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(originalData),
      });

      const cursorMcp = CursorMcp.fromRulesyncMcp({
        rulesyncMcp,
        validate: false,
      });

      const backToRulesync = cursorMcp.toRulesyncMcp();

      expect(JSON.parse(backToRulesync.getFileContent())).toEqual({
        mcpServers: originalData.mcpServers,
      });
    });
  });
});
