import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { type ValidationResult } from "../../types/ai-file.js";
import { ModularMcp, type ModularMcpParams } from "./modular-mcp.js";

describe("ModularMcp", () => {
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
    it("should create instance with valid JSON content", () => {
      const validJsonContent = JSON.stringify({
        groups: {
          fetch: {
            servers: ["fetch"],
          },
        },
      });

      const modularMcp = new ModularMcp({
        relativeDirPath: ".",
        relativeFilePath: "modular-mcp.json",
        fileContent: validJsonContent,
      });

      expect(modularMcp).toBeInstanceOf(ModularMcp);
      expect(modularMcp.getRelativeDirPath()).toBe(".");
      expect(modularMcp.getRelativeFilePath()).toBe("modular-mcp.json");
      expect(modularMcp.getFileContent()).toBe(validJsonContent);
    });

    it("should create instance with custom baseDir", () => {
      const validJsonContent = JSON.stringify({
        groups: {},
      });

      const customBaseDir = join(testDir, "custom", "path");
      const modularMcp = new ModularMcp({
        baseDir: customBaseDir,
        relativeDirPath: ".",
        relativeFilePath: "modular-mcp.json",
        fileContent: validJsonContent,
      });

      expect(modularMcp.getFilePath()).toBe(join(customBaseDir, "modular-mcp.json"));
      expect(modularMcp.getBaseDir()).toBe(customBaseDir);
    });

    it("should parse JSON content correctly", () => {
      const jsonData = {
        groups: {
          fetch: {
            servers: ["fetch"],
          },
          serena: {
            servers: ["serena"],
          },
        },
      };
      const validJsonContent = JSON.stringify(jsonData);

      const modularMcp = new ModularMcp({
        relativeDirPath: ".",
        relativeFilePath: "modular-mcp.json",
        fileContent: validJsonContent,
      });

      expect(modularMcp.getJson()).toEqual(jsonData);
    });

    it("should handle empty JSON object", () => {
      const emptyJsonContent = JSON.stringify({});

      const modularMcp = new ModularMcp({
        relativeDirPath: ".",
        relativeFilePath: "modular-mcp.json",
        fileContent: emptyJsonContent,
      });

      expect(modularMcp.getJson()).toEqual({});
    });

    it("should handle empty fileContent", () => {
      const modularMcp = new ModularMcp({
        relativeDirPath: ".",
        relativeFilePath: "modular-mcp.json",
        fileContent: "",
      });

      expect(modularMcp.getJson()).toEqual({});
    });

    it("should throw error for invalid JSON content", () => {
      const invalidJsonContent = "{ invalid json }";

      expect(() => {
        const _instance = new ModularMcp({
          relativeDirPath: ".",
          relativeFilePath: "modular-mcp.json",
          fileContent: invalidJsonContent,
        });
      }).toThrow(SyntaxError);
    });

    it("should throw error for malformed JSON", () => {
      const malformedJsonContent = '{"key": "value",}'; // trailing comma

      expect(() => {
        const _instance = new ModularMcp({
          relativeDirPath: ".",
          relativeFilePath: "modular-mcp.json",
          fileContent: malformedJsonContent,
        });
      }).toThrow(SyntaxError);
    });

    it("should handle complex nested JSON structure", () => {
      const complexJsonData = {
        groups: {
          fetch: {
            servers: ["fetch"],
            description: "Fetch group",
          },
          serena: {
            servers: ["serena", "serena-extra"],
            description: "Serena group",
          },
        },
        metadata: {
          version: "1.0.0",
          author: "test",
        },
      };
      const jsonContent = JSON.stringify(complexJsonData);

      const modularMcp = new ModularMcp({
        relativeDirPath: ".",
        relativeFilePath: "modular-mcp.json",
        fileContent: jsonContent,
      });

      expect(modularMcp.getJson()).toEqual(complexJsonData);
    });
  });

  describe("getJson", () => {
    it("should return parsed JSON object", () => {
      const jsonData = {
        groups: {
          fetch: {
            servers: ["fetch"],
          },
        },
      };
      const modularMcp = new ModularMcp({
        relativeDirPath: ".",
        relativeFilePath: "modular-mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const result = modularMcp.getJson();

      expect(result).toEqual(jsonData);
    });

    it("should return empty object for empty JSON", () => {
      const modularMcp = new ModularMcp({
        relativeDirPath: ".",
        relativeFilePath: "modular-mcp.json",
        fileContent: JSON.stringify({}),
      });

      const result = modularMcp.getJson();

      expect(result).toEqual({});
    });

    it("should return same reference on multiple calls", () => {
      const jsonData = {
        groups: {
          fetch: {
            servers: ["fetch"],
          },
        },
      };
      const modularMcp = new ModularMcp({
        relativeDirPath: ".",
        relativeFilePath: "modular-mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const result1 = modularMcp.getJson();
      const result2 = modularMcp.getJson();

      expect(result1).toBe(result2);
      expect(result1).toEqual(jsonData);
    });
  });

  describe("getSettablePaths", () => {
    it("should return correct paths for non-global mode", () => {
      const paths = ModularMcp.getSettablePaths();

      expect(paths.relativeDirPath).toBe(".");
      expect(paths.relativeFilePath).toBe("modular-mcp.json");
    });

    it("should return correct paths for global mode with claudecode", () => {
      const paths = ModularMcp.getSettablePaths({ global: true, relativeDirPath: ".claude" });

      expect(paths.relativeDirPath).toBe(".claude");
      expect(paths.relativeFilePath).toBe("modular-mcp.json");
    });

    it("should return correct paths for global mode with codexcli", () => {
      const paths = ModularMcp.getSettablePaths({ global: true, relativeDirPath: ".codex" });

      expect(paths.relativeDirPath).toBe(".codex");
      expect(paths.relativeFilePath).toBe("modular-mcp.json");
    });

    it("should return consistent paths", () => {
      const paths1 = ModularMcp.getSettablePaths();
      const paths2 = ModularMcp.getSettablePaths();

      expect(paths1).toEqual(paths2);
    });
  });

  describe("getMcpServers", () => {
    it("should return modular-mcp proxy server configuration for non-global mode", () => {
      const mcpServers = ModularMcp.getMcpServers();

      expect(mcpServers).toHaveProperty("modular-mcp");
      expect(mcpServers["modular-mcp"]).toEqual({
        type: "stdio",
        command: "npx",
        args: ["-y", "@kimuson/modular-mcp", "modular-mcp.json"],
        env: {},
      });
    });

    it("should return modular-mcp proxy server configuration for global mode with claudecode", () => {
      const mcpServers = ModularMcp.getMcpServers({
        baseDir: testDir,
        global: true,
        relativeDirPath: ".claude",
      });

      expect(mcpServers).toHaveProperty("modular-mcp");
      expect(mcpServers["modular-mcp"]).toEqual({
        type: "stdio",
        command: "npx",
        args: ["-y", "@kimuson/modular-mcp", join(testDir, ".claude", "modular-mcp.json")],
        env: {},
      });
    });

    it("should return modular-mcp proxy server configuration for global mode with codexcli", () => {
      const mcpServers = ModularMcp.getMcpServers({
        baseDir: testDir,
        global: true,
        relativeDirPath: ".codex",
      });

      expect(mcpServers).toHaveProperty("modular-mcp");
      expect(mcpServers["modular-mcp"]).toEqual({
        type: "stdio",
        command: "npx",
        args: ["-y", "@kimuson/modular-mcp", join(testDir, ".codex", "modular-mcp.json")],
        env: {},
      });
    });

    it("should return consistent server configuration", () => {
      const servers1 = ModularMcp.getMcpServers();
      const servers2 = ModularMcp.getMcpServers();

      expect(servers1).toEqual(servers2);
    });
  });

  describe("validate", () => {
    it("should return successful validation result", () => {
      const modularMcp = new ModularMcp({
        relativeDirPath: ".",
        relativeFilePath: "modular-mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            "test-server": {
              command: "node",
              description: "Test server",
            },
          },
        }),
      });

      const result = modularMcp.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return validation error for invalid data", () => {
      const modularMcp = new ModularMcp({
        relativeDirPath: ".",
        relativeFilePath: "modular-mcp.json",
        fileContent: JSON.stringify({ invalid: "data" }),
      });

      const result = modularMcp.validate();

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should return success for empty content", () => {
      const modularMcp = new ModularMcp({
        relativeDirPath: ".",
        relativeFilePath: "modular-mcp.json",
        fileContent: JSON.stringify({}),
      });

      const result: ValidationResult = modularMcp.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });

  describe("type exports", () => {
    it("should export ModularMcpParams type", () => {
      const params: ModularMcpParams = {
        relativeDirPath: ".",
        relativeFilePath: "modular-mcp.json",
        fileContent: JSON.stringify({}),
      };

      expect(params).toBeDefined();
    });

    it("should have correct type definitions for parameters", () => {
      const customBaseDir = join(testDir, "custom");
      const constructorParams: ModularMcpParams = {
        baseDir: customBaseDir,
        relativeDirPath: ".",
        relativeFilePath: "modular-mcp.json",
        fileContent: "{}",
      };

      expect(constructorParams.baseDir).toBe(customBaseDir);
      expect(constructorParams.relativeDirPath).toBe(".");
      expect(constructorParams.relativeFilePath).toBe("modular-mcp.json");
      expect(constructorParams.fileContent).toBe("{}");
    });
  });

  describe("integration and edge cases", () => {
    it("should handle large JSON structures", () => {
      const largeJsonData = {
        groups: Array.from({ length: 100 }, (_, i) => [
          `group-${i}`,
          {
            servers: Array.from({ length: 10 }, (_, j) => `server-${i}-${j}`),
            description: `Group ${i} description`,
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
      };

      const modularMcp = new ModularMcp({
        relativeDirPath: ".",
        relativeFilePath: "modular-mcp.json",
        fileContent: JSON.stringify(largeJsonData),
      });

      expect(modularMcp.getJson()).toEqual(largeJsonData);
      expect(Object.keys((modularMcp.getJson() as any).groups)).toHaveLength(100);
    });

    it("should handle special characters and unicode in JSON", () => {
      const unicodeJsonData = {
        groups: {
          "unicode-group": {
            servers: ["unicode-server"],
            description: "Hello 世界 🌍 العالم мир",
          },
          "special-chars-group": {
            servers: ["special-server"],
            description: "!@#$%^&*()_+-=[]{}|;':\",./<>?",
          },
        },
      };

      const modularMcp = new ModularMcp({
        relativeDirPath: ".",
        relativeFilePath: "modular-mcp.json",
        fileContent: JSON.stringify(unicodeJsonData),
      });

      expect(modularMcp.getJson()).toEqual(unicodeJsonData);
    });

    it("should preserve exact JSON structure through round-trip", () => {
      const originalJsonData = {
        groups: {
          fetch: {
            servers: ["fetch"],
            description: "Fetch group",
          },
        },
        metadata: {
          version: "1.0.0",
          created: "2024-01-01T00:00:00.000Z",
        },
      };

      const modularMcp1 = new ModularMcp({
        relativeDirPath: ".",
        relativeFilePath: "modular-mcp.json",
        fileContent: JSON.stringify(originalJsonData),
      });

      // Create second instance from first instance's content
      const modularMcp2 = new ModularMcp({
        relativeDirPath: ".",
        relativeFilePath: "modular-mcp.json",
        fileContent: JSON.stringify(modularMcp1.getJson()),
      });

      expect(modularMcp2.getJson()).toEqual(originalJsonData);
      expect(modularMcp2.getJson()).toEqual(modularMcp1.getJson());
    });

    it("should handle deeply nested JSON structures", () => {
      const deeplyNestedData = {
        groups: {
          "nested-group": {
            servers: ["server"],
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

      const modularMcp = new ModularMcp({
        relativeDirPath: ".",
        relativeFilePath: "modular-mcp.json",
        fileContent: JSON.stringify(deeplyNestedData),
      });

      expect(modularMcp.getJson()).toEqual(deeplyNestedData);
    });
  });
});
