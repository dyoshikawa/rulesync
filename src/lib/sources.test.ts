import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH } from "../constants/rulesync-paths.js";
import { directoryExists, findFilesByGlobs, removeDirectory, writeFileContent } from "../utils/file.js";
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

vi.mock("./sources-lock.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./sources-lock.js")>();
  return {
    ...actual,
    readLockFile: vi.fn().mockResolvedValue({ sources: {} }),
    writeLockFile: vi.fn().mockResolvedValue(undefined),
  };
});

describe("resolveAndFetchSources", () => {
  beforeEach(() => {
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

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should return zero counts with empty sources", async () => {
    const result = await resolveAndFetchSources({
      sources: [],
      baseDir: "/project",
    });

    expect(result).toEqual({ fetchedSkillCount: 0, sourcesProcessed: 0 });
  });

  it("should skip fetching when skipSources is true", async () => {
    const result = await resolveAndFetchSources({
      sources: [{ source: "https://github.com/org/repo" }],
      baseDir: "/project",
      options: { skipSources: true },
    });

    expect(result).toEqual({ fetchedSkillCount: 0, sourcesProcessed: 0 });
    expect(mockClientInstance.getDefaultBranch).not.toHaveBeenCalled();
  });

  it("should clean curated directory if it exists before fetching", async () => {
    const curatedDir = join("/project", RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH);

    // Curated dir exists
    vi.mocked(directoryExists).mockImplementation(async (path: string) => {
      return path === curatedDir;
    });

    // No remote skills
    mockClientInstance.listDirectory.mockResolvedValue([]);

    await resolveAndFetchSources({
      sources: [{ source: "https://github.com/org/repo" }],
      baseDir: "/project",
    });

    expect(removeDirectory).toHaveBeenCalledWith(curatedDir);
  });

  it("should fetch skills from a remote source", async () => {
    // Mock: remote has one skill directory with one file
    mockClientInstance.listDirectory.mockImplementation(async (_owner: string, _repo: string, path: string) => {
      if (path === "skills") {
        return [{ name: "my-skill", path: "skills/my-skill", type: "dir" }];
      }
      if (path === "skills/my-skill") {
        return [{ name: "SKILL.md", path: "skills/my-skill/SKILL.md", type: "file", size: 100 }];
      }
      return [];
    });
    mockClientInstance.getFileContent.mockResolvedValue("# My Skill\nContent here.");

    const result = await resolveAndFetchSources({
      sources: [{ source: "https://github.com/org/repo" }],
      baseDir: "/project",
    });

    expect(result.fetchedSkillCount).toBe(1);
    expect(result.sourcesProcessed).toBe(1);

    const expectedFilePath = join(
      "/project",
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
    vi.mocked(findFilesByGlobs).mockResolvedValue(["/project/.rulesync/skills/my-skill"]);

    // Remote has same skill name
    mockClientInstance.listDirectory.mockImplementation(async (_owner: string, _repo: string, path: string) => {
      if (path === "skills") {
        return [{ name: "my-skill", path: "skills/my-skill", type: "dir" }];
      }
      return [];
    });

    const result = await resolveAndFetchSources({
      sources: [{ source: "https://github.com/org/repo" }],
      baseDir: "/project",
    });

    // Skill should be skipped since local takes precedence
    expect(result.fetchedSkillCount).toBe(0);
  });

  it("should respect skill filter", async () => {
    // Remote has two skills
    mockClientInstance.listDirectory.mockImplementation(async (_owner: string, _repo: string, path: string) => {
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
    });
    mockClientInstance.getFileContent.mockResolvedValue("content");

    const result = await resolveAndFetchSources({
      sources: [{ source: "https://github.com/org/repo", skills: ["skill-a"] }],
      baseDir: "/project",
    });

    // Only skill-a should be fetched
    expect(result.fetchedSkillCount).toBe(1);
    const writeArgs = vi.mocked(writeFileContent).mock.calls.map((call) => call[0]);
    expect(writeArgs.some((p) => p.includes("skill-a"))).toBe(true);
    expect(writeArgs.some((p) => p.includes("skill-b"))).toBe(false);
  });

  it("should skip duplicate skills from later sources", async () => {
    // Both sources have "shared-skill"
    mockClientInstance.listDirectory.mockImplementation(async (_owner: string, _repo: string, path: string) => {
      if (path === "skills") {
        return [{ name: "shared-skill", path: "skills/shared-skill", type: "dir" }];
      }
      if (path === "skills/shared-skill") {
        return [{ name: "SKILL.md", path: "skills/shared-skill/SKILL.md", type: "file", size: 50 }];
      }
      return [];
    });
    mockClientInstance.getFileContent.mockResolvedValue("content");

    const result = await resolveAndFetchSources({
      sources: [
        { source: "https://github.com/org/repo-a" },
        { source: "https://github.com/org/repo-b" },
      ],
      baseDir: "/project",
    });

    // First source fetches it, second source skips it
    expect(result.fetchedSkillCount).toBe(1);
  });

  it("should handle 404 for skills directory gracefully", async () => {
    const { GitHubClientError } = await import("./github-client.js");
    mockClientInstance.listDirectory.mockRejectedValue(
      new GitHubClientError("Not Found", 404),
    );

    const result = await resolveAndFetchSources({
      sources: [{ source: "https://github.com/org/repo" }],
      baseDir: "/project",
    });

    // Should not throw, just skip the source
    expect(result.fetchedSkillCount).toBe(0);
    expect(result.sourcesProcessed).toBe(1);
  });

  it("should re-resolve refs when updateSources is true", async () => {
    // Set up mock: remote has one skill
    mockClientInstance.listDirectory.mockImplementation(async (_owner: string, _repo: string, path: string) => {
      if (path === "skills") {
        return [{ name: "my-skill", path: "skills/my-skill", type: "dir" }];
      }
      if (path === "skills/my-skill") {
        return [{ name: "SKILL.md", path: "skills/my-skill/SKILL.md", type: "file", size: 100 }];
      }
      return [];
    });
    mockClientInstance.getFileContent.mockResolvedValue("content");

    const result = await resolveAndFetchSources({
      sources: [{ source: "https://github.com/org/repo" }],
      baseDir: "/project",
      options: { updateSources: true },
    });

    // updateSources: true creates empty lock, so resolveRefToSha must be called
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
    mockClientInstance.listDirectory.mockImplementation(async (_owner: string, _repo: string, path: string) => {
      if (path === "skills") {
        return [{ name: "good-skill", path: "skills/good-skill", type: "dir" }];
      }
      if (path === "skills/good-skill") {
        return [{ name: "SKILL.md", path: "skills/good-skill/SKILL.md", type: "file", size: 50 }];
      }
      return [];
    });
    mockClientInstance.getFileContent.mockResolvedValue("content");

    const result = await resolveAndFetchSources({
      sources: [
        { source: "https://github.com/org/failing-repo" },
        { source: "https://github.com/org/good-repo" },
      ],
      baseDir: "/project",
    });

    // Second source should succeed despite first failing
    expect(result.fetchedSkillCount).toBe(1);
    expect(result.sourcesProcessed).toBe(2);
  });

  it("should handle GitLab source gracefully", async () => {
    const result = await resolveAndFetchSources({
      sources: [{ source: "gitlab:org/repo" }],
      baseDir: "/project",
    });

    // Should not throw, but log error and skip
    expect(result.fetchedSkillCount).toBe(0);
    expect(result.sourcesProcessed).toBe(1);
  });

  it("should prune stale lockfile entries for removed sources", async () => {
    const { readLockFile, writeLockFile } = await import("./sources-lock.js");

    // Pre-existing lock has an entry for a source that's no longer in config
    vi.mocked(readLockFile).mockResolvedValue({
      sources: {
        "https://github.com/org/old-removed-repo": {
          resolvedRef: "old-sha",
          skills: ["old-skill"],
        },
      },
    });

    // No remote skills for new source
    mockClientInstance.listDirectory.mockResolvedValue([]);

    await resolveAndFetchSources({
      sources: [{ source: "https://github.com/org/new-repo" }],
      baseDir: "/project",
    });

    // The written lock should NOT contain the old-removed-repo entry
    const writeCalls = vi.mocked(writeLockFile).mock.calls;
    expect(writeCalls.length).toBeGreaterThan(0);
    const writtenLock = writeCalls[0]![0].lock;
    expect(writtenLock.sources["https://github.com/org/old-removed-repo"]).toBeUndefined();
  });
});
