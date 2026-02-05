import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../test-utils/test-directories.js";
import { removeDirectory } from "../utils/file.js";
import { AiDir } from "./ai-dir.js";
import { DirFeatureProcessor } from "./dir-feature-processor.js";

vi.mock("../utils/file.js", async () => {
  const actual = await vi.importActual<typeof import("../utils/file.js")>("../utils/file.js");
  return {
    ...actual,
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
  });

  afterEach(async () => {
    await cleanup();
    vi.clearAllMocks();
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

      await processor.removeOrphanAiDirs(existingDirs, generatedDirs);

      expect(removeDirectory).toHaveBeenCalledTimes(2);
      expect(removeDirectory).toHaveBeenCalledWith("/path/to/orphan1");
      expect(removeDirectory).toHaveBeenCalledWith("/path/to/orphan2");
    });

    it("should not remove any dirs when all existing dirs are in generated", async () => {
      const processor = new TestDirProcessor({ baseDir: testDir });

      const existingDirs = [createMockDir("/path/to/dir1"), createMockDir("/path/to/dir2")];

      const generatedDirs = [createMockDir("/path/to/dir1"), createMockDir("/path/to/dir2")];

      await processor.removeOrphanAiDirs(existingDirs, generatedDirs);

      expect(removeDirectory).not.toHaveBeenCalled();
    });

    it("should remove all dirs when generated is empty", async () => {
      const processor = new TestDirProcessor({ baseDir: testDir });

      const existingDirs = [createMockDir("/path/to/dir1"), createMockDir("/path/to/dir2")];

      const generatedDirs: AiDir[] = [];

      await processor.removeOrphanAiDirs(existingDirs, generatedDirs);

      expect(removeDirectory).toHaveBeenCalledTimes(2);
      expect(removeDirectory).toHaveBeenCalledWith("/path/to/dir1");
      expect(removeDirectory).toHaveBeenCalledWith("/path/to/dir2");
    });

    it("should not remove any dirs when existing is empty", async () => {
      const processor = new TestDirProcessor({ baseDir: testDir });

      const existingDirs: AiDir[] = [];
      const generatedDirs = [createMockDir("/path/to/dir1")];

      await processor.removeOrphanAiDirs(existingDirs, generatedDirs);

      expect(removeDirectory).not.toHaveBeenCalled();
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
