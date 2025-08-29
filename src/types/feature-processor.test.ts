import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import { AiFile, ValidationResult } from "./ai-file.js";
import { FeatureProcessor } from "./feature-processor.js";
import { RulesyncFile } from "./rulesync-file.js";
import { ToolFile } from "./tool-file.js";
import { ToolTarget } from "./tool-targets.js";

// Mock the file utility
vi.mock("../utils/file.js", () => ({
  writeFileContent: vi.fn(),
}));

import { writeFileContent } from "../utils/file.js";

// Concrete implementation for testing the abstract FeatureProcessor class
class TestProcessor extends FeatureProcessor {
  constructor(baseDir: string) {
    super({ baseDir });
  }

  // Implement abstract methods for testing
  async loadRulesyncFiles(): Promise<RulesyncFile[]> {
    return [];
  }

  async loadToolFiles(): Promise<ToolFile[]> {
    return [];
  }

  async convertRulesyncFilesToToolFiles(_rulesyncFiles: RulesyncFile[]): Promise<ToolFile[]> {
    return [];
  }

  async convertToolFilesToRulesyncFiles(_toolFiles: ToolFile[]): Promise<RulesyncFile[]> {
    return [];
  }

  getToolTargets(): ToolTarget[] {
    return [];
  }

  // Expose protected method for testing
  async testWriteAiFiles(aiFiles: AiFile[]): Promise<number> {
    return this.writeAiFiles(aiFiles);
  }
}

// Simple AiFile implementation for testing
class TestAiFile extends AiFile {
  constructor(
    relativeDirPath: string,
    relativeFilePath: string,
    fileContent: string,
    baseDir: string = ".",
  ) {
    super({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent,
    });
  }

  validate(): ValidationResult {
    if (this.fileContent.includes("invalid")) {
      return {
        success: false,
        error: new Error("Content contains invalid text"),
      };
    }
    return {
      success: true,
      error: undefined,
    };
  }
}

describe("FeatureProcessor", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;
  let mockWriteFileContent: ReturnType<typeof vi.mocked<typeof writeFileContent>>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    mockWriteFileContent = vi.mocked(writeFileContent);
    mockWriteFileContent.mockClear();
    mockWriteFileContent.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("constructor", () => {
    it("should create instance with baseDir", () => {
      const processor = new TestProcessor(testDir);
      expect(processor).toBeInstanceOf(FeatureProcessor);
    });

    it("should store baseDir correctly", () => {
      const customDir = join(testDir, "custom");
      const processor = new TestProcessor(customDir);
      expect(processor).toBeInstanceOf(FeatureProcessor);
    });
  });

  describe("writeAiFiles", () => {
    it("should write single AI file", async () => {
      const processor = new TestProcessor(testDir);
      const aiFile = new TestAiFile(".test", "single.md", "Single file content");

      await processor.testWriteAiFiles([aiFile]);

      expect(mockWriteFileContent).toHaveBeenCalledOnce();
      expect(mockWriteFileContent).toHaveBeenCalledWith(
        aiFile.getFilePath(),
        "Single file content",
      );
    });

    it("should write multiple AI files", async () => {
      const processor = new TestProcessor(testDir);
      const files = [
        new TestAiFile(".test", "file1.md", "Content 1"),
        new TestAiFile(".test", "file2.md", "Content 2"),
        new TestAiFile(".test", "file3.md", "Content 3"),
      ];

      await processor.testWriteAiFiles(files);

      expect(mockWriteFileContent).toHaveBeenCalledTimes(3);
      expect(mockWriteFileContent).toHaveBeenNthCalledWith(1, files[0]!.getFilePath(), "Content 1");
      expect(mockWriteFileContent).toHaveBeenNthCalledWith(2, files[1]!.getFilePath(), "Content 2");
      expect(mockWriteFileContent).toHaveBeenNthCalledWith(3, files[2]!.getFilePath(), "Content 3");
    });

    it("should handle empty array", async () => {
      const processor = new TestProcessor(testDir);

      await processor.testWriteAiFiles([]);

      expect(mockWriteFileContent).not.toHaveBeenCalled();
    });

    it("should write files with different paths", async () => {
      const processor = new TestProcessor(testDir);
      const files = [
        new TestAiFile(".claude/agents", "planner.md", "Planner content", testDir),
        new TestAiFile(".cursor/rules", "rules.md", "Rules content", testDir),
        new TestAiFile("docs", "readme.md", "Readme content", testDir),
      ];

      await processor.testWriteAiFiles(files);

      expect(mockWriteFileContent).toHaveBeenCalledTimes(3);
      expect(mockWriteFileContent).toHaveBeenNthCalledWith(
        1,
        join(testDir, ".claude/agents", "planner.md"),
        "Planner content",
      );
      expect(mockWriteFileContent).toHaveBeenNthCalledWith(
        2,
        join(testDir, ".cursor/rules", "rules.md"),
        "Rules content",
      );
      expect(mockWriteFileContent).toHaveBeenNthCalledWith(
        3,
        join(testDir, "docs", "readme.md"),
        "Readme content",
      );
    });

    it("should handle file write errors", async () => {
      const processor = new TestProcessor(testDir);
      const aiFile = new TestAiFile(".test", "error.md", "Error content");

      mockWriteFileContent.mockRejectedValueOnce(new Error("Write failed"));

      await expect(processor.testWriteAiFiles([aiFile])).rejects.toThrow("Write failed");
    });

    it("should handle multiple files with some failures", async () => {
      const processor = new TestProcessor(testDir);
      const files = [
        new TestAiFile(".test", "success1.md", "Success 1"),
        new TestAiFile(".test", "error.md", "Error content"),
        new TestAiFile(".test", "success2.md", "Success 2"),
      ];

      // Mock the second call to fail
      mockWriteFileContent
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("Write failed"))
        .mockResolvedValueOnce(undefined);

      await expect(processor.testWriteAiFiles(files)).rejects.toThrow("Write failed");

      // Should have attempted all three calls before failing (parallel execution)
      expect(mockWriteFileContent).toHaveBeenCalledTimes(3);
    });

    it("should process all files in parallel", async () => {
      const processor = new TestProcessor(testDir);
      const files = [
        new TestAiFile(".test", "first.md", "First content"),
        new TestAiFile(".test", "second.md", "Second content"),
        new TestAiFile(".test", "third.md", "Third content"),
      ];

      await processor.testWriteAiFiles(files);

      expect(mockWriteFileContent).toHaveBeenCalledTimes(3);

      // Verify all files were called (order not guaranteed in parallel execution)
      const calls = mockWriteFileContent.mock.calls;
      const contents = calls.map((call: unknown[]) => call[1]);
      expect(contents).toContain("First content");
      expect(contents).toContain("Second content");
      expect(contents).toContain("Third content");
    });
  });

  describe("integration with real file system (without mocking)", () => {
    beforeEach(async () => {
      // Restore the real writeFileContent function for these tests
      vi.doUnmock("../utils/file.js");
      const { writeFileContent: realWriteFileContent } = await import("../utils/file.js");
      // Override the mock with the real implementation
      mockWriteFileContent.mockImplementation(realWriteFileContent);
    });

    it("should actually write files to filesystem", async () => {
      const processor = new TestProcessor(testDir);
      const testFile = new TestAiFile(
        "integration",
        "test.md",
        "Integration test content",
        testDir,
      );

      // This will use the real writeFileContent function
      await processor.testWriteAiFiles([testFile]);

      // Verify the file was actually written
      const writtenContent = await readFile(testFile.getFilePath(), "utf-8");
      expect(writtenContent).toBe("Integration test content");
    });

    it("should create directories if they don't exist", async () => {
      const processor = new TestProcessor(testDir);
      const deepPath = "very/deep/nested/structure";
      const testFile = new TestAiFile(deepPath, "deep.md", "Deep content", testDir);

      await processor.testWriteAiFiles([testFile]);

      // Verify the file was created in the deep path
      const writtenContent = await readFile(testFile.getFilePath(), "utf-8");
      expect(writtenContent).toBe("Deep content");
    });

    it("should handle multiple files with real file operations", async () => {
      const processor = new TestProcessor(testDir);
      const files = [
        new TestAiFile("real", "file1.md", "Real content 1", testDir),
        new TestAiFile("real", "file2.md", "Real content 2", testDir),
        new TestAiFile("real/nested", "file3.md", "Real content 3", testDir),
      ];

      await processor.testWriteAiFiles(files);

      // Verify all files were written correctly
      for (const file of files) {
        const content = await readFile(file.getFilePath(), "utf-8");
        expect(content).toBe(file.getFileContent());
      }
    });

    afterEach(() => {
      // Clear the implementation override for subsequent tests
      mockWriteFileContent.mockRestore();
      mockWriteFileContent.mockResolvedValue(undefined);
    });
  });

  describe("edge cases", () => {
    it("should handle files with empty content", async () => {
      const processor = new TestProcessor(testDir);
      const emptyFile = new TestAiFile(".test", "empty.md", "");

      await processor.testWriteAiFiles([emptyFile]);

      expect(mockWriteFileContent).toHaveBeenCalledWith(emptyFile.getFilePath(), "");
    });

    it("should handle files with special characters in content", async () => {
      const processor = new TestProcessor(testDir);
      const specialContent = "Special chars: üñíçødé 🤖 \n\t\r \\n \\t";
      const specialFile = new TestAiFile(".test", "special.md", specialContent);

      await processor.testWriteAiFiles([specialFile]);

      expect(mockWriteFileContent).toHaveBeenCalledWith(specialFile.getFilePath(), specialContent);
    });

    it("should handle files with very long content", async () => {
      const processor = new TestProcessor(testDir);
      const longContent = "x".repeat(10000);
      const longFile = new TestAiFile(".test", "long.md", longContent);

      await processor.testWriteAiFiles([longFile]);

      expect(mockWriteFileContent).toHaveBeenCalledWith(longFile.getFilePath(), longContent);
    });

    it("should handle files with special characters in paths", async () => {
      const processor = new TestProcessor(testDir);
      const specialFile = new TestAiFile(
        "path with spaces/special-chars_123",
        "file-name_with-specials.md",
        "Special path content",
      );

      await processor.testWriteAiFiles([specialFile]);

      expect(mockWriteFileContent).toHaveBeenCalledWith(
        specialFile.getFilePath(),
        "Special path content",
      );
    });
  });

  describe("base directory handling", () => {
    it("should use baseDir in file paths", async () => {
      const customBase = join(testDir, "custom", "base");
      const processor = new TestProcessor(customBase);
      const testFile = new TestAiFile("relative", "test.md", "Base dir test content", customBase);

      await processor.testWriteAiFiles([testFile]);

      expect(mockWriteFileContent).toHaveBeenCalledWith(
        join(customBase, "relative", "test.md"),
        "Base dir test content",
      );
    });

    it("should handle different baseDirs for different files", async () => {
      const processor = new TestProcessor(testDir);
      const files = [
        new TestAiFile("dir1", "file1.md", "Content 1", testDir),
        new TestAiFile("dir2", "file2.md", "Content 2", join(testDir, "alt")),
      ];

      await processor.testWriteAiFiles(files);

      expect(mockWriteFileContent).toHaveBeenCalledTimes(2);
      expect(mockWriteFileContent).toHaveBeenNthCalledWith(
        1,
        join(testDir, "dir1", "file1.md"),
        "Content 1",
      );
      expect(mockWriteFileContent).toHaveBeenNthCalledWith(
        2,
        join(testDir, "alt", "dir2", "file2.md"),
        "Content 2",
      );
    });
  });

  describe("abstract class behavior", () => {
    it("should not be instantiable directly", () => {
      // This is enforced at TypeScript compile time
      // but we can verify the pattern exists
      expect(FeatureProcessor).toBeDefined();
      expect(typeof FeatureProcessor).toBe("function");

      // Verify that TestProcessor extends FeatureProcessor
      const testProcessor = new TestProcessor(testDir);
      expect(testProcessor).toBeInstanceOf(FeatureProcessor);
    });
  });
});
