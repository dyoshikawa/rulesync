import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_SOURCES_RELATIVE_DIR_PATH } from "../constants/rulesync-paths.js";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { directoryExists, ensureDir, removeDirectory, writeFileContent } from "../utils/file.js";
import { resolveAndFetchSources } from "./sources.js";

let mockClientInstance: any;

vi.mock("./github-client.js", () => ({
  GitHubClient: class MockGitHubClient {
    static resolveToken = vi.fn().mockReturnValue(undefined);

    getDefaultBranch(...args: any[]) {
      return mockClientInstance.getDefaultBranch(...args);
    }
    listDirectory(...args: any[]) {
      return mockClientInstance.listDirectory(...args);
    }
    getFileContent(...args: any[]) {
      return mockClientInstance.getFileContent(...args);
    }
    resolveRefToSha(...args: any[]) {
      return mockClientInstance.resolveRefToSha(...args);
    }
  },
  GitHubClientError: class GitHubClientError extends Error {
    statusCode?: number;
    constructor(message: string, statusCode?: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
  logGitHubAuthHints: vi.fn(),
}));

vi.mock("../utils/file.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/file.js")>();
  return {
    ...actual,
    directoryExists: vi.fn(),
    ensureDir: vi.fn(),
    removeDirectory: vi.fn(),
    writeFileContent: vi.fn(),
    checkPathTraversal: actual.checkPathTraversal,
  };
});

vi.mock("../utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const { logger } = await vi.importMock<typeof import("../utils/logger.js")>("../utils/logger.js");

vi.mock("./git-client.js", () => ({
  GitClientError: class GitClientError extends Error {
    constructor(message: string, cause?: unknown) {
      super(message);
      this.name = "GitClientError";
      this.cause = cause;
    }
  },
  validateGitUrl: vi.fn(),
  validateRef: vi.fn(),
  checkGitAvailable: vi.fn(),
  resetGitCheck: vi.fn(),
  resolveDefaultRef: vi.fn(),
  resolveRefToSha: vi.fn(),
  fetchSourceCacheFiles: vi.fn(),
}));

vi.mock("./github-utils.js", () => ({
  listDirectoryRecursive: vi.fn().mockResolvedValue([]),
  withSemaphore: vi.fn((_semaphore: any, fn: () => any) => fn()),
}));

vi.mock("./source-cache.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./source-cache.js")>();
  return {
    ...actual,
    sourceKeyToDirName: actual.sourceKeyToDirName,
  };
});

vi.mock("./sources-lock.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./sources-lock.js")>();
  return {
    ...actual,
    readLockFile: vi.fn().mockResolvedValue({ lockfileVersion: 2, sources: {} }),
    writeLockFile: vi.fn().mockResolvedValue(undefined),
  };
});

describe("resolveAndFetchSources", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);

    mockClientInstance = {
      getDefaultBranch: vi.fn().mockResolvedValue("main"),
      resolveRefToSha: vi.fn().mockResolvedValue("abc123def456"),
      listDirectory: vi.fn().mockResolvedValue([]),
      getFileContent: vi.fn().mockResolvedValue("file content"),
    };

    // Default: no source cache dir exists
    vi.mocked(directoryExists).mockResolvedValue(false);
    vi.mocked(removeDirectory).mockResolvedValue(undefined);
    vi.mocked(writeFileContent).mockResolvedValue(undefined);
    vi.mocked(ensureDir).mockResolvedValue(undefined as any);
  });

  afterEach(async () => {
    await cleanup();
    vi.clearAllMocks();
  });

  it("should return zero counts with empty sources", async () => {
    const result = await resolveAndFetchSources({
      sources: [],
      baseDir: testDir,
    });

    expect(result).toEqual({ fetchedFileCount: 0, sourcesProcessed: 0 });
  });

  it("should skip fetching when skipSources is true", async () => {
    const result = await resolveAndFetchSources({
      sources: [{ source: "https://github.com/org/repo" }],
      baseDir: testDir,
      options: { skipSources: true },
    });

    expect(result).toEqual({ fetchedFileCount: 0, sourcesProcessed: 0 });
    expect(mockClientInstance.getDefaultBranch).not.toHaveBeenCalled();
  });

  it("should clean source cache before re-fetching", async () => {
    const { readLockFile } = await import("./sources-lock.js");
    const sourceCacheDir = join(testDir, RULESYNC_SOURCES_RELATIVE_DIR_PATH, "org--repo");

    // Pre-existing lock with previously fetched files
    vi.mocked(readLockFile).mockResolvedValue({
      lockfileVersion: 2,
      sources: {
        "https://github.com/org/repo": {
          resolvedRef: "locked-sha",
          files: {
            "skills/old-skill-a/SKILL.md": { integrity: "sha256-aaa" },
          },
        },
      },
    });

    // Source cache dir does not exist, so SHA-match skip fails and re-fetch triggers
    vi.mocked(directoryExists).mockResolvedValue(false);

    // No remote content after cleanup
    mockClientInstance.listDirectory.mockResolvedValue([]);
    // getFileContent throws 404 for single-file features
    const { GitHubClientError } = await import("./github-client.js");
    mockClientInstance.getFileContent.mockRejectedValue(new GitHubClientError("Not Found", 404));

    await resolveAndFetchSources({
      sources: [{ source: "https://github.com/org/repo" }],
      baseDir: testDir,
    });

    // cleanSourceCache should call removeDirectory then ensureDir on the source cache path
    // Since directoryExists returns false, removeDirectory may not be called,
    // but ensureDir should be called for the cache path
    expect(ensureDir).toHaveBeenCalledWith(sourceCacheDir);
  });

  it("should skip re-fetch when SHA matches lockfile and source cache exists on disk", async () => {
    const { readLockFile } = await import("./sources-lock.js");
    const sourceCacheDir = join(testDir, RULESYNC_SOURCES_RELATIVE_DIR_PATH, "org--repo");

    // Lock has a source with resolved SHA
    vi.mocked(readLockFile).mockResolvedValue({
      lockfileVersion: 2,
      sources: {
        "https://github.com/org/repo": {
          resolvedRef: "locked-sha-123",
          files: { "skills/cached-skill/SKILL.md": { integrity: "sha256-cached" } },
        },
      },
    });

    // Source cache directory exists on disk
    vi.mocked(directoryExists).mockImplementation(async (path: string) => {
      if (path === sourceCacheDir) return true;
      return false;
    });

    const result = await resolveAndFetchSources({
      sources: [{ source: "https://github.com/org/repo" }],
      baseDir: testDir,
    });

    // Should not call listDirectory (no re-fetch)
    expect(mockClientInstance.listDirectory).not.toHaveBeenCalled();
    // fetchedFileCount is 0 because nothing was newly fetched
    expect(result.fetchedFileCount).toBe(0);
    expect(result.sourcesProcessed).toBe(1);
    // removeDirectory should not have been called (no cleanup needed)
    expect(removeDirectory).not.toHaveBeenCalled();
  });

  it("should fetch skills from a remote source", async () => {
    const { listDirectoryRecursive } = await import("./github-utils.js");

    // Mock: listDirectory returns skill dirs for "skills" path, empty/404 for others
    const { GitHubClientError } = await import("./github-client.js");
    mockClientInstance.listDirectory.mockImplementation(
      async (_owner: string, _repo: string, path: string) => {
        if (path === "skills") {
          return [{ name: "my-skill", path: "skills/my-skill", type: "dir" }];
        }
        // Other directory features return 404
        throw new GitHubClientError("Not Found", 404);
      },
    );
    // Single-file features return 404
    mockClientInstance.getFileContent.mockRejectedValue(new GitHubClientError("Not Found", 404));

    // listDirectoryRecursive returns files within the skill dir
    vi.mocked(listDirectoryRecursive).mockResolvedValue([
      {
        name: "SKILL.md",
        path: "skills/my-skill/SKILL.md",
        type: "file",
        size: 100,
        sha: "abc123",
        download_url: null,
      },
    ]);

    // Mock getFileContent to succeed when called via withSemaphore for skill files
    const { withSemaphore } = await import("./github-utils.js");
    vi.mocked(withSemaphore).mockImplementation(async (_sem: any, fn: () => any) => fn());
    // Re-mock getFileContent to handle both skill files and single-file features
    mockClientInstance.getFileContent.mockImplementation(
      async (_owner: string, _repo: string, path: string) => {
        if (path === "skills/my-skill/SKILL.md") {
          return "# My Skill\nContent here.";
        }
        throw new GitHubClientError("Not Found", 404);
      },
    );

    const result = await resolveAndFetchSources({
      sources: [{ source: "https://github.com/org/repo" }],
      baseDir: testDir,
    });

    expect(result.fetchedFileCount).toBeGreaterThanOrEqual(1);
    expect(result.sourcesProcessed).toBe(1);

    const sourceCacheDir = join(testDir, RULESYNC_SOURCES_RELATIVE_DIR_PATH, "org--repo");
    const expectedFilePath = join(sourceCacheDir, "skills", "my-skill", "SKILL.md");
    expect(writeFileContent).toHaveBeenCalledWith(expectedFilePath, "# My Skill\nContent here.");
  });

  it("should respect skill filter", async () => {
    const { listDirectoryRecursive } = await import("./github-utils.js");
    const { GitHubClientError } = await import("./github-client.js");
    const { withSemaphore } = await import("./github-utils.js");
    vi.mocked(withSemaphore).mockImplementation(async (_sem: any, fn: () => any) => fn());

    // Remote has two skill dirs
    mockClientInstance.listDirectory.mockImplementation(
      async (_owner: string, _repo: string, path: string) => {
        if (path === "skills") {
          return [
            { name: "skill-a", path: "skills/skill-a", type: "dir" },
            { name: "skill-b", path: "skills/skill-b", type: "dir" },
          ];
        }
        throw new GitHubClientError("Not Found", 404);
      },
    );
    mockClientInstance.getFileContent.mockImplementation(
      async (_owner: string, _repo: string, path: string) => {
        if (path.startsWith("skills/")) return "content";
        throw new GitHubClientError("Not Found", 404);
      },
    );

    // listDirectoryRecursive returns files for whichever skill dir is requested
    vi.mocked(listDirectoryRecursive).mockImplementation(async (params: any) => {
      if (params.path === "skills/skill-a") {
        return [
          {
            name: "SKILL.md",
            path: "skills/skill-a/SKILL.md",
            type: "file",
            size: 50,
            sha: "abc123",
            download_url: null,
          },
        ];
      }
      return [];
    });

    await resolveAndFetchSources({
      sources: [{ source: "https://github.com/org/repo", skills: ["skill-a"] }],
      baseDir: testDir,
    });

    // Only skill-a should be fetched
    const writeArgs = vi.mocked(writeFileContent).mock.calls.map((call) => call[0]);
    expect(writeArgs.some((p) => p.includes("skill-a"))).toBe(true);
    expect(writeArgs.some((p) => p.includes("skill-b"))).toBe(false);
  });

  it("should handle 404 for skills directory gracefully", async () => {
    const { GitHubClientError } = await import("./github-client.js");
    // All listDirectory and getFileContent calls return 404
    mockClientInstance.listDirectory.mockRejectedValue(new GitHubClientError("Not Found", 404));
    mockClientInstance.getFileContent.mockRejectedValue(new GitHubClientError("Not Found", 404));

    const result = await resolveAndFetchSources({
      sources: [{ source: "https://github.com/org/repo" }],
      baseDir: testDir,
    });

    // Should not throw, just skip features that are not found
    expect(result.fetchedFileCount).toBe(0);
    expect(result.sourcesProcessed).toBe(1);
  });

  it("should re-resolve refs when updateSources is true", async () => {
    const { readLockFile } = await import("./sources-lock.js");
    const { GitHubClientError } = await import("./github-client.js");

    // Pre-existing lock has a different SHA for the same source
    vi.mocked(readLockFile).mockResolvedValue({
      lockfileVersion: 2,
      sources: {
        "https://github.com/org/repo": {
          resolvedRef: "old-locked-sha-should-be-ignored",
          files: { "skills/my-skill/SKILL.md": { integrity: "sha256-xxx" } },
        },
      },
    });

    const { listDirectoryRecursive, withSemaphore } = await import("./github-utils.js");
    vi.mocked(withSemaphore).mockImplementation(async (_sem: any, fn: () => any) => fn());

    // Remote has one skill
    mockClientInstance.listDirectory.mockImplementation(
      async (_owner: string, _repo: string, path: string) => {
        if (path === "skills") {
          return [{ name: "my-skill", path: "skills/my-skill", type: "dir" }];
        }
        throw new GitHubClientError("Not Found", 404);
      },
    );
    vi.mocked(listDirectoryRecursive).mockResolvedValue([
      {
        name: "SKILL.md",
        path: "skills/my-skill/SKILL.md",
        type: "file",
        size: 100,
        sha: "abc123",
        download_url: null,
      },
    ]);
    mockClientInstance.getFileContent.mockImplementation(
      async (_owner: string, _repo: string, path: string) => {
        if (path.startsWith("skills/")) return "content";
        throw new GitHubClientError("Not Found", 404);
      },
    );

    const result = await resolveAndFetchSources({
      sources: [{ source: "https://github.com/org/repo" }],
      baseDir: testDir,
      options: { updateSources: true },
    });

    // updateSources: true creates empty lock, so resolveRefToSha must be called
    expect(mockClientInstance.resolveRefToSha).toHaveBeenCalled();
    expect(result.fetchedFileCount).toBeGreaterThanOrEqual(1);
  });

  it("should continue processing other sources when one source fails", async () => {
    const { GitHubClientError } = await import("./github-client.js");
    const { listDirectoryRecursive, withSemaphore } = await import("./github-utils.js");
    vi.mocked(withSemaphore).mockImplementation(async (_sem: any, fn: () => any) => fn());

    let resolveCallCount = 0;
    mockClientInstance.resolveRefToSha.mockImplementation(async () => {
      resolveCallCount++;
      if (resolveCallCount === 1) {
        throw new Error("Network error");
      }
      return "abc123def456";
    });

    // Second source has a skill (first source will fail before listing)
    mockClientInstance.listDirectory.mockImplementation(
      async (_owner: string, _repo: string, path: string) => {
        if (path === "skills") {
          return [{ name: "good-skill", path: "skills/good-skill", type: "dir" }];
        }
        throw new GitHubClientError("Not Found", 404);
      },
    );
    vi.mocked(listDirectoryRecursive).mockResolvedValue([
      {
        name: "SKILL.md",
        path: "skills/good-skill/SKILL.md",
        type: "file",
        size: 50,
        sha: "abc123",
        download_url: null,
      },
    ]);
    mockClientInstance.getFileContent.mockImplementation(
      async (_owner: string, _repo: string, path: string) => {
        if (path.startsWith("skills/")) return "content";
        throw new GitHubClientError("Not Found", 404);
      },
    );

    const result = await resolveAndFetchSources({
      sources: [
        { source: "https://github.com/org/failing-repo" },
        { source: "https://github.com/org/good-repo" },
      ],
      baseDir: testDir,
    });

    // Second source should succeed despite first failing
    expect(result.fetchedFileCount).toBeGreaterThanOrEqual(1);
    expect(result.sourcesProcessed).toBe(2);
  });

  it("should handle GitLab source gracefully", async () => {
    const { GitHubClientError } = await import("./github-client.js");
    // Mock getFileContent for non-gitlab sources, but the gitlab source won't reach it
    mockClientInstance.listDirectory.mockRejectedValue(new GitHubClientError("Not Found", 404));
    mockClientInstance.getFileContent.mockRejectedValue(new GitHubClientError("Not Found", 404));

    const result = await resolveAndFetchSources({
      sources: [{ source: "gitlab:org/repo" }],
      baseDir: testDir,
    });

    // Should not throw, but log warning and skip
    expect(result.fetchedFileCount).toBe(0);
    expect(result.sourcesProcessed).toBe(1);
  });

  it("should prune stale lockfile entries and preserve current sources", async () => {
    const { readLockFile, writeLockFile } = await import("./sources-lock.js");
    const sourceCacheDir = join(testDir, RULESYNC_SOURCES_RELATIVE_DIR_PATH, "org--new-repo");

    // Pre-existing lock has entries for both a removed and a current source
    vi.mocked(readLockFile).mockResolvedValue({
      lockfileVersion: 2,
      sources: {
        "org/old-removed-repo": {
          resolvedRef: "old-sha",
          files: { "skills/old-skill/SKILL.md": { integrity: "sha256-old" } },
        },
        "org/new-repo": {
          resolvedRef: "existing-sha",
          files: { "skills/kept-skill/SKILL.md": { integrity: "sha256-kept" } },
        },
      },
    });

    // Source cache exists on disk (for SHA-match skip)
    vi.mocked(directoryExists).mockImplementation(async (path: string) => {
      if (path === sourceCacheDir) return true;
      return false;
    });

    await resolveAndFetchSources({
      sources: [{ source: "https://github.com/org/new-repo" }],
      baseDir: testDir,
    });

    // The written lock should NOT contain the old-removed-repo entry
    const writeCalls = vi.mocked(writeLockFile).mock.calls;
    expect(writeCalls.length).toBeGreaterThan(0);
    const writtenLock = writeCalls[0]![0].lock;
    expect(writtenLock.sources["org/old-removed-repo"]).toBeUndefined();
    // The current source should be preserved (normalized key)
    expect(writtenLock.sources["org/new-repo"]).toBeDefined();
  });

  it("should not prune current sources even when config uses different URL format than lock key", async () => {
    const { readLockFile, writeLockFile } = await import("./sources-lock.js");
    const sourceCacheDir = join(testDir, RULESYNC_SOURCES_RELATIVE_DIR_PATH, "org--repo");

    // Lock stored under normalized key
    vi.mocked(readLockFile).mockResolvedValue({
      lockfileVersion: 2,
      sources: {
        "org/repo": {
          resolvedRef: "sha-123",
          files: { "skills/my-skill/SKILL.md": { integrity: "sha256-xxx" } },
        },
      },
    });

    // Source cache exists on disk
    vi.mocked(directoryExists).mockImplementation(async (path: string) => {
      if (path === sourceCacheDir) return true;
      return false;
    });

    await resolveAndFetchSources({
      // Config uses full URL but lock has normalized key
      sources: [{ source: "https://github.com/org/repo" }],
      baseDir: testDir,
    });

    // Lockfile should be unchanged (not written) since SHA matches and nothing new
    const writeCalls = vi.mocked(writeLockFile).mock.calls;
    // Either not written (unchanged) or written with the entry preserved
    if (writeCalls.length > 0) {
      const writtenLock = writeCalls[0]![0].lock;
      expect(writtenLock.sources["org/repo"]).toBeDefined();
    }
  });

  it("should reject files with path traversal via checkPathTraversal", async () => {
    const { listDirectoryRecursive, withSemaphore } = await import("./github-utils.js");
    const { GitHubClientError } = await import("./github-client.js");
    vi.mocked(withSemaphore).mockImplementation(async (_sem: any, fn: () => any) => fn());

    // Remote has a skill with a path-traversal name
    mockClientInstance.listDirectory.mockImplementation(
      async (_owner: string, _repo: string, path: string) => {
        if (path === "skills") {
          return [{ name: "../../evil", path: "skills/../../evil", type: "dir" }];
        }
        throw new GitHubClientError("Not Found", 404);
      },
    );
    vi.mocked(listDirectoryRecursive).mockResolvedValue([
      {
        name: "EVIL.md",
        path: "skills/../../evil/EVIL.md",
        type: "file",
        size: 50,
        sha: "abc123",
        download_url: null,
      },
    ]);
    mockClientInstance.getFileContent.mockImplementation(
      async (_owner: string, _repo: string, path: string) => {
        if (path.startsWith("skills/")) return "content";
        throw new GitHubClientError("Not Found", 404);
      },
    );

    // The path traversal causes writeAndTrackFile to throw via checkPathTraversal,
    // which propagates as a source-level error caught by the outer try/catch
    const result = await resolveAndFetchSources({
      sources: [{ source: "https://github.com/org/repo" }],
      baseDir: testDir,
    });

    // The evil file should never be written
    const writeArgs = vi.mocked(writeFileContent).mock.calls.map((call) => call[0]);
    expect(writeArgs.some((p) => p.includes("evil"))).toBe(false);
    // The source-level error means fetchedFileCount is 0
    expect(result.fetchedFileCount).toBe(0);
    expect(result.sourcesProcessed).toBe(1);
  });

  it("should throw when frozen and source not in lockfile", async () => {
    const { readLockFile } = await import("./sources-lock.js");

    vi.mocked(readLockFile).mockResolvedValue({ lockfileVersion: 2, sources: {} });

    await expect(
      resolveAndFetchSources({
        sources: [{ source: "https://github.com/org/repo" }],
        baseDir: testDir,
        options: { frozen: true },
      }),
    ).rejects.toThrow("Frozen install failed");
    expect(mockClientInstance.getDefaultBranch).not.toHaveBeenCalled();
  });

  it("should succeed in frozen mode when lockfile covers all sources and cache exists on disk", async () => {
    const { readLockFile } = await import("./sources-lock.js");
    const sourceCacheDir = join(testDir, RULESYNC_SOURCES_RELATIVE_DIR_PATH, "org--repo");

    vi.mocked(readLockFile).mockResolvedValue({
      lockfileVersion: 2,
      sources: {
        "org/repo": {
          resolvedRef: "sha-123",
          files: { "skills/my-skill/SKILL.md": { integrity: "sha256-xxx" } },
        },
      },
    });

    vi.mocked(directoryExists).mockImplementation(async (path: string) => {
      if (path === sourceCacheDir) return true;
      return false;
    });

    const result = await resolveAndFetchSources({
      sources: [{ source: "https://github.com/org/repo" }],
      baseDir: testDir,
      options: { frozen: true },
    });

    expect(result.fetchedFileCount).toBe(0);
    expect(result.sourcesProcessed).toBe(1);
  });

  it("should fetch missing locked source in frozen mode without writing lockfile", async () => {
    const { readLockFile, writeLockFile } = await import("./sources-lock.js");
    const { listDirectoryRecursive, withSemaphore } = await import("./github-utils.js");
    const { GitHubClientError } = await import("./github-client.js");
    vi.mocked(withSemaphore).mockImplementation(async (_sem: any, fn: () => any) => fn());

    vi.mocked(readLockFile).mockResolvedValue({
      lockfileVersion: 2,
      sources: {
        "org/repo": {
          resolvedRef: "sha-123",
          files: { "skills/missing-skill/SKILL.md": { integrity: "sha256-xxx" } },
        },
      },
    });

    // Source cache dir does not exist on disk
    vi.mocked(directoryExists).mockResolvedValue(false);

    mockClientInstance.listDirectory.mockImplementation(
      async (_owner: string, _repo: string, path: string) => {
        if (path === "skills") {
          return [{ name: "missing-skill", path: "skills/missing-skill", type: "dir" }];
        }
        throw new GitHubClientError("Not Found", 404);
      },
    );
    vi.mocked(listDirectoryRecursive).mockResolvedValue([
      {
        name: "SKILL.md",
        path: "skills/missing-skill/SKILL.md",
        type: "file",
        size: 42,
        sha: "abc123",
        download_url: null,
      },
    ]);
    mockClientInstance.getFileContent.mockImplementation(
      async (_owner: string, _repo: string, path: string) => {
        if (path.startsWith("skills/")) return "locked skill content";
        throw new GitHubClientError("Not Found", 404);
      },
    );

    const result = await resolveAndFetchSources({
      sources: [{ source: "https://github.com/org/repo" }],
      baseDir: testDir,
      options: { frozen: true },
    });

    expect(result.fetchedFileCount).toBeGreaterThanOrEqual(1);
    expect(result.sourcesProcessed).toBe(1);
    expect(mockClientInstance.getDefaultBranch).not.toHaveBeenCalled();
    expect(mockClientInstance.resolveRefToSha).not.toHaveBeenCalled();
    expect(writeLockFile).not.toHaveBeenCalled();
  });

  it("should warn when computed integrity differs from locked hash", async () => {
    const { readLockFile } = await import("./sources-lock.js");
    const { listDirectoryRecursive, withSemaphore } = await import("./github-utils.js");
    const { GitHubClientError } = await import("./github-client.js");
    vi.mocked(withSemaphore).mockImplementation(async (_sem: any, fn: () => any) => fn());

    // Lock has a source with a specific integrity hash
    vi.mocked(readLockFile).mockResolvedValue({
      lockfileVersion: 2,
      sources: {
        "org/repo": {
          resolvedRef: "locked-sha-123",
          files: { "skills/my-skill/SKILL.md": { integrity: "sha256-old-hash" } },
        },
      },
    });

    // Source cache is missing so re-fetch is triggered
    vi.mocked(directoryExists).mockResolvedValue(false);

    // Mock: remote has one skill with different content than what was locked
    mockClientInstance.resolveRefToSha.mockResolvedValue("locked-sha-123");
    mockClientInstance.listDirectory.mockImplementation(
      async (_owner: string, _repo: string, path: string) => {
        if (path === "skills") {
          return [{ name: "my-skill", path: "skills/my-skill", type: "dir" }];
        }
        throw new GitHubClientError("Not Found", 404);
      },
    );
    vi.mocked(listDirectoryRecursive).mockResolvedValue([
      {
        name: "SKILL.md",
        path: "skills/my-skill/SKILL.md",
        type: "file",
        size: 100,
        sha: "abc123",
        download_url: null,
      },
    ]);
    mockClientInstance.getFileContent.mockImplementation(
      async (_owner: string, _repo: string, path: string) => {
        if (path.startsWith("skills/")) return "tampered content";
        throw new GitHubClientError("Not Found", 404);
      },
    );

    await resolveAndFetchSources({
      sources: [{ source: "https://github.com/org/repo" }],
      baseDir: testDir,
    });

    // Should have warned about integrity mismatch
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("Integrity mismatch"));
  });

  it("should fetch files via git transport", async () => {
    const { resolveDefaultRef, fetchSourceCacheFiles } = await import("./git-client.js");
    vi.mocked(resolveDefaultRef).mockResolvedValue({ ref: "main", sha: "abc123def456" });
    vi.mocked(fetchSourceCacheFiles).mockResolvedValue([
      { relativePath: "skills/my-skill/SKILL.md", content: "# My Skill", size: 100 },
    ]);

    await resolveAndFetchSources({
      sources: [{ source: "https://dev.azure.com/org/project/_git/repo", transport: "git" }],
      baseDir: testDir,
    });

    expect(mockClientInstance.listDirectory).not.toHaveBeenCalled();
    // File should be written to source cache, not curated dir
    const writeCalls = vi.mocked(writeFileContent).mock.calls;
    const writtenPaths = writeCalls.map((call) => call[0]);
    expect(writtenPaths.some((p) => p.includes("skills") && p.includes("my-skill"))).toBe(true);
  });

  it("should use explicit ref and path for git transport", async () => {
    const { resolveRefToSha: gitResolveRefToSha, fetchSourceCacheFiles } =
      await import("./git-client.js");
    vi.mocked(gitResolveRefToSha).mockResolvedValue("def456abc789");
    vi.mocked(fetchSourceCacheFiles).mockResolvedValue([
      { relativePath: "skills/my-skill/SKILL.md", content: "# Custom Path", size: 50 },
    ]);

    await resolveAndFetchSources({
      sources: [
        {
          source: "file:///local/clone",
          transport: "git",
          ref: "develop",
          path: "exports/skills",
        },
      ],
      baseDir: testDir,
    });

    expect(vi.mocked(gitResolveRefToSha)).toHaveBeenCalledWith("file:///local/clone", "develop");
    expect(vi.mocked(fetchSourceCacheFiles)).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "file:///local/clone",
        ref: "develop",
        basePath: "exports/skills",
      }),
    );
  });

  it("should error in frozen mode when git source lockfile entry lacks requestedRef", async () => {
    const { readLockFile } = await import("./sources-lock.js");

    vi.mocked(readLockFile).mockResolvedValue({
      lockfileVersion: 2,
      sources: {
        "https://dev.azure.com/org/_git/repo": {
          resolvedRef: "a".repeat(40),
          files: { "skills/my-skill/SKILL.md": { integrity: "sha256-x" } },
        },
      },
    });

    // Source cache dir missing so SHA-match skip fails
    vi.mocked(directoryExists).mockResolvedValue(false);

    const result = await resolveAndFetchSources({
      sources: [{ source: "https://dev.azure.com/org/_git/repo", transport: "git" }],
      baseDir: testDir,
      options: { frozen: true },
    });

    expect(result.fetchedFileCount).toBe(0);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("missing requestedRef"));
  });

  it("should skip re-fetch for git transport when locked SHA matches and cache exists", async () => {
    const { readLockFile } = await import("./sources-lock.js");
    const { fetchSourceCacheFiles } = await import("./git-client.js");

    vi.mocked(readLockFile).mockResolvedValue({
      lockfileVersion: 2,
      sources: {
        "https://dev.azure.com/org/_git/repo": {
          resolvedRef: "b".repeat(40),
          requestedRef: "main",
          files: { "skills/cached-skill/SKILL.md": { integrity: "sha256-cached" } },
        },
      },
    });

    // Source cache exists on disk - sourceKeyToDirName for the URL
    vi.mocked(directoryExists).mockImplementation(async (path: string) => {
      if (path.includes(".sources")) return true;
      return false;
    });

    const result = await resolveAndFetchSources({
      sources: [{ source: "https://dev.azure.com/org/_git/repo", transport: "git" }],
      baseDir: testDir,
    });

    expect(result.fetchedFileCount).toBe(0);
    expect(vi.mocked(fetchSourceCacheFiles)).not.toHaveBeenCalled();
  });

  it("should apply skill filter for git transport", async () => {
    const { resolveDefaultRef, fetchSourceCacheFiles } = await import("./git-client.js");
    vi.mocked(resolveDefaultRef).mockResolvedValue({ ref: "main", sha: "c".repeat(40) });
    vi.mocked(fetchSourceCacheFiles).mockResolvedValue([
      { relativePath: "skills/skill-a/SKILL.md", content: "A", size: 10 },
      { relativePath: "skills/skill-b/SKILL.md", content: "B", size: 10 },
    ]);

    await resolveAndFetchSources({
      sources: [
        {
          source: "https://dev.azure.com/org/_git/repo",
          transport: "git",
          skills: ["skill-a"],
        },
      ],
      baseDir: testDir,
    });

    // Only skill-a should be written
    const writeArgs = vi.mocked(writeFileContent).mock.calls.map((call) => call[0]);
    expect(writeArgs.some((p) => p.includes("skill-a"))).toBe(true);
    expect(writeArgs.some((p) => p.includes("skill-b"))).toBe(false);
  });

  it("should not write files outside requested features for git transport", async () => {
    const { resolveDefaultRef, fetchSourceCacheFiles } = await import("./git-client.js");
    vi.mocked(resolveDefaultRef).mockResolvedValue({ ref: "main", sha: "a".repeat(40) });

    // Simulate sparse checkout returning extra files outside the requested feature
    // (e.g. mcp.json sitting alongside subagents/ under the basePath)
    vi.mocked(fetchSourceCacheFiles).mockResolvedValue([
      { relativePath: "subagents/reviewer.md", content: "# Reviewer", size: 50 },
      { relativePath: "mcp.json", content: '{"mcpServers":{}}', size: 20 },
    ]);

    await resolveAndFetchSources({
      sources: [
        {
          source: "https://dev.azure.com/org/_git/repo",
          transport: "git",
          features: ["subagents"],
          path: ".rulesync",
        },
      ],
      baseDir: testDir,
    });

    const writeArgs = vi.mocked(writeFileContent).mock.calls.map((call) => call[0]);
    // subagents/reviewer.md should be written
    expect(writeArgs.some((p) => p.includes("subagents") && p.includes("reviewer.md"))).toBe(true);
    // mcp.json should NOT be written since "mcp" is not in the features list
    expect(writeArgs.some((p) => p.endsWith("mcp.json"))).toBe(false);
  });

  it("should warn on integrity mismatch for git transport file", async () => {
    const { readLockFile } = await import("./sources-lock.js");
    const { fetchSourceCacheFiles } = await import("./git-client.js");
    const lockedSha = "f".repeat(40);

    vi.mocked(readLockFile).mockResolvedValue({
      lockfileVersion: 2,
      sources: {
        "https://dev.azure.com/org/_git/repo": {
          resolvedRef: lockedSha,
          requestedRef: "main",
          files: { "skills/my-skill/SKILL.md": { integrity: "sha256-original" } },
        },
      },
    });

    // Source cache dir missing so re-fetch is triggered
    vi.mocked(directoryExists).mockResolvedValue(false);
    vi.mocked(fetchSourceCacheFiles).mockResolvedValue([
      { relativePath: "skills/my-skill/SKILL.md", content: "tampered", size: 10 },
    ]);

    await resolveAndFetchSources({
      sources: [{ source: "https://dev.azure.com/org/_git/repo", transport: "git" }],
      baseDir: testDir,
    });

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("Integrity mismatch"));
  });

  it("should handle GitClientError gracefully and continue processing", async () => {
    const { GitClientError } = await import("./git-client.js");
    const { resolveDefaultRef, fetchSourceCacheFiles } = await import("./git-client.js");

    let callCount = 0;
    vi.mocked(resolveDefaultRef).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        throw new GitClientError("git is not installed or not found in PATH");
      }
      return { ref: "main", sha: "a".repeat(40) };
    });
    vi.mocked(fetchSourceCacheFiles).mockResolvedValue([
      { relativePath: "skills/good-skill/SKILL.md", content: "ok", size: 10 },
    ]);

    const result = await resolveAndFetchSources({
      sources: [
        { source: "https://dev.azure.com/org/_git/failing", transport: "git" },
        { source: "https://dev.azure.com/org/_git/good", transport: "git" },
      ],
      baseDir: testDir,
    });

    expect(result.fetchedFileCount).toBeGreaterThanOrEqual(1);
    expect(result.sourcesProcessed).toBe(2);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("not installed"));
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("Hint"));
  });

  it("should fetch skills, rules, and mcp.json from a single source into .sources/", async () => {
    const { listDirectoryRecursive, withSemaphore } = await import("./github-utils.js");
    vi.mocked(withSemaphore).mockImplementation(async (_sem: any, fn: () => any) => fn());
    const { GitHubClientError } = await import("./github-client.js");

    // Remote has skills, rules, and mcp.json; other features return 404
    mockClientInstance.listDirectory.mockImplementation(
      async (_owner: string, _repo: string, path: string) => {
        if (path === "skills") {
          return [{ name: "my-skill", path: "skills/my-skill", type: "dir" }];
        }
        if (path === "rules") {
          return [{ name: "coding.md", path: "rules/coding.md", type: "file" }];
        }
        throw new GitHubClientError("Not Found", 404);
      },
    );
    vi.mocked(listDirectoryRecursive).mockResolvedValue([
      {
        name: "SKILL.md",
        path: "skills/my-skill/SKILL.md",
        type: "file",
        size: 50,
        sha: "abc",
        download_url: null,
      },
    ]);
    mockClientInstance.getFileContent.mockImplementation(
      async (_owner: string, _repo: string, path: string) => {
        if (path === "skills/my-skill/SKILL.md") return "# My Skill";
        if (path === "rules/coding.md") return "# Coding Rules";
        if (path === ".rulesync/mcp.json" || path === "mcp.json")
          return JSON.stringify({ mcpServers: { s1: { command: "cmd" } } });
        throw new GitHubClientError("Not Found", 404);
      },
    );

    const result = await resolveAndFetchSources({
      sources: [{ source: "https://github.com/org/multi-feature" }],
      baseDir: testDir,
    });

    expect(result.sourcesProcessed).toBe(1);
    expect(result.fetchedFileCount).toBeGreaterThanOrEqual(2);

    const sourceCacheDir = join(testDir, RULESYNC_SOURCES_RELATIVE_DIR_PATH, "org--multi-feature");
    // Verify skill was written
    expect(writeFileContent).toHaveBeenCalledWith(
      join(sourceCacheDir, "skills", "my-skill", "SKILL.md"),
      "# My Skill",
    );
    // Verify rule was written
    expect(writeFileContent).toHaveBeenCalledWith(
      join(sourceCacheDir, "rules", "coding.md"),
      "# Coding Rules",
    );
  });

  it("should drop renamed/deleted files from lockfile when upstream removes them", async () => {
    const { readLockFile, writeLockFile } = await import("./sources-lock.js");
    const { resolveDefaultRef, fetchSourceCacheFiles } = await import("./git-client.js");

    // Lock has "old-skill" from a previous install
    vi.mocked(readLockFile).mockResolvedValue({
      lockfileVersion: 2,
      sources: {
        "https://dev.azure.com/org/_git/repo": {
          resolvedRef: "a".repeat(40),
          requestedRef: "main",
          files: { "skills/old-skill/SKILL.md": { integrity: "sha256-old" } },
        },
      },
    });

    // Remote now has "new-skill" instead of "old-skill" (renamed upstream)
    vi.mocked(resolveDefaultRef).mockResolvedValue({ ref: "main", sha: "b".repeat(40) });
    vi.mocked(fetchSourceCacheFiles).mockResolvedValue([
      { relativePath: "skills/new-skill/SKILL.md", content: "renamed", size: 10 },
    ]);

    vi.mocked(directoryExists).mockResolvedValue(false);

    await resolveAndFetchSources({
      sources: [{ source: "https://dev.azure.com/org/_git/repo", transport: "git" }],
      baseDir: testDir,
    });

    // The lockfile should contain only "new-skill", not "old-skill"
    const writeCalls = vi.mocked(writeLockFile).mock.calls;
    expect(writeCalls).toHaveLength(1);
    const writtenLock = writeCalls[0]![0].lock;
    const sourceEntry = Object.values(writtenLock.sources)[0]!;
    expect(sourceEntry.files).toHaveProperty("skills/new-skill/SKILL.md");
    expect(sourceEntry.files).not.toHaveProperty("skills/old-skill/SKILL.md");
  });
});
