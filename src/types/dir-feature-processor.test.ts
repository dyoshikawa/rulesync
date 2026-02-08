import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../test-utils/test-directories.js";
import {
  ensureDir,
  readFileContentOrNull,
  removeDirectory,
  writeFileContent,
} from "../utils/file.js";
import { AiDir, AiDirFile } from "./ai-dir.js";
import { DirFeatureProcessor } from "./dir-feature-processor.js";

vi.mock("../utils/file.js", async () => {
  const actual = await vi.importActual<typeof import("../utils/file.js")>("../utils/file.js");
  return {
    ...actual,
    readFileContentOrNull: vi.fn().mockResolvedValue(null),
    removeDirectory: vi.fn(),
    ensureDir: vi.fn(),
    writeFileContent: vi.fn(),
  };
});

function createMockDir(dirPath: string): AiDir {
  return {
    getDirPath: () => dirPath,
    getMainFile: () => undefined,
    getOtherFiles: () => [],
  } as unknown as AiDir;
}

class TestDirProcessor extends DirFeatureProcessor {
  loadRulesyncDirs(): Promise<AiDir[]> {
    return Promise.resolve([]);
  }

  loadToolDirs(): Promise<AiDir[]> {
    return Promise.resolve([]);
  }

  loadToolDirsToDelete(): Promise<AiDir[]> {
    return Promise.resolve([]);
  }

  convertRulesyncDirsToToolDirs(): Promise<AiDir[]> {
    return Promise.resolve([]);
  }

  convertToolDirsToRulesyncDirs(): Promise<AiDir[]> {
    return Promise.resolve([]);
  }
}

describe("DirFeatureProcessor", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("removeOrphanAiDirs", () => {
    it("should remove dirs that exist in existing but not in generated", async () => {
      const processor = new TestDirProcessor({ baseDir: testDir });

      const existingDirs = [
        createMockDir("/path/to/orphan1"),
        createMockDir("/path/to/orphan2"),
        createMockDir("/path/to/kept"),
      ];

      const generatedDirs = [createMockDir("/path/to/kept")];

      const count = await processor.removeOrphanAiDirs(existingDirs, generatedDirs);

      expect(count).toBe(2);
      expect(removeDirectory).toHaveBeenCalledTimes(2);
      expect(removeDirectory).toHaveBeenCalledWith("/path/to/orphan1");
      expect(removeDirectory).toHaveBeenCalledWith("/path/to/orphan2");
    });

    it("should not remove any dirs when all existing dirs are in generated", async () => {
      const processor = new TestDirProcessor({ baseDir: testDir });

      const existingDirs = [createMockDir("/path/to/dir1"), createMockDir("/path/to/dir2")];

      const generatedDirs = [createMockDir("/path/to/dir1"), createMockDir("/path/to/dir2")];

      const count = await processor.removeOrphanAiDirs(existingDirs, generatedDirs);

      expect(count).toBe(0);
      expect(removeDirectory).not.toHaveBeenCalled();
    });

    it("should remove all dirs when generated is empty", async () => {
      const processor = new TestDirProcessor({ baseDir: testDir });

      const existingDirs = [createMockDir("/path/to/dir1"), createMockDir("/path/to/dir2")];

      const generatedDirs: AiDir[] = [];

      const count = await processor.removeOrphanAiDirs(existingDirs, generatedDirs);

      expect(count).toBe(2);
      expect(removeDirectory).toHaveBeenCalledTimes(2);
      expect(removeDirectory).toHaveBeenCalledWith("/path/to/dir1");
      expect(removeDirectory).toHaveBeenCalledWith("/path/to/dir2");
    });

    it("should return count without removing dirs in dry-run mode", async () => {
      const processor = new TestDirProcessor({ baseDir: testDir, dryRun: true });

      const existingDirs = [
        createMockDir("/path/to/orphan1"),
        createMockDir("/path/to/orphan2"),
        createMockDir("/path/to/kept"),
      ];

      const generatedDirs = [createMockDir("/path/to/kept")];

      const count = await processor.removeOrphanAiDirs(existingDirs, generatedDirs);

      expect(count).toBe(2);
      expect(removeDirectory).not.toHaveBeenCalled();
    });

    it("should not remove any dirs when existing is empty", async () => {
      const processor = new TestDirProcessor({ baseDir: testDir });

      const existingDirs: AiDir[] = [];
      const generatedDirs = [createMockDir("/path/to/dir1")];

      await processor.removeOrphanAiDirs(existingDirs, generatedDirs);

      expect(removeDirectory).not.toHaveBeenCalled();
    });
  });

  describe("writeAiDirs", () => {
    function createMockDirWithFiles({
      dirPath,
      mainFileBody,
      otherFiles = [],
    }: {
      dirPath: string;
      mainFileBody?: string;
      otherFiles?: AiDirFile[];
    }): AiDir {
      return {
        getDirPath: () => dirPath,
        getMainFile: () =>
          mainFileBody !== undefined
            ? { name: "SKILL.md", body: mainFileBody, frontmatter: {} }
            : undefined,
        getOtherFiles: () => otherFiles,
      } as unknown as AiDir;
    }

    it("should write all dirs and return count when dirs are new", async () => {
      vi.mocked(readFileContentOrNull).mockResolvedValue(null);
      const processor = new TestDirProcessor({ baseDir: testDir });

      const dirs = [
        createMockDirWithFiles({ dirPath: "/path/to/dir1", mainFileBody: "body1" }),
        createMockDirWithFiles({ dirPath: "/path/to/dir2", mainFileBody: "body2" }),
      ];

      const count = await processor.writeAiDirs(dirs);

      expect(count).toBe(2);
      expect(ensureDir).toHaveBeenCalledTimes(2);
      expect(writeFileContent).toHaveBeenCalledTimes(2);
    });

    it("should skip unchanged dirs and return 0", async () => {
      vi.mocked(readFileContentOrNull).mockResolvedValue("body1\n");
      const processor = new TestDirProcessor({ baseDir: testDir });

      const dirs = [createMockDirWithFiles({ dirPath: "/path/to/dir1", mainFileBody: "body1" })];

      const count = await processor.writeAiDirs(dirs);

      expect(count).toBe(0);
      expect(ensureDir).not.toHaveBeenCalled();
      expect(writeFileContent).not.toHaveBeenCalled();
    });

    it("should detect changes in other files", async () => {
      vi.mocked(readFileContentOrNull).mockResolvedValue(null);
      const processor = new TestDirProcessor({ baseDir: testDir });

      const otherFile: AiDirFile = {
        relativeFilePathToDirPath: "extra.txt",
        fileBuffer: Buffer.from("other content"),
      };
      const dirs = [createMockDirWithFiles({ dirPath: "/path/to/dir1", otherFiles: [otherFile] })];

      const count = await processor.writeAiDirs(dirs);

      expect(count).toBe(1);
      expect(ensureDir).toHaveBeenCalledTimes(1);
      expect(writeFileContent).toHaveBeenCalledTimes(1);
    });

    it("should return changed count without writing in dry-run mode", async () => {
      vi.mocked(readFileContentOrNull).mockResolvedValue(null);
      const processor = new TestDirProcessor({ baseDir: testDir, dryRun: true });

      const dirs = [
        createMockDirWithFiles({ dirPath: "/path/to/dir1", mainFileBody: "body1" }),
        createMockDirWithFiles({ dirPath: "/path/to/dir2", mainFileBody: "body2" }),
      ];

      const count = await processor.writeAiDirs(dirs);

      expect(count).toBe(2);
      expect(ensureDir).not.toHaveBeenCalled();
      expect(writeFileContent).not.toHaveBeenCalled();
    });
  });

  describe("removeAiDirs", () => {
    it("should remove all dirs", async () => {
      const processor = new TestDirProcessor({ baseDir: testDir });

      const dirs = [createMockDir("/path/to/dir1"), createMockDir("/path/to/dir2")];

      await processor.removeAiDirs(dirs);

      expect(removeDirectory).toHaveBeenCalledTimes(2);
      expect(removeDirectory).toHaveBeenCalledWith("/path/to/dir1");
      expect(removeDirectory).toHaveBeenCalledWith("/path/to/dir2");
    });
  });
});
