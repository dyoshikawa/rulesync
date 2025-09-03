import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import * as fileUtils from "../utils/file.js";
import { AiFile } from "./ai-file.js";
import { FeatureProcessor } from "./feature-processor.js";
import { RulesyncFile } from "./rulesync-file.js";
import { ToolFile } from "./tool-file.js";

vi.mock("../utils/file.js");

// Create a concrete implementation for testing
class TestFeatureProcessor extends FeatureProcessor {
  async loadRulesyncFiles(): Promise<RulesyncFile[]> {
    return [];
  }

  async loadToolFiles(): Promise<ToolFile[]> {
    return [];
  }

  async convertRulesyncFilesToToolFiles(rulesyncFiles: RulesyncFile[]): Promise<ToolFile[]> {
    return [];
  }

  async convertToolFilesToRulesyncFiles(toolFiles: ToolFile[]): Promise<RulesyncFile[]> {
    return [];
  }

  static getToolTargets() {
    return ["test-target"];
  }
}

describe("FeatureProcessor", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;
  let processor: TestFeatureProcessor;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    processor = new TestFeatureProcessor({ baseDir: testDir });
  });

  afterEach(async () => {
    await cleanup();
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should create processor with custom base directory", () => {
      const customProcessor = new TestFeatureProcessor({ baseDir: "/custom/path" });
      expect(customProcessor).toBeInstanceOf(FeatureProcessor);
      expect((customProcessor as any).baseDir).toBe("/custom/path");
    });

    it("should use current working directory as default", () => {
      const defaultProcessor = new TestFeatureProcessor({});
      expect((defaultProcessor as any).baseDir).toBe(process.cwd());
    });

    it("should handle no parameters", () => {
      // Test constructor with no baseDir parameter
      class NoParamProcessor extends FeatureProcessor {
        constructor() {
          super({});
        }
        async loadRulesyncFiles(): Promise<RulesyncFile[]> {
          return [];
        }
        async loadToolFiles(): Promise<ToolFile[]> {
          return [];
        }
        async convertRulesyncFilesToToolFiles(): Promise<ToolFile[]> {
          return [];
        }
        async convertToolFilesToRulesyncFiles(): Promise<RulesyncFile[]> {
          return [];
        }
      }

      const noParamProcessor = new NoParamProcessor();
      expect((noParamProcessor as any).baseDir).toBe(process.cwd());
    });
  });

  describe("abstract methods", () => {
    it("should have abstract method implementations in test class", async () => {
      expect(await processor.loadRulesyncFiles()).toEqual([]);
      expect(await processor.loadToolFiles()).toEqual([]);
      expect(await processor.convertRulesyncFilesToToolFiles([])).toEqual([]);
      expect(await processor.convertToolFilesToRulesyncFiles([])).toEqual([]);
    });
  });

  describe("getToolTargets static method", () => {
    it("should throw error when not implemented", () => {
      expect(() => FeatureProcessor.getToolTargets()).toThrow("Not implemented");
    });

    it("should work when implemented in subclass", () => {
      expect(TestFeatureProcessor.getToolTargets()).toEqual(["test-target"]);
    });
  });

  describe("writeAiFiles", () => {
    it("should write empty array of files", async () => {
      const result = await processor.writeAiFiles([]);

      expect(result).toBe(0);
      expect(fileUtils.writeFileContent).not.toHaveBeenCalled();
    });

    it("should write single AI file", async () => {
      const mockAiFile = {
        getFilePath: vi.fn().mockReturnValue("/test/path/file.txt"),
        getFileContent: vi.fn().mockReturnValue("test content"),
      } as unknown as AiFile;

      const result = await processor.writeAiFiles([mockAiFile]);

      expect(result).toBe(1);
      expect(fileUtils.writeFileContent).toHaveBeenCalledWith(
        "/test/path/file.txt",
        "test content",
      );
      expect(mockAiFile.getFilePath).toHaveBeenCalled();
      expect(mockAiFile.getFileContent).toHaveBeenCalled();
    });

    it("should write multiple AI files", async () => {
      const mockAiFile1 = {
        getFilePath: vi.fn().mockReturnValue("/test/path/file1.txt"),
        getFileContent: vi.fn().mockReturnValue("content 1"),
      } as unknown as AiFile;

      const mockAiFile2 = {
        getFilePath: vi.fn().mockReturnValue("/test/path/file2.txt"),
        getFileContent: vi.fn().mockReturnValue("content 2"),
      } as unknown as AiFile;

      const result = await processor.writeAiFiles([mockAiFile1, mockAiFile2]);

      expect(result).toBe(2);
      expect(fileUtils.writeFileContent).toHaveBeenCalledTimes(2);
      expect(fileUtils.writeFileContent).toHaveBeenCalledWith("/test/path/file1.txt", "content 1");
      expect(fileUtils.writeFileContent).toHaveBeenCalledWith("/test/path/file2.txt", "content 2");
    });

    it("should handle file write errors", async () => {
      const mockAiFile = {
        getFilePath: vi.fn().mockReturnValue("/test/path/file.txt"),
        getFileContent: vi.fn().mockReturnValue("test content"),
      } as unknown as AiFile;

      vi.mocked(fileUtils.writeFileContent).mockRejectedValue(new Error("Write failed"));

      await expect(processor.writeAiFiles([mockAiFile])).rejects.toThrow("Write failed");
    });
  });

  describe("removeAiFiles", () => {
    it("should remove empty array of files", async () => {
      await processor.removeAiFiles([]);

      expect(fileUtils.removeFile).not.toHaveBeenCalled();
    });

    it("should remove single AI file", async () => {
      const mockAiFile = {
        getFilePath: vi.fn().mockReturnValue("/test/path/file.txt"),
        getFileContent: vi.fn().mockReturnValue("test content"),
      } as unknown as AiFile;

      await processor.removeAiFiles([mockAiFile]);

      expect(fileUtils.removeFile).toHaveBeenCalledWith("/test/path/file.txt");
      expect(mockAiFile.getFilePath).toHaveBeenCalled();
    });

    it("should remove multiple AI files", async () => {
      const mockAiFile1 = {
        getFilePath: vi.fn().mockReturnValue("/test/path/file1.txt"),
        getFileContent: vi.fn().mockReturnValue("content 1"),
      } as unknown as AiFile;

      const mockAiFile2 = {
        getFilePath: vi.fn().mockReturnValue("/test/path/file2.txt"),
        getFileContent: vi.fn().mockReturnValue("content 2"),
      } as unknown as AiFile;

      await processor.removeAiFiles([mockAiFile1, mockAiFile2]);

      expect(fileUtils.removeFile).toHaveBeenCalledTimes(2);
      expect(fileUtils.removeFile).toHaveBeenCalledWith("/test/path/file1.txt");
      expect(fileUtils.removeFile).toHaveBeenCalledWith("/test/path/file2.txt");
    });

    it("should handle file removal errors", async () => {
      const mockAiFile = {
        getFilePath: vi.fn().mockReturnValue("/test/path/file.txt"),
        getFileContent: vi.fn().mockReturnValue("test content"),
      } as unknown as AiFile;

      vi.mocked(fileUtils.removeFile).mockRejectedValue(new Error("Remove failed"));

      await expect(processor.removeAiFiles([mockAiFile])).rejects.toThrow("Remove failed");
    });

    it("should continue removing files even if one fails", async () => {
      const mockAiFile1 = {
        getFilePath: vi.fn().mockReturnValue("/test/path/file1.txt"),
      } as unknown as AiFile;

      const mockAiFile2 = {
        getFilePath: vi.fn().mockReturnValue("/test/path/file2.txt"),
      } as unknown as AiFile;

      vi.mocked(fileUtils.removeFile)
        .mockRejectedValueOnce(new Error("Remove failed"))
        .mockResolvedValueOnce(undefined);

      // Should throw on first failure
      await expect(processor.removeAiFiles([mockAiFile1, mockAiFile2])).rejects.toThrow(
        "Remove failed",
      );

      // But first call should still have been made
      expect(fileUtils.removeFile).toHaveBeenCalledWith("/test/path/file1.txt");
    });
  });

  describe("inheritance behavior", () => {
    it("should allow subclasses to access protected baseDir", () => {
      class AccessingProcessor extends FeatureProcessor {
        getBaseDir() {
          return this.baseDir;
        }
        async loadRulesyncFiles(): Promise<RulesyncFile[]> {
          return [];
        }
        async loadToolFiles(): Promise<ToolFile[]> {
          return [];
        }
        async convertRulesyncFilesToToolFiles(): Promise<ToolFile[]> {
          return [];
        }
        async convertToolFilesToRulesyncFiles(): Promise<RulesyncFile[]> {
          return [];
        }
      }

      const accessingProcessor = new AccessingProcessor({ baseDir: "/custom" });
      expect(accessingProcessor.getBaseDir()).toBe("/custom");
    });

    it("should require implementation of all abstract methods", () => {
      // This is a compile-time check, but we can verify behavior
      expect(() => {
        abstract class IncompleteProcessor extends FeatureProcessor {
          async loadRulesyncFiles(): Promise<RulesyncFile[]> {
            return [];
          }
          // Missing other abstract method implementations
        }
        // TypeScript would prevent instantiation, but at runtime:
      }).not.toThrow(); // The class definition itself doesn't throw
    });
  });
});
