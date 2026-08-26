import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../constants/rulesync-paths.js";
import { createMockLogger } from "../test-utils/mock-logger.js";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { readFileContentOrNull, removeFile, writeFileContent } from "../utils/file.js";
import { AiFile } from "./ai-file.js";
import {
  ClaimedIdentities,
  FeatureProcessor,
  formatCuratedCaseCollisionWarning,
  groupSpellingsByCaseFoldedIdentity,
  mergeByCaseInsensitiveIdentity,
  mergeByIdentity,
  pickLastRootWithFile,
  resetRootShadowingWarnings,
} from "./feature-processor.js";
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

/**
 * Minimal `AiFile` stand-in. `shouldSkipCreationWhenPayloadEmpty` deliberately
 * delegates to the real `AiFile.prototype` implementation (which keys off the
 * relative path), so these tests exercise the production predicate rather than a
 * hand-written stub.
 */
function createMockFile(
  filePath: string,
  { fileContent = "content" }: { fileContent?: string } = {},
): AiFile {
  const file = {
    getFilePath: () => filePath,
    getFileContent: () => fileContent,
    getRelativePathFromCwd: () => filePath,
    // Declared on the AiFile base class; defaults to false for non-merging files.
    shouldMergeExistingFileContent: () => false,
    shouldSkipCreationWhenPayloadEmpty: () =>
      AiFile.prototype.shouldSkipCreationWhenPayloadEmpty.call(file),
  } as AiFile;
  return file;
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
      const logger = createMockLogger();
      const processor = new TestProcessor({ logger, outputRoot: testDir });

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
      // A real `--delete` run has to say what it deleted: a file swept from a
      // directory rulesync shares with another vendor would otherwise disappear
      // without a trace.
      expect(logger.info).toHaveBeenCalledWith("Deleted: /path/to/orphan1.md");
      expect(logger.info).toHaveBeenCalledWith("Deleted: /path/to/orphan2.md");
      expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining("kept.md"));
    });

    it("should strip control characters from the deletion log", async () => {
      const logger = createMockLogger();
      const processor = new TestProcessor({ logger, outputRoot: testDir });

      // The path is an on-disk name rulesync did not choose, so a name carrying
      // `\x1b[2K\r` must not be able to rewrite the line and hide the deletion.
      const existingFiles = [createMockFile("/path/to/\u001b[2K\r-innocent.md")];

      const count = await processor.removeOrphanAiFiles(existingFiles, []);

      expect(count).toBe(1);
      expect(logger.info).toHaveBeenCalledWith("Deleted: /path/to/[2K-innocent.md");
    });

    it("should not remove any files when all existing files are in generated", async () => {
      const processor = new TestProcessor({ logger: createMockLogger(), outputRoot: testDir });

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
      const processor = new TestProcessor({ logger: createMockLogger(), outputRoot: testDir });

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
      const logger = createMockLogger();
      const processor = new TestProcessor({
        logger,
        outputRoot: testDir,
        dryRun: true,
      });

      const existingFiles = [
        createMockFile("/path/to/orphan1.md"),
        createMockFile("/path/to/orphan2.md"),
        createMockFile("/path/to/kept.md"),
      ];

      const generatedFiles = [createMockFile("/path/to/kept.md")];

      const count = await processor.removeOrphanAiFiles(existingFiles, generatedFiles);

      expect(count).toBe(2);
      expect(removeFile).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith("[DRY RUN] Would delete: /path/to/orphan1.md");
      expect(logger.info).toHaveBeenCalledWith("[DRY RUN] Would delete: /path/to/orphan2.md");
      expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining("kept.md"));
    });

    it("should not remove any files when existing is empty", async () => {
      const processor = new TestProcessor({ logger: createMockLogger(), outputRoot: testDir });

      const existingFiles: AiFile[] = [];
      const generatedFiles = [createMockFile("/path/to/file1.md")];

      await processor.removeOrphanAiFiles(existingFiles, generatedFiles);

      expect(removeFile).not.toHaveBeenCalled();
    });
  });

  describe("writeAiFiles", () => {
    it("should write all files and return count when files are new", async () => {
      vi.mocked(readFileContentOrNull).mockResolvedValue(null);
      const processor = new TestProcessor({ logger: createMockLogger(), outputRoot: testDir });

      const files = [createMockFile("/path/to/file1.md"), createMockFile("/path/to/file2.md")];

      const result = await processor.writeAiFiles(files);

      expect(result).toEqual({ count: 2, paths: ["/path/to/file1.md", "/path/to/file2.md"] });
      expect(writeFileContent).toHaveBeenCalledTimes(2);
    });

    it("should skip unchanged files and return 0", async () => {
      vi.mocked(readFileContentOrNull).mockResolvedValue("content\n");
      const processor = new TestProcessor({ logger: createMockLogger(), outputRoot: testDir });

      const files = [createMockFile("/path/to/file1.md"), createMockFile("/path/to/file2.md")];

      const result = await processor.writeAiFiles(files);

      expect(result).toEqual({ count: 0, paths: [] });
      expect(writeFileContent).not.toHaveBeenCalled();
    });

    it("should only write changed files and return changed count", async () => {
      vi.mocked(readFileContentOrNull)
        .mockResolvedValueOnce("content\n") // file1: unchanged
        .mockResolvedValueOnce(null); // file2: new
      const processor = new TestProcessor({ logger: createMockLogger(), outputRoot: testDir });

      const files = [createMockFile("/path/to/file1.md"), createMockFile("/path/to/file2.md")];

      const result = await processor.writeAiFiles(files);

      expect(result).toEqual({ count: 1, paths: ["/path/to/file2.md"] });
      expect(writeFileContent).toHaveBeenCalledTimes(1);
    });

    it("should return changed count without writing files in dry-run mode", async () => {
      vi.mocked(readFileContentOrNull).mockResolvedValue(null);
      const processor = new TestProcessor({
        logger: createMockLogger(),
        outputRoot: testDir,
        dryRun: true,
      });

      const files = [createMockFile("/path/to/file1.md"), createMockFile("/path/to/file2.md")];

      const result = await processor.writeAiFiles(files);

      expect(result).toEqual({ count: 2, paths: ["/path/to/file1.md", "/path/to/file2.md"] });
      expect(writeFileContent).not.toHaveBeenCalled();
    });

    it("should strip control characters from the dry-run write log", async () => {
      vi.mocked(readFileContentOrNull).mockResolvedValue(null);
      const logger = createMockLogger();
      const processor = new TestProcessor({ logger, outputRoot: testDir, dryRun: true });

      // Dry-run output is what a user reads to see what a run would do, and the
      // name comes from a `.rulesync/**` file `rulesync fetch` may have supplied.
      const files = [createMockFile("/path/to/\u001b[2K\r-innocent.md")];

      await processor.writeAiFiles(files);

      expect(logger.info).toHaveBeenCalledWith("[DRY RUN] Would write: /path/to/[2K-innocent.md");
    });

    it("should not create a missing shared config file when the payload is empty", async () => {
      vi.mocked(readFileContentOrNull).mockResolvedValue(null);
      const processor = new TestProcessor({ logger: createMockLogger(), outputRoot: testDir });

      const files = [
        createMockFile(".antigravity/settings.json", { fileContent: "{}" }),
        createMockFile(".devin/config.json", {
          fileContent: JSON.stringify({ mcpServers: {}, permissions: {} }),
        }),
      ];

      const result = await processor.writeAiFiles(files);

      expect(result).toEqual({ count: 0, paths: [] });
      expect(writeFileContent).not.toHaveBeenCalled();
    });

    it("should still create a missing shared config file when the payload has content", async () => {
      vi.mocked(readFileContentOrNull).mockResolvedValue(null);
      const processor = new TestProcessor({ logger: createMockLogger(), outputRoot: testDir });

      const files = [
        createMockFile(".antigravity/settings.json", {
          fileContent: JSON.stringify({ permissions: { allow: ["read"] } }),
        }),
      ];

      const result = await processor.writeAiFiles(files);

      expect(result).toEqual({ count: 1, paths: [".antigravity/settings.json"] });
      expect(writeFileContent).toHaveBeenCalledTimes(1);
    });

    it("should still write an empty payload into a shared config file that already exists", async () => {
      vi.mocked(readFileContentOrNull).mockResolvedValue(
        JSON.stringify({ permissions: { allow: ["read"] } }),
      );
      const processor = new TestProcessor({ logger: createMockLogger(), outputRoot: testDir });

      const files = [createMockFile(".antigravity/settings.json", { fileContent: "{}" })];

      const result = await processor.writeAiFiles(files);

      expect(result).toEqual({ count: 1, paths: [".antigravity/settings.json"] });
      expect(writeFileContent).toHaveBeenCalledTimes(1);
    });

    it("should create a missing rulesync-owned file even when the payload is empty", async () => {
      vi.mocked(readFileContentOrNull).mockResolvedValue(null);
      const processor = new TestProcessor({ logger: createMockLogger(), outputRoot: testDir });

      // `.agents/hooks.json` is owned wholesale by rulesync, so its existence is
      // part of what generation produces even when it holds no hooks.
      const files = [createMockFile(".agents/hooks.json", { fileContent: "{}" })];

      const result = await processor.writeAiFiles(files);

      expect(result).toEqual({ count: 1, paths: [".agents/hooks.json"] });
      expect(writeFileContent).toHaveBeenCalledTimes(1);
    });
  });

  describe("removeAiFiles", () => {
    it("should remove all files", async () => {
      const processor = new TestProcessor({ logger: createMockLogger(), outputRoot: testDir });

      const files = [createMockFile("/path/to/file1.md"), createMockFile("/path/to/file2.md")];

      await processor.removeAiFiles(files);

      expect(removeFile).toHaveBeenCalledTimes(2);
      expect(removeFile).toHaveBeenCalledWith("/path/to/file1.md");
      expect(removeFile).toHaveBeenCalledWith("/path/to/file2.md");
    });
  });
});

describe("FeatureProcessor inputRoots default", () => {
  // `TestProcessor` re-exposes the protected `inputRoots` so we can assert
  // the base-class constructor's normalization directly. The singular
  // `inputRoot` alias is deliberately absent — it's collapsed to a
  // one-element `inputRoots` at the outer input surface (config
  // schema/resolver + CLI/programmatic API), and every internal consumer,
  // this base class included, only ever sees the plural form.
  class ProbeProcessor extends TestProcessor {
    getInputRoots(): readonly [string, ...string[]] {
      return this.inputRoots;
    }
  }

  it("stores the passed inputRoots verbatim (order preserved)", () => {
    const processor = new ProbeProcessor({
      logger: createMockLogger(),
      outputRoot: "/out",
      inputRoots: ["/a", "/b", "/c"],
    });
    expect(processor.getInputRoots()).toEqual(["/a", "/b", "/c"]);
  });

  it("falls back to [join(process.cwd(), '.rulesync')] when inputRoots is omitted", () => {
    const processor = new ProbeProcessor({
      logger: createMockLogger(),
      outputRoot: "/out",
    });
    expect(processor.getInputRoots()).toEqual([join(process.cwd(), RULESYNC_RELATIVE_DIR_PATH)]);
  });

  it("falls back to [join(process.cwd(), '.rulesync')] when inputRoots is an empty list", () => {
    const processor = new ProbeProcessor({
      logger: createMockLogger(),
      outputRoot: "/out",
      inputRoots: [],
    });
    expect(processor.getInputRoots()).toEqual([join(process.cwd(), RULESYNC_RELATIVE_DIR_PATH)]);
  });
});

describe("mergeByIdentity", () => {
  it("keeps later entries for the same identity while preserving first-appearance order", () => {
    const perRoot = [
      [
        { id: "a", value: "base-a" },
        { id: "b", value: "base-b" },
      ],
      [
        { id: "b", value: "overlay-b" },
        { id: "c", value: "overlay-c" },
      ],
    ];

    expect(mergeByIdentity({ perRoot, identity: (item) => item.id })).toEqual([
      { id: "a", value: "base-a" },
      { id: "b", value: "overlay-b" },
      { id: "c", value: "overlay-c" },
    ]);
  });

  it("returns an empty list when every root is empty", () => {
    expect(
      mergeByIdentity<{ id: string }>({
        perRoot: [[], []],
        identity: (item) => item.id,
      }),
    ).toEqual([]);
  });
});

describe("mergeByCaseInsensitiveIdentity", () => {
  it("warns when distinct casing collapses to one identity", () => {
    const logger = createMockLogger();
    const result = mergeByCaseInsensitiveIdentity({
      perRoot: [[{ id: "Review.md", value: "base" }], [{ id: "review.md", value: "overlay" }]],
      identity: (item) => item.id,
      artifactName: "rule",
      logger,
    });

    expect(result).toEqual([{ id: "review.md", value: "overlay" }]);
    expect(logger.warn).toHaveBeenCalledWith(
      "Case-insensitive rule collision: 'Review.md' and 'review.md' resolve to the same identity. The later entry wins.",
    );
  });

  it("does not warn for exact-name overlays", () => {
    const logger = createMockLogger();

    mergeByCaseInsensitiveIdentity({
      perRoot: [[{ id: "review.md" }], [{ id: "review.md" }]],
      identity: (item) => item.id,
      artifactName: "rule",
      logger,
    });

    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe("ClaimedIdentities", () => {
  it("returns null for an identity nothing claimed yet", () => {
    const claimed = new ClaimedIdentities();

    expect(claimed.claim({ identity: "review", source: ".junie/skills" })).toBeNull();
    expect(claimed.claim({ identity: "plan", source: ".junie/skills" })).toBeNull();
  });

  it("returns the standing claim for an exact repeat", () => {
    const claimed = new ClaimedIdentities();
    claimed.claim({ identity: "review", source: ".junie/skills" });

    expect(claimed.claim({ identity: "review", source: ".agents/skills" })).toEqual({
      spelling: "review",
      source: ".junie/skills",
    });
  });

  it("returns the first spelling for a case-only collision", () => {
    const claimed = new ClaimedIdentities();
    claimed.claim({ identity: "Dup-Skill", source: ".junie/skills" });

    expect(claimed.claim({ identity: "dup-skill", source: ".agents/skills" })?.spelling).toBe(
      "Dup-Skill",
    );
    expect(claimed.claim({ identity: "DUP-SKILL", source: ".agents/skills" })?.spelling).toBe(
      "Dup-Skill",
    );
  });

  it("reports the source that claimed the identity, so a same-source collision is tellable", () => {
    const claimed = new ClaimedIdentities();
    claimed.claim({ identity: "planner", source: ".junie/agents" });

    expect(claimed.claim({ identity: "Planner", source: ".junie/agents" })?.source).toBe(
      ".junie/agents",
    );
    expect(claimed.claim({ identity: "PLANNER", source: ".agents" })?.source).toBe(".junie/agents");
  });

  it("keeps the first spelling rather than the most recent one", () => {
    const claimed = new ClaimedIdentities();

    expect(claimed.claim({ identity: "Review.md", source: "a" })).toBeNull();
    expect(claimed.claim({ identity: "review.md", source: "b" })?.spelling).toBe("Review.md");
    expect(claimed.claim({ identity: "REVIEW.md", source: "c" })?.spelling).toBe("Review.md");
  });

  it("folds the composed and decomposed spellings of an accented name", () => {
    // macOS filesystems are normalization-insensitive as well as case-insensitive,
    // so these two are one directory there.
    // Written as escapes because the two literals are indistinguishable on
    // screen, and a tool that normalized one of them would leave the test
    // green while checking nothing.
    const composed = "caf\u00e9-skill";
    const decomposed = "cafe\u0301-skill";
    expect(composed).not.toBe(decomposed);
    const claimed = new ClaimedIdentities();

    expect(claimed.claim({ identity: composed, source: ".junie/skills" })).toBeNull();
    expect(claimed.claim({ identity: decomposed, source: ".agents/skills" })?.spelling).toBe(
      composed,
    );
  });

  it("treats identities that differ beyond case as distinct", () => {
    const claimed = new ClaimedIdentities();
    claimed.claim({ identity: "review", source: "a" });

    expect(claimed.claim({ identity: "reviewer", source: "a" })).toBeNull();
  });
});

describe("groupSpellingsByCaseFoldedIdentity", () => {
  it("keeps every spelling that folds onto the same identity, in order", () => {
    const grouped = groupSpellingsByCaseFoldedIdentity([
      "shared.md",
      "Shared.md",
      "other.md",
      "SHARED.MD",
    ]);

    expect(grouped.get("shared.md")).toEqual(["shared.md", "Shared.md", "SHARED.MD"]);
    expect(grouped.get("other.md")).toEqual(["other.md"]);
  });

  it("folds NFD spellings onto their NFC identity", () => {
    // macOS hands back decomposed filenames, so the same name typed on Linux
    // must land in the same group.
    const grouped = groupSpellingsByCaseFoldedIdentity(["caf\u00e9.md", "cafe\u0301.md"]);

    expect(grouped.size).toBe(1);
    expect(grouped.get("caf\u00e9.md".normalize("NFC"))).toEqual(["caf\u00e9.md", "cafe\u0301.md"]);
  });
});

describe("formatCuratedCaseCollisionWarning", () => {
  it("names the last local spelling as the winner and lists the rest", () => {
    // The last spelling wins because `mergeByCaseInsensitiveIdentity` keeps the
    // later entry, so the message must never point at one that loses.
    const message = formatCuratedCaseCollisionWarning({
      artifactKind: "rule",
      entryNoun: "file",
      treeDirPath: ".rulesync/rules",
      curatedSpelling: ".curated/shared.md",
      localSpellings: ["SHARED.MD", "Shared.md", "shared.md"],
    });

    expect(message).toBe(
      "Case-insensitive rule collision under .rulesync/rules: curated '.curated/shared.md' and " +
        "local 'shared.md' resolve to the same identity. The local file wins and the curated file " +
        "is skipped. Other local spellings that fold onto the same identity: 'SHARED.MD', " +
        "'Shared.md'.",
    );
  });

  it("omits the extra-spellings sentence when there is only one local spelling", () => {
    const message = formatCuratedCaseCollisionWarning({
      artifactKind: "skill",
      entryNoun: "skill",
      treeDirPath: ".rulesync/skills",
      curatedSpelling: "shared-skill",
      localSpellings: ["Shared-Skill"],
    });

    expect(message).toBe(
      "Case-insensitive skill collision under .rulesync/skills: curated 'shared-skill' and local " +
        "'Shared-Skill' resolve to the same identity. The local skill wins and the curated skill " +
        "is skipped.",
    );
  });

  it("strips control characters from every untrusted segment", () => {
    // `.curated/` names come from an external Git repository or npm package,
    // and the tree path comes from a config file that can be committed, so an
    // escape sequence must not reach the terminal from any of them.
    const eraseLine = "\u001b[2K";
    const message = formatCuratedCaseCollisionWarning({
      artifactKind: "rule",
      entryNoun: "file",
      treeDirPath: `.rulesync${eraseLine}/rules`,
      curatedSpelling: `.curated/${eraseLine}shared.md`,
      localSpellings: [`${eraseLine}SHARED.md`, "Shared.md"],
    });

    expect(message).not.toContain("\u001b");
  });
});

describe("pickLastRootWithFile", () => {
  // `writeFileContent` is mocked at the top of this file, so these cases use
  // the statically imported node:fs/promises helpers instead — we need real
  // files on disk for the real `fileExists` reachable via the `...actual`
  // spread to observe them.
  it("returns the last root that has any of the candidate files", async () => {
    const { testDir: root, cleanup } = await setupTestDirectory();
    try {
      const rootA = `${root}/a`;
      const rootB = `${root}/b`;
      const rootC = `${root}/c`;
      await mkdir(rootA, { recursive: true });
      await mkdir(rootB, { recursive: true });
      await mkdir(rootC, { recursive: true });
      await writeFile(`${rootA}/mcp.jsonc`, "{}");
      await writeFile(`${rootB}/mcp.jsonc`, "{}");

      expect(
        await pickLastRootWithFile({
          inputRoots: [rootA, rootB, rootC],
          relativePaths: ["mcp.jsonc"],
          logger: createMockLogger(),
          artifactName: "The hooks file",
        }),
      ).toBe(rootB);
    } finally {
      await cleanup();
    }
  });

  it("logs which root replaced which when several roots provide the file", async () => {
    const { testDir: root, cleanup } = await setupTestDirectory();
    try {
      const rootA = `${root}/a`;
      const rootB = `${root}/b`;
      await mkdir(rootA, { recursive: true });
      await mkdir(rootB, { recursive: true });
      await writeFile(`${rootA}/mcp.jsonc`, "{}");
      await writeFile(`${rootB}/mcp.jsonc`, "{}");
      const logger = createMockLogger();

      await pickLastRootWithFile({
        inputRoots: [rootA, rootB],
        relativePaths: ["mcp.jsonc"],
        logger,
        artifactName: "The hooks file",
      });

      expect(logger.warn).toHaveBeenCalledWith(
        `The hooks file is provided by more than one input root; '${rootB}' replaces the whole file from '${rootA}'.`,
      );
    } finally {
      await cleanup();
    }
  });

  it("logs the same shadowing only once per logger", async () => {
    // `generate` builds one single-file processor per tool target and per
    // output root, and every one of them re-resolves the same roots, so the
    // warning must not be repeated for each target.
    const { testDir: root, cleanup } = await setupTestDirectory();
    try {
      const rootA = `${root}/a`;
      const rootB = `${root}/b`;
      await mkdir(rootA, { recursive: true });
      await mkdir(rootB, { recursive: true });
      await writeFile(`${rootA}/mcp.jsonc`, "{}");
      await writeFile(`${rootB}/mcp.jsonc`, "{}");
      const logger = createMockLogger();

      for (let i = 0; i < 3; i++) {
        await pickLastRootWithFile({
          inputRoots: [rootA, rootB],
          relativePaths: ["mcp.jsonc"],
          logger,
          artifactName: "The hooks file",
        });
      }

      expect(logger.warn).toHaveBeenCalledTimes(1);

      // A different run gets a fresh logger, so it is told about it again.
      const nextLogger = createMockLogger();
      await pickLastRootWithFile({
        inputRoots: [rootA, rootB],
        relativePaths: ["mcp.jsonc"],
        logger: nextLogger,
        artifactName: "The hooks file",
      });

      expect(nextLogger.warn).toHaveBeenCalledTimes(1);
    } finally {
      await cleanup();
    }
  });

  it("logs the shadowing again after the suppression is reset for the run", async () => {
    // `--watch` reuses one logger for every regeneration, so `generate` resets
    // the suppression per run to keep reporting the replacement.
    const { testDir: root, cleanup } = await setupTestDirectory();
    try {
      const rootA = `${root}/a`;
      const rootB = `${root}/b`;
      await mkdir(rootA, { recursive: true });
      await mkdir(rootB, { recursive: true });
      await writeFile(`${rootA}/mcp.jsonc`, "{}");
      await writeFile(`${rootB}/mcp.jsonc`, "{}");
      const logger = createMockLogger();

      const pick = () =>
        pickLastRootWithFile({
          inputRoots: [rootA, rootB],
          relativePaths: ["mcp.jsonc"],
          logger,
          artifactName: "The hooks file",
        });

      await pick();
      await pick();
      expect(logger.warn).toHaveBeenCalledTimes(1);

      resetRootShadowingWarnings({ logger });
      await pick();

      expect(logger.warn).toHaveBeenCalledTimes(2);
    } finally {
      await cleanup();
    }
  });

  it("does not log when only one root provides the file", async () => {
    const { testDir: root, cleanup } = await setupTestDirectory();
    try {
      const rootA = `${root}/a`;
      await mkdir(rootA, { recursive: true });
      await writeFile(`${rootA}/mcp.jsonc`, "{}");
      const logger = createMockLogger();

      await pickLastRootWithFile({
        inputRoots: [rootA, `${root}/b`],
        relativePaths: ["mcp.jsonc"],
        logger,
        artifactName: "The hooks file",
      });

      expect(logger.warn).not.toHaveBeenCalled();
    } finally {
      await cleanup();
    }
  });

  it("returns undefined when no root has any candidate", async () => {
    const { testDir: root, cleanup } = await setupTestDirectory();
    try {
      expect(
        await pickLastRootWithFile({
          inputRoots: [`${root}/a`, `${root}/b`],
          relativePaths: ["mcp.jsonc"],
          logger: createMockLogger(),
          artifactName: "The hooks file",
        }),
      ).toBeUndefined();
    } finally {
      await cleanup();
    }
  });
});
