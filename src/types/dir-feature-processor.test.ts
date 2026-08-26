import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockLogger } from "../test-utils/mock-logger.js";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import {
  ensureDir,
  readFileBufferOrNull,
  readFileContentOrNull,
  removeDirectory,
  writeFileBuffer,
  writeFileContent,
} from "../utils/file.js";
import { AiDir, AiDirFile } from "./ai-dir.js";
import { DirFeatureProcessor } from "./dir-feature-processor.js";

vi.mock("../utils/file.js", async () => {
  const actual = await vi.importActual<typeof import("../utils/file.js")>("../utils/file.js");
  return {
    ...actual,
    readFileContentOrNull: vi.fn().mockResolvedValue(null),
    readFileBufferOrNull: vi.fn().mockResolvedValue(null),
    removeDirectory: vi.fn(),
    ensureDir: vi.fn(),
    writeFileContent: vi.fn(),
    writeFileBuffer: vi.fn(),
  };
});

function createMockDir(dirPath: string): AiDir {
  return {
    getDirPath: () => dirPath,
    getMainFile: () => undefined,
    getOtherFiles: () => [],
    getRelativePathFromCwd: () => dirPath,
  } as unknown as AiDir;
}

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
    getRelativePathFromCwd: () => dirPath,
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
      const logger = createMockLogger();
      const processor = new TestDirProcessor({ logger, outputRoot: testDir });

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
      // Symmetric with the dry-run case below: a real `--delete` run has to
      // report the directories it removed.
      expect(logger.info).toHaveBeenCalledWith("Deleted directory: /path/to/orphan1");
      expect(logger.info).toHaveBeenCalledWith("Deleted directory: /path/to/orphan2");
      expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining("kept"));
    });

    it("should strip control characters from the deletion log", async () => {
      const logger = createMockLogger();
      const processor = new TestDirProcessor({ logger, outputRoot: testDir });

      // The path is an on-disk name rulesync did not choose, so a name carrying
      // `\x1b[2K\r` must not be able to rewrite the line and hide the deletion.
      const existingDirs = [createMockDir("/path/to/\u001b[2K\r-innocent")];

      const count = await processor.removeOrphanAiDirs(existingDirs, []);

      expect(count).toBe(1);
      expect(logger.info).toHaveBeenCalledWith("Deleted directory: /path/to/[2K-innocent");
    });

    it("should not remove any dirs when all existing dirs are in generated", async () => {
      const processor = new TestDirProcessor({ logger: createMockLogger(), outputRoot: testDir });

      const existingDirs = [createMockDir("/path/to/dir1"), createMockDir("/path/to/dir2")];

      const generatedDirs = [createMockDir("/path/to/dir1"), createMockDir("/path/to/dir2")];

      const count = await processor.removeOrphanAiDirs(existingDirs, generatedDirs);

      expect(count).toBe(0);
      expect(removeDirectory).not.toHaveBeenCalled();
    });

    it("should remove all dirs when generated is empty", async () => {
      const processor = new TestDirProcessor({ logger: createMockLogger(), outputRoot: testDir });

      const existingDirs = [createMockDir("/path/to/dir1"), createMockDir("/path/to/dir2")];

      const generatedDirs: AiDir[] = [];

      const count = await processor.removeOrphanAiDirs(existingDirs, generatedDirs);

      expect(count).toBe(2);
      expect(removeDirectory).toHaveBeenCalledTimes(2);
      expect(removeDirectory).toHaveBeenCalledWith("/path/to/dir1");
      expect(removeDirectory).toHaveBeenCalledWith("/path/to/dir2");
    });

    it("should return count without removing dirs in dry-run mode", async () => {
      const logger = createMockLogger();
      const processor = new TestDirProcessor({
        logger,
        outputRoot: testDir,
        dryRun: true,
      });

      const existingDirs = [
        createMockDir("/path/to/orphan1"),
        createMockDir("/path/to/orphan2"),
        createMockDir("/path/to/kept"),
      ];

      const generatedDirs = [createMockDir("/path/to/kept")];

      const count = await processor.removeOrphanAiDirs(existingDirs, generatedDirs);

      expect(count).toBe(2);
      expect(removeDirectory).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        "[DRY RUN] Would delete directory: /path/to/orphan1",
      );
      expect(logger.info).toHaveBeenCalledWith(
        "[DRY RUN] Would delete directory: /path/to/orphan2",
      );
      expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining("kept"));
    });

    it("should not remove any dirs when existing is empty", async () => {
      const processor = new TestDirProcessor({ logger: createMockLogger(), outputRoot: testDir });

      const existingDirs: AiDir[] = [];
      const generatedDirs = [createMockDir("/path/to/dir1")];

      await processor.removeOrphanAiDirs(existingDirs, generatedDirs);

      expect(removeDirectory).not.toHaveBeenCalled();
    });
  });

  describe("writeAiDirs", () => {
    it("should write all dirs and return count when dirs are new", async () => {
      vi.mocked(readFileContentOrNull).mockResolvedValue(null);
      const processor = new TestDirProcessor({ logger: createMockLogger(), outputRoot: testDir });

      const dirs = [
        createMockDirWithFiles({ dirPath: "/path/to/dir1", mainFileBody: "body1" }),
        createMockDirWithFiles({ dirPath: "/path/to/dir2", mainFileBody: "body2" }),
      ];

      const result = await processor.writeAiDirs(dirs);

      expect(result).toEqual({
        count: 2,
        paths: ["/path/to/dir1/SKILL.md", "/path/to/dir2/SKILL.md"],
      });
      expect(ensureDir).toHaveBeenCalledTimes(2);
      expect(writeFileContent).toHaveBeenCalledTimes(2);
    });

    it("should strip control characters from the dry-run write log", async () => {
      vi.mocked(readFileContentOrNull).mockResolvedValue(null);
      const logger = createMockLogger();
      const processor = new TestDirProcessor({ logger, outputRoot: testDir, dryRun: true });

      // Dry-run output is what a user reads to see what a run would do, and the
      // name comes from a `.rulesync/**` file `rulesync fetch` may have supplied.
      const otherFile: AiDirFile = {
        relativeFilePathToDirPath: "\u001b[2K\r-extra.txt",
        fileBuffer: Buffer.from("other content"),
      };
      const dirs = [
        createMockDirWithFiles({
          dirPath: "/path/to/\u001b[2K\r-dir1",
          mainFileBody: "body1",
          otherFiles: [otherFile],
        }),
      ];

      await processor.writeAiDirs(dirs);

      expect(logger.info).toHaveBeenCalledWith(
        "[DRY RUN] Would create directory: /path/to/[2K-dir1",
      );
      expect(logger.info).toHaveBeenCalledWith(
        `[DRY RUN] Would write: ${join("/path/to/[2K-dir1", "SKILL.md")}`,
      );
      expect(logger.info).toHaveBeenCalledWith(
        `[DRY RUN] Would write: ${join("/path/to/[2K-dir1", "[2K-extra.txt")}`,
      );
    });

    it("should skip unchanged dirs and return 0", async () => {
      vi.mocked(readFileContentOrNull).mockResolvedValue("body1\n");
      const processor = new TestDirProcessor({ logger: createMockLogger(), outputRoot: testDir });

      const dirs = [createMockDirWithFiles({ dirPath: "/path/to/dir1", mainFileBody: "body1" })];

      const result = await processor.writeAiDirs(dirs);

      expect(result).toEqual({ count: 0, paths: [] });
      expect(ensureDir).not.toHaveBeenCalled();
      expect(writeFileContent).not.toHaveBeenCalled();
    });

    it("should detect changes in other files", async () => {
      vi.mocked(readFileContentOrNull).mockResolvedValue(null);
      const processor = new TestDirProcessor({ logger: createMockLogger(), outputRoot: testDir });

      const otherFile: AiDirFile = {
        relativeFilePathToDirPath: "extra.txt",
        fileBuffer: Buffer.from("other content"),
      };
      const dirs = [createMockDirWithFiles({ dirPath: "/path/to/dir1", otherFiles: [otherFile] })];

      const result = await processor.writeAiDirs(dirs);

      expect(result).toEqual({ count: 1, paths: ["/path/to/dir1/extra.txt"] });
      expect(ensureDir).toHaveBeenCalledTimes(1);
      expect(writeFileBuffer).toHaveBeenCalledWith("/path/to/dir1/extra.txt", otherFile.fileBuffer);
      expect(writeFileContent).not.toHaveBeenCalled();
    });

    it("should copy a text other file byte-faithfully", async () => {
      // A trailing-newline-less, CRLF-separated companion file used to be
      // rewritten to LF with a newline appended.
      const textBuffer = Buffer.from("first\r\nsecond");
      const processor = new TestDirProcessor({ logger: createMockLogger(), outputRoot: testDir });

      const otherFile: AiDirFile = {
        relativeFilePathToDirPath: "fixture.txt",
        fileBuffer: textBuffer,
      };
      const dirs = [createMockDirWithFiles({ dirPath: "/path/to/dir1", otherFiles: [otherFile] })];

      const result = await processor.writeAiDirs(dirs);

      expect(result).toEqual({ count: 1, paths: ["/path/to/dir1/fixture.txt"] });
      expect(writeFileBuffer).toHaveBeenCalledWith("/path/to/dir1/fixture.txt", textBuffer);
      expect(writeFileContent).not.toHaveBeenCalled();
    });

    it("should skip an unchanged text other file", async () => {
      const textBuffer = Buffer.from("first\r\nsecond");
      vi.mocked(readFileBufferOrNull).mockResolvedValue(textBuffer);
      const processor = new TestDirProcessor({ logger: createMockLogger(), outputRoot: testDir });

      const otherFile: AiDirFile = {
        relativeFilePathToDirPath: "fixture.txt",
        fileBuffer: textBuffer,
      };
      const dirs = [createMockDirWithFiles({ dirPath: "/path/to/dir1", otherFiles: [otherFile] })];

      const result = await processor.writeAiDirs(dirs);

      expect(result).toEqual({ count: 0, paths: [] });
      expect(writeFileBuffer).not.toHaveBeenCalled();
    });

    it("should detect a change in a later other file", async () => {
      const unchanged = Buffer.from("same");
      vi.mocked(readFileBufferOrNull).mockImplementation(async (filePath) =>
        filePath.endsWith("first.txt") ? unchanged : Buffer.from("stale"),
      );
      const processor = new TestDirProcessor({ logger: createMockLogger(), outputRoot: testDir });

      const otherFiles: AiDirFile[] = [
        { relativeFilePathToDirPath: "first.txt", fileBuffer: unchanged },
        { relativeFilePathToDirPath: "second.txt", fileBuffer: Buffer.from("fresh") },
      ];
      const dirs = [createMockDirWithFiles({ dirPath: "/path/to/dir1", otherFiles })];

      const result = await processor.writeAiDirs(dirs);

      expect(result.count).toBe(1);
      // Directory-level change detection: both files are rewritten.
      expect(writeFileBuffer).toHaveBeenCalledTimes(2);
    });

    it("should treat a reformatted structured other file as unchanged", async () => {
      // `agents/openai.yaml` is composed by rulesync, so a formatter's
      // re-indentation must not make every generate report a change.
      vi.mocked(readFileBufferOrNull).mockResolvedValue(Buffer.from("name:   deploy\nsteps: []\n"));
      const processor = new TestDirProcessor({ logger: createMockLogger(), outputRoot: testDir });

      const otherFile: AiDirFile = {
        relativeFilePathToDirPath: "agents/openai.yaml",
        fileBuffer: Buffer.from("name: deploy\nsteps: []"),
        composed: true,
      };
      const dirs = [createMockDirWithFiles({ dirPath: "/path/to/dir1", otherFiles: [otherFile] })];

      const result = await processor.writeAiDirs(dirs);

      expect(result).toEqual({ count: 0, paths: [] });
      expect(writeFileBuffer).not.toHaveBeenCalled();
    });

    it("should rewrite a text other file that differs only in trailing bytes", async () => {
      vi.mocked(readFileBufferOrNull).mockResolvedValue(Buffer.from("first\nsecond\n"));
      const processor = new TestDirProcessor({ logger: createMockLogger(), outputRoot: testDir });

      const otherFile: AiDirFile = {
        relativeFilePathToDirPath: "fixture.txt",
        fileBuffer: Buffer.from("first\r\nsecond"),
      };
      const dirs = [createMockDirWithFiles({ dirPath: "/path/to/dir1", otherFiles: [otherFile] })];

      const result = await processor.writeAiDirs(dirs);

      expect(result).toEqual({ count: 1, paths: ["/path/to/dir1/fixture.txt"] });
      expect(writeFileBuffer).toHaveBeenCalledTimes(1);
    });

    it("should write binary other files via the buffer path", async () => {
      const binaryBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
      const processor = new TestDirProcessor({ logger: createMockLogger(), outputRoot: testDir });

      const otherFile: AiDirFile = {
        relativeFilePathToDirPath: "image.jpg",
        fileBuffer: binaryBuffer,
      };
      const dirs = [createMockDirWithFiles({ dirPath: "/path/to/dir1", otherFiles: [otherFile] })];

      const result = await processor.writeAiDirs(dirs);

      expect(result).toEqual({ count: 1, paths: ["/path/to/dir1/image.jpg"] });
      expect(writeFileBuffer).toHaveBeenCalledWith("/path/to/dir1/image.jpg", binaryBuffer);
      expect(writeFileContent).not.toHaveBeenCalled();
    });

    it("should skip unchanged binary other files", async () => {
      const binaryBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
      vi.mocked(readFileBufferOrNull).mockResolvedValue(binaryBuffer);
      const processor = new TestDirProcessor({ logger: createMockLogger(), outputRoot: testDir });

      const otherFile: AiDirFile = {
        relativeFilePathToDirPath: "image.jpg",
        fileBuffer: binaryBuffer,
      };
      const dirs = [createMockDirWithFiles({ dirPath: "/path/to/dir1", otherFiles: [otherFile] })];

      const result = await processor.writeAiDirs(dirs);

      expect(result).toEqual({ count: 0, paths: [] });
      expect(writeFileBuffer).not.toHaveBeenCalled();
    });

    it("should detect changes in binary other files", async () => {
      const binaryBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
      vi.mocked(readFileBufferOrNull).mockResolvedValue(Buffer.from([0x00, 0x01, 0x02]));
      const processor = new TestDirProcessor({ logger: createMockLogger(), outputRoot: testDir });

      const otherFile: AiDirFile = {
        relativeFilePathToDirPath: "image.jpg",
        fileBuffer: binaryBuffer,
      };
      const dirs = [createMockDirWithFiles({ dirPath: "/path/to/dir1", otherFiles: [otherFile] })];

      const result = await processor.writeAiDirs(dirs);

      expect(result).toEqual({ count: 1, paths: ["/path/to/dir1/image.jpg"] });
      expect(writeFileBuffer).toHaveBeenCalledTimes(1);
    });

    it("should return changed count without writing in dry-run mode", async () => {
      vi.mocked(readFileContentOrNull).mockResolvedValue(null);
      const processor = new TestDirProcessor({
        logger: createMockLogger(),
        outputRoot: testDir,
        dryRun: true,
      });

      const dirs = [
        createMockDirWithFiles({ dirPath: "/path/to/dir1", mainFileBody: "body1" }),
        createMockDirWithFiles({ dirPath: "/path/to/dir2", mainFileBody: "body2" }),
      ];

      const result = await processor.writeAiDirs(dirs);

      expect(result).toEqual({
        count: 2,
        paths: ["/path/to/dir1/SKILL.md", "/path/to/dir2/SKILL.md"],
      });
      expect(ensureDir).not.toHaveBeenCalled();
      expect(writeFileContent).not.toHaveBeenCalled();
    });
  });

  describe("removeAiDirs", () => {
    it("should remove all dirs", async () => {
      const processor = new TestDirProcessor({ logger: createMockLogger(), outputRoot: testDir });

      const dirs = [createMockDir("/path/to/dir1"), createMockDir("/path/to/dir2")];

      await processor.removeAiDirs(dirs);

      expect(removeDirectory).toHaveBeenCalledTimes(2);
      expect(removeDirectory).toHaveBeenCalledWith("/path/to/dir1");
      expect(removeDirectory).toHaveBeenCalledWith("/path/to/dir2");
    });
  });
});
