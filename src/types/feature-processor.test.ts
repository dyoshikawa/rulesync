import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../test-utils/test-directories.js";
import { removeFile, writeFileContent } from "../utils/file.js";
import { AiFile } from "./ai-file.js";
import { FeatureProcessor } from "./feature-processor.js";
import { RulesyncFile } from "./rulesync-file.js";
import { ToolFile } from "./tool-file.js";

vi.mock("../utils/file.js", async () => {
  const actual = await vi.importActual<typeof import("../utils/file.js")>("../utils/file.js");
  return {
    ...actual,
    removeFile: vi.fn(),
    writeFileContent: vi.fn(),
  };
});

function createMockFile(filePath: string): AiFile {
  return {
    getFilePath: () => filePath,
    getFileContent: () => "content",
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

      await processor.removeOrphanAiFiles(existingFiles, generatedFiles);

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

      await processor.removeOrphanAiFiles(existingFiles, generatedFiles);

      expect(removeFile).not.toHaveBeenCalled();
    });

    it("should remove all files when generated is empty", async () => {
      const processor = new TestProcessor({ baseDir: testDir });

      const existingFiles = [
        createMockFile("/path/to/file1.md"),
        createMockFile("/path/to/file2.md"),
      ];

      const generatedFiles: AiFile[] = [];

      await processor.removeOrphanAiFiles(existingFiles, generatedFiles);

      expect(removeFile).toHaveBeenCalledTimes(2);
      expect(removeFile).toHaveBeenCalledWith("/path/to/file1.md");
      expect(removeFile).toHaveBeenCalledWith("/path/to/file2.md");
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
    it("should write all files and return count", async () => {
      const processor = new TestProcessor({ baseDir: testDir });

      const files = [createMockFile("/path/to/file1.md"), createMockFile("/path/to/file2.md")];

      const count = await processor.writeAiFiles(files);

      expect(count).toBe(2);
      expect(writeFileContent).toHaveBeenCalledTimes(2);
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
