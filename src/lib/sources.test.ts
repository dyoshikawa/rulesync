import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH } from "../constants/rulesync-paths.js";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import {
  directoryExists,
  findFilesByGlobs,
  removeDirectory,
  writeFileContent,
} from "../utils/file.js";
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
    findFilesByGlobs: vi.fn(),
    removeDirectory: vi.fn(),
    writeFileContent: vi.fn(),
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

vi.mock("./sources-lock.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./sources-lock.js")>();
  return {
    ...actual,
    readLockFile: vi.fn().mockResolvedValue({ lockfileVersion: 1, sources: {} }),
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

    // Default: no curated dir, no local skills
    vi.mocked(directoryExists).mockResolvedValue(false);
    vi.mocked(findFilesByGlobs).mockResolvedValue([]);
    vi.mocked(removeDirectory).mockResolvedValue(undefined);
    vi.mocked(writeFileContent).mockResolvedValue(undefined);
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

    expect(result).toEqual({ fetchedSkillCount: 0, sourcesProcessed: 0 });
  });

  it("should skip fetching when skipSources is true", async () => {
    const result = await resolveAndFetchSources({
      sources: [{ source: "https://github.com/org/repo" }],
      baseDir: testDir,
      options: { skipSources: true },
    });

    expect(result).toEqual({ fetchedSkillCount: 0, sourcesProcessed: 0 });
    expect(mockClientInstance.getDefaultBranch).not.toHaveBeenCalled();
  });

  it("should clean per-source locked skill directories before re-fetching", async () => {
    const { readLockFile } = await import("./sources-lock.js");
    const curatedDir = join(testDir, RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH);

    // Pre-existing lock with previously fetched skills
    vi.mocked(readLockFile).mockResolvedValue({
      lockfileVersion: 1,
      sources: {
        "https://github.com/org/repo": {
          resolvedRef: "locked-sha",
          skills: {
            "old-skill-a": { integrity: "sha256-aaa" },
            "old-skill-b": { integrity: "sha256-bbb" },
          },
        },
      },
    });

    // old-skill-a exists on disk, old-skill-b does not.
    // Because old-skill-b is missing, the SHA-match skip check fails,
    // and per-source cleanup runs for old-skill-a (which exists).
    vi.mocked(directoryExists).mockImplementation(async (path: string) => {
      if (path === join(curatedDir, "old-skill-a")) return true;
      return false;
    });

    // No remote skills after cleanup
    mockClientInstance.listDirectory.mockResolvedValue([]);

    await resolveAndFetchSources({
      sources: [{ source: "https://github.com/org/repo" }],
      baseDir: testDir,
    });

    // Only old-skill-a should be removed (it existed on disk)
    expect(removeDirectory).toHaveBeenCalledWith(join(curatedDir, "old-skill-a"));
    // Should NOT do a blanket removal of the curated dir
    expect(removeDirectory).not.toHaveBeenCalledWith(curatedDir);
  });

  it("should skip re-fetch when SHA matches lockfile and skills exist on disk", async () => {
    const { readLockFile } = await import("./sources-lock.js");
    const curatedDir = join(testDir, RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH);

    // Lock has a source with resolved SHA and skills
    vi.mocked(readLockFile).mockResolvedValue({
      lockfileVersion: 1,
      sources: {
        "https://github.com/org/repo": {
          resolvedRef: "locked-sha-123",
          skills: { "cached-skill": { integrity: "sha256-cached" } },
        },
      },
    });

    // All locked skill dirs exist on disk
    vi.mocked(directoryExists).mockImplementation(async (path: string) => {
      if (path === join(curatedDir, "cached-skill")) return true;
      return false;
    });

    const result = await resolveAndFetchSources({
      sources: [{ source: "https://github.com/org/repo" }],
      baseDir: testDir,
    });

    // Should not call listDirectory (no re-fetch)
    expect(mockClientInstance.listDirectory).not.toHaveBeenCalled();
    // fetchedSkillCount is 0 because nothing was newly fetched
    expect(result.fetchedSkillCount).toBe(0);
    expect(result.sourcesProcessed).toBe(1);
    // removeDirectory should not have been called (no cleanup needed)
    expect(removeDirectory).not.toHaveBeenCalled();
  });

  it("should fetch skills from a remote source", async () => {
    // Mock: remote has one skill directory with one file
    mockClientInstance.listDirectory.mockImplementation(
      async (_owner: string, _repo: string, path: string) => {
        if (path === "skills") {
          return [{ name: "my-skill", path: "skills/my-skill", type: "dir" }];
        }
        if (path === "skills/my-skill") {
          return [{ name: "SKILL.md", path: "skills/my-skill/SKILL.md", type: "file", size: 100 }];
        }
        return [];
      },
    );
    mockClientInstance.getFileContent.mockResolvedValue("# My Skill\nContent here.");

    const result = await resolveAndFetchSources({
      sources: [{ source: "https://github.com/org/repo" }],
      baseDir: testDir,
    });

    expect(result.fetchedSkillCount).toBe(1);
    expect(result.sourcesProcessed).toBe(1);

    const expectedFilePath = join(
      testDir,
      RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH,
      "my-skill",
      "SKILL.md",
    );
    expect(writeFileContent).toHaveBeenCalledWith(expectedFilePath, "# My Skill\nContent here.");
  });

  it("should skip skills that exist locally", async () => {
    // Local skill "my-skill" exists
    vi.mocked(directoryExists).mockImplementation(async (path: string) => {
      if (path.endsWith("skills")) return true;
      return false;
    });
    vi.mocked(findFilesByGlobs).mockResolvedValue([join(testDir, ".rulesync/skills/my-skill")]);

    // Remote has same skill name
    mockClientInstance.listDirectory.mockImplementation(
      async (_owner: string, _repo: string, path: string) => {
        if (path === "skills") {
          return [{ name: "my-skill", path: "skills/my-skill", type: "dir" }];
        }
        return [];
      },
    );

    const result = await resolveAndFetchSources({
      sources: [{ source: "https://github.com/org/repo" }],
      baseDir: testDir,
    });

    // Skill should be skipped since local takes precedence
    expect(result.fetchedSkillCount).toBe(0);
  });

  it("should respect skill filter", async () => {
    // Remote has two skills
    mockClientInstance.listDirectory.mockImplementation(
      async (_owner: string, _repo: string, path: string) => {
        if (path === "skills") {
          return [
            { name: "skill-a", path: "skills/skill-a", type: "dir" },
            { name: "skill-b", path: "skills/skill-b", type: "dir" },
          ];
        }
        if (path === "skills/skill-a") {
          return [{ name: "SKILL.md", path: "skills/skill-a/SKILL.md", type: "file", size: 50 }];
        }
        return [];
      },
    );
    mockClientInstance.getFileContent.mockResolvedValue("content");

    const result = await resolveAndFetchSources({
      sources: [{ source: "https://github.com/org/repo", skills: ["skill-a"] }],
      baseDir: testDir,
    });

    // Only skill-a should be fetched
    expect(result.fetchedSkillCount).toBe(1);
    const writeArgs = vi.mocked(writeFileContent).mock.calls.map((call) => call[0]);
    expect(writeArgs.some((p) => p.includes("skill-a"))).toBe(true);
    expect(writeArgs.some((p) => p.includes("skill-b"))).toBe(false);
  });

  it("should skip duplicate skills from later sources", async () => {
    // Both sources have "shared-skill"
    mockClientInstance.listDirectory.mockImplementation(
      async (_owner: string, _repo: string, path: string) => {
        if (path === "skills") {
          return [{ name: "shared-skill", path: "skills/shared-skill", type: "dir" }];
        }
        if (path === "skills/shared-skill") {
          return [
            { name: "SKILL.md", path: "skills/shared-skill/SKILL.md", type: "file", size: 50 },
          ];
        }
        return [];
      },
    );
    mockClientInstance.getFileContent.mockResolvedValue("content");

    const result = await resolveAndFetchSources({
      sources: [
        { source: "https://github.com/org/repo-a" },
        { source: "https://github.com/org/repo-b" },
      ],
      baseDir: testDir,
    });

    // First source fetches it, second source skips it
    expect(result.fetchedSkillCount).toBe(1);
  });

  it("should handle 404 for skills directory gracefully", async () => {
    const { GitHubClientError } = await import("./github-client.js");
    mockClientInstance.listDirectory.mockRejectedValue(new GitHubClientError("Not Found", 404));

    const result = await resolveAndFetchSources({
      sources: [{ source: "https://github.com/org/repo" }],
      baseDir: testDir,
    });

    // Should not throw, just skip the source
    expect(result.fetchedSkillCount).toBe(0);
    expect(result.sourcesProcessed).toBe(1);
  });

  it("should re-resolve refs when updateSources is true", async () => {
    const { readLockFile } = await import("./sources-lock.js");

    // Pre-existing lock has a different SHA for the same source
    vi.mocked(readLockFile).mockResolvedValue({
      lockfileVersion: 1,
      sources: {
        "https://github.com/org/repo": {
          resolvedRef: "old-locked-sha-should-be-ignored",
          skills: { "my-skill": { integrity: "sha256-xxx" } },
        },
      },
    });

    // Set up mock: remote has one skill
    mockClientInstance.listDirectory.mockImplementation(
      async (_owner: string, _repo: string, path: string) => {
        if (path === "skills") {
          return [{ name: "my-skill", path: "skills/my-skill", type: "dir" }];
        }
        if (path === "skills/my-skill") {
          return [{ name: "SKILL.md", path: "skills/my-skill/SKILL.md", type: "file", size: 100 }];
        }
        return [];
      },
    );
    mockClientInstance.getFileContent.mockResolvedValue("content");

    const result = await resolveAndFetchSources({
      sources: [{ source: "https://github.com/org/repo" }],
      baseDir: testDir,
      options: { updateSources: true },
    });

    // updateSources: true creates empty lock, so resolveRefToSha must be called
    // (proving the pre-existing lock entry "old-locked-sha-should-be-ignored" was ignored)
    expect(mockClientInstance.resolveRefToSha).toHaveBeenCalled();
    expect(result.fetchedSkillCount).toBe(1);
  });

  it("should continue processing other sources when one source fails", async () => {
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
        if (path === "skills/good-skill") {
          return [{ name: "SKILL.md", path: "skills/good-skill/SKILL.md", type: "file", size: 50 }];
        }
        return [];
      },
    );
    mockClientInstance.getFileContent.mockResolvedValue("content");

    const result = await resolveAndFetchSources({
      sources: [
        { source: "https://github.com/org/failing-repo" },
        { source: "https://github.com/org/good-repo" },
      ],
      baseDir: testDir,
    });

    // Second source should succeed despite first failing
    expect(result.fetchedSkillCount).toBe(1);
    expect(result.sourcesProcessed).toBe(2);
  });

  it("should handle GitLab source gracefully", async () => {
    const result = await resolveAndFetchSources({
      sources: [{ source: "gitlab:org/repo" }],
      baseDir: testDir,
    });

    // Should not throw, but log error and skip
    expect(result.fetchedSkillCount).toBe(0);
    expect(result.sourcesProcessed).toBe(1);
  });

  it("should prune stale lockfile entries and preserve current sources", async () => {
    const { readLockFile, writeLockFile } = await import("./sources-lock.js");

    // Pre-existing lock has entries for both a removed and a current source
    vi.mocked(readLockFile).mockResolvedValue({
      lockfileVersion: 1,
      sources: {
        "org/old-removed-repo": {
          resolvedRef: "old-sha",
          skills: { "old-skill": { integrity: "sha256-old" } },
        },
        "org/new-repo": {
          resolvedRef: "existing-sha",
          skills: { "kept-skill": { integrity: "sha256-kept" } },
        },
      },
    });

    // All locked skill dirs exist on disk (for SHA-match skip)
    vi.mocked(directoryExists).mockImplementation(async (path: string) => {
      if (path.includes("kept-skill")) return true;
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

    // Lock stored under normalized key
    vi.mocked(readLockFile).mockResolvedValue({
      lockfileVersion: 1,
      sources: {
        "org/repo": {
          resolvedRef: "sha-123",
          skills: { "my-skill": { integrity: "sha256-xxx" } },
        },
      },
    });

    // All locked skill dirs exist
    vi.mocked(directoryExists).mockImplementation(async (path: string) => {
      if (path.includes("my-skill")) return true;
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

  it("should skip skill directories with path traversal characters in name", async () => {
    // Remote has skills with suspicious names
    mockClientInstance.listDirectory.mockImplementation(
      async (_owner: string, _repo: string, path: string) => {
        if (path === "skills") {
          return [
            { name: "../../evil", path: "skills/../../evil", type: "dir" },
            { name: "good-skill", path: "skills/good-skill", type: "dir" },
          ];
        }
        if (path === "skills/good-skill") {
          return [{ name: "SKILL.md", path: "skills/good-skill/SKILL.md", type: "file", size: 50 }];
        }
        return [];
      },
    );
    mockClientInstance.getFileContent.mockResolvedValue("content");

    const result = await resolveAndFetchSources({
      sources: [{ source: "https://github.com/org/repo" }],
      baseDir: testDir,
    });

    // Only the good skill should be fetched; the traversal one is skipped
    expect(result.fetchedSkillCount).toBe(1);
    const writeArgs = vi.mocked(writeFileContent).mock.calls.map((call) => call[0]);
    expect(writeArgs.some((p) => p.includes("evil"))).toBe(false);
    expect(writeArgs.some((p) => p.includes("good-skill"))).toBe(true);
  });

  it("should throw when frozen and source not in lockfile", async () => {
    const { readLockFile } = await import("./sources-lock.js");

    vi.mocked(readLockFile).mockResolvedValue({ lockfileVersion: 1, sources: {} });

    await expect(
      resolveAndFetchSources({
        sources: [{ source: "https://github.com/org/repo" }],
        baseDir: testDir,
        options: { frozen: true },
      }),
    ).rejects.toThrow("Frozen install failed");
    expect(mockClientInstance.getDefaultBranch).not.toHaveBeenCalled();
  });

  it("should succeed in frozen mode when lockfile covers all sources and skills exist on disk", async () => {
    const { readLockFile } = await import("./sources-lock.js");
    const curatedDir = join(testDir, RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH);

    vi.mocked(readLockFile).mockResolvedValue({
      lockfileVersion: 1,
      sources: {
        "org/repo": {
          resolvedRef: "sha-123",
          skills: { "my-skill": { integrity: "sha256-xxx" } },
        },
      },
    });

    vi.mocked(directoryExists).mockImplementation(async (path: string) => {
      if (path === join(curatedDir, "my-skill")) return true;
      return false;
    });

    const result = await resolveAndFetchSources({
      sources: [{ source: "https://github.com/org/repo" }],
      baseDir: testDir,
      options: { frozen: true },
    });

    expect(result.fetchedSkillCount).toBe(0);
    expect(result.sourcesProcessed).toBe(1);
  });

  it("should fetch missing locked skills in frozen mode without writing lockfile", async () => {
    const { readLockFile, writeLockFile } = await import("./sources-lock.js");

    vi.mocked(readLockFile).mockResolvedValue({
      lockfileVersion: 1,
      sources: {
        "org/repo": {
          resolvedRef: "sha-123",
          skills: {
            "missing-skill": {
              integrity: "sha256-3cf172cc8bf603e45354b443326e07357681b17caf8caa8c027d64742739a35a",
            },
          },
        },
      },
    });

    // Skill dir does not exist on disk
    vi.mocked(directoryExists).mockResolvedValue(false);

    mockClientInstance.listDirectory.mockImplementation(
      async (_owner: string, _repo: string, path: string) => {
        if (path === "skills") {
          return [{ name: "missing-skill", path: "skills/missing-skill", type: "dir" }];
        }
        if (path === "skills/missing-skill") {
          return [
            { name: "SKILL.md", path: "skills/missing-skill/SKILL.md", type: "file", size: 42 },
          ];
        }
        return [];
      },
    );
    mockClientInstance.getFileContent.mockResolvedValue("locked skill content");

    const result = await resolveAndFetchSources({
      sources: [{ source: "https://github.com/org/repo" }],
      baseDir: testDir,
      options: { frozen: true },
    });

    expect(result).toEqual({ fetchedSkillCount: 1, sourcesProcessed: 1 });
    expect(mockClientInstance.getDefaultBranch).not.toHaveBeenCalled();
    expect(mockClientInstance.resolveRefToSha).not.toHaveBeenCalled();
    expect(writeLockFile).not.toHaveBeenCalled();
  });

  it("should warn when computed integrity differs from locked hash", async () => {
    const { readLockFile } = await import("./sources-lock.js");

    // Lock has a source with a specific integrity hash
    vi.mocked(readLockFile).mockResolvedValue({
      lockfileVersion: 1,
      sources: {
        "org/repo": {
          resolvedRef: "locked-sha-123",
          skills: { "my-skill": { integrity: "sha256-old-hash" } },
        },
      },
    });

    // Skill dir is missing on disk so re-fetch is triggered
    vi.mocked(directoryExists).mockResolvedValue(false);

    // Mock: remote has one skill with different content than what was locked
    mockClientInstance.resolveRefToSha.mockResolvedValue("locked-sha-123");
    mockClientInstance.listDirectory.mockImplementation(
      async (_owner: string, _repo: string, path: string) => {
        if (path === "skills") {
          return [{ name: "my-skill", path: "skills/my-skill", type: "dir" }];
        }
        if (path === "skills/my-skill") {
          return [{ name: "SKILL.md", path: "skills/my-skill/SKILL.md", type: "file", size: 100 }];
        }
        return [];
      },
    );
    mockClientInstance.getFileContent.mockResolvedValue("tampered content");

    await resolveAndFetchSources({
      sources: [{ source: "https://github.com/org/repo" }],
      baseDir: testDir,
    });

    // Should have warned about integrity mismatch
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("Integrity mismatch"));
  });

  it("should throw in frozen mode when integrity mismatch is detected", async () => {
    const { readLockFile } = await import("./sources-lock.js");

    // Lock has a source with a specific integrity hash
    vi.mocked(readLockFile).mockResolvedValue({
      lockfileVersion: 1,
      sources: {
        "org/repo": {
          resolvedRef: "locked-sha-123",
          skills: { "my-skill": { integrity: "sha256-old-hash" } },
        },
      },
    });

    // Skill dir is missing on disk so re-fetch is triggered
    vi.mocked(directoryExists).mockResolvedValue(false);

    // Mock: remote has one skill with different content than what was locked
    mockClientInstance.listDirectory.mockImplementation(
      async (_owner: string, _repo: string, path: string) => {
        if (path === "skills") {
          return [{ name: "my-skill", path: "skills/my-skill", type: "dir" }];
        }
        if (path === "skills/my-skill") {
          return [{ name: "SKILL.md", path: "skills/my-skill/SKILL.md", type: "file", size: 100 }];
        }
        return [];
      },
    );
    mockClientInstance.getFileContent.mockResolvedValue("tampered content");

    await expect(
      resolveAndFetchSources({
        sources: [{ source: "https://github.com/org/repo" }],
        baseDir: testDir,
        options: { frozen: true },
      }),
    ).rejects.toThrow("Frozen install failed: Integrity mismatch");
  });

  it("should preserve lock entries for skipped skills", async () => {
    const { readLockFile, writeLockFile } = await import("./sources-lock.js");

    // Lock has two skills for this source
    vi.mocked(readLockFile).mockResolvedValue({
      lockfileVersion: 1,
      sources: {
        "org/repo": {
          resolvedRef: "locked-sha",
          skills: {
            "local-skill": { integrity: "sha256-local" },
            "remote-skill": { integrity: "sha256-remote" },
          },
        },
      },
    });

    // local-skill exists locally, so it will be skipped
    vi.mocked(directoryExists).mockImplementation(async (path: string) => {
      if (path.endsWith("skills")) return true;
      return false;
    });
    vi.mocked(findFilesByGlobs).mockResolvedValue([join(testDir, ".rulesync/skills/local-skill")]);

    // remote-skill doesn't exist on disk, so SHA-match skip fails and re-fetch happens
    // Remote has only remote-skill
    mockClientInstance.listDirectory.mockImplementation(
      async (_owner: string, _repo: string, path: string) => {
        if (path === "skills") {
          return [
            { name: "local-skill", path: "skills/local-skill", type: "dir" },
            { name: "remote-skill", path: "skills/remote-skill", type: "dir" },
          ];
        }
        if (path === "skills/remote-skill") {
          return [
            {
              name: "SKILL.md",
              path: "skills/remote-skill/SKILL.md",
              type: "file",
              size: 50,
            },
          ];
        }
        return [];
      },
    );
    mockClientInstance.getFileContent.mockResolvedValue("content");

    await resolveAndFetchSources({
      sources: [{ source: "https://github.com/org/repo" }],
      baseDir: testDir,
    });

    // The written lock should still have both skills
    const writeCalls = vi.mocked(writeLockFile).mock.calls;
    expect(writeCalls.length).toBeGreaterThan(0);
    const writtenLock = writeCalls[0]![0].lock;
    const sourceEntry = writtenLock.sources["org/repo"];
    expect(sourceEntry).toBeDefined();
    // local-skill should be preserved from locked entry (it was skipped due to local precedence)
    expect(sourceEntry?.skills["local-skill"]).toBeDefined();
    // remote-skill should have been re-fetched with new integrity
    expect(sourceEntry?.skills["remote-skill"]).toBeDefined();
  });
});
