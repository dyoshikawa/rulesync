import { basename, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_MCP_FILE_NAME,
  RULESYNC_MCP_LEGACY_FILE_NAME,
  RULESYNC_MCP_RELATIVE_FILE_PATH,
  RULESYNC_MCP_SCHEMA_URL,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { type ValidationResult } from "../../types/ai-file.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import {
  mergeMcpJsonOverlays,
  RulesyncMcp,
  type RulesyncMcpFromFileParams,
  type RulesyncMcpParams,
} from "./rulesync-mcp.js";

const makeInstance = (json: Record<string, unknown>) =>
  new RulesyncMcp({
    relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
    relativeFilePath: "mcp.json",
    fileContent: JSON.stringify(json),
  });

const makeLogger = () => ({ warn: vi.fn() }) as any;

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

    it("should create instance with custom outputRoot", () => {
      const validJsonContent = JSON.stringify({
        mcpServers: {},
      });

      const rulesyncMcp = new RulesyncMcp({
        outputRoot: "/custom/path",
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: validJsonContent,
      });

      expect(rulesyncMcp.getFilePath()).toBe(
        `/custom/path/${RULESYNC_RELATIVE_DIR_PATH}/.mcp.json`,
      );
      expect(rulesyncMcp.getOutputRoot()).toBe("/custom/path");
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

    it("should accept JSONC content (trailing commas and comments)", () => {
      const jsoncContent = `{
        // servers
        "mcpServers": {
          "test": { "command": "node", },
        },
      }`;

      const instance = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "mcp.jsonc",
        fileContent: jsoncContent,
      });

      expect(instance.getMcpServers()).toEqual({ test: { command: "node" } });
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
    // A server named after a prototype member is removed by the parser before
    // the schema can see it, so it used to produce neither an error nor an
    // entry in any generated file. These pin the report that replaced that
    // silence.
    it("should reject a server named after a prototype member", () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_MCP_FILE_NAME,
        // Written as raw text: a `__proto__` key in an object literal sets the
        // prototype instead of becoming a property, so it would never survive
        // JSON.stringify to reach the parser under test.
        fileContent: '{"mcpServers": {"__proto__": {"command": "node"}}}',
        validate: false,
      });

      const result = rulesyncMcp.validate();

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("mcpServers.__proto__");
      expect(result.error?.message).toContain("rename them");
    });

    it("should throw from the constructor when validation is enabled", () => {
      expect(
        () =>
          new RulesyncMcp({
            relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
            relativeFilePath: RULESYNC_MCP_FILE_NAME,
            fileContent: '{"mcpServers": {"constructor": {"command": "node"}}}',
            validate: true,
          }),
      ).toThrow("mcpServers.constructor");
    });

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

    it("should pass validation when $schema field is present", () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: basename(RULESYNC_MCP_RELATIVE_FILE_PATH),
        fileContent: JSON.stringify({
          $schema: RULESYNC_MCP_SCHEMA_URL,
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

    it("should validate an AI Assistant tool-scoped block", () => {
      const rulesyncMcp = makeInstance({
        mcpServers: { shared: { command: "node" } },
        aiassistant: {
          mcpServers: {
            extra: { command: "uvx" },
            shared: null,
          },
        },
      });

      expect(rulesyncMcp.validate()).toEqual({ success: true, error: null });
    });

    it("should reject a malformed AI Assistant tool-scoped block", () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: basename(RULESYNC_MCP_RELATIVE_FILE_PATH),
        fileContent: JSON.stringify({
          mcpServers: {},
          aiassistant: { mcpServers: { malformed: "not-a-server" } },
        }),
        validate: false,
      });

      expect(rulesyncMcp.validate().success).toBe(false);
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
    it("should load mcp.jsonc with comments", async () => {
      const jsoncPath = join(testDir, RULESYNC_RELATIVE_DIR_PATH, "mcp.jsonc");
      const jsoncContent = `{
        "mcpServers": {
          // local stdio server
          "file-server": { "command": "node", },
        },
      }`;

      await ensureDir(join(testDir, RULESYNC_RELATIVE_DIR_PATH));
      await writeFileContent(jsoncPath, jsoncContent);

      const rulesyncMcp = await RulesyncMcp.fromFile({ validate: true });

      expect(rulesyncMcp.getRelativeFilePath()).toBe("mcp.jsonc");
      expect(rulesyncMcp.getMcpServers()).toEqual({ "file-server": { command: "node" } });
    });

    it("should prefer mcp.jsonc over mcp.json when both exist", async () => {
      await ensureDir(join(testDir, RULESYNC_RELATIVE_DIR_PATH));
      await writeFileContent(
        join(testDir, RULESYNC_RELATIVE_DIR_PATH, basename(RULESYNC_MCP_RELATIVE_FILE_PATH)),
        JSON.stringify({ mcpServers: { fromJson: { command: "a" } } }),
      );
      await writeFileContent(
        join(testDir, RULESYNC_RELATIVE_DIR_PATH, "mcp.jsonc"),
        JSON.stringify({ mcpServers: { fromJsonc: { command: "b" } } }),
      );

      const rulesyncMcp = await RulesyncMcp.fromFile({ validate: true });

      expect(rulesyncMcp.getRelativeFilePath()).toBe("mcp.jsonc");
      expect(Object.keys(rulesyncMcp.getMcpServers())).toEqual(["fromJsonc"]);
    });

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
      expect(rulesyncMcp.getOutputRoot()).toBe(testDir);
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
        outputRoot: "/custom",
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: "{}",
        validate: false,
      };

      const fromFileParams: RulesyncMcpFromFileParams = {
        validate: false,
      };

      expect(constructorParams.outputRoot).toBe("/custom");
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
      expect(typeof rulesyncMcp.getOutputRoot()).toBe("string");
      expect(typeof rulesyncMcp.getRelativePathFromCwd()).toBe("string");
    });

    it("should call parent constructor correctly", () => {
      const jsonData = { mcpServers: { test: { command: "node" } } };
      const rulesyncMcp = new RulesyncMcp({
        outputRoot: "/test/base",
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      expect(rulesyncMcp.getOutputRoot()).toBe("/test/base");
      expect(rulesyncMcp.getRelativeDirPath()).toBe(RULESYNC_RELATIVE_DIR_PATH);
      expect(rulesyncMcp.getRelativeFilePath()).toBe(".mcp.json");
      expect(rulesyncMcp.getFileContent()).toBe(JSON.stringify(jsonData));
    });
  });

  describe("enabled generation filter (issue #2433)", () => {
    it("emits a server unless enabled is explicitly false", () => {
      const instance = makeInstance({
        mcpServers: {
          implicit: { command: "node" },
          explicit: { command: "deno", enabled: true },
          off: { command: "bun", enabled: false },
        },
      });

      const servers = instance.getMcpServers();
      expect(Object.keys(servers).toSorted()).toEqual(["explicit", "implicit"]);
      // The filter field never reaches tool output — OpenCode/Kilo/Grok/Goose
      // have a NATIVE enabled field with different semantics.
      expect(servers.explicit).toEqual({ command: "deno" });
    });

    it("keeps the pass-through disabled field on servers that are still emitted", () => {
      const instance = makeInstance({
        mcpServers: {
          off: { command: "node", disabled: true },
          gone: { command: "deno", disabled: true, enabled: false },
        },
      });

      const servers = instance.getMcpServers();
      // enabled: false wins and drops the server entirely; disabled only
      // matters for servers still emitted.
      expect(Object.keys(servers)).toEqual(["off"]);
      expect(servers.off).toEqual({ command: "node", disabled: true });
    });

    it("filters enabled: false inside a tool-scoped block too", () => {
      const instance = makeInstance({
        mcpServers: { shared: { command: "node" } },
        claudecode: { mcpServers: { extra: { command: "uvx", enabled: false } } },
      });

      const forClaudecode = instance.forTarget({ toolTarget: "claudecode" });
      expect(Object.keys(forClaudecode.getMcpServers())).toEqual(["shared"]);
    });

    it("produces an empty map when every server is filtered out", () => {
      const instance = makeInstance({
        mcpServers: { a: { command: "node", enabled: false } },
      });

      expect(instance.getMcpServers()).toEqual({});
    });
  });

  describe("forTarget", () => {
    it("should return the same instance when no tool block or targets exist", () => {
      const instance = makeInstance({ mcpServers: { shared: { command: "node" } } });

      expect(instance.forTarget({ toolTarget: "claudecode" })).toBe(instance);
    });

    it("should add a tool-scoped server only for that tool", () => {
      const instance = makeInstance({
        mcpServers: { shared: { command: "node" } },
        claudecode: { mcpServers: { extra: { command: "uvx" } } },
      });

      const forClaudecode = instance.forTarget({ toolTarget: "claudecode" });
      expect(Object.keys(forClaudecode.getMcpServers())).toEqual(["shared", "extra"]);

      const forCursor = instance.forTarget({ toolTarget: "cursor" });
      expect(Object.keys(forCursor.getMcpServers())).toEqual(["shared"]);
    });

    it("should apply AI Assistant additions and null removals", () => {
      const instance = makeInstance({
        mcpServers: { shared: { command: "node" }, kept: { command: "deno" } },
        aiassistant: {
          mcpServers: { shared: null, extra: { command: "uvx" } },
        },
      });

      expect(instance.forTarget({ toolTarget: "aiassistant" }).getMcpServers()).toEqual({
        kept: { command: "deno" },
        extra: { command: "uvx" },
      });
    });

    it("should replace a same-named shared server wholesale", () => {
      const instance = makeInstance({
        mcpServers: { serena: { command: "uvx", args: ["serena"], env: { A: "1" } } },
        codexcli: { mcpServers: { serena: { command: "npx" } } },
      });

      const effective = instance.forTarget({ toolTarget: "codexcli" });

      expect(effective.getMcpServers().serena).toEqual({ command: "npx" });
    });

    it("should remove a shared server when the tool-scoped entry is null", () => {
      const instance = makeInstance({
        mcpServers: { shared: { command: "node" }, other: { command: "deno" } },
        warp: { mcpServers: { shared: null } },
      });

      const effective = instance.forTarget({ toolTarget: "warp" });

      expect(Object.keys(effective.getMcpServers())).toEqual(["other"]);
    });

    it("should honor the deprecated targets filter and warn", () => {
      const logger = makeLogger();
      const instance = makeInstance({
        mcpServers: {
          all: { command: "node" },
          claudeOnly: { command: "uvx", targets: ["claudecode"] },
          wildcard: { command: "deno", targets: ["*"] },
        },
      });

      const forClaudecode = instance.forTarget({ toolTarget: "claudecode", logger });
      expect(Object.keys(forClaudecode.getMcpServers())).toEqual(["all", "claudeOnly", "wildcard"]);

      const forCursor = instance.forTarget({ toolTarget: "cursor", logger });
      expect(Object.keys(forCursor.getMcpServers())).toEqual(["all", "wildcard"]);

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("deprecated"));
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("claudeOnly"));
    });

    it("should strip every tool-scoped block from the effective json", () => {
      const instance = makeInstance({
        $schema: "https://example.com/mcp-schema.json",
        mcpServers: { shared: { command: "node" } },
        claudecode: { mcpServers: { claudeExtra: { command: "uvx" } } },
        cursor: { mcpServers: { cursorExtra: { command: "deno" } } },
      });

      // Translators like Junie spread the whole rulesync JSON into their
      // output, so other tools' blocks must not survive forTarget.
      const effective = instance.forTarget({ toolTarget: "junie" });
      const json = effective.getJson() as Record<string, unknown>;

      expect(json.claudecode).toBeUndefined();
      expect(json.cursor).toBeUndefined();
      expect(json.$schema).toBe("https://example.com/mcp-schema.json");
      expect(Object.keys(effective.getMcpServers())).toEqual(["shared"]);
    });

    it("should read the kiro block for kiro-cli and kiro-ide (shared output file)", () => {
      const instance = makeInstance({
        mcpServers: { shared: { command: "node" } },
        kiro: { mcpServers: { kiroExtra: { command: "uvx" } } },
      });

      for (const toolTarget of ["kiro", "kiro-cli", "kiro-ide"] as const) {
        const effective = instance.forTarget({ toolTarget });
        expect(Object.keys(effective.getMcpServers())).toEqual(["shared", "kiroExtra"]);
      }
    });

    it("should match deprecated targets across shared-output alias groups", () => {
      const instance = makeInstance({
        mcpServers: {
          kiroServer: { command: "node", targets: ["kiro"] },
          legacyServer: { command: "deno", targets: ["claudecode-legacy"] },
        },
      });

      // All kiro variants write the same file, so a `targets: ["kiro"]`
      // server must be kept for every variant.
      for (const toolTarget of ["kiro", "kiro-cli", "kiro-ide"] as const) {
        expect(Object.keys(instance.forTarget({ toolTarget }).getMcpServers())).toEqual([
          "kiroServer",
        ]);
      }

      // `claudecode-legacy` and `claudecode` form one alias group.
      for (const toolTarget of ["claudecode", "claudecode-legacy"] as const) {
        expect(Object.keys(instance.forTarget({ toolTarget }).getMcpServers())).toEqual([
          "legacyServer",
        ]);
      }

      expect(Object.keys(instance.forTarget({ toolTarget: "cursor" }).getMcpServers())).toEqual([]);
    });

    it("should apply both antigravity blocks regardless of target (shared output file)", () => {
      const instance = makeInstance({
        mcpServers: { shared: { command: "node" } },
        "antigravity-ide": {
          mcpServers: { ideExtra: { command: "uvx" }, both: { command: "ide-wins" } },
        },
        "antigravity-cli": { mcpServers: { both: { command: "cli-wins" } } },
      });

      // Both targets write the same file at BOTH scopes
      // (.agents/mcp_config.json and ~/.gemini/config/mcp_config.json), so
      // both must resolve to the same deterministic server set: ide block
      // first, cli block second (cli wins per server on conflict).
      for (const toolTarget of ["antigravity-ide", "antigravity-cli"] as const) {
        const servers = instance.forTarget({ toolTarget }).getMcpServers();
        expect(Object.keys(servers).toSorted()).toEqual(["both", "ideExtra", "shared"]);
        expect(servers.both).toEqual({ command: "cli-wins" });
      }
    });

    it("should warn when a block is authored under an alias source name", () => {
      const logger = makeLogger();
      const instance = makeInstance({
        mcpServers: { shared: { command: "node" } },
        "kiro-cli": { mcpServers: { ignored: { command: "uvx" } } },
      });

      const effective = instance.forTarget({ toolTarget: "kiro-cli", logger });

      // The block under the alias SOURCE name is ignored, but not silently.
      expect(Object.keys(effective.getMcpServers())).toEqual(["shared"]);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('"kiro"'));
    });

    it("should read the claudecode block for the claudecode-legacy target", () => {
      const instance = makeInstance({
        mcpServers: { shared: { command: "node", targets: ["claudecode"] } },
        claudecode: { mcpServers: { extra: { command: "uvx" } } },
      });

      const effective = instance.forTarget({ toolTarget: "claudecode-legacy" });

      expect(Object.keys(effective.getMcpServers())).toEqual(["shared", "extra"]);
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

    it("should preserve outputRoot and paths in the new instance", () => {
      const rulesyncMcp = new RulesyncMcp({
        outputRoot: "/custom/path",
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

      expect(result.getOutputRoot()).toBe("/custom/path");
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

  describe("getMcpServers field stripping", () => {
    it("should strip codex-specific envVars from getMcpServers output", () => {
      // envVars is codex-only; it must NOT leak into other tools' generated
      // configs (claudecode, opencode, kilo, etc.) which all
      // consume getMcpServers(). The codex generator reads envVars directly
      // from getJson() instead.
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            pal: {
              type: "stdio",
              command: "uvx",
              args: ["pal-mcp-server"],
              envVars: ["OPENAI_API_KEY", "OPENROUTER_API_KEY"],
            },
          },
        }),
      });

      const servers = rulesyncMcp.getMcpServers();

      expect(servers.pal).toBeDefined();
      expect((servers.pal as any).command).toBe("uvx");
      expect((servers.pal as any).envVars).toBeUndefined();
    });

    it("should strip both spellings of the codex-only experimental_environment", () => {
      // Codex-only, and meaningless to every other tool. The camelCase form is
      // canonical; the snake_case one is what someone copying a codex config
      // writes, and it leaked into every other tool's config before.
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            canonical: { command: "uvx", experimentalEnvironment: "remote" },
            raw: { command: "uvx", experimental_environment: "remote" },
          },
        }),
      });

      const servers = rulesyncMcp.getMcpServers();

      expect((servers.canonical as any).experimentalEnvironment).toBeUndefined();
      expect((servers.raw as any).experimental_environment).toBeUndefined();
      expect((servers.canonical as any).command).toBe("uvx");
      expect((servers.raw as any).command).toBe("uvx");
    });

    it("should strip the musecode-only musecodeMode from getMcpServers output", () => {
      // Same arrangement as envVars: `musecodeMode` is written out only by the
      // musecode generator, which reads it back off getJson(). Leaving it in the
      // shared map would put a rulesync-only key into every other tool's config.
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            pal: { command: "uvx", args: ["pal-mcp-server"], musecodeMode: "optional" },
          },
        }),
      });

      const servers = rulesyncMcp.getMcpServers();

      expect((servers.pal as any).musecodeMode).toBeUndefined();
      expect((servers.pal as any).command).toBe("uvx");
      expect((rulesyncMcp.getJson().mcpServers.pal as any).musecodeMode).toBe("optional");
    });

    it("should strip the rovodev-only enable_instructions from getMcpServers output", () => {
      // Stronger reason than envVars/musecodeMode: this key decides whether a
      // third-party server's own text is pasted into the agent's system prompt,
      // so leaking it into every other tool's config would opt the user into
      // that for tools they were not writing about. Both spellings are stripped
      // because both are accepted on the way in.
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            canonical: { command: "uvx", rovodevEnableInstructions: true },
            raw: { command: "uvx", enable_instructions: true },
          },
        }),
      });

      const servers = rulesyncMcp.getMcpServers();

      expect((servers.canonical as any).rovodevEnableInstructions).toBeUndefined();
      expect((servers.raw as any).enable_instructions).toBeUndefined();
      expect((servers.canonical as any).command).toBe("uvx");
      expect((servers.raw as any).command).toBe("uvx");
      expect((rulesyncMcp.getJson().mcpServers.canonical as any).rovodevEnableInstructions).toBe(
        true,
      );
      expect((rulesyncMcp.getJson().mcpServers.raw as any).enable_instructions).toBe(true);
    });

    it("should still expose envVars via getJson() for the codex generator", () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            pal: {
              type: "stdio",
              command: "uvx",
              envVars: ["OPENAI_API_KEY"],
            },
          },
        }),
      });

      const fromJson = rulesyncMcp.getJson().mcpServers.pal;
      expect((fromJson as any).envVars).toEqual(["OPENAI_API_KEY"]);
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

describe("RulesyncMcp.fromRoots", () => {
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

  it("should preserve a single root's JSONC content and actual source path", async () => {
    const inputRoot = join(testDir, RULESYNC_RELATIVE_DIR_PATH);
    const fileContent = `{
  // Keep this comment when no merge is necessary.
  "mcpServers": {
    "alpha": { "command": "alpha" },
  },
}`;

    await writeFileContent(join(inputRoot, RULESYNC_MCP_LEGACY_FILE_NAME), fileContent);

    const rulesyncMcp = await RulesyncMcp.fromRoots({ inputRoots: [inputRoot] });

    expect(rulesyncMcp.getRelativeFilePath()).toBe(RULESYNC_MCP_LEGACY_FILE_NAME);
    expect(rulesyncMcp.getFileContent()).toBe(fileContent);
  });

  it("should preserve JSONC content and source path when only one of several roots has the file", async () => {
    const baseRoot = join(testDir, RULESYNC_RELATIVE_DIR_PATH);
    const overlayRoot = join(testDir, ".rulesync.local");
    const fileContent = `{
  // Only the overlay provides an MCP file, so nothing is merged.
  "mcpServers": {
    "alpha": { "command": "alpha" },
  },
}`;

    await ensureDir(baseRoot);
    await writeFileContent(join(overlayRoot, RULESYNC_MCP_FILE_NAME), fileContent);

    const rulesyncMcp = await RulesyncMcp.fromRoots({ inputRoots: [baseRoot, overlayRoot] });

    expect(rulesyncMcp.getFileContent()).toBe(fileContent);
    expect(rulesyncMcp.getFilePath()).toBe(join(overlayRoot, RULESYNC_MCP_FILE_NAME));
  });

  it("should reject top-level null MCP servers instead of treating them as deletions", async () => {
    const baseRoot = join(testDir, RULESYNC_RELATIVE_DIR_PATH);
    const overlayRoot = join(testDir, ".rulesync.local");
    await writeFileContent(
      join(baseRoot, RULESYNC_MCP_FILE_NAME),
      JSON.stringify({
        mcpServers: {
          alpha: { command: "alpha" },
          beta: { command: "beta" },
        },
      }),
    );
    await writeFileContent(
      join(overlayRoot, RULESYNC_MCP_FILE_NAME),
      JSON.stringify({
        mcpServers: {
          alpha: null,
        },
      }),
    );

    await expect(RulesyncMcp.fromRoots({ inputRoots: [baseRoot, overlayRoot] })).rejects.toThrow(
      join(overlayRoot, RULESYNC_MCP_FILE_NAME),
    );
  });

  it("should validate a base file even when an overlay would replace its invalid server", async () => {
    const baseRoot = join(testDir, RULESYNC_RELATIVE_DIR_PATH);
    const overlayRoot = join(testDir, ".rulesync.local");
    await writeFileContent(
      join(baseRoot, RULESYNC_MCP_FILE_NAME),
      JSON.stringify({ mcpServers: { shared: { command: 123 } } }),
    );
    await writeFileContent(
      join(overlayRoot, RULESYNC_MCP_FILE_NAME),
      JSON.stringify({ mcpServers: { shared: { command: "valid-overlay" } } }),
    );

    await expect(RulesyncMcp.fromRoots({ inputRoots: [baseRoot, overlayRoot] })).rejects.toThrow(
      join(baseRoot, RULESYNC_MCP_FILE_NAME),
    );
  });

  it("should attribute JSONC syntax errors to the overlay file", async () => {
    const baseRoot = join(testDir, RULESYNC_RELATIVE_DIR_PATH);
    const overlayRoot = join(testDir, ".rulesync.local");
    await writeFileContent(
      join(baseRoot, RULESYNC_MCP_FILE_NAME),
      JSON.stringify({ mcpServers: { base: { command: "base" } } }),
    );
    await writeFileContent(join(overlayRoot, RULESYNC_MCP_FILE_NAME), "{ invalid");

    await expect(RulesyncMcp.fromRoots({ inputRoots: [baseRoot, overlayRoot] })).rejects.toThrow(
      join(overlayRoot, RULESYNC_MCP_FILE_NAME),
    );
  });

  it("should report a prototype-member server the merge parse dropped from an overlay", async () => {
    // The merge path re-serializes from the parsed records, so without its own
    // report the dropped server would vanish and the merged file would look
    // like the user never wrote it.
    const baseRoot = join(testDir, RULESYNC_RELATIVE_DIR_PATH);
    const overlayRoot = join(testDir, ".rulesync.local");
    await writeFileContent(
      join(baseRoot, RULESYNC_MCP_FILE_NAME),
      JSON.stringify({ mcpServers: { base: { command: "base" } } }),
    );
    await writeFileContent(
      join(overlayRoot, RULESYNC_MCP_FILE_NAME),
      '{"mcpServers": {"__proto__": {"command": "node"}}}',
    );

    await expect(RulesyncMcp.fromRoots({ inputRoots: [baseRoot, overlayRoot] })).rejects.toThrow(
      "mcpServers.__proto__",
    );
  });

  it("should reject an overlay MCP file whose JSON is not an object", async () => {
    const baseRoot = join(testDir, RULESYNC_RELATIVE_DIR_PATH);
    const overlayRoot = join(testDir, ".rulesync.local");
    await writeFileContent(
      join(baseRoot, RULESYNC_MCP_FILE_NAME),
      JSON.stringify({ mcpServers: { base: { command: "base" } } }),
    );
    await writeFileContent(join(overlayRoot, RULESYNC_MCP_FILE_NAME), JSON.stringify([]));

    await expect(RulesyncMcp.fromRoots({ inputRoots: [baseRoot, overlayRoot] })).rejects.toThrow(
      `Invalid MCP source file '${join(overlayRoot, RULESYNC_MCP_FILE_NAME)}': Error: Expected a JSON object.`,
    );
  });
});

describe("mergeMcpJsonOverlays", () => {
  it("merges the top-level mcpServers map by server name (later wins per key)", () => {
    const base = {
      mcpServers: {
        alpha: { command: "alpha-v1", args: ["--old"] },
        beta: { command: "beta-v1" },
      },
    };
    const overlay = {
      mcpServers: {
        alpha: { command: "alpha-v2", args: ["--new"] },
        gamma: { command: "gamma-v1" },
      },
    };

    expect(mergeMcpJsonOverlays({ base, overlay })).toEqual({
      mcpServers: {
        // `alpha` is replaced atomically — the overlay's args map replaces
        // the base's args map, no key-level union.
        alpha: { command: "alpha-v2", args: ["--new"] },
        beta: { command: "beta-v1" },
        gamma: { command: "gamma-v1" },
      },
    });
  });

  it("does not interpret top-level null mcpServers entries as deletions", () => {
    const base = {
      mcpServers: {
        alpha: { command: "alpha" },
        beta: { command: "beta" },
      },
    };
    const overlay = { mcpServers: { alpha: null } };

    expect(mergeMcpJsonOverlays({ base, overlay })).toEqual({
      mcpServers: {
        alpha: null,
        beta: { command: "beta" },
      },
    });
  });

  it("merges tool-scoped mcpServers maps in exactly the same way", () => {
    const base = { claudecode: { mcpServers: { shared: { command: "shared" } } } };
    const overlay = {
      claudecode: {
        mcpServers: {
          shared: null,
          local: { command: "local-only" },
        },
      },
    };

    expect(mergeMcpJsonOverlays({ base, overlay })).toEqual({
      claudecode: {
        mcpServers: {
          shared: null,
          local: { command: "local-only" },
        },
      },
    });
  });

  it("replaces non-server keys atomically", () => {
    const base = { $schema: "https://example.com/base.json", other: { keep: true } };
    const overlay = { $schema: "https://example.com/overlay.json", other: { keep: false } };

    expect(mergeMcpJsonOverlays({ base, overlay })).toEqual({
      $schema: "https://example.com/overlay.json",
      other: { keep: false },
    });
  });

  it("drops prototype-pollution keys silently", () => {
    const overlay = JSON.parse('{"__proto__": {"polluted": true}}');
    expect(mergeMcpJsonOverlays({ base: { mcpServers: {} }, overlay })).toEqual({
      mcpServers: {},
    });
  });

  it("drops prototype-pollution keys inside a tool-scoped block and its mcpServers", () => {
    const overlay = JSON.parse(
      '{"cursor": {"__proto__": {"polluted": true}, "mcpServers": {"__proto__": {"polluted": true}, "alpha": {"command": "alpha"}}}}',
    );

    const merged = mergeMcpJsonOverlays({ base: { cursor: { mcpServers: {} } }, overlay });

    expect(merged).toEqual({ cursor: { mcpServers: { alpha: { command: "alpha" } } } });
    expect(Object.keys(merged.cursor as Record<string, unknown>)).toEqual(["mcpServers"]);
    expect(
      Object.keys((merged.cursor as Record<string, unknown>).mcpServers as Record<string, unknown>),
    ).toEqual(["alpha"]);
  });

  it("rejects non-object mcpServers overlays instead of treating them as empty", () => {
    expect(() =>
      mergeMcpJsonOverlays({ base: { mcpServers: {} }, overlay: { mcpServers: [] } }),
    ).toThrow(/mcpServers/);
  });

  it("rejects non-object tool-scoped blocks instead of treating them as empty", () => {
    expect(() => mergeMcpJsonOverlays({ base: {}, overlay: { cursor: null } })).toThrow(/cursor/);
  });
});
