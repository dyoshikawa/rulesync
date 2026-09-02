import { chmod, symlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockLogger } from "../test-utils/mock-logger.js";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import {
  applyFileMode,
  ensureDir,
  readFileBufferOrNull,
  readFileContentOrNull,
  removeDirectory,
  removeFile,
  restoreMissingExecutableBit,
  writeFileBuffer,
  writeFileContent,
} from "../utils/file.js";
import { recordIncompleteCarriedFiles } from "../utils/warned-once.js";
import { AiDir, AiDirFile } from "./ai-dir.js";
import { DirFeatureProcessor } from "./dir-feature-processor.js";

vi.mock("../utils/file.js", async () => {
  const actual = await vi.importActual<typeof import("../utils/file.js")>("../utils/file.js");
  return {
    ...actual,
    readFileContentOrNull: vi.fn().mockResolvedValue(null),
    readFileBufferOrNull: vi.fn().mockResolvedValue(null),
    removeDirectory: vi.fn(),
    removeFile: vi.fn(),
    ensureDir: vi.fn(),
    writeFileContent: vi.fn(),
    writeFileBuffer: vi.fn(),
    applyFileMode: vi.fn(),
    restoreMissingExecutableBit: vi.fn(),
  };
});

function createMockDir({
  dirPath,
  ownsDirTree = true,
  // The root the directory was found in, as a real `AiDir` carries it: an
  // output root plus a relative directory path. It defaults to the parent,
  // which is where a real `AiDir` puts it — the sweep checks that positionally.
  outputRoot = dirname(dirPath),
  relativeDirPath = ".",
}: {
  dirPath: string;
  ownsDirTree?: boolean;
  outputRoot?: string;
  relativeDirPath?: string;
}): AiDir {
  return {
    getDirPath: () => dirPath,
    getDirName: () => basename(dirPath),
    getMainFile: () => undefined,
    getOtherFiles: () => [],
    getOutputRoot: () => outputRoot,
    getRelativeDirPath: () => relativeDirPath,
    getRelativePathFromCwd: () => dirPath,
    ownsDirTree: () => ownsDirTree,
  } as unknown as AiDir;
}

/**
 * A candidate for a tool that flattens into a shared root: it owns no
 * directory of its own, reports that root as its directory, and stands for one
 * file directly inside it — the shape `TaktSkill` has.
 */
function createMockFlatDir({
  root,
  fileName,
  outputRoot = dirname(root),
  relativeDirPath = basename(root),
  dirPath = root,
  flatFilePath,
  otherFiles = [],
}: {
  root: string;
  fileName: string;
  outputRoot?: string;
  relativeDirPath?: string;
  /** What the candidate reports as its directory; the shared root itself, normally. */
  dirPath?: string;
  /** Overrides the file the candidate names; `null` for one that names none. */
  flatFilePath?: string | null;
  /** Companion files this entry writes beside its own, as generate does. */
  otherFiles?: AiDirFile[];
}): AiDir {
  return {
    getDirPath: () => dirPath,
    getDirName: () => basename(fileName, ".md"),
    getFlatFilePath: () =>
      flatFilePath === null ? undefined : (flatFilePath ?? join(dirPath, fileName)),
    getMainFile: () => ({ name: fileName, body: "", frontmatter: {} }),
    getOtherFiles: () => otherFiles,
    getOutputRoot: () => outputRoot,
    getRelativeDirPath: () => relativeDirPath,
    getRelativePathFromCwd: () => join(relativeDirPath, fileName),
    ownsDirTree: () => false,
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
    // The same three values `createMockDir` supplies: the orphan sweep reads
    // them positionally, so a mock without them fails at run time rather than
    // in the type checker, which the cast below has already given up on.
    getOutputRoot: () => dirname(dirPath),
    getRelativeDirPath: () => ".",
    getDirName: () => basename(dirPath),
    getMainFile: () =>
      mainFileBody !== undefined
        ? { name: "SKILL.md", body: mainFileBody, frontmatter: {} }
        : undefined,
    getOtherFiles: () => otherFiles,
    getRelativePathFromCwd: () => dirPath,
    ownsDirTree: () => true,
  } as unknown as AiDir;
}

/**
 * Real files on disk, for the one sweep that decides from a walk of the
 * directory rather than from a list a caller hands it: a mocked enumeration
 * there would only be testing the mock. `removeFile` stays mocked, so what the
 * sweep decided is what is asserted -- and the tree survives to be asserted
 * against.
 */
async function writeFiles(dirPath: string, names: string[]): Promise<void> {
  const { writeFileContent: realWriteFileContent, ensureDir: realEnsureDir } =
    await vi.importActual<typeof import("../utils/file.js")>("../utils/file.js");
  await realEnsureDir(dirPath);
  for (const name of names) {
    await realEnsureDir(dirname(join(dirPath, name)));
    await realWriteFileContent(join(dirPath, name), "content");
  }
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
      const processor = new TestDirProcessor({ logger, outputRoot: "/path/to" });

      const existingDirs = [
        createMockDir({ dirPath: "/path/to/orphan1" }),
        createMockDir({ dirPath: "/path/to/orphan2" }),
        createMockDir({ dirPath: "/path/to/kept" }),
      ];

      const generatedDirs = [createMockDir({ dirPath: "/path/to/kept" })];

      const count = await processor.removeOrphanAiDirs(existingDirs, generatedDirs);

      expect(count).toBe(2);
      expect(removeDirectory).toHaveBeenCalledTimes(2);
      expect(removeDirectory).toHaveBeenCalledWith("/path/to/orphan1");
      expect(removeDirectory).toHaveBeenCalledWith("/path/to/orphan2");
      // Symmetric with the dry-run case below: a real `--delete` run has to
      // report the directories it removed.
      expect(logger.info).toHaveBeenCalledWith('Deleted directory: "/path/to/orphan1"');
      expect(logger.info).toHaveBeenCalledWith('Deleted directory: "/path/to/orphan2"');
      expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining("kept"));
      // The backstop must stay invisible on the ordinary path: a warning here
      // would mean every `--delete` run tells the user it refused something.
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("should strip control characters from the deletion log", async () => {
      const logger = createMockLogger();
      const processor = new TestDirProcessor({ logger, outputRoot: "/path/to" });

      // The path is an on-disk name rulesync did not choose, so a name carrying
      // `\x1b[2K\r` must not be able to rewrite the line and hide the deletion.
      const existingDirs = [createMockDir({ dirPath: "/path/to/\u001b[2K\r-innocent" })];

      const count = await processor.removeOrphanAiDirs(existingDirs, []);

      expect(count).toBe(1);
      expect(logger.info).toHaveBeenCalledWith('Deleted directory: "/path/to/[2K-innocent"');
    });

    it("should refuse a candidate that reports the root it was found in", async () => {
      // The shape #2777 hit: a subclass overrode `getDirPath()` to return the
      // shared root, so every candidate reported the same directory and the
      // sweep deleted the root with every sibling in it. There it was
      // `ownsDirTree()` that stopped the deletion; this pins that a candidate
      // which claims the tree as its own anyway does not get through either.
      const logger = createMockLogger();
      const processor = new TestDirProcessor({ logger, outputRoot: "/path/to" });

      const count = await processor.removeOrphanAiDirs(
        [createMockDir({ dirPath: "/path/to/root", outputRoot: "/path/to/root" })],
        [],
      );

      expect(count).toBe(0);
      expect(removeDirectory).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        'Refusing to delete "/path/to/root": it is the root it was found in, not a directory ' +
          "inside that root",
      );
    });

    it("should refuse a candidate that climbs out of the root it was found in", async () => {
      const logger = createMockLogger();
      const processor = new TestDirProcessor({ logger, outputRoot: "/path/to" });

      const count = await processor.removeOrphanAiDirs(
        [createMockDir({ dirPath: "/path/to/elsewhere", outputRoot: "/path/to/root" })],
        [],
      );

      expect(count).toBe(0);
      expect(removeDirectory).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        'Refusing to delete "/path/to/elsewhere": it is not inside "/path/to/root", the root it ' +
          "was found in",
      );
    });

    it("should still remove a directory whose name merely starts with dots", async () => {
      // `..cache` is an ordinary directory name, not a climb out of the root.
      const processor = new TestDirProcessor({
        logger: createMockLogger(),
        outputRoot: "/path/to",
      });

      const count = await processor.removeOrphanAiDirs(
        [createMockDir({ dirPath: "/path/to/root/..cache", outputRoot: "/path/to/root" })],
        [],
      );

      expect(count).toBe(1);
      expect(removeDirectory).toHaveBeenCalledWith("/path/to/root/..cache");
    });

    it("should still remove a directory nested below the root it was found in", async () => {
      // A tool that keeps its skills one level deeper is not the case above.
      const processor = new TestDirProcessor({
        logger: createMockLogger(),
        outputRoot: "/path/to",
      });

      const count = await processor.removeOrphanAiDirs(
        [createMockDir({ dirPath: "/path/to/root/nested/orphan", outputRoot: "/path/to/root" })],
        [],
      );

      expect(count).toBe(1);
      expect(removeDirectory).toHaveBeenCalledWith("/path/to/root/nested/orphan");
    });

    it("should report a candidate that disowns a directory which is not the root", async () => {
      // `ownsDirTree()` is false for two shapes: a tool that flattens into a
      // shared root, and an override of `getDirPath()` that was never kept in
      // agreement with it. Only the first reports the root, so calling the
      // second a shared root would say something untrue about it.
      const logger = createMockLogger();
      const processor = new TestDirProcessor({ logger, outputRoot: "/path/to" });

      const count = await processor.removeOrphanAiDirs(
        [
          createMockDir({
            dirPath: "/path/to/root/elsewhere",
            ownsDirTree: false,
            outputRoot: "/path/to/root",
          }),
        ],
        [],
      );

      expect(count).toBe(0);
      expect(removeDirectory).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        'Refusing to delete "/path/to/root/elsewhere": it does not own that directory, and it ' +
          'is not the shared root "/path/to/root" it was found in either',
      );
      expect(logger.debug).not.toHaveBeenCalledWith(expect.stringContaining("shared root, not"));
    });

    it("should build the root from both halves the candidate carries", async () => {
      // `relativeDirPath` is part of the root, and dropping it would widen the
      // root to the output root and let a sibling tree through.
      const logger = createMockLogger();
      const processor = new TestDirProcessor({ logger, outputRoot: "/path/to" });

      const count = await processor.removeOrphanAiDirs(
        [
          createMockDir({
            dirPath: "/path/to/other/orphan",
            outputRoot: "/path/to",
            relativeDirPath: "root",
          }),
        ],
        [],
      );

      expect(count).toBe(0);
      expect(removeDirectory).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('it is not inside "/path/to/root"'),
      );
    });

    it("should refuse a candidate whose own root is outside the processor's", async () => {
      // The root a candidate reports is its own claim. One that climbs out of
      // the directory the processor writes to would otherwise vouch for
      // everything below it.
      const logger = createMockLogger();
      const processor = new TestDirProcessor({ logger, outputRoot: "/path/to" });

      const count = await processor.removeOrphanAiDirs(
        [createMockDir({ dirPath: "/elsewhere/root/orphan", outputRoot: "/elsewhere/root" })],
        [],
      );

      expect(count).toBe(0);
      expect(removeDirectory).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        'Refusing to delete "/elsewhere/root/orphan": the root "/elsewhere/root" it was found ' +
          'in is not inside "/path/to", the directory this run writes to',
      );
    });

    it("should say the root is out of reach even when the candidate disowns it", async () => {
      // A root outside the directory this run writes to is reported for its own
      // reason: the candidate's position within that root — which is what the
      // `ownsDirTree()` branch describes — says nothing about whether the root
      // is one this run may delete from.
      const logger = createMockLogger();
      const processor = new TestDirProcessor({ logger, outputRoot: "/path/to" });

      const sharedRoot = "/elsewhere/facets/knowledge";
      const count = await processor.removeOrphanAiDirs(
        [createMockDir({ dirPath: sharedRoot, ownsDirTree: false, outputRoot: sharedRoot })],
        [],
      );

      expect(count).toBe(0);
      expect(removeDirectory).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        `Refusing to delete "${sharedRoot}": the root "${sharedRoot}" it was found in is not ` +
          'inside "/path/to", the directory this run writes to',
      );
      expect(logger.debug).not.toHaveBeenCalledWith(expect.stringContaining("shared root"));
    });

    it("should refuse a candidate whose relative directory path climbs out", async () => {
      // The half of the root the candidate supplies as a relative path is the
      // one that can climb: a root reached by `..` would otherwise vouch for
      // every directory below wherever it landed.
      const logger = createMockLogger();
      const processor = new TestDirProcessor({ logger, outputRoot: "/path/to" });

      const count = await processor.removeOrphanAiDirs(
        [createMockDir({ dirPath: "/orphan", outputRoot: "/path/to", relativeDirPath: "../.." })],
        [],
      );

      expect(count).toBe(0);
      expect(removeDirectory).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('the root "/" it was found in is not inside "/path/to"'),
      );
    });

    it("should still sweep a real orphan alongside a refused candidate", async () => {
      // Refusing one candidate must not turn `--delete` off for the rest of the
      // run, the same way the shared-root case does not.
      const processor = new TestDirProcessor({
        logger: createMockLogger(),
        outputRoot: "/path/to",
      });

      const count = await processor.removeOrphanAiDirs(
        [
          createMockDir({ dirPath: "/elsewhere/root/orphan", outputRoot: "/elsewhere/root" }),
          createMockDir({ dirPath: "/path/to/orphan" }),
        ],
        [],
      );

      expect(count).toBe(1);
      expect(removeDirectory).toHaveBeenCalledExactlyOnceWith("/path/to/orphan");
    });

    it("should not remove any dirs when all existing dirs are in generated", async () => {
      const processor = new TestDirProcessor({
        logger: createMockLogger(),
        outputRoot: "/path/to",
      });

      const existingDirs = [
        createMockDir({ dirPath: "/path/to/dir1" }),
        createMockDir({ dirPath: "/path/to/dir2" }),
      ];

      const generatedDirs = [
        createMockDir({ dirPath: "/path/to/dir1" }),
        createMockDir({ dirPath: "/path/to/dir2" }),
      ];

      const count = await processor.removeOrphanAiDirs(existingDirs, generatedDirs);

      expect(count).toBe(0);
      expect(removeDirectory).not.toHaveBeenCalled();
    });

    it("should remove all dirs when generated is empty", async () => {
      const processor = new TestDirProcessor({
        logger: createMockLogger(),
        outputRoot: "/path/to",
      });

      const existingDirs = [
        createMockDir({ dirPath: "/path/to/dir1" }),
        createMockDir({ dirPath: "/path/to/dir2" }),
      ];

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
        outputRoot: "/path/to",
        dryRun: true,
      });

      const existingDirs = [
        createMockDir({ dirPath: "/path/to/orphan1" }),
        createMockDir({ dirPath: "/path/to/orphan2" }),
        createMockDir({ dirPath: "/path/to/kept" }),
      ];

      const generatedDirs = [createMockDir({ dirPath: "/path/to/kept" })];

      const count = await processor.removeOrphanAiDirs(existingDirs, generatedDirs);

      expect(count).toBe(2);
      expect(removeDirectory).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        '[DRY RUN] Would delete directory: "/path/to/orphan1"',
      );
      expect(logger.info).toHaveBeenCalledWith(
        '[DRY RUN] Would delete directory: "/path/to/orphan2"',
      );
      expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining("kept"));
    });

    it("should never remove a candidate that only points at a shared root", async () => {
      // Regression test for #2777. `TaktSkill` drops `dirName` from
      // `getDirPath()` because takt skills are flat files under a shared root,
      // so every enumerated candidate reports that root. Sweeping it when no
      // skill was generated deleted the root itself, taking hand-authored files
      // in it with it.
      const logger = createMockLogger();
      const processor = new TestDirProcessor({ logger, outputRoot: "/path/to" });

      const sharedRoot = "/path/to/.takt/facets/knowledge";
      const existingDirs = [
        createMockDir({ dirPath: sharedRoot, ownsDirTree: false, outputRoot: sharedRoot }),
        createMockDir({ dirPath: sharedRoot, ownsDirTree: false, outputRoot: sharedRoot }),
      ];

      const count = await processor.removeOrphanAiDirs(existingDirs, []);

      expect(count).toBe(0);
      expect(removeDirectory).not.toHaveBeenCalled();
      expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining(sharedRoot));
      expect(logger.debug).toHaveBeenCalledWith(
        `Skipping orphan sweep for "knowledge": "${sharedRoot}" is a shared root, not a ` +
          "directory of its own",
      );
    });

    it("should still sweep a real orphan alongside a shared-root candidate", async () => {
      // The guard has to work per candidate. Stopping the whole sweep the moment
      // one flat-file tool appears in the list would silently turn `--delete`
      // off for everything else in the same run.
      const processor = new TestDirProcessor({
        logger: createMockLogger(),
        outputRoot: "/path/to",
      });

      const count = await processor.removeOrphanAiDirs(
        [
          createMockDir({
            dirPath: "/path/to/.takt/facets/knowledge",
            ownsDirTree: false,
            outputRoot: "/path/to/.takt/facets/knowledge",
          }),
          createMockDir({ dirPath: "/path/to/orphan" }),
        ],
        [],
      );

      expect(count).toBe(1);
      expect(removeDirectory).toHaveBeenCalledTimes(1);
      expect(removeDirectory).toHaveBeenCalledWith("/path/to/orphan");
    });

    it("should not remove a shared root even in dry-run mode", async () => {
      // The dry-run line is what a user reads to decide whether `--delete` is
      // safe to run, so it must not promise a deletion that must never happen.
      const logger = createMockLogger();
      const processor = new TestDirProcessor({
        logger,
        outputRoot: "/path/to",
        dryRun: true,
      });

      const count = await processor.removeOrphanAiDirs(
        [
          createMockDir({
            dirPath: "/path/to/.takt/facets/knowledge",
            ownsDirTree: false,
            outputRoot: "/path/to/.takt/facets/knowledge",
          }),
        ],
        [],
      );

      expect(count).toBe(0);
      expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining("Would delete"));
    });

    it("should not remove any dirs when existing is empty", async () => {
      const processor = new TestDirProcessor({
        logger: createMockLogger(),
        outputRoot: "/path/to",
      });

      const existingDirs: AiDir[] = [];
      const generatedDirs = [createMockDir({ dirPath: "/path/to/dir1" })];

      await processor.removeOrphanAiDirs(existingDirs, generatedDirs);

      expect(removeDirectory).not.toHaveBeenCalled();
    });
  });

  describe("removeOrphanFilesInAiDirs", () => {
    it("should remove a companion file the run no longer writes", async () => {
      const logger = createMockLogger();
      const processor = new TestDirProcessor({ logger, outputRoot: testDir });
      const dirPath = join(testDir, "demo");
      // Nested beside a companion that is kept, which is the shape #2867
      // reported: a top-level orphan would not exercise the walk's joining of
      // a relative name, nor its normalization to compare against.
      await writeFiles(dirPath, [
        "SKILL.md",
        join("references", "keep.md"),
        join("references", "stale.md"),
      ]);

      const count = await processor.removeOrphanFilesInAiDirs({
        generatedDirs: [
          createMockDirWithFiles({
            dirPath,
            mainFileBody: "body",
            otherFiles: [
              {
                relativeFilePathToDirPath: "references/keep.md",
                fileBuffer: Buffer.from("content"),
              } as unknown as AiDirFile,
            ],
          }),
        ],
        isClaimed: () => false,
      });

      expect(count).toBe(1);
      expect(removeFile).toHaveBeenCalledTimes(1);
      expect(removeFile).toHaveBeenCalledWith(join(dirPath, "references", "stale.md"));
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("should leave hidden files alone", async () => {
      // A hidden name is where a user's own files live -- a `.gitkeep`, a
      // `.env` -- and the sweep cannot tell one from a hidden companion the
      // loader carried, so it keeps every hidden file rather than guess.
      const logger = createMockLogger();
      const processor = new TestDirProcessor({ logger, outputRoot: testDir });
      const dirPath = join(testDir, "demo");
      await writeFiles(dirPath, ["SKILL.md", ".gitkeep"]);

      const count = await processor.removeOrphanFilesInAiDirs({
        generatedDirs: [createMockDirWithFiles({ dirPath, mainFileBody: "body" })],
        isClaimed: () => false,
      });

      expect(count).toBe(0);
      expect(removeFile).not.toHaveBeenCalled();
    });

    it("should report rather than delete in a dry run", async () => {
      const logger = createMockLogger();
      const processor = new TestDirProcessor({ logger, outputRoot: testDir, dryRun: true });
      const dirPath = join(testDir, "demo");
      await writeFiles(dirPath, ["SKILL.md", "stale.md"]);

      const count = await processor.removeOrphanFilesInAiDirs({
        generatedDirs: [createMockDirWithFiles({ dirPath, mainFileBody: "body" })],
        isClaimed: () => false,
      });

      // Counted, because `generate --check` decides from the count whether the
      // tree is up to date, and a stale file means it is not.
      expect(count).toBe(1);
      expect(removeFile).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        `[DRY RUN] Would delete file: ${JSON.stringify(join(dirPath, "stale.md"))}`,
      );
    });

    it("should not sweep a directory the entry does not own", async () => {
      // A tool that flattens into a shared root reports that root here. Its
      // files belong to `removeOrphanFlatFiles`, which sweeps only the ones it
      // can name; everything else under a shared root is somebody else's.
      const logger = createMockLogger();
      const processor = new TestDirProcessor({ logger, outputRoot: testDir });
      const dirPath = join(testDir, "shared");
      await writeFiles(dirPath, ["someone-elses.md"]);

      const count = await processor.removeOrphanFilesInAiDirs({
        // The shape a flattening tool has: the root it was found in is the
        // directory it reports, which is what tells the two cases apart.
        generatedDirs: [
          createMockDir({
            dirPath,
            ownsDirTree: false,
            outputRoot: testDir,
            relativeDirPath: "shared",
          }),
        ],
        isClaimed: () => false,
      });

      expect(count).toBe(0);
      expect(removeFile).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("should refuse a directory outside the root this run writes to", async () => {
      const logger = createMockLogger();
      const processor = new TestDirProcessor({ logger, outputRoot: join(testDir, "elsewhere") });
      const dirPath = join(testDir, "demo");
      await writeFiles(dirPath, ["stale.md"]);

      const count = await processor.removeOrphanFilesInAiDirs({
        generatedDirs: [createMockDirWithFiles({ dirPath })],
        isClaimed: () => false,
      });

      expect(count).toBe(0);
      expect(removeFile).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("Refusing to sweep"));
    });

    it("should keep a file another target in this run wrote", async () => {
      // Several targets write into one shared skills root, and this entry lists
      // only its own files. A sibling's fresh output is not an orphan.
      const logger = createMockLogger();
      const processor = new TestDirProcessor({ logger, outputRoot: testDir });
      const dirPath = join(testDir, "demo");
      const siblingPath = join(dirPath, "SIBLING.md");
      await writeFiles(dirPath, ["SKILL.md", "SIBLING.md", "stale.md"]);

      const count = await processor.removeOrphanFilesInAiDirs({
        generatedDirs: [createMockDirWithFiles({ dirPath, mainFileBody: "body" })],
        isClaimed: (path) => path === siblingPath,
      });

      expect(count).toBe(1);
      expect(removeFile).toHaveBeenCalledTimes(1);
      expect(removeFile).toHaveBeenCalledWith(join(dirPath, "stale.md"));
    });

    it("should leave a hidden directory's contents alone", async () => {
      // Hidden anywhere on the path, not only at the top level: the walk skips
      // a hidden directory whole, so nothing under `.cache/` is considered.
      const logger = createMockLogger();
      const processor = new TestDirProcessor({ logger, outputRoot: testDir });
      const dirPath = join(testDir, "demo");
      await writeFiles(dirPath, ["SKILL.md", join(".cache", "note.md")]);

      const count = await processor.removeOrphanFilesInAiDirs({
        generatedDirs: [createMockDirWithFiles({ dirPath, mainFileBody: "body" })],
        isClaimed: () => false,
      });

      expect(count).toBe(0);
      expect(removeFile).not.toHaveBeenCalled();
    });

    it.skipIf(process.platform === "win32")(
      "should leave a symbolic link alone rather than unlink it",
      async () => {
        // The writer only ever creates real files, so a link here is the user's.
        // The walk is told not to follow links, and this is what says so: drop
        // that option and the sweep starts unlinking them.
        const logger = createMockLogger();
        const processor = new TestDirProcessor({ logger, outputRoot: testDir });
        const dirPath = join(testDir, "demo");
        const outsidePath = join(testDir, "outside.md");
        await writeFiles(dirPath, ["SKILL.md"]);
        await writeFiles(testDir, ["outside.md"]);
        await symlink(outsidePath, join(dirPath, "link.md"));

        const count = await processor.removeOrphanFilesInAiDirs({
          generatedDirs: [createMockDirWithFiles({ dirPath, mainFileBody: "body" })],
          isClaimed: () => false,
        });

        expect(count).toBe(0);
        expect(removeFile).not.toHaveBeenCalled();
      },
    );

    it.skipIf(process.platform === "win32")(
      "should refuse a generated directory that is itself a symbolic link",
      async () => {
        // A skill directory linked to a checkout elsewhere. Its files read back
        // through the link, and so would every unlink: nothing this run wrote is
        // there, and everything there is somebody else's. The link's target is
        // beside the point — one that stays inside the root is refused all the
        // same, since the lexical verdict above never saw the link at all.
        const logger = createMockLogger();
        const processor = new TestDirProcessor({ logger, outputRoot: testDir });
        const linkedDir = join(testDir, "vendored");
        await writeFiles(linkedDir, ["precious.md", join("sub", "nested.md")]);
        const dirPath = join(testDir, "demo");
        await symlink(linkedDir, dirPath, "dir");

        const count = await processor.removeOrphanFilesInAiDirs({
          generatedDirs: [createMockDirWithFiles({ dirPath, mainFileBody: "body" })],
          isClaimed: () => false,
        });

        expect(count).toBe(0);
        expect(removeFile).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringMatching(/Refusing to sweep .*symbolic link/),
        );
      },
    );

    it.skipIf(process.platform === "win32")(
      "should not descend into a symlinked directory",
      async () => {
        // The deletion that matters: a link to a directory outside the tree must
        // not turn into a sweep of that directory's files.
        const logger = createMockLogger();
        const processor = new TestDirProcessor({ logger, outputRoot: testDir });
        const dirPath = join(testDir, "demo");
        const outsideDirPath = join(testDir, "outside");
        await writeFiles(dirPath, ["SKILL.md"]);
        await writeFiles(outsideDirPath, ["private.md"]);
        await symlink(outsideDirPath, join(dirPath, "linked"));

        const count = await processor.removeOrphanFilesInAiDirs({
          generatedDirs: [createMockDirWithFiles({ dirPath, mainFileBody: "body" })],
          isClaimed: () => false,
        });

        expect(count).toBe(0);
        expect(removeFile).not.toHaveBeenCalled();
      },
    );

    it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
      "should refuse a directory it cannot read rather than fail the run",
      async () => {
        // Every file has been written by the time the sweep runs. A subtree
        // the current user cannot list is a warning and a refusal, as it is on
        // the source side, not an exception out of `generate`.
        const logger = createMockLogger();
        const processor = new TestDirProcessor({ logger, outputRoot: testDir });
        const dirPath = join(testDir, "demo");
        await writeFiles(dirPath, ["SKILL.md", "stale.md", join("locked", "inner.md")]);
        const lockedDir = join(dirPath, "locked");
        await chmod(lockedDir, 0o000);

        try {
          const count = await processor.removeOrphanFilesInAiDirs({
            generatedDirs: [createMockDirWithFiles({ dirPath, mainFileBody: "body" })],
            isClaimed: () => false,
          });

          expect(count).toBe(0);
          expect(removeFile).not.toHaveBeenCalled();
          expect(logger.warn).toHaveBeenCalledWith(
            expect.stringMatching(/Refusing to sweep .*locked/),
          );
        } finally {
          await chmod(lockedDir, 0o755);
        }
      },
    );

    it("should refuse a file whose name differs from a generated one only in case", async () => {
      // On a case-insensitive filesystem the two names are one file — the very
      // file this run wrote — so the sweep says why it is standing down rather
      // than leaving a real stale `Ref.md` to survive in silence.
      const logger = createMockLogger();
      const processor = new TestDirProcessor({ logger, outputRoot: testDir });
      const dirPath = join(testDir, "demo");
      await writeFiles(dirPath, ["SKILL.md", "Ref.md"]);

      const count = await processor.removeOrphanFilesInAiDirs({
        generatedDirs: [
          createMockDirWithFiles({
            dirPath,
            mainFileBody: "body",
            otherFiles: [
              {
                relativeFilePathToDirPath: "ref.md",
                fileBuffer: Buffer.from("content"),
              } as unknown as AiDirFile,
            ],
          }),
        ],
        isClaimed: () => false,
      });

      expect(count).toBe(0);
      expect(removeFile).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("differs from it only in case"),
      );
    });

    it("should report a candidate that owns no tree and is not a shared root either", async () => {
      // A `getDirPath()` override out of agreement with `ownsDirTree()`. The
      // directory sweep reports that shape rather than passing it over, and so
      // does this one.
      const logger = createMockLogger();
      const processor = new TestDirProcessor({ logger, outputRoot: testDir });
      const dirPath = join(testDir, "demo");
      await writeFiles(dirPath, ["stale.md"]);

      const count = await processor.removeOrphanFilesInAiDirs({
        generatedDirs: [createMockDir({ dirPath, ownsDirTree: false })],
        isClaimed: () => false,
      });

      expect(count).toBe(0);
      expect(removeFile).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("it does not own that directory"),
      );
    });

    it("should report a candidate that owns a directory outside the root it reports", async () => {
      // `ownsDirTree()` agrees, but the directory it names is not under the
      // root the candidate says it was found in. Sweeping it would walk a tree
      // this run has no claim over, so the sweep reports the shape instead.
      const logger = createMockLogger();
      const processor = new TestDirProcessor({ logger, outputRoot: testDir });
      const dirPath = join(testDir, "demo");
      await writeFiles(dirPath, ["stale.md"]);

      const count = await processor.removeOrphanFilesInAiDirs({
        generatedDirs: [createMockDir({ dirPath, outputRoot: testDir, relativeDirPath: "root" })],
        isClaimed: () => false,
      });

      expect(count).toBe(0);
      expect(removeFile).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("it is not a directory inside"),
      );
    });

    it("should sweep nothing when this run could not read its sources in full", async () => {
      // A companion file that would not open is dropped with a warning, and the
      // run carries on. Its generated copy then looks exactly like a file whose
      // source was deleted, so the whole sweep stands down rather than guess.
      const logger = createMockLogger();
      const processor = new TestDirProcessor({ logger, outputRoot: testDir });
      const dirPath = join(testDir, "demo");
      await writeFiles(dirPath, ["SKILL.md", "stale.md"]);
      recordIncompleteCarriedFiles();

      const count = await processor.removeOrphanFilesInAiDirs({
        generatedDirs: [createMockDirWithFiles({ dirPath, mainFileBody: "body" })],
        isClaimed: () => false,
      });

      expect(count).toBe(0);
      expect(removeFile).not.toHaveBeenCalled();
    });
  });

  describe("removeOrphanFlatFiles", () => {
    const root = "/path/to/.takt/facets/knowledge";

    it("should remove a flat file no source produces and keep the generated one", async () => {
      const logger = createMockLogger();
      const processor = new TestDirProcessor({ logger, outputRoot: "/path/to" });

      const count = await processor.removeOrphanFlatFiles({
        existingFlatFiles: [
          createMockFlatDir({ root, fileName: "stale.md" }),
          createMockFlatDir({ root, fileName: "kept.md" }),
        ],
        generatedDirs: [createMockFlatDir({ root, fileName: "kept.md" })],
      });

      expect(count).toBe(1);
      expect(removeFile).toHaveBeenCalledExactlyOnceWith(join(root, "stale.md"));
      expect(logger.info).toHaveBeenCalledWith(
        `Deleted file: ${JSON.stringify(join(root, "stale.md"))}`,
      );
      // The root itself, and everything else in it, is left alone.
      expect(removeDirectory).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("should keep a companion file this run wrote into the same root", async () => {
      const processor = new TestDirProcessor({
        logger: createMockLogger(),
        outputRoot: "/path/to",
      });

      const count = await processor.removeOrphanFlatFiles({
        // A companion lands beside the skill's own file, directly in the
        // shared root, and is as much a file of this run as the main one.
        existingFlatFiles: [createMockFlatDir({ root, fileName: "reference.md" })],
        generatedDirs: [
          createMockFlatDir({
            root,
            fileName: "kept.md",
            otherFiles: [
              {
                relativeFilePathToDirPath: "reference.md",
                fileBuffer: Buffer.from(""),
              } as unknown as AiDirFile,
            ],
          }),
        ],
      });

      expect(count).toBe(0);
      expect(removeFile).not.toHaveBeenCalled();
    });

    it("should sweep nothing in a root this run wrote no file into", async () => {
      const logger = createMockLogger();
      const processor = new TestDirProcessor({ logger, outputRoot: "/path/to" });

      const count = await processor.removeOrphanFlatFiles({
        existingFlatFiles: [createMockFlatDir({ root, fileName: "handwritten.md" })],
        // Nothing was generated into that root: no source targets the tool, or
        // its sources are all gone. A root with no source behind it is not one
        // whose every file has gone orphan.
        generatedDirs: [],
      });

      expect(count).toBe(0);
      expect(removeFile).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining("this run wrote no file into that shared root"),
      );
    });

    it("should refuse a file a generated path differs from only in case", async () => {
      const logger = createMockLogger();
      const processor = new TestDirProcessor({ logger, outputRoot: "/path/to" });

      const count = await processor.removeOrphanFlatFiles({
        // What a rename from `Runbook` to `runbook` leaves behind on a
        // case-insensitive filesystem: the write lands in the entry that is
        // still spelled `Runbook.md`, so the file the run just wrote is the
        // one the enumeration reads back.
        existingFlatFiles: [
          createMockFlatDir({ root, fileName: "Runbook.md" }),
          createMockFlatDir({ root, fileName: "stale.md" }),
        ],
        generatedDirs: [createMockFlatDir({ root, fileName: "runbook.md" })],
      });

      expect(count).toBe(1);
      expect(removeFile).toHaveBeenCalledExactlyOnceWith(join(root, "stale.md"));
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("differs from it only in case"),
      );
    });

    it("should delete a file two candidates report once", async () => {
      const processor = new TestDirProcessor({
        logger: createMockLogger(),
        outputRoot: "/path/to",
      });

      const count = await processor.removeOrphanFlatFiles({
        existingFlatFiles: [
          createMockFlatDir({ root, fileName: "stale.md" }),
          createMockFlatDir({ root, fileName: "stale.md" }),
        ],
        generatedDirs: [createMockFlatDir({ root, fileName: "kept.md" })],
      });

      expect(count).toBe(1);
      expect(removeFile).toHaveBeenCalledExactlyOnceWith(join(root, "stale.md"));
    });

    it("should report a deletion without making it on a dry run", async () => {
      const logger = createMockLogger();
      const processor = new TestDirProcessor({ logger, outputRoot: "/path/to", dryRun: true });

      const count = await processor.removeOrphanFlatFiles({
        existingFlatFiles: [createMockFlatDir({ root, fileName: "stale.md" })],
        generatedDirs: [createMockFlatDir({ root, fileName: "kept.md" })],
      });

      expect(count).toBe(1);
      expect(removeFile).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        `[DRY RUN] Would delete file: ${JSON.stringify(join(root, "stale.md"))}`,
      );
    });

    it("should refuse a candidate that names no file", async () => {
      const logger = createMockLogger();
      const processor = new TestDirProcessor({ logger, outputRoot: "/path/to" });

      const count = await processor.removeOrphanFlatFiles({
        existingFlatFiles: [createMockFlatDir({ root, fileName: "stale.md", flatFilePath: null })],
        generatedDirs: [createMockFlatDir({ root, fileName: "kept.md" })],
      });

      expect(count).toBe(0);
      expect(removeFile).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("names no file directly under the root it was found in"),
      );
    });

    it("should refuse a candidate whose root is outside the directory this run writes to", async () => {
      const logger = createMockLogger();
      const processor = new TestDirProcessor({ logger, outputRoot: "/path/to" });

      const count = await processor.removeOrphanFlatFiles({
        existingFlatFiles: [
          createMockFlatDir({ root: "/elsewhere/knowledge", fileName: "stale.md" }),
        ],
        generatedDirs: [createMockFlatDir({ root, fileName: "kept.md" })],
      });

      expect(count).toBe(0);
      expect(removeFile).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('is not inside "/path/to", the directory this run writes to'),
      );
    });

    it("should refuse a candidate reporting a directory other than the root it was found in", async () => {
      const logger = createMockLogger();
      const processor = new TestDirProcessor({ logger, outputRoot: "/path/to" });

      const count = await processor.removeOrphanFlatFiles({
        // A `getDirPath()` override this sweep was never told about: the file
        // it names is not the one the root was enumerated for.
        existingFlatFiles: [
          createMockFlatDir({ root, fileName: "stale.md", dirPath: join(root, "nested") }),
        ],
        generatedDirs: [createMockFlatDir({ root, fileName: "kept.md" })],
      });

      expect(count).toBe(0);
      expect(removeFile).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("it is not directly inside"),
      );
    });

    it("should refuse a candidate naming a file outside the root it reports", async () => {
      const logger = createMockLogger();
      const processor = new TestDirProcessor({ logger, outputRoot: "/path/to" });

      const count = await processor.removeOrphanFlatFiles({
        // The root it reports is the one it was enumerated from, and passes
        // the positional check — but the file it names is somewhere else
        // entirely. Only the file is ever deleted, so only the file's own
        // directory settles whether it may be.
        existingFlatFiles: [
          createMockFlatDir({ root, fileName: "stale.md", flatFilePath: "/etc/passwd" }),
        ],
        generatedDirs: [createMockFlatDir({ root, fileName: "kept.md" })],
      });

      expect(count).toBe(0);
      expect(removeFile).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("it is not directly inside"),
      );
    });

    it("should sweep nothing when there are no candidates", async () => {
      const processor = new TestDirProcessor({
        logger: createMockLogger(),
        outputRoot: "/path/to",
      });

      expect(
        await processor.removeOrphanFlatFiles({
          existingFlatFiles: [],
          generatedDirs: [createMockFlatDir({ root, fileName: "a.md" })],
        }),
      ).toBe(0);
      expect(removeFile).not.toHaveBeenCalled();
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

    it("should give a written companion file the executable bit its source has", async () => {
      // A skill's `scripts/*.sh` is copied so the agent can run it the way the
      // skill says. The mode travels with the bytes; a file without one is left
      // to the platform default, as before.
      vi.mocked(readFileContentOrNull).mockResolvedValue(null);
      const processor = new TestDirProcessor({ logger: createMockLogger(), outputRoot: testDir });

      const script: AiDirFile = {
        relativeFilePathToDirPath: "scripts/run.sh",
        fileBuffer: Buffer.from("#!/bin/sh\n"),
        fileMode: 0o755,
      };
      const note: AiDirFile = {
        relativeFilePathToDirPath: "notes.md",
        fileBuffer: Buffer.from("plain\n"),
      };
      const dirs = [
        createMockDirWithFiles({ dirPath: "/path/to/dir1", otherFiles: [script, note] }),
      ];

      await processor.writeAiDirs(dirs);

      expect(applyFileMode).toHaveBeenCalledTimes(1);
      expect(applyFileMode).toHaveBeenCalledWith(join("/path/to/dir1", "scripts/run.sh"), 0o755);
    });

    it("should restore a missing executable bit on an unchanged dir", async () => {
      // The bytes already match, so nothing is rewritten -- but the copy may
      // have been made by a version that never carried the mode.
      vi.mocked(readFileContentOrNull).mockResolvedValue("body1\n");
      vi.mocked(readFileBufferOrNull).mockResolvedValue(Buffer.from("#!/bin/sh\n"));
      const processor = new TestDirProcessor({ logger: createMockLogger(), outputRoot: testDir });

      const script: AiDirFile = {
        relativeFilePathToDirPath: "scripts/run.sh",
        fileBuffer: Buffer.from("#!/bin/sh\n"),
        fileMode: 0o755,
      };
      const dirs = [
        createMockDirWithFiles({
          dirPath: "/path/to/dir1",
          mainFileBody: "body1",
          otherFiles: [script],
        }),
      ];

      const result = await processor.writeAiDirs(dirs);

      expect(result).toEqual({ count: 0, paths: [] });
      expect(writeFileBuffer).not.toHaveBeenCalled();
      expect(restoreMissingExecutableBit).toHaveBeenCalledWith(
        join("/path/to/dir1", "scripts/run.sh"),
        0o755,
      );
    });

    it("should not touch a mode in dry run", async () => {
      vi.mocked(readFileContentOrNull).mockResolvedValue("body1\n");
      vi.mocked(readFileBufferOrNull).mockResolvedValue(Buffer.from("#!/bin/sh\n"));
      const processor = new TestDirProcessor({
        logger: createMockLogger(),
        outputRoot: testDir,
        dryRun: true,
      });

      const script: AiDirFile = {
        relativeFilePathToDirPath: "scripts/run.sh",
        fileBuffer: Buffer.from("#!/bin/sh\n"),
        fileMode: 0o755,
      };
      const dirs = [
        createMockDirWithFiles({
          dirPath: "/path/to/dir1",
          mainFileBody: "body1",
          otherFiles: [script],
        }),
      ];

      await processor.writeAiDirs(dirs);

      expect(restoreMissingExecutableBit).not.toHaveBeenCalled();
      expect(applyFileMode).not.toHaveBeenCalled();
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
});
