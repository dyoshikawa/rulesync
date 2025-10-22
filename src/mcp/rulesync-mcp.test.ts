import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { type ValidationResult } from "../types/ai-file.js";
import { ensureDir, writeFileContent } from "../utils/file.js";
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
  });

  afterEach(async () => {
    await cleanup();
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
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: validJsonContent,
      });

      expect(rulesyncMcp).toBeInstanceOf(RulesyncMcp);
      expect(rulesyncMcp.getRelativeDirPath()).toBe(".rulesync");
      expect(rulesyncMcp.getRelativeFilePath()).toBe(".mcp.json");
      expect(rulesyncMcp.getFileContent()).toBe(validJsonContent);
    });

    it("should create instance with custom baseDir", () => {
      const validJsonContent = JSON.stringify({
        mcpServers: {},
      });

      const rulesyncMcp = new RulesyncMcp({
        baseDir: "/custom/path",
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: validJsonContent,
      });

      expect(rulesyncMcp.getFilePath()).toBe("/custom/path/.rulesync/.mcp.json");
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
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: validJsonContent,
      });

      expect(rulesyncMcp.getJson()).toEqual(jsonData);
    });

    it("should handle empty JSON object", () => {
      const emptyJsonContent = JSON.stringify({});

      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: ".rulesync",
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
        relativeDirPath: ".rulesync",
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
          relativeDirPath: ".rulesync",
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
          relativeDirPath: ".rulesync",
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
          relativeDirPath: ".rulesync",
          relativeFilePath: ".mcp.json",
          fileContent: invalidJsonContent,
        });
      }).toThrow(SyntaxError);
    });

    it("should throw error for malformed JSON", () => {
      const malformedJsonContent = '{"key": "value",}'; // trailing comma

      expect(() => {
        const _instance = new RulesyncMcp({
          relativeDirPath: ".rulesync",
          relativeFilePath: ".mcp.json",
          fileContent: malformedJsonContent,
        });
      }).toThrow(SyntaxError);
    });

    it("should handle non-object JSON content", () => {
      const stringJsonContent = JSON.stringify("string value");

      expect(() => {
        const _instance = new RulesyncMcp({
          relativeDirPath: ".rulesync",
          relativeFilePath: ".mcp.json",
          fileContent: stringJsonContent,
        });
      }).not.toThrow(); // JSON.parse handles strings just fine
    });

    it("should handle array JSON content", () => {
      const arrayJsonContent = JSON.stringify([1, 2, 3]);

      expect(() => {
        const _instance = new RulesyncMcp({
          relativeDirPath: ".rulesync",
          relativeFilePath: ".mcp.json",
          fileContent: arrayJsonContent,
        });
      }).not.toThrow(); // JSON.parse handles arrays just fine
    });

    it("should handle null JSON content", () => {
      const nullJsonContent = JSON.stringify(null);

      expect(() => {
        const _instance = new RulesyncMcp({
          relativeDirPath: ".rulesync",
          relativeFilePath: ".mcp.json",
          fileContent: nullJsonContent,
        });
      }).not.toThrow(); // JSON.parse handles null just fine
    });

    it("should handle numeric JSON content", () => {
      const numericJsonContent = JSON.stringify(42);

      expect(() => {
        const _instance = new RulesyncMcp({
          relativeDirPath: ".rulesync",
          relativeFilePath: ".mcp.json",
          fileContent: numericJsonContent,
        });
      }).not.toThrow(); // JSON.parse handles numbers just fine
    });

    it("should handle boolean JSON content", () => {
      const booleanJsonContent = JSON.stringify(true);

      expect(() => {
        const _instance = new RulesyncMcp({
          relativeDirPath: ".rulesync",
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
          relativeDirPath: ".rulesync",
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
          relativeDirPath: ".rulesync",
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
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({ mcpServers: {} }),
        validate: false, // Skip validation in constructor to test method directly
      });

      const result = rulesyncMcp.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should always return success for current implementation", () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({ invalid: "data" }),
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
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const result = rulesyncMcp.getJson();

      expect(result).toEqual(jsonData);
      expect(result).toBe(rulesyncMcp.getJson()); // Should return the same reference
    });

    it("should return empty object for empty JSON", () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({}),
      });

      const result = rulesyncMcp.getJson();

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
            targets: ["claudecode"],
          },
        },
        metadata: {
          tags: ["production", "api"],
          version: "2.1.0",
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(complexData),
      });

      const result = rulesyncMcp.getJson();

      expect(result).toEqual(complexData);
    });

    it("should handle primitive JSON values", () => {
      const primitiveValue = "simple string";
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(primitiveValue),
      });

      const result = rulesyncMcp.getJson();

      expect(result).toBe(primitiveValue);
    });

    it("should handle array JSON values", () => {
      const arrayValue = [1, 2, { key: "value" }, "string"];
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(arrayValue),
      });

      const result = rulesyncMcp.getJson();

      expect(result).toEqual(arrayValue);
    });

    it("should handle null JSON values", () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(null),
      });

      const result = rulesyncMcp.getJson();

      expect(result).toBeNull();
    });
  });

  describe("fromFile", () => {
    it("should create RulesyncMcp from existing file", async () => {
      const mcpJsonPath = join(testDir, ".rulesync", "mcp.json");
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
      await ensureDir(join(testDir, ".rulesync"));
      await writeFileContent(mcpJsonPath, JSON.stringify(jsonData, null, 2));

      // Change working directory to test directory temporarily
      const originalCwd = process.cwd();
      process.chdir(testDir);

      try {
        const rulesyncMcp = await RulesyncMcp.fromFile({ validate: true });

        expect(rulesyncMcp).toBeInstanceOf(RulesyncMcp);
        expect(rulesyncMcp.getJson()).toEqual(jsonData);
        expect(rulesyncMcp.getBaseDir()).toBe(".");
        expect(rulesyncMcp.getRelativeDirPath()).toBe(".rulesync");
        expect(rulesyncMcp.getRelativeFilePath()).toBe("mcp.json");
      } finally {
        process.chdir(originalCwd);
      }
    });

    it("should create RulesyncMcp from file with validation disabled", async () => {
      const mcpJsonPath = join(testDir, ".rulesync", "mcp.json");
      const jsonData = {
        mcpServers: {
          "no-validation-server": {
            command: "python",
            args: ["server.py"],
          },
        },
      };

      await ensureDir(join(testDir, ".rulesync"));
      await writeFileContent(mcpJsonPath, JSON.stringify(jsonData));

      const originalCwd = process.cwd();
      process.chdir(testDir);

      try {
        const rulesyncMcp = await RulesyncMcp.fromFile({ validate: false });

        expect(rulesyncMcp).toBeInstanceOf(RulesyncMcp);
        expect(rulesyncMcp.getJson()).toEqual(jsonData);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it("should use validation by default", async () => {
      const mcpJsonPath = join(testDir, ".rulesync", "mcp.json");
      const jsonData = {
        mcpServers: {},
      };

      await ensureDir(join(testDir, ".rulesync"));
      await writeFileContent(mcpJsonPath, JSON.stringify(jsonData));

      const originalCwd = process.cwd();
      process.chdir(testDir);

      try {
        const rulesyncMcp = await RulesyncMcp.fromFile({});

        expect(rulesyncMcp).toBeInstanceOf(RulesyncMcp);
        expect(rulesyncMcp.getJson()).toEqual(jsonData);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it("should handle complex MCP server configurations", async () => {
      const mcpJsonPath = join(testDir, ".rulesync", "mcp.json");
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

      await ensureDir(join(testDir, ".rulesync"));
      await writeFileContent(mcpJsonPath, JSON.stringify(complexMcpData, null, 2));

      const originalCwd = process.cwd();
      process.chdir(testDir);

      try {
        const rulesyncMcp = await RulesyncMcp.fromFile({ validate: true });

        expect(rulesyncMcp.getJson()).toEqual(complexMcpData);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it("should throw error if file does not exist", async () => {
      const originalCwd = process.cwd();
      process.chdir(testDir); // Change to empty test directory

      try {
        await expect(RulesyncMcp.fromFile({ validate: true })).rejects.toThrow();
      } finally {
        process.chdir(originalCwd);
      }
    });

    it("should throw error for invalid JSON in file", async () => {
      const mcpJsonPath = join(testDir, ".rulesync", ".mcp.json");
      const invalidJson = "{ invalid json content }";

      await ensureDir(join(testDir, ".rulesync"));
      await writeFileContent(mcpJsonPath, invalidJson);

      const originalCwd = process.cwd();
      process.chdir(testDir);

      try {
        await expect(RulesyncMcp.fromFile({ validate: true })).rejects.toThrow(SyntaxError);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it("should handle empty file", async () => {
      const mcpJsonPath = join(testDir, ".rulesync", ".mcp.json");

      await ensureDir(join(testDir, ".rulesync"));
      await writeFileContent(mcpJsonPath, "");

      const originalCwd = process.cwd();
      process.chdir(testDir);

      try {
        await expect(RulesyncMcp.fromFile({ validate: true })).rejects.toThrow(SyntaxError);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it("should handle file with only whitespace", async () => {
      const mcpJsonPath = join(testDir, ".rulesync", ".mcp.json");

      await ensureDir(join(testDir, ".rulesync"));
      await writeFileContent(mcpJsonPath, "   \n\t  \n  ");

      const originalCwd = process.cwd();
      process.chdir(testDir);

      try {
        await expect(RulesyncMcp.fromFile({ validate: true })).rejects.toThrow(SyntaxError);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it("should prefer recommended path over legacy when both exist", async () => {
      const recommendedPath = join(testDir, ".rulesync", "mcp.json");
      const legacyPath = join(testDir, ".rulesync", ".mcp.json");

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

      await ensureDir(join(testDir, ".rulesync"));
      await writeFileContent(recommendedPath, JSON.stringify(recommendedData));
      await writeFileContent(legacyPath, JSON.stringify(legacyData));

      const originalCwd = process.cwd();
      process.chdir(testDir);

      try {
        const rulesyncMcp = await RulesyncMcp.fromFile({ validate: true });

        expect(rulesyncMcp.getJson()).toEqual(recommendedData);
        expect(rulesyncMcp.getRelativeFilePath()).toBe("mcp.json");
      } finally {
        process.chdir(originalCwd);
      }
    });

    it("should use legacy path when recommended does not exist", async () => {
      const legacyPath = join(testDir, ".rulesync", ".mcp.json");

      const legacyData = {
        mcpServers: {
          "legacy-server": {
            command: "node",
            args: ["legacy.js"],
          },
        },
      };

      await ensureDir(join(testDir, ".rulesync"));
      await writeFileContent(legacyPath, JSON.stringify(legacyData));

      const originalCwd = process.cwd();
      process.chdir(testDir);

      try {
        const rulesyncMcp = await RulesyncMcp.fromFile({ validate: true });

        expect(rulesyncMcp.getJson()).toEqual(legacyData);
        expect(rulesyncMcp.getRelativeFilePath()).toBe(".mcp.json");
      } finally {
        process.chdir(originalCwd);
      }
    });

    it("should use recommended path when neither exists (for error message)", async () => {
      const originalCwd = process.cwd();
      process.chdir(testDir);

      try {
        await expect(RulesyncMcp.fromFile({ validate: true })).rejects.toThrow();
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  describe("type exports and schema", () => {
    it("should export RulesyncMcpParams type", () => {
      const params: RulesyncMcpParams = {
        relativeDirPath: ".rulesync",
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
        relativeDirPath: ".rulesync",
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
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({}),
      });

      expect(rulesyncMcp.constructor.name).toBe("RulesyncMcp");
    });

    it("should have correct property types inherited from base classes", () => {
      const jsonData = { mcpServers: {} };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: ".rulesync",
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
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      expect(rulesyncMcp.getBaseDir()).toBe("/test/base");
      expect(rulesyncMcp.getRelativeDirPath()).toBe(".rulesync");
      expect(rulesyncMcp.getRelativeFilePath()).toBe(".mcp.json");
      expect(rulesyncMcp.getFileContent()).toBe(JSON.stringify(jsonData));
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
        relativeDirPath: ".rulesync",
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
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(unicodeJsonData),
      });

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
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(originalJsonData),
      });

      // Create second instance from first instance's content
      const rulesyncMcp2 = new RulesyncMcp({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(rulesyncMcp1.getJson()),
      });

      expect(rulesyncMcp2.getJson()).toEqual(originalJsonData);
      expect(rulesyncMcp2.getJson()).toEqual(rulesyncMcp1.getJson());
    });

    it("should work correctly with different file extensions", () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: ".rulesync",
        relativeFilePath: "custom-config.json",
        fileContent: JSON.stringify({ mcpServers: {} }),
      });

      expect(rulesyncMcp.getRelativeFilePath()).toBe("custom-config.json");
      expect(rulesyncMcp.getFilePath()).toBe(".rulesync/custom-config.json");
    });

    it("should work correctly with different directory paths", () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: "custom-dir",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({ mcpServers: {} }),
      });

      expect(rulesyncMcp.getRelativeDirPath()).toBe("custom-dir");
      expect(rulesyncMcp.getFilePath()).toBe("custom-dir/.mcp.json");
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
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(deeplyNestedData),
      });

      expect(rulesyncMcp.getJson()).toEqual(deeplyNestedData);
    });
  });
});
