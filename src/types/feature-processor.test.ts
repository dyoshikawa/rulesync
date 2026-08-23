import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../constants/rulesync-paths.js";
import { createMockLogger } from "../test-utils/mock-logger.js";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { readFileContentOrNull, removeFile, writeFileContent } from "../utils/file.js";
import { AiFile } from "./ai-file.js";
import {
  FeatureProcessor,
  mergeByCaseInsensitiveIdentity,
  mergeByIdentity,
  pickLastRootWithFile,
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
      const processor = new TestProcessor({ logger: createMockLogger(), outputRoot: testDir });

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
      const processor = new TestProcessor({
        logger: createMockLogger(),
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

    expect(mergeByIdentity(perRoot, (item) => item.id)).toEqual([
      { id: "a", value: "base-a" },
      { id: "b", value: "overlay-b" },
      { id: "c", value: "overlay-c" },
    ]);
  });

  it("returns an empty list when every root is empty", () => {
    expect(mergeByIdentity<{ id: string }>([[], []], (item) => item.id)).toEqual([]);
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

describe("pickLastRootWithFile", () => {
  // `writeFileContent` is mocked at the top of this file, so we drop down to
  // node:fs/promises directly here — we need real files on disk for the
  // real `fileExists` reachable via the `...actual` spread to observe them.
  it("returns the last root that has any of the candidate files", async () => {
    const { mkdir, writeFile } = await import("node:fs/promises");
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
        }),
      ).toBe(rootB);
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
        }),
      ).toBeUndefined();
    } finally {
      await cleanup();
    }
  });
});
