import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import { AiFileFromFilePathParams, AiFileParams } from "../types/ai-file.js";
import { ToolMcp } from "./tool-mcp.js";

// Mock concrete implementation of ToolMcp for testing
class MockToolMcp extends ToolMcp {
  private readonly fileName: string;
  private readonly configContent: Record<string, unknown>;

  constructor(
    params: AiFileParams & {
      fileName: string;
      configContent: Record<string, unknown>;
    },
  ) {
    const { fileName, configContent, ...aiFileParams } = params;
    super(aiFileParams);
    this.fileName = fileName;
    this.configContent = configContent;
  }

  getFileName(): string {
    return this.fileName;
  }

  async generateContent(): Promise<string> {
    return this.serializeToJson(this.configContent);
  }

  static async fromFilePath(params: AiFileFromFilePathParams): Promise<MockToolMcp> {
    const config = await ToolMcp.loadJsonConfig(params.filePath);

    return new MockToolMcp({
      baseDir: params.baseDir ?? ".",
      relativeDirPath: params.relativeDirPath,
      relativeFilePath: params.relativeFilePath,
      fileContent: JSON.stringify(config),
      fileName: "mock.json",
      configContent: config,
      validate: params.validate ?? true,
    });
  }
}

// Mock implementation with directory-based filename
class MockDirectoryToolMcp extends MockToolMcp {
  getFileName(): string {
    return ".mock/config.json";
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
    it("should create instance with valid parameters", () => {
      const mockConfig = { servers: { test: { command: "echo" } } };

      const toolMcp = new MockToolMcp({
        baseDir: testDir,
        relativeDirPath: ".mcp",
        relativeFilePath: "config.json",
        fileContent: JSON.stringify(mockConfig),
        fileName: "config.json",
        configContent: mockConfig,
      });

      expect(toolMcp).toBeInstanceOf(ToolMcp);
      expect(toolMcp.getRelativeDirPath()).toBe(".mcp");
      expect(toolMcp.getRelativeFilePath()).toBe("config.json");
    });

    it("should throw error when validation fails", () => {
      expect(() => {
         
        new MockToolMcp({
          baseDir: testDir,
          relativeDirPath: "", // Invalid: empty directory path
          relativeFilePath: "config.json",
          fileContent: "{}",
          fileName: "config.json",
          configContent: {},
        });
      }).toThrow("relativeDirPath is required for ToolMcp");
    });

    it("should skip validation when validate is false", () => {
      const toolMcp = new MockToolMcp({
        baseDir: testDir,
        relativeDirPath: "", // Would normally be invalid
        relativeFilePath: "config.json",
        fileContent: "{}",
        fileName: "config.json",
        configContent: {},
        validate: false,
      });

      expect(toolMcp).toBeInstanceOf(ToolMcp);
    });
  });

  describe("static fromFilePath", () => {
    it("should throw error when not implemented in base class", async () => {
      await expect(
        ToolMcp.fromFilePath({
          filePath: "/path/to/file.json",
          baseDir: testDir,
          relativeDirPath: ".mcp",
          relativeFilePath: "config.json",
        }),
      ).rejects.toThrow("Please implement this method in the subclass.");
    });

    it("should work when implemented in concrete subclass", async () => {
      const configDir = join(testDir, ".mcp");
      await mkdir(configDir, { recursive: true });

      const configFile = join(configDir, "config.json");
      const testConfig = { mcpServers: { test: { command: "echo" } } };
      await writeFile(configFile, JSON.stringify(testConfig, null, 2));

      const toolMcp = await MockToolMcp.fromFilePath({
        filePath: configFile,
        baseDir: testDir,
        relativeDirPath: ".mcp",
        relativeFilePath: "config.json",
      });

      expect(toolMcp).toBeInstanceOf(MockToolMcp);
      expect(toolMcp.getFileContent()).toContain("mcpServers");
    });
  });

  describe("abstract methods", () => {
    it("getFileName should be implemented by concrete class", () => {
      const toolMcp = new MockToolMcp({
        baseDir: testDir,
        relativeDirPath: ".mcp",
        relativeFilePath: "config.json",
        fileContent: "{}",
        fileName: "test.json",
        configContent: {},
      });

      expect(toolMcp.getFileName()).toBe("test.json");
    });

    it("generateContent should be implemented by concrete class", async () => {
      const testConfig = { test: "value" };
      const toolMcp = new MockToolMcp({
        baseDir: testDir,
        relativeDirPath: ".mcp",
        relativeFilePath: "config.json",
        fileContent: "{}",
        fileName: "test.json",
        configContent: testConfig,
      });

      const content = await toolMcp.generateContent();
      expect(content).toBe(JSON.stringify(testConfig, null, 2));
    });
  });

  describe("validate", () => {
    it("should return success for valid configuration", () => {
      const toolMcp = new MockToolMcp({
        baseDir: testDir,
        relativeDirPath: ".mcp",
        relativeFilePath: "config.json",
        fileContent: "{}",
        fileName: "test.json",
        configContent: {},
        validate: false, // Skip validation during construction
      });

      const result = toolMcp.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return failure when relativeDirPath is missing", () => {
      const toolMcp = new MockToolMcp({
        baseDir: testDir,
        relativeDirPath: "",
        relativeFilePath: "config.json",
        fileContent: "{}",
        fileName: "test.json",
        configContent: {},
        validate: false, // Skip validation during construction
      });

      const result = toolMcp.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("relativeDirPath is required");
    });

    it("should return failure when relativeFilePath is missing", () => {
      const toolMcp = new MockToolMcp({
        baseDir: testDir,
        relativeDirPath: ".mcp",
        relativeFilePath: "",
        fileContent: "{}",
        fileName: "test.json",
        configContent: {},
        validate: false, // Skip validation during construction
      });

      const result = toolMcp.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("relativeFilePath is required");
    });
  });

  describe("loadJsonConfig", () => {
    it("should load and parse valid JSON file", async () => {
      const configFile = join(testDir, "config.json");
      const testConfig = { test: "value", nested: { key: 123 } };
      await writeFile(configFile, JSON.stringify(testConfig));

      const config = await ToolMcp.loadJsonConfig(configFile);
      expect(config).toEqual(testConfig);
    });

    it("should throw error for invalid JSON", async () => {
      const configFile = join(testDir, "invalid.json");
      await writeFile(configFile, "{ invalid json }");

      await expect(ToolMcp.loadJsonConfig(configFile)).rejects.toThrow(
        "Failed to load JSON configuration",
      );
    });

    it("should throw error for non-existent file", async () => {
      const configFile = join(testDir, "nonexistent.json");

      await expect(ToolMcp.loadJsonConfig(configFile)).rejects.toThrow(
        "Failed to load JSON configuration",
      );
    });
  });

  describe("serializeToJson", () => {
    it("should serialize object to JSON with default indentation", () => {
      const toolMcp = new MockToolMcp({
        baseDir: testDir,
        relativeDirPath: ".mcp",
        relativeFilePath: "config.json",
        fileContent: "{}",
        fileName: "test.json",
        configContent: {},
      });

      const testObj = { key: "value", nested: { num: 42 } };
      const result = toolMcp.serializeToJson(testObj);

      expect(result).toBe(JSON.stringify(testObj, null, 2));
      expect(result).toContain('  "key": "value"'); // Check indentation
    });

    it("should serialize object with custom indentation", () => {
      const toolMcp = new MockToolMcp({
        baseDir: testDir,
        relativeDirPath: ".mcp",
        relativeFilePath: "config.json",
        fileContent: "{}",
        fileName: "test.json",
        configContent: {},
      });

      const testObj = { key: "value" };
      const result = toolMcp.serializeToJson(testObj, 4);

      expect(result).toBe(JSON.stringify(testObj, null, 4));
      expect(result).toContain('    "key": "value"'); // Check custom indentation
    });
  });

  describe("getTargetFilePath", () => {
    it("should return standard file path for simple filename", () => {
      const toolMcp = new MockToolMcp({
        baseDir: testDir,
        relativeDirPath: ".mcp",
        relativeFilePath: "config.json",
        fileContent: "{}",
        fileName: "config.json",
        configContent: {},
      });

      const targetPath = toolMcp.getTargetFilePath();
      expect(targetPath).toBe(join(testDir, ".mcp", "config.json"));
    });

    it("should return directory-based path for filename with path separators", () => {
      const toolMcp = new MockDirectoryToolMcp({
        baseDir: testDir,
        relativeDirPath: ".mcp",
        relativeFilePath: "config.json",
        fileContent: "{}",
        fileName: ".mock/config.json",
        configContent: {},
      });

      const targetPath = toolMcp.getTargetFilePath();
      expect(targetPath).toBe(".mock/config.json");
    });

    it("should handle Windows-style path separators", () => {
      const toolMcp = new MockToolMcp({
        baseDir: testDir,
        relativeDirPath: ".mcp",
        relativeFilePath: "config.json",
        fileContent: "{}",
        fileName: "dir\\config.json",
        configContent: {},
      });

      const targetPath = toolMcp.getTargetFilePath();
      expect(targetPath).toBe("dir\\config.json");
    });
  });

  describe("inheritance", () => {
    it("should extend AiFile correctly", () => {
      const toolMcp = new MockToolMcp({
        baseDir: testDir,
        relativeDirPath: ".mcp",
        relativeFilePath: "config.json",
        fileContent: "{}",
        fileName: "test.json",
        configContent: {},
      });

      // Test inherited methods from AiFile
      expect(toolMcp.getRelativeDirPath()).toBe(".mcp");
      expect(toolMcp.getRelativeFilePath()).toBe("config.json");
      expect(toolMcp.getFilePath()).toBe(join(testDir, ".mcp", "config.json"));
      expect(toolMcp.getFileContent()).toBe("{}");
    });

    it("should provide proper inheritance from AiFile", () => {
      const toolMcp = new MockToolMcp({
        baseDir: testDir,
        relativeDirPath: ".mcp",
        relativeFilePath: "config.json",
        fileContent: "{}",
        fileName: "test.json",
        configContent: {},
      });

      // Should have all AiFile methods available
      expect(typeof toolMcp.validate).toBe("function");
      expect(typeof toolMcp.getRelativeDirPath).toBe("function");
      expect(typeof toolMcp.getRelativeFilePath).toBe("function");
      expect(typeof toolMcp.getFilePath).toBe("function");
      expect(typeof toolMcp.getFileContent).toBe("function");

      // Should have ToolMcp-specific methods
      expect(typeof toolMcp.getFileName).toBe("function");
      expect(typeof toolMcp.generateContent).toBe("function");
      expect(typeof toolMcp.getTargetFilePath).toBe("function");
      expect(typeof toolMcp.serializeToJson).toBe("function");
    });
  });
});
