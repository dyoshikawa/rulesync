import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_CURATED_RULES_RELATIVE_DIR_PATH,
  RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
} from "../constants/rulesync-paths.js";
import { createMockLogger } from "../test-utils/mock-logger.js";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import {
  directoryExists,
  fileExists,
  findFilesByGlobs,
  readFileContent,
  removeDirectoryStrict as removeDirectory,
  removeFileStrict as removeFile,
  writeFileContent,
} from "../utils/file.js";
import { computeRuleIntegrity } from "./sources-lock.js";
import {
  getInstalledSourceRuleNames,
  getInstalledSourceSkillNames,
  resolveAndFetchSources,
} from "./sources.js";

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
    fileExists: vi.fn(),
    findFilesByGlobs: vi.fn(),
    readFileContent: vi.fn(),
    removeDirectoryStrict: vi.fn(),
    removeFileStrict: vi.fn(),
    writeFileContent: vi.fn(),
    assertDirectoryIfExists: vi.fn(),
    assertTreeContainsNoSymlinks: vi.fn(),
    assertWritablePathInsideRoot: vi.fn(),
  };
});

const logger = createMockLogger();

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
  fetchSkillFiles: vi.fn(),
}));

vi.mock("./npm-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./npm-client.js")>();
  return {
    ...actual,
    fetchPackument: vi.fn(),
    fetchTarball: vi.fn(),
    getPackumentVersionDist: vi.fn(),
    resolveNpmToken: vi.fn(),
    resolvePackumentVersion: vi.fn(),
    verifyTarballIntegrity: vi.fn(),
  };
});

vi.mock("./npm-tar.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./npm-tar.js")>();
  return {
    ...actual,
    extractPackageTarball: vi.fn(),
  };
});

vi.mock("./sources-lock.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./sources-lock.js")>();
  return {
    ...actual,
    readLockFile: vi.fn().mockResolvedValue({ lockfileVersion: 1, sources: {} }),
    writeLockFile: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("./npm-sources-lock.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./npm-sources-lock.js")>();
  return {
    ...actual,
    readNpmLockFile: vi.fn().mockResolvedValue({ lockfileVersion: 1, sources: {} }),
    writeNpmLockFile: vi.fn().mockResolvedValue(undefined),
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
    vi.mocked(fileExists).mockResolvedValue(false);
    vi.mocked(findFilesByGlobs).mockResolvedValue([]);
    vi.mocked(readFileContent).mockResolvedValue("");
    vi.mocked(removeDirectory).mockResolvedValue(undefined);
    vi.mocked(removeFile).mockResolvedValue(undefined);
    vi.mocked(writeFileContent).mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await cleanup();
    vi.clearAllMocks();
  });

  it("should return zero counts with empty sources", async () => {
    const result = await resolveAndFetchSources({ logger, sources: [], projectRoot: testDir });

    expect(result).toEqual({
      fetchedSkillCount: 0,
      fetchedRuleCount: 0,
      sourcesProcessed: 0,
      failedSourceCount: 0,
    });
  });

  it("should skip fetching when skipSources is true", async () => {
    const result = await resolveAndFetchSources({
      logger,
      sources: [{ source: "https://github.com/org/repo" }],
      projectRoot: testDir,
      options: { skipSources: true },
    });

    expect(result).toEqual({
      fetchedSkillCount: 0,
      fetchedRuleCount: 0,
      sourcesProcessed: 0,
      failedSourceCount: 0,
    });
    expect(mockClientInstance.getDefaultBranch).not.toHaveBeenCalled();
  });

  it("should reserve skill names from fully installed existing sources", async () => {
    const { readLockFile } = await import("./sources-lock.js");
    vi.mocked(readLockFile).mockResolvedValue({
      lockfileVersion: 1,
      sources: {
        "org/existing": {
          resolvedRef: "existing-sha",
          skills: { "existing-skill": { integrity: "sha256-existing" } },
        },
      },
    });
    vi.mocked(directoryExists).mockResolvedValue(true);

    const result = await getInstalledSourceSkillNames({
      sources: [{ source: "org/existing" }],
      projectRoot: testDir,
      logger,
    });

    expect(result).toEqual(["existing-skill"]);
  });

  it("should reserve rule names from fully installed existing sources", async () => {
    const { readLockFile } = await import("./sources-lock.js");
    vi.mocked(readLockFile).mockResolvedValue({
      lockfileVersion: 1,
      sources: {
        "org/existing": {
          resolvedRef: "existing-sha",
          skills: {},
          rules: {
            "testing-guidelines": {
              integrity: computeRuleIntegrity(""),
            },
          },
          ruleSelection: ["testing-guidelines"],
          rulesPath: "rules",
          resolvedRuleNames: ["testing-guidelines"],
        },
      },
    });
    vi.mocked(fileExists).mockResolvedValue(true);

    const result = await getInstalledSourceRuleNames({
      sources: [{ source: "org/existing", rules: ["testing-guidelines"] }],
      projectRoot: testDir,
      logger,
    });

    expect(result).toEqual(["testing-guidelines"]);
  });

  it("should reject a rule source whose lock predates rule tracking", async () => {
    const { readLockFile } = await import("./sources-lock.js");
    vi.mocked(readLockFile).mockResolvedValue({
      lockfileVersion: 1,
      sources: {
        "org/existing": {
          resolvedRef: "existing-sha",
          skills: {},
        },
      },
    });

    await expect(
      getInstalledSourceRuleNames({
        sources: [{ source: "org/existing", rules: ["testing-guidelines"] }],
        projectRoot: testDir,
        logger,
      }),
    ).rejects.toThrow(/Run 'rulesync install' before adding another source/);
  });

  it("should reject an existing source that is not locked and installed", async () => {
    const { readLockFile } = await import("./sources-lock.js");
    vi.mocked(readLockFile).mockResolvedValue({ lockfileVersion: 1, sources: {} });

    await expect(
      getInstalledSourceSkillNames({
        sources: [{ source: "org/missing" }],
        projectRoot: testDir,
        logger,
      }),
    ).rejects.toThrow(/Run 'rulesync install' before adding another source/);
  });

  it("should preserve locked skill directories when no remote skills match", async () => {
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

    // old-skill-a exists on disk, old-skill-b does not, so the resolver checks the remote.
    vi.mocked(directoryExists).mockImplementation(async (path: string) => {
      if (path === join(curatedDir, "old-skill-a")) return true;
      return false;
    });

    // No remote skills after cleanup
    mockClientInstance.listDirectory.mockResolvedValue([]);

    await resolveAndFetchSources({
      logger,
      sources: [{ source: "https://github.com/org/repo" }],
      projectRoot: testDir,
    });

    // A source with no matching remote skills fails before mutating the previous install.
    expect(removeDirectory).not.toHaveBeenCalledWith(join(curatedDir, "old-skill-a"));
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
      logger,
      sources: [{ source: "https://github.com/org/repo" }],
      projectRoot: testDir,
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
      logger,
      sources: [{ source: "https://github.com/org/repo" }],
      projectRoot: testDir,
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

  it("should fetch only selected rules from a GitHub source", async () => {
    mockClientInstance.listDirectory.mockImplementation(
      async (_owner: string, _repo: string, path: string) => {
        if (path === "exports/rules") {
          return [
            {
              name: "typescript-conventions.md",
              path: "exports/rules/typescript-conventions.md",
              type: "file",
              size: 100,
            },
            {
              name: "testing-guidelines.md",
              path: "exports/rules/testing-guidelines.md",
              type: "file",
              size: 100,
            },
          ];
        }
        return [];
      },
    );
    mockClientInstance.getFileContent.mockResolvedValue("---\ntargets: ['*']\n---\nUse Vitest.");

    const result = await resolveAndFetchSources({
      logger,
      sources: [
        {
          source: "https://github.com/org/repo",
          rules: ["testing-guidelines"],
          rulesPath: "exports/rules",
        },
      ],
      projectRoot: testDir,
    });

    expect(result.fetchedSkillCount).toBe(0);
    expect(result.fetchedRuleCount).toBe(1);
    expect(mockClientInstance.listDirectory).not.toHaveBeenCalledWith(
      "org",
      "repo",
      "skills",
      expect.any(String),
    );
    expect(writeFileContent).toHaveBeenCalledWith(
      join(testDir, RULESYNC_CURATED_RULES_RELATIVE_DIR_PATH, "testing-guidelines.md"),
      "---\ntargets: ['*']\n---\nUse Vitest.",
    );
    const { writeLockFile } = await import("./sources-lock.js");
    expect(vi.mocked(writeLockFile).mock.calls.at(-1)?.[0].lock.sources["org/repo"]).toMatchObject({
      ruleSelection: ["testing-guidelines"],
      rulesPath: "exports/rules",
      resolvedRuleNames: ["testing-guidelines"],
    });
  });

  it("should reuse one resolved SHA for skills and rules from the same source", async () => {
    const { writeLockFile } = await import("./sources-lock.js");
    const firstSha = "a".repeat(40);
    const secondSha = "b".repeat(40);
    mockClientInstance.resolveRefToSha
      .mockResolvedValueOnce(firstSha)
      .mockResolvedValueOnce(secondSha);
    mockClientInstance.listDirectory.mockImplementation(
      async (_owner: string, _repo: string, path: string) => {
        if (path === "skills") {
          return [{ name: "shared", path: "skills/shared", type: "dir" }];
        }
        if (path === "skills/shared") {
          return [{ name: "SKILL.md", path: "skills/shared/SKILL.md", type: "file", size: 50 }];
        }
        if (path === "rules") {
          return [{ name: "shared.md", path: "rules/shared.md", type: "file", size: 50 }];
        }
        return [];
      },
    );

    const result = await resolveAndFetchSources({
      logger,
      sources: [{ source: "org/repo", skills: ["shared"], rules: ["shared"] }],
      projectRoot: testDir,
      options: { updateSources: true },
    });

    expect(result.fetchedSkillCount).toBe(1);
    expect(result.fetchedRuleCount).toBe(1);
    expect(mockClientInstance.resolveRefToSha).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(writeLockFile).mock.calls.at(-1)?.[0].lock.sources["org/repo"]?.resolvedRef,
    ).toBe(firstSha);
  });

  it("should reject prototype-polluting rule names", async () => {
    mockClientInstance.listDirectory.mockResolvedValue([
      { name: "__proto__.md", path: "rules/__proto__.md", type: "file", size: 100 },
    ]);

    const result = await resolveAndFetchSources({
      logger,
      sources: [{ source: "org/repo", rules: ["*"] }],
      projectRoot: testDir,
    });

    expect(result.failedSourceCount).toBe(1);
    expect(result.fetchedRuleCount).toBe(0);
    expect(mockClientInstance.getFileContent).not.toHaveBeenCalled();
    expect(writeFileContent).not.toHaveBeenCalledWith(
      join(testDir, RULESYNC_CURATED_RULES_RELATIVE_DIR_PATH, "__proto__.md"),
      expect.any(String),
    );
  });

  it("should preserve existing rules when a GitHub download fails", async () => {
    const { readLockFile } = await import("./sources-lock.js");
    vi.mocked(readLockFile).mockResolvedValue({
      lockfileVersion: 1,
      sources: {
        "org/repo": {
          resolvedRef: "old-sha",
          skills: {},
          rules: { old: { integrity: computeRuleIntegrity("old content") } },
          ruleSelection: ["*"],
          rulesPath: "rules",
          resolvedRuleNames: ["old"],
        },
      },
    });
    vi.mocked(fileExists).mockResolvedValue(true);
    vi.mocked(readFileContent).mockResolvedValue("old content");
    mockClientInstance.listDirectory.mockResolvedValue([
      { name: "new.md", path: "rules/new.md", type: "file", size: 100 },
    ]);
    mockClientInstance.getFileContent.mockRejectedValue(new Error("download failed"));

    const result = await resolveAndFetchSources({
      logger,
      sources: [{ source: "org/repo", rules: ["*"] }],
      projectRoot: testDir,
      options: { updateSources: true },
    });

    expect(result.failedSourceCount).toBe(1);
    expect(removeFile).not.toHaveBeenCalledWith(
      join(testDir, RULESYNC_CURATED_RULES_RELATIVE_DIR_PATH, "old.md"),
    );
  });

  it("should restore existing rules when writing a replacement fails", async () => {
    const { readLockFile } = await import("./sources-lock.js");
    const oldRulePath = join(testDir, RULESYNC_CURATED_RULES_RELATIVE_DIR_PATH, "old.md");
    const newRulePath = join(testDir, RULESYNC_CURATED_RULES_RELATIVE_DIR_PATH, "new.md");
    vi.mocked(readLockFile).mockResolvedValue({
      lockfileVersion: 1,
      sources: {
        "org/repo": {
          resolvedRef: "old-sha",
          skills: {},
          rules: { old: { integrity: computeRuleIntegrity("old content") } },
          ruleSelection: ["*"],
          rulesPath: "rules",
          resolvedRuleNames: ["old"],
        },
      },
    });
    vi.mocked(fileExists).mockResolvedValue(true);
    vi.mocked(readFileContent).mockResolvedValue("old content");
    mockClientInstance.listDirectory.mockResolvedValue([
      { name: "new.md", path: "rules/new.md", type: "file", size: 100 },
    ]);
    mockClientInstance.getFileContent.mockResolvedValue("new content");
    vi.mocked(writeFileContent).mockImplementation(async (path) => {
      if (path === newRulePath) {
        throw new Error("write failed");
      }
    });

    const result = await resolveAndFetchSources({
      logger,
      sources: [{ source: "org/repo", rules: ["*"] }],
      projectRoot: testDir,
      options: { updateSources: true },
    });

    expect(result.failedSourceCount).toBe(1);
    expect(removeFile).toHaveBeenCalledWith(newRulePath);
    expect(writeFileContent).toHaveBeenCalledWith(oldRulePath, "old content");
  });

  it("should let a local rule override a curated rule with the same name", async () => {
    vi.mocked(findFilesByGlobs).mockResolvedValue([
      join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "testing-guidelines.md"),
    ]);
    mockClientInstance.listDirectory.mockResolvedValue([
      {
        name: "testing-guidelines.md",
        path: "rules/testing-guidelines.md",
        type: "file",
        size: 100,
      },
    ]);

    const result = await resolveAndFetchSources({
      logger,
      sources: [{ source: "https://github.com/org/repo", rules: ["testing-guidelines"] }],
      projectRoot: testDir,
    });

    expect(result.fetchedRuleCount).toBe(0);
    expect(mockClientInstance.getFileContent).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining("local rule takes precedence"),
    );
  });

  it("should remove a formerly owned curated rule even when a local rule has the same name", async () => {
    const { readLockFile } = await import("./sources-lock.js");
    const curatedRulePath = join(
      testDir,
      RULESYNC_CURATED_RULES_RELATIVE_DIR_PATH,
      "testing-guidelines.md",
    );
    const curatedSkillDir = join(
      testDir,
      RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH,
      "cached-skill",
    );
    vi.mocked(readLockFile).mockResolvedValue({
      lockfileVersion: 1,
      sources: {
        "org/repo": {
          resolvedRef: "locked-sha",
          skills: { "cached-skill": { integrity: "sha256-cached" } },
          rules: { "testing-guidelines": { integrity: "sha256-old" } },
          ruleSelection: ["testing-guidelines"],
          rulesPath: "rules",
          resolvedRuleNames: ["testing-guidelines"],
        },
      },
    });
    vi.mocked(directoryExists).mockImplementation(async (path) => path === curatedSkillDir);
    vi.mocked(fileExists).mockImplementation(async (path) => path === curatedRulePath);
    vi.mocked(findFilesByGlobs).mockResolvedValue([
      join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "testing-guidelines.md"),
    ]);

    const result = await resolveAndFetchSources({
      logger,
      sources: [{ source: "org/repo" }],
      projectRoot: testDir,
    });

    expect(result.failedSourceCount).toBe(0);
    expect(removeFile).toHaveBeenCalledWith(curatedRulePath);
  });

  it("should retain rule ownership when curated cleanup fails", async () => {
    const { readLockFile, writeLockFile } = await import("./sources-lock.js");
    const curatedRulePath = join(testDir, RULESYNC_CURATED_RULES_RELATIVE_DIR_PATH, "old.md");
    const curatedSkillDir = join(
      testDir,
      RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH,
      "cached-skill",
    );
    vi.mocked(readLockFile).mockResolvedValue({
      lockfileVersion: 1,
      sources: {
        "org/repo": {
          resolvedRef: "locked-sha",
          skills: { "cached-skill": { integrity: "sha256-cached" } },
          rules: { old: { integrity: "sha256-old" } },
          ruleSelection: ["old"],
          rulesPath: "rules",
          resolvedRuleNames: ["old"],
        },
      },
    });
    vi.mocked(directoryExists).mockImplementation(async (path) => path === curatedSkillDir);
    vi.mocked(fileExists).mockImplementation(async (path) => path === curatedRulePath);
    vi.mocked(removeFile).mockRejectedValue(new Error("delete failed"));

    const result = await resolveAndFetchSources({
      logger,
      sources: [{ source: "org/repo" }],
      projectRoot: testDir,
    });

    expect(result.failedSourceCount).toBe(1);
    expect(writeLockFile).not.toHaveBeenCalled();
  });

  it("should let the first declared source win for duplicate rules", async () => {
    mockClientInstance.listDirectory.mockResolvedValue([
      {
        name: "shared.md",
        path: "rules/shared.md",
        type: "file",
        size: 100,
      },
    ]);
    mockClientInstance.getFileContent.mockImplementation(
      async (owner: string) => `---\ntargets: ['*']\n---\nFrom ${owner}`,
    );

    const result = await resolveAndFetchSources({
      logger,
      sources: [
        { source: "first/repo", rules: ["shared"] },
        { source: "second/repo", rules: ["shared"] },
      ],
      projectRoot: testDir,
    });

    expect(result.fetchedRuleCount).toBe(1);
    expect(writeFileContent).toHaveBeenCalledTimes(1);
    expect(writeFileContent).toHaveBeenCalledWith(
      join(testDir, RULESYNC_CURATED_RULES_RELATIVE_DIR_PATH, "shared.md"),
      "---\ntargets: ['*']\n---\nFrom first",
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("already fetched from another source"),
    );
  });

  it("should not remove a duplicate rule already written by an earlier source", async () => {
    const { readLockFile } = await import("./sources-lock.js");
    vi.mocked(readLockFile).mockResolvedValue({
      lockfileVersion: 1,
      sources: {
        "second/repo": {
          resolvedRef: "abc123def456",
          skills: {},
          rules: { shared: { integrity: "sha256-old" } },
        },
      },
    });
    vi.mocked(fileExists).mockResolvedValue(true);
    mockClientInstance.listDirectory.mockResolvedValue([
      { name: "shared.md", path: "rules/shared.md", type: "file", size: 100 },
    ]);

    const result = await resolveAndFetchSources({
      logger,
      sources: [
        { source: "first/repo", rules: ["shared"] },
        { source: "second/repo", rules: ["shared"] },
      ],
      projectRoot: testDir,
    });

    expect(result.fetchedRuleCount).toBe(1);
    expect(removeFile).not.toHaveBeenCalledWith(
      join(testDir, RULESYNC_CURATED_RULES_RELATIVE_DIR_PATH, "shared.md"),
    );
  });

  it("should fetch selected rules through the git transport", async () => {
    const { resolveDefaultRef, fetchSkillFiles } = await import("./git-client.js");
    vi.mocked(resolveDefaultRef).mockResolvedValue({ ref: "main", sha: "a".repeat(40) });
    vi.mocked(fetchSkillFiles).mockResolvedValue([
      {
        relativePath: "testing-guidelines.md",
        content: "---\ntargets: ['*']\n---\nUse Vitest.",
        size: 50,
      },
      {
        relativePath: "typescript-conventions.md",
        content: "---\ntargets: ['*']\n---\nUse TypeScript.",
        size: 60,
      },
    ]);

    const result = await resolveAndFetchSources({
      logger,
      sources: [
        {
          source: "https://example.com/team/rules.git",
          transport: "git",
          rules: ["testing-guidelines"],
          rulesPath: "exports/rules",
        },
      ],
      projectRoot: testDir,
    });

    expect(result.fetchedRuleCount).toBe(1);
    expect(fetchSkillFiles).toHaveBeenCalledWith({
      url: "https://example.com/team/rules.git",
      ref: "main",
      resolvedRef: "a".repeat(40),
      skillsPath: "exports/rules",
      logger,
    });
  });

  it("should fetch selected rules through the npm transport", async () => {
    const {
      fetchPackument,
      fetchTarball,
      getPackumentVersionDist,
      resolveNpmToken,
      resolvePackumentVersion,
    } = await import("./npm-client.js");
    const { extractPackageTarball } = await import("./npm-tar.js");
    vi.mocked(resolveNpmToken).mockReturnValue(undefined);
    vi.mocked(fetchPackument).mockResolvedValue({});
    vi.mocked(resolvePackumentVersion).mockReturnValue("1.0.0");
    vi.mocked(getPackumentVersionDist).mockReturnValue({
      tarball: "https://registry.npmjs.org/example/-/example-1.0.0.tgz",
      integrity: "sha512-example",
    });
    vi.mocked(fetchTarball).mockResolvedValue(Buffer.from("tarball"));
    vi.mocked(extractPackageTarball).mockReturnValue([
      {
        relativePath: "exports/rules/testing-guidelines.md",
        content: Buffer.from("---\ntargets: ['*']\n---\nUse Vitest."),
      },
      {
        relativePath: "exports/rules/typescript-conventions.md",
        content: Buffer.from("---\ntargets: ['*']\n---\nUse TypeScript."),
      },
    ]);

    const result = await resolveAndFetchSources({
      logger,
      sources: [
        {
          source: "example",
          transport: "npm",
          rules: ["testing-guidelines"],
          rulesPath: "exports/rules",
        },
      ],
      projectRoot: testDir,
    });

    expect(result.fetchedSkillCount).toBe(0);
    expect(result.fetchedRuleCount).toBe(1);
    expect(writeFileContent).toHaveBeenCalledWith(
      join(testDir, RULESYNC_CURATED_RULES_RELATIVE_DIR_PATH, "testing-guidelines.md"),
      "---\ntargets: ['*']\n---\nUse Vitest.",
    );
  });

  it("should omit rule state for an npm source that only installs skills", async () => {
    const {
      fetchPackument,
      fetchTarball,
      getPackumentVersionDist,
      resolveNpmToken,
      resolvePackumentVersion,
    } = await import("./npm-client.js");
    const { extractPackageTarball } = await import("./npm-tar.js");
    const { writeNpmLockFile } = await import("./npm-sources-lock.js");
    vi.mocked(resolveNpmToken).mockReturnValue(undefined);
    vi.mocked(fetchPackument).mockResolvedValue({});
    vi.mocked(resolvePackumentVersion).mockReturnValue("1.0.0");
    vi.mocked(getPackumentVersionDist).mockReturnValue({
      tarball: "https://registry.npmjs.org/example/-/example-1.0.0.tgz",
      integrity: "sha512-example",
    });
    vi.mocked(fetchTarball).mockResolvedValue(Buffer.from("tarball"));
    vi.mocked(extractPackageTarball).mockReturnValue([
      { relativePath: "skills/example/SKILL.md", content: Buffer.from("# Example") },
    ]);

    const result = await resolveAndFetchSources({
      logger,
      sources: [{ source: "example", transport: "npm" }],
      projectRoot: testDir,
    });

    expect(result.fetchedSkillCount).toBe(1);
    const locked = vi.mocked(writeNpmLockFile).mock.calls.at(-1)?.[0].lock.sources.example;
    expect(locked).toBeDefined();
    expect(locked).not.toHaveProperty("rules");
    expect(locked).not.toHaveProperty("ruleSelection");
  });

  it("should honor ref and path fields for a GitHub source", async () => {
    const { readLockFile } = await import("./sources-lock.js");
    vi.mocked(readLockFile).mockResolvedValue({ lockfileVersion: 1, sources: {} });
    mockClientInstance.listDirectory.mockImplementation(
      async (_owner: string, _repo: string, path: string) => {
        if (path === "exports/skills") {
          return [{ name: "my-skill", path: "exports/skills/my-skill", type: "dir" }];
        }
        if (path === "exports/skills/my-skill") {
          return [
            {
              name: "SKILL.md",
              path: "exports/skills/my-skill/SKILL.md",
              type: "file",
              size: 100,
            },
          ];
        }
        return [];
      },
    );

    const result = await resolveAndFetchSources({
      logger,
      sources: [
        {
          source: "https://github.com/org/repo",
          ref: "trusted-release",
          path: "exports/skills",
        },
      ],
      projectRoot: testDir,
    });

    expect(result.fetchedSkillCount).toBe(1);
    expect(mockClientInstance.getDefaultBranch).not.toHaveBeenCalled();
    expect(mockClientInstance.resolveRefToSha).toHaveBeenCalledWith(
      "org",
      "repo",
      "trusted-release",
    );
    expect(mockClientInstance.listDirectory).toHaveBeenCalledWith(
      "org",
      "repo",
      "exports/skills",
      "abc123def456",
    );
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
      logger,
      sources: [{ source: "https://github.com/org/repo" }],
      projectRoot: testDir,
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
      logger,
      sources: [{ source: "https://github.com/org/repo", skills: ["skill-a"] }],
      projectRoot: testDir,
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
      logger,
      sources: [
        { source: "https://github.com/org/repo-a" },
        { source: "https://github.com/org/repo-b" },
      ],
      projectRoot: testDir,
    });

    // First source fetches it, second source skips it
    expect(result.fetchedSkillCount).toBe(1);
  });

  it("should handle 404 for skills directory gracefully", async () => {
    const { GitHubClientError } = await import("./github-client.js");
    mockClientInstance.listDirectory.mockRejectedValue(new GitHubClientError("Not Found", 404));

    const result = await resolveAndFetchSources({
      logger,
      sources: [{ source: "https://github.com/org/repo" }],
      projectRoot: testDir,
    });

    // Should not throw, just skip the source
    expect(result.fetchedSkillCount).toBe(0);
    expect(result.sourcesProcessed).toBe(1);
    expect(result.failedSourceCount).toBe(1);
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
      logger,
      sources: [{ source: "https://github.com/org/repo" }],
      projectRoot: testDir,
      options: { updateSources: true },
    });

    // updateSources: true must resolve a fresh SHA instead of reusing the old lock entry.
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
      logger,
      sources: [
        { source: "https://github.com/org/failing-repo" },
        { source: "https://github.com/org/good-repo" },
      ],
      projectRoot: testDir,
    });

    // Second source should succeed despite first failing
    expect(result.fetchedSkillCount).toBe(1);
    expect(result.sourcesProcessed).toBe(2);
    expect(result.failedSourceCount).toBe(1);
  });

  it("should handle GitLab source gracefully", async () => {
    const result = await resolveAndFetchSources({
      logger,
      sources: [{ source: "gitlab:org/repo" }],
      projectRoot: testDir,
    });

    // Should not throw, but log error and skip
    expect(result.fetchedSkillCount).toBe(0);
    expect(result.sourcesProcessed).toBe(1);
    expect(result.failedSourceCount).toBe(1);
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
      logger,
      sources: [{ source: "https://github.com/org/new-repo" }],
      projectRoot: testDir,
    });

    // The written lock should NOT contain the old-removed-repo entry
    const writeCalls = vi.mocked(writeLockFile).mock.calls;
    expect(writeCalls.length).toBeGreaterThan(0);
    const writtenLock = writeCalls[0]![0].lock;
    expect(writtenLock.sources["org/old-removed-repo"]).toBeUndefined();
    // The current source should be preserved (normalized key)
    expect(writtenLock.sources["org/new-repo"]).toBeDefined();
  });

  it("should remove stale rules when all sources are removed", async () => {
    const { readLockFile, writeLockFile } = await import("./sources-lock.js");
    const staleRulePath = join(testDir, RULESYNC_CURATED_RULES_RELATIVE_DIR_PATH, "stale-rule.md");
    vi.mocked(readLockFile).mockResolvedValue({
      lockfileVersion: 1,
      sources: {
        "org/removed": {
          resolvedRef: "old-sha",
          skills: {},
          rules: { "stale-rule": { integrity: "sha256-old" } },
          ruleSelection: ["stale-rule"],
          rulesPath: "rules",
          resolvedRuleNames: ["stale-rule"],
        },
      },
    });
    vi.mocked(fileExists).mockImplementation(async (path) => path === staleRulePath);

    const result = await resolveAndFetchSources({ logger, sources: [], projectRoot: testDir });

    expect(result.sourcesProcessed).toBe(0);
    expect(removeFile).toHaveBeenCalledWith(staleRulePath);
    expect(vi.mocked(writeLockFile).mock.calls.at(-1)?.[0].lock.sources).toEqual({});
  });

  it("should not remove stale artifacts in frozen mode", async () => {
    const { readLockFile, writeLockFile } = await import("./sources-lock.js");
    vi.mocked(readLockFile).mockResolvedValue({
      lockfileVersion: 1,
      sources: {
        "org/removed": {
          resolvedRef: "old-sha",
          skills: {},
          rules: { "stale-rule": { integrity: "sha256-old" } },
          ruleSelection: ["stale-rule"],
          rulesPath: "rules",
          resolvedRuleNames: ["stale-rule"],
        },
      },
    });
    vi.mocked(fileExists).mockResolvedValue(true);

    await resolveAndFetchSources({
      logger,
      sources: [],
      projectRoot: testDir,
      options: { frozen: true },
    });

    expect(removeFile).not.toHaveBeenCalled();
    expect(writeLockFile).not.toHaveBeenCalled();
  });

  it("should preserve unlisted lock entries when resolving only a newly added source", async () => {
    const { readLockFile, writeLockFile } = await import("./sources-lock.js");
    vi.mocked(readLockFile).mockResolvedValue({
      lockfileVersion: 1,
      sources: {
        "org/existing-repo": {
          resolvedRef: "existing-sha",
          skills: { "existing-skill": { integrity: "sha256-existing" } },
        },
        "org/new-repo": {
          resolvedRef: "stale-sha",
          skills: { "stale-skill": { integrity: "sha256-stale" } },
        },
      },
    });
    vi.mocked(directoryExists).mockResolvedValue(true);
    mockClientInstance.listDirectory.mockImplementation(
      async (_owner: string, _repo: string, path: string) => {
        if (path === "skills") {
          return [{ name: "new-skill", path: "skills/new-skill", type: "dir" }];
        }
        if (path === "skills/new-skill") {
          return [{ name: "SKILL.md", path: "skills/new-skill/SKILL.md", type: "file", size: 50 }];
        }
        return [];
      },
    );

    const result = await resolveAndFetchSources({
      logger,
      sources: [{ source: "https://github.com/org/new-repo" }],
      projectRoot: testDir,
      options: {
        updateSources: true,
        preserveUnlistedLockEntries: true,
        requireResolvedSkills: true,
      },
    });

    expect(result.failedSourceCount).toBe(0);
    const writeCalls = vi.mocked(writeLockFile).mock.calls;
    const writtenLock = writeCalls.at(-1)![0].lock;
    expect(writtenLock.sources["org/existing-repo"]).toBeDefined();
    expect(writtenLock.sources["org/new-repo"]).toBeDefined();
    expect(writtenLock.sources["org/new-repo"]?.skills["stale-skill"]).toBeUndefined();
    expect(removeDirectory).toHaveBeenCalledWith(
      join(testDir, RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH, "stale-skill"),
    );
    expect(removeDirectory).not.toHaveBeenCalledWith(
      join(testDir, RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH, "existing-skill"),
    );
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
      logger,
      // Config uses full URL but lock has normalized key
      sources: [{ source: "https://github.com/org/repo" }],
      projectRoot: testDir,
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
      logger,
      sources: [{ source: "https://github.com/org/repo" }],
      projectRoot: testDir,
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
        logger,
        sources: [{ source: "https://github.com/org/repo" }],
        projectRoot: testDir,
        options: { frozen: true },
      }),
    ).rejects.toThrow("Frozen install failed");
    expect(mockClientInstance.getDefaultBranch).not.toHaveBeenCalled();
  });

  it("should throw when frozen and requested rules are missing from the lockfile", async () => {
    const { readLockFile } = await import("./sources-lock.js");
    vi.mocked(readLockFile).mockResolvedValue({
      lockfileVersion: 1,
      sources: {
        "org/repo": {
          resolvedRef: "sha-123",
          skills: {},
        },
      },
    });

    await expect(
      resolveAndFetchSources({
        logger,
        sources: [{ source: "org/repo", rules: ["testing-guidelines"] }],
        projectRoot: testDir,
        options: { frozen: true },
      }),
    ).rejects.toThrow("Frozen install failed");
    expect(mockClientInstance.listDirectory).not.toHaveBeenCalled();
  });

  it("should allow a frozen rule selection satisfied by a local rule", async () => {
    const { readLockFile } = await import("./sources-lock.js");
    vi.mocked(readLockFile).mockResolvedValue({
      lockfileVersion: 1,
      sources: {
        "org/repo": {
          resolvedRef: "sha-123",
          skills: {},
          rules: {},
          ruleSelection: ["testing-guidelines"],
          rulesPath: "rules",
          resolvedRuleNames: ["testing-guidelines"],
        },
      },
    });
    vi.mocked(findFilesByGlobs).mockResolvedValue([
      join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "testing-guidelines.md"),
    ]);
    mockClientInstance.listDirectory.mockResolvedValue([
      {
        name: "testing-guidelines.md",
        path: "rules/testing-guidelines.md",
        type: "file",
        size: 50,
      },
    ]);

    const result = await resolveAndFetchSources({
      logger,
      sources: [{ source: "org/repo", rules: ["testing-guidelines"] }],
      projectRoot: testDir,
      options: { frozen: true },
    });

    expect(result.failedSourceCount).toBe(0);
    expect(result.fetchedRuleCount).toBe(0);
  });

  it("should refetch when the declared rule selection differs from the lockfile", async () => {
    const { readLockFile } = await import("./sources-lock.js");
    vi.mocked(readLockFile).mockResolvedValue({
      lockfileVersion: 1,
      sources: {
        "org/repo": {
          resolvedRef: "sha-123",
          skills: {},
          rules: { old: { integrity: "sha256-old" } },
          ruleSelection: ["old"],
          rulesPath: "rules",
          resolvedRuleNames: ["old"],
        },
      },
    });
    vi.mocked(fileExists).mockResolvedValue(true);
    mockClientInstance.listDirectory.mockResolvedValue([
      { name: "new.md", path: "rules/new.md", type: "file", size: 50 },
    ]);

    const result = await resolveAndFetchSources({
      logger,
      sources: [{ source: "org/repo", rules: ["new"] }],
      projectRoot: testDir,
    });

    expect(result.fetchedRuleCount).toBe(1);
    expect(mockClientInstance.listDirectory).toHaveBeenCalled();
    expect(removeFile).toHaveBeenCalledWith(
      join(testDir, RULESYNC_CURATED_RULES_RELATIVE_DIR_PATH, "old.md"),
    );
  });

  it("should refetch when an explicit rule selection changes to a wildcard", async () => {
    const { readLockFile, writeLockFile } = await import("./sources-lock.js");
    vi.mocked(readLockFile).mockResolvedValue({
      lockfileVersion: 1,
      sources: {
        "org/repo": {
          resolvedRef: "sha-123",
          skills: {},
          rules: { old: { integrity: computeRuleIntegrity("") } },
          ruleSelection: ["old"],
          rulesPath: "rules",
          resolvedRuleNames: ["old"],
        },
      },
    });
    vi.mocked(fileExists).mockResolvedValue(true);
    mockClientInstance.listDirectory.mockResolvedValue([
      { name: "old.md", path: "rules/old.md", type: "file", size: 50 },
      { name: "new.md", path: "rules/new.md", type: "file", size: 50 },
    ]);

    const result = await resolveAndFetchSources({
      logger,
      sources: [{ source: "org/repo", rules: ["*"] }],
      projectRoot: testDir,
    });

    expect(result.fetchedRuleCount).toBe(2);
    expect(vi.mocked(writeLockFile).mock.calls.at(-1)?.[0].lock.sources["org/repo"]).toMatchObject({
      ruleSelection: ["*"],
      resolvedRuleNames: ["old", "new"],
    });
  });

  it("should refetch when a cached rule fails its integrity check", async () => {
    const { readLockFile } = await import("./sources-lock.js");
    vi.mocked(readLockFile).mockResolvedValue({
      lockfileVersion: 1,
      sources: {
        "org/repo": {
          resolvedRef: "sha-123",
          skills: {},
          rules: { rule: { integrity: computeRuleIntegrity("expected") } },
          ruleSelection: ["rule"],
          rulesPath: "rules",
          resolvedRuleNames: ["rule"],
        },
      },
    });
    vi.mocked(fileExists).mockResolvedValue(true);
    vi.mocked(readFileContent).mockResolvedValue("tampered");
    mockClientInstance.listDirectory.mockResolvedValue([
      { name: "rule.md", path: "rules/rule.md", type: "file", size: 50 },
    ]);

    const result = await resolveAndFetchSources({
      logger,
      sources: [{ source: "org/repo", rules: ["rule"] }],
      projectRoot: testDir,
    });

    expect(result.fetchedRuleCount).toBe(1);
    expect(mockClientInstance.listDirectory).toHaveBeenCalled();
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
      logger,
      sources: [{ source: "https://github.com/org/repo" }],
      projectRoot: testDir,
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
          skills: { "missing-skill": { integrity: "sha256-xxx" } },
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
      logger,
      sources: [{ source: "https://github.com/org/repo" }],
      projectRoot: testDir,
      options: { frozen: true },
    });

    expect(result).toEqual({
      fetchedSkillCount: 1,
      fetchedRuleCount: 0,
      sourcesProcessed: 1,
      failedSourceCount: 0,
    });
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
      logger,
      sources: [{ source: "https://github.com/org/repo" }],
      projectRoot: testDir,
    });

    // Should have warned about integrity mismatch
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("Integrity mismatch"));
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
      logger,
      sources: [{ source: "https://github.com/org/repo" }],
      projectRoot: testDir,
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

  it("should fetch skills via git transport", async () => {
    const { resolveDefaultRef, fetchSkillFiles } = await import("./git-client.js");
    vi.mocked(resolveDefaultRef).mockResolvedValue({ ref: "main", sha: "abc123def456" });
    vi.mocked(fetchSkillFiles).mockResolvedValue([
      { relativePath: "my-skill/SKILL.md", content: "# My Skill", size: 100 },
    ]);

    const result = await resolveAndFetchSources({
      logger,
      sources: [{ source: "https://dev.azure.com/org/project/_git/repo", transport: "git" }],
      projectRoot: testDir,
    });

    expect(result.fetchedSkillCount).toBe(1);
    expect(mockClientInstance.listDirectory).not.toHaveBeenCalled();
    expect(writeFileContent).toHaveBeenCalledWith(
      join(testDir, RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH, "my-skill", "SKILL.md"),
      "# My Skill",
    );
  });

  it("should use explicit ref and path for git transport", async () => {
    const { resolveRefToSha, fetchSkillFiles } = await import("./git-client.js");
    vi.mocked(resolveRefToSha).mockResolvedValue("def456abc789");
    vi.mocked(fetchSkillFiles).mockResolvedValue([
      { relativePath: "my-skill/SKILL.md", content: "# Custom Path", size: 50 },
    ]);

    await resolveAndFetchSources({
      logger,
      sources: [
        { source: "file:///local/clone", transport: "git", ref: "develop", path: "exports/skills" },
      ],
      projectRoot: testDir,
    });

    expect(vi.mocked(resolveRefToSha)).toHaveBeenCalledWith("file:///local/clone", "develop");
    expect(vi.mocked(fetchSkillFiles)).toHaveBeenCalledWith({
      url: "file:///local/clone",
      ref: "develop",
      resolvedRef: "def456abc789",
      skillsPath: "exports/skills",
    });
  });

  it("should error in frozen mode when git source lockfile entry lacks requestedRef", async () => {
    const { readLockFile } = await import("./sources-lock.js");

    vi.mocked(readLockFile).mockResolvedValue({
      lockfileVersion: 1,
      sources: {
        "https://dev.azure.com/org/_git/repo": {
          resolvedRef: "a".repeat(40),
          skills: { "my-skill": { integrity: "sha256-x" } },
        },
      },
    });

    // Skill dir missing so SHA-match skip fails
    vi.mocked(directoryExists).mockResolvedValue(false);

    const result = await resolveAndFetchSources({
      logger,
      sources: [{ source: "https://dev.azure.com/org/_git/repo", transport: "git" }],
      projectRoot: testDir,
      options: { frozen: true },
    });

    expect(result.fetchedSkillCount).toBe(0);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("missing requestedRef"));
  });

  it("should skip re-fetch for git transport when locked SHA matches and skills exist", async () => {
    const { readLockFile } = await import("./sources-lock.js");
    const { fetchSkillFiles } = await import("./git-client.js");
    const curatedDir = join(testDir, RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH);

    vi.mocked(readLockFile).mockResolvedValue({
      lockfileVersion: 1,
      sources: {
        "https://dev.azure.com/org/_git/repo": {
          resolvedRef: "b".repeat(40),
          requestedRef: "main",
          skills: { "cached-skill": { integrity: "sha256-cached" } },
        },
      },
    });

    vi.mocked(directoryExists).mockImplementation(async (path: string) => {
      if (path === join(curatedDir, "cached-skill")) return true;
      return false;
    });

    const result = await resolveAndFetchSources({
      logger,
      sources: [{ source: "https://dev.azure.com/org/_git/repo", transport: "git" }],
      projectRoot: testDir,
    });

    expect(result.fetchedSkillCount).toBe(0);
    expect(vi.mocked(fetchSkillFiles)).not.toHaveBeenCalled();
  });

  it("should apply skill filter for git transport", async () => {
    const { resolveDefaultRef, fetchSkillFiles } = await import("./git-client.js");
    vi.mocked(resolveDefaultRef).mockResolvedValue({ ref: "main", sha: "c".repeat(40) });
    vi.mocked(fetchSkillFiles).mockResolvedValue([
      { relativePath: "skill-a/SKILL.md", content: "A", size: 10 },
      { relativePath: "skill-b/SKILL.md", content: "B", size: 10 },
    ]);

    const result = await resolveAndFetchSources({
      logger,
      sources: [
        {
          source: "https://dev.azure.com/org/_git/repo",
          transport: "git",
          skills: ["skill-a"],
        },
      ],
      projectRoot: testDir,
    });

    expect(result.fetchedSkillCount).toBe(1);
    const writeArgs = vi.mocked(writeFileContent).mock.calls.map((call) => call[0]);
    expect(writeArgs.some((p) => p.includes("skill-a"))).toBe(true);
    expect(writeArgs.some((p) => p.includes("skill-b"))).toBe(false);
  });

  it("should skip git transport skill when local skill takes precedence", async () => {
    const { resolveDefaultRef, fetchSkillFiles } = await import("./git-client.js");
    vi.mocked(resolveDefaultRef).mockResolvedValue({ ref: "main", sha: "d".repeat(40) });
    vi.mocked(fetchSkillFiles).mockResolvedValue([
      { relativePath: "local-skill/SKILL.md", content: "remote", size: 10 },
    ]);

    // local-skill exists locally
    vi.mocked(directoryExists).mockImplementation(async (path: string) => {
      if (path.endsWith("skills")) return true;
      return false;
    });
    vi.mocked(findFilesByGlobs).mockResolvedValue([join(testDir, ".rulesync/skills/local-skill")]);

    const result = await resolveAndFetchSources({
      logger,
      sources: [{ source: "https://dev.azure.com/org/_git/repo", transport: "git" }],
      projectRoot: testDir,
    });

    expect(result.fetchedSkillCount).toBe(0);
    expect(writeFileContent).not.toHaveBeenCalled();
  });

  it("should skip duplicate git transport skill from later source", async () => {
    const { resolveDefaultRef, fetchSkillFiles } = await import("./git-client.js");
    vi.mocked(resolveDefaultRef).mockResolvedValue({ ref: "main", sha: "e".repeat(40) });
    vi.mocked(fetchSkillFiles).mockResolvedValue([
      { relativePath: "shared-skill/SKILL.md", content: "content", size: 10 },
    ]);

    const result = await resolveAndFetchSources({
      logger,
      sources: [
        { source: "https://dev.azure.com/org/_git/repo-a", transport: "git" },
        { source: "https://dev.azure.com/org/_git/repo-b", transport: "git" },
      ],
      projectRoot: testDir,
    });

    // First source fetches it, second source skips it
    expect(result.fetchedSkillCount).toBe(1);
  });

  it("should warn on integrity mismatch for git transport skill", async () => {
    const { readLockFile } = await import("./sources-lock.js");
    const { fetchSkillFiles } = await import("./git-client.js");
    const lockedSha = "f".repeat(40);

    vi.mocked(readLockFile).mockResolvedValue({
      lockfileVersion: 1,
      sources: {
        "https://dev.azure.com/org/_git/repo": {
          resolvedRef: lockedSha,
          requestedRef: "main",
          skills: { "my-skill": { integrity: "sha256-original" } },
        },
      },
    });

    // Skill dir missing so re-fetch is triggered
    vi.mocked(directoryExists).mockResolvedValue(false);
    vi.mocked(fetchSkillFiles).mockResolvedValue([
      { relativePath: "my-skill/SKILL.md", content: "tampered", size: 10 },
    ]);

    await resolveAndFetchSources({
      logger,
      sources: [{ source: "https://dev.azure.com/org/_git/repo", transport: "git" }],
      projectRoot: testDir,
    });

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("Integrity mismatch"));
  });

  it("should handle GitClientError gracefully and continue processing", async () => {
    const { GitClientError } = await import("./git-client.js");
    const { resolveDefaultRef, fetchSkillFiles } = await import("./git-client.js");

    let callCount = 0;
    vi.mocked(resolveDefaultRef).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        throw new GitClientError("git is not installed or not found in PATH");
      }
      return { ref: "main", sha: "a".repeat(40) };
    });
    vi.mocked(fetchSkillFiles).mockResolvedValue([
      { relativePath: "good-skill/SKILL.md", content: "ok", size: 10 },
    ]);

    const result = await resolveAndFetchSources({
      logger,
      sources: [
        { source: "https://dev.azure.com/org/_git/failing", transport: "git" },
        { source: "https://dev.azure.com/org/_git/good", transport: "git" },
      ],
      projectRoot: testDir,
    });

    expect(result.fetchedSkillCount).toBe(1);
    expect(result.sourcesProcessed).toBe(2);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("not installed"));
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("Hint"));
  });

  it("should drop renamed/deleted skills from lockfile when upstream removes them", async () => {
    const { readLockFile, writeLockFile } = await import("./sources-lock.js");
    const { resolveDefaultRef, fetchSkillFiles } = await import("./git-client.js");

    // Lock has "old-skill" from a previous install
    vi.mocked(readLockFile).mockResolvedValue({
      lockfileVersion: 1,
      sources: {
        "https://dev.azure.com/org/_git/repo": {
          resolvedRef: "a".repeat(40),
          requestedRef: "main",
          skills: { "old-skill": { integrity: "sha256-old" } },
        },
      },
    });

    // Remote now has "new-skill" instead of "old-skill" (renamed upstream)
    vi.mocked(resolveDefaultRef).mockResolvedValue({ ref: "main", sha: "b".repeat(40) });
    vi.mocked(fetchSkillFiles).mockResolvedValue([
      { relativePath: "new-skill/SKILL.md", content: "renamed", size: 10 },
    ]);

    vi.mocked(directoryExists).mockResolvedValue(false);

    await resolveAndFetchSources({
      logger,
      sources: [{ source: "https://dev.azure.com/org/_git/repo", transport: "git" }],
      projectRoot: testDir,
    });

    // The lockfile should contain only "new-skill", not "old-skill"
    const writeCalls = vi.mocked(writeLockFile).mock.calls;
    expect(writeCalls).toHaveLength(1);
    const writtenLock = writeCalls[0]![0].lock;
    const sourceEntry = Object.values(writtenLock.sources)[0]!;
    expect(sourceEntry.skills).toHaveProperty("new-skill");
    expect(sourceEntry.skills).not.toHaveProperty("old-skill");
  });

  it("should install single-skill repo with SKILL.md at path root", async () => {
    const { resolveDefaultRef, fetchSkillFiles } = await import("./git-client.js");
    vi.mocked(resolveDefaultRef).mockResolvedValue({ ref: "main", sha: "a".repeat(40) });
    vi.mocked(fetchSkillFiles).mockResolvedValue([
      { relativePath: "SKILL.md", content: "# Humanizer", size: 50 },
      { relativePath: "README.md", content: "docs", size: 20 },
    ]);

    const result = await resolveAndFetchSources({
      logger,
      sources: [
        {
          source: "https://dev.azure.com/org/_git/humanizer",
          transport: "git",
          path: "",
          skills: ["humanizer"],
        },
      ],
      projectRoot: testDir,
    });

    expect(result.fetchedSkillCount).toBe(1);
    expect(writeFileContent).toHaveBeenCalledWith(
      join(testDir, RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH, "humanizer", "SKILL.md"),
      "# Humanizer",
    );
  });

  it("should install root SKILL.md when git source has metadata directories", async () => {
    const { resolveDefaultRef, fetchSkillFiles } = await import("./git-client.js");
    vi.mocked(resolveDefaultRef).mockResolvedValue({ ref: "main", sha: "a".repeat(40) });
    vi.mocked(fetchSkillFiles).mockResolvedValue([
      { relativePath: "SKILL.md", content: "# Humanizer", size: 50 },
      { relativePath: "README.md", content: "docs", size: 20 },
      { relativePath: ".claude-plugin/plugin.json", content: "{}", size: 2 },
    ]);

    const result = await resolveAndFetchSources({
      logger,
      sources: [
        {
          source: "https://github.com/blader/humanizer",
          transport: "git",
          path: ".",
          skills: ["humanizer"],
        },
      ],
      projectRoot: testDir,
    });

    expect(result.fetchedSkillCount).toBe(1);
    expect(writeFileContent).toHaveBeenCalledWith(
      join(testDir, RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH, "humanizer", "SKILL.md"),
      "# Humanizer",
    );
  });

  it("should still handle classic subdirectory skill structure", async () => {
    const { resolveDefaultRef, fetchSkillFiles } = await import("./git-client.js");
    vi.mocked(resolveDefaultRef).mockResolvedValue({ ref: "main", sha: "b".repeat(40) });
    vi.mocked(fetchSkillFiles).mockResolvedValue([
      { relativePath: "humanizer/SKILL.md", content: "# Humanizer", size: 50 },
    ]);

    const result = await resolveAndFetchSources({
      logger,
      sources: [
        {
          source: "https://dev.azure.com/org/_git/repo",
          transport: "git",
          skills: ["humanizer"],
        },
      ],
      projectRoot: testDir,
    });

    expect(result.fetchedSkillCount).toBe(1);
    expect(writeFileContent).toHaveBeenCalledWith(
      join(testDir, RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH, "humanizer", "SKILL.md"),
      "# Humanizer",
    );
  });

  it("should not install root-level files when skills filter is wildcard", async () => {
    const { resolveDefaultRef, fetchSkillFiles } = await import("./git-client.js");
    vi.mocked(resolveDefaultRef).mockResolvedValue({ ref: "main", sha: "c".repeat(40) });
    vi.mocked(fetchSkillFiles).mockResolvedValue([
      { relativePath: "SKILL.md", content: "# Skill", size: 50 },
    ]);

    const result = await resolveAndFetchSources({
      logger,
      sources: [
        {
          source: "https://dev.azure.com/org/_git/single-skill-repo",
          transport: "git",
          // no skills → defaults to ["*"]
        },
      ],
      projectRoot: testDir,
    });

    expect(result.fetchedSkillCount).toBe(0);
    expect(writeFileContent).not.toHaveBeenCalled();
  });

  it("should not install explicit root fallback without root SKILL.md", async () => {
    const { resolveDefaultRef, fetchSkillFiles } = await import("./git-client.js");
    vi.mocked(resolveDefaultRef).mockResolvedValue({ ref: "main", sha: "c".repeat(40) });
    vi.mocked(fetchSkillFiles).mockResolvedValue([
      { relativePath: "README.md", content: "docs", size: 20 },
      { relativePath: ".claude-plugin/plugin.json", content: "{}", size: 2 },
    ]);

    const result = await resolveAndFetchSources({
      logger,
      sources: [
        {
          source: "https://github.com/blader/humanizer",
          transport: "git",
          path: ".",
          skills: ["humanizer"],
        },
      ],
      projectRoot: testDir,
    });

    expect(result.fetchedSkillCount).toBe(0);
    expect(writeFileContent).not.toHaveBeenCalled();
  });

  it("should install each top-level directory as a skill for path '.' with wildcard filter", async () => {
    const { resolveDefaultRef, fetchSkillFiles } = await import("./git-client.js");
    vi.mocked(resolveDefaultRef).mockResolvedValue({ ref: "main", sha: "d".repeat(40) });
    // Whole-repo fetch (path: ".") returns multiple top-level skill directories
    // plus a root-level file that must be ignored under the wildcard filter.
    vi.mocked(fetchSkillFiles).mockResolvedValue([
      { relativePath: "README.md", content: "root docs", size: 20 },
      { relativePath: "skill-a/SKILL.md", content: "# Skill A", size: 50 },
      { relativePath: "skill-b/SKILL.md", content: "# Skill B", size: 50 },
    ]);

    const result = await resolveAndFetchSources({
      logger,
      sources: [
        {
          source: "https://dev.azure.com/org/_git/multi-skill-repo",
          transport: "git",
          path: ".",
          skills: ["*"],
        },
      ],
      projectRoot: testDir,
    });

    expect(result.fetchedSkillCount).toBe(2);
    expect(writeFileContent).toHaveBeenCalledWith(
      join(testDir, RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH, "skill-a", "SKILL.md"),
      "# Skill A",
    );
    expect(writeFileContent).toHaveBeenCalledWith(
      join(testDir, RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH, "skill-b", "SKILL.md"),
      "# Skill B",
    );
    // The root-level README.md must not be installed as a skill.
    expect(writeFileContent).not.toHaveBeenCalledWith(
      expect.stringContaining(join("README.md")),
      expect.anything(),
    );
  });

  it("should install single-skill repo with SKILL.md at path root via github transport", async () => {
    mockClientInstance.listDirectory.mockImplementation(
      async (_owner: string, _repo: string, path: string) => {
        if (path === "skills") {
          return [
            { name: "SKILL.md", path: "skills/SKILL.md", type: "file", size: 50 },
            { name: "README.md", path: "skills/README.md", type: "file", size: 20 },
          ];
        }
        return [];
      },
    );
    mockClientInstance.getFileContent.mockImplementation(
      async (_o: string, _r: string, path: string) => {
        if (path === "skills/SKILL.md") return "# Humanizer";
        if (path === "skills/README.md") return "docs";
        return "";
      },
    );

    const result = await resolveAndFetchSources({
      logger,
      sources: [{ source: "org/humanizer:skills", skills: ["humanizer"] }],
      projectRoot: testDir,
    });

    expect(result.fetchedSkillCount).toBe(1);
    expect(writeFileContent).toHaveBeenCalledWith(
      join(testDir, RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH, "humanizer", "SKILL.md"),
      "# Humanizer",
    );
  });

  it("should install root SKILL.md when github source has metadata directories", async () => {
    mockClientInstance.listDirectory.mockImplementation(
      async (_owner: string, _repo: string, path: string) => {
        if (path === ".") {
          return [
            { name: "SKILL.md", path: "SKILL.md", type: "file", size: 50 },
            { name: "README.md", path: "README.md", type: "file", size: 20 },
            { name: ".claude-plugin", path: ".claude-plugin", type: "dir", size: 0 },
          ];
        }
        return [];
      },
    );
    mockClientInstance.getFileContent.mockImplementation(
      async (_o: string, _r: string, path: string) => {
        if (path === "SKILL.md") return "# Humanizer";
        if (path === "README.md") return "docs";
        return "";
      },
    );

    const result = await resolveAndFetchSources({
      logger,
      sources: [{ source: "org/humanizer:.", skills: ["humanizer"] }],
      projectRoot: testDir,
    });

    expect(result.fetchedSkillCount).toBe(1);
    expect(writeFileContent).toHaveBeenCalledWith(
      join(testDir, RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH, "humanizer", "SKILL.md"),
      "# Humanizer",
    );
  });

  it("should clean a locked root fallback before writing its replacement", async () => {
    const { readLockFile } = await import("./sources-lock.js");
    vi.mocked(readLockFile).mockResolvedValue({
      lockfileVersion: 1,
      sources: {
        "org/humanizer:.": {
          resolvedRef: "locked-sha",
          skills: { humanizer: { integrity: "sha256-old" } },
        },
      },
    });
    let skillDirectoryCheckCount = 0;
    vi.mocked(directoryExists).mockImplementation(async (path: string) => {
      if (path.endsWith(join("humanizer"))) {
        skillDirectoryCheckCount += 1;
        return skillDirectoryCheckCount > 1;
      }
      return false;
    });
    mockClientInstance.listDirectory.mockResolvedValue([
      { name: "SKILL.md", path: "SKILL.md", type: "file", size: 50 },
    ]);
    mockClientInstance.getFileContent.mockResolvedValue("# Replacement");

    const result = await resolveAndFetchSources({
      logger,
      sources: [{ source: "org/humanizer:.", skills: ["humanizer"] }],
      projectRoot: testDir,
    });

    expect(result.failedSourceCount).toBe(0);
    const skillPath = join(
      testDir,
      RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH,
      "humanizer",
      "SKILL.md",
    );
    const writeIndex = vi
      .mocked(writeFileContent)
      .mock.calls.findIndex(([path]) => path === skillPath);
    expect(writeIndex).toBeGreaterThanOrEqual(0);
    expect(vi.mocked(removeDirectory).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(writeFileContent).mock.invocationCallOrder[writeIndex]!,
    );
  });

  it("installs the root SKILL.md under the requested name when real skill dirs coexist and the requested skill is absent", async () => {
    // Locks the (intended) widened-fallback behavior: when the repository has
    // real skill dirs plus an incidental root SKILL.md and the caller requests a
    // skill name that matches no dir, the root is installed under the requested
    // name.
    mockClientInstance.listDirectory.mockImplementation(
      async (_owner: string, _repo: string, path: string) => {
        if (path === ".") {
          return [
            { name: "other-skill", path: "other-skill", type: "dir", size: 0 },
            { name: "SKILL.md", path: "SKILL.md", type: "file", size: 50 },
            { name: "README.md", path: "README.md", type: "file", size: 20 },
          ];
        }
        return [];
      },
    );
    mockClientInstance.getFileContent.mockImplementation(
      async (_o: string, _r: string, path: string) => {
        if (path === "SKILL.md") return "# Root Skill";
        if (path === "README.md") return "docs";
        return "";
      },
    );

    const result = await resolveAndFetchSources({
      logger,
      sources: [{ source: "org/repo:.", skills: ["nonexistent"] }],
      projectRoot: testDir,
    });

    expect(result.fetchedSkillCount).toBe(1);
    expect(writeFileContent).toHaveBeenCalledWith(
      join(testDir, RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH, "nonexistent", "SKILL.md"),
      "# Root Skill",
    );
  });

  it("does not fetch root files when the requested skill is absent and there is no root SKILL.md", async () => {
    // The fallback (and its full root-file fetch) must be short-circuited when the
    // directory listing shows no root SKILL.md — nothing would be installed, so no
    // root content should be fetched.
    mockClientInstance.listDirectory.mockImplementation(
      async (_owner: string, _repo: string, path: string) => {
        if (path === ".") {
          return [
            { name: "other-skill", path: "other-skill", type: "dir", size: 0 },
            { name: "README.md", path: "README.md", type: "file", size: 20 },
          ];
        }
        return [];
      },
    );

    const result = await resolveAndFetchSources({
      logger,
      sources: [{ source: "org/repo:.", skills: ["nonexistent"] }],
      projectRoot: testDir,
    });

    expect(result.fetchedSkillCount).toBe(0);
    expect(writeFileContent).not.toHaveBeenCalled();
    // No root file contents are fetched because the fallback is short-circuited.
    expect(mockClientInstance.getFileContent).not.toHaveBeenCalled();
  });

  it("should treat backslash-separated git paths as nested skill files", async () => {
    const { resolveDefaultRef, fetchSkillFiles } = await import("./git-client.js");
    vi.mocked(resolveDefaultRef).mockResolvedValue({ ref: "main", sha: "d".repeat(40) });
    vi.mocked(fetchSkillFiles).mockResolvedValue([
      { relativePath: "humanizer\\SKILL.md", content: "# Humanizer", size: 50 },
    ]);

    const result = await resolveAndFetchSources({
      logger,
      sources: [
        {
          source: "https://dev.azure.com/org/_git/repo",
          transport: "git",
          skills: ["humanizer"],
        },
      ],
      projectRoot: testDir,
    });

    expect(result.fetchedSkillCount).toBe(1);
    expect(writeFileContent).toHaveBeenCalledWith(
      join(testDir, RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH, "humanizer", "SKILL.md"),
      "# Humanizer",
    );
  });
});
