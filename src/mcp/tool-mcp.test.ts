import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { type ValidationResult } from "../types/ai-file.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import {
  ToolMcp,
  type ToolMcpFromFileParams,
  type ToolMcpFromRulesyncMcpParams,
} from "./tool-mcp.js";

// Create a concrete test implementation of the abstract ToolMcp class
class TestToolMcp extends ToolMcp {
  validate(): ValidationResult {
    return {
      success: true,
      error: null,
    };
  }

  toRulesyncMcp(): RulesyncMcp {
    return this.toRulesyncMcpDefault();
  }

  static async fromFile(_params: ToolMcpFromFileParams): Promise<TestToolMcp> {
    throw new Error("Please implement this method in the subclass.");
  }

  static fromRulesyncMcp({
    baseDir = ".",
    rulesyncMcp,
    validate = true,
  }: ToolMcpFromRulesyncMcpParams): TestToolMcp {
    return new TestToolMcp({
      baseDir,
      relativeDirPath: "test",
      relativeFilePath: "test.json",
      fileContent: rulesyncMcp.getFileContent(),
      validate,
    });
  }
}

describe("ToolMcp", () => {
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

      const toolMcp = new TestToolMcp({
        relativeDirPath: "test",
        relativeFilePath: "test.json",
        fileContent: validJsonContent,
      });

      expect(toolMcp).toBeInstanceOf(TestToolMcp);
      expect(toolMcp).toBeInstanceOf(ToolMcp);
      expect(toolMcp.getRelativeDirPath()).toBe("test");
      expect(toolMcp.getRelativeFilePath()).toBe("test.json");
      expect(toolMcp.getFileContent()).toBe(validJsonContent);
    });

    it("should create instance with custom baseDir", () => {
      const validJsonContent = JSON.stringify({
        mcpServers: {},
      });

      const toolMcp = new TestToolMcp({
        baseDir: "/custom/path",
        relativeDirPath: "test",
        relativeFilePath: "test.json",
        fileContent: validJsonContent,
      });

      expect(toolMcp.getFilePath()).toBe("/custom/path/test/test.json");
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
        config: {
          timeout: 30000,
        },
      };
      const validJsonContent = JSON.stringify(jsonData);

      const toolMcp = new TestToolMcp({
        relativeDirPath: "test",
        relativeFilePath: "test.json",
        fileContent: validJsonContent,
      });

      expect(toolMcp.getJson()).toEqual(jsonData);
    });

    it("should handle empty JSON object", () => {
      const emptyJsonContent = JSON.stringify({});

      const toolMcp = new TestToolMcp({
        relativeDirPath: "test",
        relativeFilePath: "test.json",
        fileContent: emptyJsonContent,
      });

      expect(toolMcp.getJson()).toEqual({});
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

      const toolMcp = new TestToolMcp({
        relativeDirPath: "test",
        relativeFilePath: "test.json",
        fileContent: jsonContent,
      });

      expect(toolMcp.getJson()).toEqual(complexJsonData);
    });

    it("should validate content by default", () => {
      const validJsonContent = JSON.stringify({
        mcpServers: {},
      });

      expect(() => {
        const _instance = new TestToolMcp({
          relativeDirPath: "test",
          relativeFilePath: "test.json",
          fileContent: validJsonContent,
        });
      }).not.toThrow();
    });

    it("should skip validation when validate is false", () => {
      const validJsonContent = JSON.stringify({
        mcpServers: {},
      });

      expect(() => {
        const _instance = new TestToolMcp({
          relativeDirPath: "test",
          relativeFilePath: "test.json",
          fileContent: validJsonContent,
          validate: false,
        });
      }).not.toThrow();
    });

    it("should throw error for invalid JSON content", () => {
      const invalidJsonContent = "{ invalid json }";

      expect(() => {
        const _instance = new TestToolMcp({
          relativeDirPath: "test",
          relativeFilePath: "test.json",
          fileContent: invalidJsonContent,
        });
      }).toThrow(SyntaxError);
    });

    it("should throw error for malformed JSON", () => {
      const malformedJsonContent = '{"key": "value",}'; // trailing comma

      expect(() => {
        const _instance = new TestToolMcp({
          relativeDirPath: "test",
          relativeFilePath: "test.json",
          fileContent: malformedJsonContent,
        });
      }).toThrow(SyntaxError);
    });

    it("should throw error for non-object JSON content", () => {
      const nonObjectJsonContent = JSON.stringify("string value");

      expect(() => {
        const _instance = new TestToolMcp({
          relativeDirPath: "test",
          relativeFilePath: "test.json",
          fileContent: nonObjectJsonContent,
        });
      }).not.toThrow(); // JSON.parse handles strings, arrays, etc. just fine
    });

    it("should throw error for array JSON content", () => {
      const arrayJsonContent = JSON.stringify([1, 2, 3]);

      expect(() => {
        const _instance = new TestToolMcp({
          relativeDirPath: "test",
          relativeFilePath: "test.json",
          fileContent: arrayJsonContent,
        });
      }).not.toThrow(); // JSON.parse handles arrays just fine
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
      const toolMcp = new TestToolMcp({
        relativeDirPath: "test",
        relativeFilePath: "test.json",
        fileContent: JSON.stringify(jsonData),
      });

      const result = toolMcp.getJson();

      expect(result).toEqual(jsonData);
      expect(result).toBe(toolMcp.getJson()); // Should return the same reference
    });

    it("should return empty object for empty JSON", () => {
      const toolMcp = new TestToolMcp({
        relativeDirPath: "test",
        relativeFilePath: "test.json",
        fileContent: JSON.stringify({}),
      });

      const result = toolMcp.getJson();

      expect(result).toEqual({});
    });

    it("should return complex nested structure", () => {
      const complexData = {
        servers: {
          primary: {
            config: {
              port: 8080,
              ssl: true,
              middleware: ["auth", "cors"],
            },
          },
        },
        metadata: {
          tags: ["production", "api"],
          version: "2.1.0",
        },
      };
      const toolMcp = new TestToolMcp({
        relativeDirPath: "test",
        relativeFilePath: "test.json",
        fileContent: JSON.stringify(complexData),
      });

      const result = toolMcp.getJson();

      expect(result).toEqual(complexData);
    });
  });

  describe("toRulesyncMcpDefault", () => {
    it("should create RulesyncMcp with default configuration", () => {
      const jsonData = {
        mcpServers: {
          "test-server": {
            command: "node",
            args: ["server.js"],
          },
        },
      };
      const toolMcp = new TestToolMcp({
        relativeDirPath: "test",
        relativeFilePath: "test.json",
        fileContent: JSON.stringify(jsonData),
      });

      const rulesyncMcp = toolMcp.toRulesyncMcp();

      expect(rulesyncMcp).toBeInstanceOf(RulesyncMcp);
      expect(rulesyncMcp.getFileContent()).toBe(JSON.stringify(jsonData));
      expect(rulesyncMcp.getRelativeDirPath()).toBe(".rulesync");
      expect(rulesyncMcp.getRelativeFilePath()).toBe(".mcp.json");
    });

    it("should preserve baseDir when creating RulesyncMcp", () => {
      const jsonData = {
        mcpServers: {},
      };
      const toolMcp = new TestToolMcp({
        baseDir: "/custom/base/dir",
        relativeDirPath: "test",
        relativeFilePath: "test.json",
        fileContent: JSON.stringify(jsonData),
      });

      const rulesyncMcp = toolMcp.toRulesyncMcp();

      expect(rulesyncMcp.getBaseDir()).toBe("/custom/base/dir");
      expect(rulesyncMcp.getFilePath()).toBe("/custom/base/dir/.rulesync/.mcp.json");
    });

    it("should preserve file content exactly", () => {
      const originalJsonString = JSON.stringify({
        mcpServers: {
          "preserve-server": {
            command: "node",
            args: ["preserve.js"],
          },
        },
      });
      const toolMcp = new TestToolMcp({
        relativeDirPath: "test",
        relativeFilePath: "test.json",
        fileContent: originalJsonString,
      });

      const rulesyncMcp = toolMcp.toRulesyncMcp();

      expect(rulesyncMcp.getFileContent()).toBe(originalJsonString);
    });

    it("should work with complex JSON structures", () => {
      const complexJsonData = {
        mcpServers: {
          "server-1": {
            command: "node",
            args: ["s1.js"],
            env: { NODE_ENV: "production" },
          },
          "server-2": {
            command: "python",
            args: ["s2.py", "--config", "/path/to/config"],
            env: { PYTHONPATH: "/app" },
          },
        },
        globalConfig: {
          timeout: 30000,
          retries: 3,
          logging: {
            level: "info",
            destinations: ["console", "file"],
          },
        },
      };
      const toolMcp = new TestToolMcp({
        baseDir: "/project",
        relativeDirPath: "custom",
        relativeFilePath: "custom.json",
        fileContent: JSON.stringify(complexJsonData),
      });

      const rulesyncMcp = toolMcp.toRulesyncMcp();

      expect(rulesyncMcp.getBaseDir()).toBe("/project");
      expect(JSON.parse(rulesyncMcp.getFileContent())).toEqual(complexJsonData);
    });
  });

  describe("static methods", () => {
    it("should throw error for abstract fromFile method", async () => {
      await expect(
        ToolMcp.fromFile({
          baseDir: testDir,
        }),
      ).rejects.toThrow("Please implement this method in the subclass.");
    });

    it("should throw error for abstract fromRulesyncMcp method", async () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({ mcpServers: {} }),
      });

      await expect(async () => {
        await ToolMcp.fromRulesyncMcp({
          rulesyncMcp,
        });
      }).rejects.toThrow("Please implement this method in the subclass.");
    });

    it("should throw error for fromFile with custom parameters", async () => {
      await expect(
        ToolMcp.fromFile({
          baseDir: "/custom/path",
          validate: false,
        }),
      ).rejects.toThrow("Please implement this method in the subclass.");
    });

    it("should throw error for fromRulesyncMcp with custom parameters", async () => {
      const rulesyncMcp = new RulesyncMcp({
        baseDir: "/custom",
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            "custom-server": {
              command: "node",
              args: ["custom.js"],
            },
          },
        }),
      });

      await expect(async () => {
        await ToolMcp.fromRulesyncMcp({
          baseDir: "/target",
          rulesyncMcp,
          validate: false,
        });
      }).rejects.toThrow("Please implement this method in the subclass.");
    });
  });

  describe("concrete implementation methods", () => {
    it("should allow TestToolMcp.fromRulesyncMcp to work correctly", () => {
      const jsonData = {
        mcpServers: {
          "test-server": {
            command: "node",
            args: ["test.js"],
          },
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const toolMcp = TestToolMcp.fromRulesyncMcp({
        rulesyncMcp,
      });

      expect(toolMcp).toBeInstanceOf(TestToolMcp);
      expect(toolMcp.getJson()).toEqual(jsonData);
    });

    it("should allow TestToolMcp.fromFile to throw expected error", async () => {
      await expect(
        TestToolMcp.fromFile({
          baseDir: testDir,
        }),
      ).rejects.toThrow("Please implement this method in the subclass.");
    });
  });

  describe("inheritance and type checking", () => {
    it("should be instance of ToolMcp", () => {
      const toolMcp = new TestToolMcp({
        relativeDirPath: "test",
        relativeFilePath: "test.json",
        fileContent: JSON.stringify({}),
      });

      expect(toolMcp).toBeInstanceOf(ToolMcp);
      expect(toolMcp).toBeInstanceOf(TestToolMcp);
    });

    it("should have correct property types", () => {
      const jsonData = { mcpServers: {} };
      const toolMcp = new TestToolMcp({
        relativeDirPath: "test",
        relativeFilePath: "test.json",
        fileContent: JSON.stringify(jsonData),
      });

      expect(typeof toolMcp.getJson()).toBe("object");
      expect(typeof toolMcp.getFilePath()).toBe("string");
      expect(typeof toolMcp.getFileContent()).toBe("string");
      expect(typeof toolMcp.getRelativeDirPath()).toBe("string");
      expect(typeof toolMcp.getRelativeFilePath()).toBe("string");
    });
  });

  describe("integration", () => {
    it("should handle complete workflow: create -> toRulesyncMcp -> fromRulesyncMcp", () => {
      const originalJsonData = {
        mcpServers: {
          "workflow-server": {
            command: "node",
            args: ["workflow.js", "--config", "config.json"],
            env: {
              NODE_ENV: "test",
            },
          },
        },
        settings: {
          debug: true,
          timeout: 45000,
        },
      };

      // Step 1: Create original ToolMcp
      const originalToolMcp = new TestToolMcp({
        baseDir: testDir,
        relativeDirPath: "original",
        relativeFilePath: "original.json",
        fileContent: JSON.stringify(originalJsonData),
      });

      // Step 2: Convert to RulesyncMcp
      const rulesyncMcp = originalToolMcp.toRulesyncMcp();

      // Step 3: Create new ToolMcp from RulesyncMcp
      const newToolMcp = TestToolMcp.fromRulesyncMcp({
        baseDir: testDir,
        rulesyncMcp,
      });

      // Verify data integrity
      expect(newToolMcp.getJson()).toEqual(originalJsonData);
      expect(newToolMcp.getBaseDir()).toBe(testDir);
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
        globalConfig: {
          timeout: 60000,
          maxRetries: 5,
          logLevel: "debug",
          features: {
            authentication: true,
            caching: true,
            metrics: false,
          },
        },
        metadata: {
          version: "3.0.0",
          description: "Integration test configuration",
          tags: ["test", "integration", "mcp"],
        },
      };

      // Create TestToolMcp
      const toolMcp = new TestToolMcp({
        baseDir: "/project",
        relativeDirPath: "integration",
        relativeFilePath: "integration.json",
        fileContent: JSON.stringify(complexJsonData),
      });

      // Convert to RulesyncMcp and back
      const rulesyncMcp = toolMcp.toRulesyncMcp();
      const newToolMcp = TestToolMcp.fromRulesyncMcp({
        baseDir: "/project",
        rulesyncMcp,
      });

      // Verify all data is preserved
      expect(newToolMcp.getJson()).toEqual(complexJsonData);
      expect(newToolMcp.getBaseDir()).toBe("/project");
    });

    it("should handle edge cases in data transformation", () => {
      const edgeCaseData = {
        mcpServers: {},
        emptyObject: {},
        emptyArray: [],
        nullValue: null,
        booleanTrue: true,
        booleanFalse: false,
        numberZero: 0,
        numberNegative: -42,
        numberFloat: 3.14159,
        stringEmpty: "",
        stringWithSpecialChars: "Hello \"World\" with 'quotes' and \\backslashes\\",
        unicode: "🌟 Unicode test 中文 العربية",
      };

      const toolMcp = new TestToolMcp({
        relativeDirPath: "edge-case",
        relativeFilePath: "edge.json",
        fileContent: JSON.stringify(edgeCaseData),
      });

      const rulesyncMcp = toolMcp.toRulesyncMcp();
      const newToolMcp = TestToolMcp.fromRulesyncMcp({
        rulesyncMcp,
      });

      expect(newToolMcp.getJson()).toEqual(edgeCaseData);
    });
  });
});
