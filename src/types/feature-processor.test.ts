import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../test-utils/test-directories.js";
import { readFileContentOrNull, removeFile, writeFileContent } from "../utils/file.js";
import { AiFile } from "./ai-file.js";
import { FeatureProcessor } from "./feature-processor.js";
import { RulesyncFile } from "./rulesync-file.js";
import { ToolFile } from "./tool-file.js";

vi.mock("../utils/file.js", async () => {
  const actual = await vi.importActual<typeof import("../utils/file.js")>("../utils/file.js");
  return {
    ...actual,
    readFileContentOrNull: vi.fn().mockResolvedValue(null),
    removeFile: vi.fn(),
    writeFileContent: vi.fn(),
  };
});

function createMockFile(filePath: string): AiFile {
  return {
    getFilePath: () => filePath,
    getFileContent: () => "content",
    getRelativePathFromCwd: () => filePath,
  } as AiFile;
}

class TestProcessor extends FeatureProcessor {
  loadRulesyncFiles(): Promise<RulesyncFile[]> {
    return Promise.resolve([]);
  }

  loadToolFiles(): Promise<ToolFile[]> {
    return Promise.resolve([]);
  }

  convertRulesyncFilesToToolFiles(): Promise<ToolFile[]> {
    return Promise.resolve([]);
  }

  convertToolFilesToRulesyncFiles(): Promise<RulesyncFile[]> {
    return Promise.resolve([]);
  }
}

describe("FeatureProcessor", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.clearAllMocks();
  });

  describe("removeOrphanAiFiles", () => {
    it("should remove files that exist in existing but not in generated", async () => {
      const processor = new TestProcessor({ baseDir: testDir });

      const existingFiles = [
        createMockFile("/path/to/orphan1.md"),
        createMockFile("/path/to/orphan2.md"),
        createMockFile("/path/to/kept.md"),
      ];

      const generatedFiles = [createMockFile("/path/to/kept.md")];

      const count = await processor.removeOrphanAiFiles(existingFiles, generatedFiles);

      expect(count).toBe(2);
      expect(removeFile).toHaveBeenCalledTimes(2);
      expect(removeFile).toHaveBeenCalledWith("/path/to/orphan1.md");
      expect(removeFile).toHaveBeenCalledWith("/path/to/orphan2.md");
    });

    it("should not remove any files when all existing files are in generated", async () => {
      const processor = new TestProcessor({ baseDir: testDir });

      const existingFiles = [
        createMockFile("/path/to/file1.md"),
        createMockFile("/path/to/file2.md"),
      ];

      const generatedFiles = [
        createMockFile("/path/to/file1.md"),
        createMockFile("/path/to/file2.md"),
      ];

      const count = await processor.removeOrphanAiFiles(existingFiles, generatedFiles);

      expect(count).toBe(0);
      expect(removeFile).not.toHaveBeenCalled();
    });

    it("should remove all files when generated is empty", async () => {
      const processor = new TestProcessor({ baseDir: testDir });

      const existingFiles = [
        createMockFile("/path/to/file1.md"),
        createMockFile("/path/to/file2.md"),
      ];

      const generatedFiles: AiFile[] = [];

      const count = await processor.removeOrphanAiFiles(existingFiles, generatedFiles);

      expect(count).toBe(2);
      expect(removeFile).toHaveBeenCalledTimes(2);
      expect(removeFile).toHaveBeenCalledWith("/path/to/file1.md");
      expect(removeFile).toHaveBeenCalledWith("/path/to/file2.md");
    });

    it("should return count without removing files in dry-run mode", async () => {
      const processor = new TestProcessor({ baseDir: testDir, dryRun: true });

      const existingFiles = [
        createMockFile("/path/to/orphan1.md"),
        createMockFile("/path/to/orphan2.md"),
        createMockFile("/path/to/kept.md"),
      ];

      const generatedFiles = [createMockFile("/path/to/kept.md")];

      const count = await processor.removeOrphanAiFiles(existingFiles, generatedFiles);

      expect(count).toBe(2);
      expect(removeFile).not.toHaveBeenCalled();
    });

    it("should not remove any files when existing is empty", async () => {
      const processor = new TestProcessor({ baseDir: testDir });

      const existingFiles: AiFile[] = [];
      const generatedFiles = [createMockFile("/path/to/file1.md")];

      await processor.removeOrphanAiFiles(existingFiles, generatedFiles);

      expect(removeFile).not.toHaveBeenCalled();
    });
  });

  describe("writeAiFiles", () => {
    it("should write all files and return count when files are new", async () => {
      vi.mocked(readFileContentOrNull).mockResolvedValue(null);
      const processor = new TestProcessor({ baseDir: testDir });

      const files = [createMockFile("/path/to/file1.md"), createMockFile("/path/to/file2.md")];

      const result = await processor.writeAiFiles(files);

      expect(result).toEqual({ count: 2, paths: expect.any(Array) });
      expect(writeFileContent).toHaveBeenCalledTimes(2);
    });

    it("should skip unchanged files and return 0", async () => {
      vi.mocked(readFileContentOrNull).mockResolvedValue("content\n");
      const processor = new TestProcessor({ baseDir: testDir });

      const files = [createMockFile("/path/to/file1.md"), createMockFile("/path/to/file2.md")];

      const result = await processor.writeAiFiles(files);

      expect(result).toEqual({ count: 0, paths: [] });
      expect(writeFileContent).not.toHaveBeenCalled();
    });

    it("should only write changed files and return changed count", async () => {
      vi.mocked(readFileContentOrNull)
        .mockResolvedValueOnce("content\n") // file1: unchanged
        .mockResolvedValueOnce(null); // file2: new
      const processor = new TestProcessor({ baseDir: testDir });

      const files = [createMockFile("/path/to/file1.md"), createMockFile("/path/to/file2.md")];

      const result = await processor.writeAiFiles(files);

      expect(result).toEqual({ count: 1, paths: expect.any(Array) });
      expect(writeFileContent).toHaveBeenCalledTimes(1);
    });

    it("should return changed count without writing files in dry-run mode", async () => {
      vi.mocked(readFileContentOrNull).mockResolvedValue(null);
      const processor = new TestProcessor({ baseDir: testDir, dryRun: true });

      const files = [createMockFile("/path/to/file1.md"), createMockFile("/path/to/file2.md")];

      const result = await processor.writeAiFiles(files);

      expect(result).toEqual({ count: 2, paths: expect.any(Array) });
      expect(writeFileContent).not.toHaveBeenCalled();
    });
  });

  describe("removeAiFiles", () => {
    it("should remove all files", async () => {
      const processor = new TestProcessor({ baseDir: testDir });

      const files = [createMockFile("/path/to/file1.md"), createMockFile("/path/to/file2.md")];

      await processor.removeAiFiles(files);

      expect(removeFile).toHaveBeenCalledTimes(2);
      expect(removeFile).toHaveBeenCalledWith("/path/to/file1.md");
      expect(removeFile).toHaveBeenCalledWith("/path/to/file2.md");
    });
  });
});
