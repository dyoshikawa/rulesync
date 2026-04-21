import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { fileExists, readFileContent, writeFileContent } from "../../utils/file.js";
import { installApm } from "./apm-install.js";
import { getApmLockPath, readApmLock } from "./apm-lock.js";
import { getApmManifestPath } from "./apm-manifest.js";

let mockClientInstance: any;

vi.mock("../github-client.js", () => ({
  GitHubClient: class MockGitHubClient {
    static resolveToken = vi.fn().mockReturnValue(undefined);

    getDefaultBranch(...args: any[]) {
      return mockClientInstance.getDefaultBranch(...args);
    }
    resolveRefToSha(...args: any[]) {
      return mockClientInstance.resolveRefToSha(...args);
    }
    listDirectory(...args: any[]) {
      return mockClientInstance.listDirectory(...args);
    }
    getFileContent(...args: any[]) {
      return mockClientInstance.getFileContent(...args);
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

const VALID_SHA = "a".repeat(40);
const SECOND_SHA = "b".repeat(40);

describe("installApm", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;
  const logger = createMockLogger();

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());

    mockClientInstance = {
      getDefaultBranch: vi.fn().mockResolvedValue("main"),
      resolveRefToSha: vi.fn().mockResolvedValue(VALID_SHA),
      listDirectory: vi.fn(),
      getFileContent: vi.fn(),
    };
  });

  afterEach(async () => {
    await cleanup();
    vi.clearAllMocks();
  });

  async function writeManifest(content: string): Promise<void> {
    await writeFileContent(getApmManifestPath(testDir), content);
  }

  it("warns and returns early when there are no dependencies", async () => {
    await writeManifest("name: my-project\nversion: 1.0.0\n");

    const result = await installApm({ baseDir: testDir, logger });

    expect(result).toEqual({
      dependenciesProcessed: 0,
      deployedFileCount: 0,
      failedDependencyCount: 0,
    });
    expect(await fileExists(getApmLockPath(testDir))).toBe(false);
  });

  it("fetches .apm/instructions and .apm/skills and deploys to .github/", async () => {
    await writeManifest(
      `dependencies:
  apm:
    - acme/security#v1.0.0
`,
    );

    // Stub github tree walk: one instructions file + one skill file.
    mockClientInstance.listDirectory.mockImplementation(
      async (_owner: string, _repo: string, path: string) => {
        if (path === ".apm/instructions") {
          return [
            {
              name: "security.instructions.md",
              path: ".apm/instructions/security.instructions.md",
              type: "file",
              size: 100,
            },
          ];
        }
        if (path === ".apm/skills") {
          return [
            {
              name: "git-commit",
              path: ".apm/skills/git-commit",
              type: "dir",
              size: 0,
            },
          ];
        }
        if (path === ".apm/skills/git-commit") {
          return [
            {
              name: "SKILL.md",
              path: ".apm/skills/git-commit/SKILL.md",
              type: "file",
              size: 50,
            },
          ];
        }
        const err = new Error(`Not found: ${path}`) as Error & { statusCode?: number };
        err.statusCode = 404;
        throw err;
      },
    );
    mockClientInstance.getFileContent.mockImplementation(
      async (_owner: string, _repo: string, path: string) => `content of ${path}`,
    );

    const result = await installApm({ baseDir: testDir, logger });

    expect(result.dependenciesProcessed).toBe(1);
    expect(result.deployedFileCount).toBe(2);
    expect(mockClientInstance.resolveRefToSha).toHaveBeenCalledWith("acme", "security", "v1.0.0");

    const instructions = await readFileContent(
      join(testDir, ".github/instructions/security.instructions.md"),
    );
    expect(instructions).toBe("content of .apm/instructions/security.instructions.md");

    const skill = await readFileContent(join(testDir, ".github/skills/git-commit/SKILL.md"));
    expect(skill).toBe("content of .apm/skills/git-commit/SKILL.md");

    const lock = await readApmLock(testDir);
    expect(lock).not.toBeNull();
    expect(lock?.dependencies).toHaveLength(1);
    expect(lock?.dependencies[0]).toMatchObject({
      repo_url: "https://github.com/acme/security",
      resolved_commit: VALID_SHA,
      resolved_ref: "v1.0.0",
      depth: 1,
      package_type: "apm_package",
      deployed_files: [
        ".github/instructions/security.instructions.md",
        ".github/skills/git-commit/SKILL.md",
      ],
    });
    expect(lock?.dependencies[0]?.content_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("uses the default branch when no ref is given", async () => {
    await writeManifest(
      `dependencies:
  apm:
    - acme/security
`,
    );
    mockClientInstance.getDefaultBranch.mockResolvedValue("trunk");
    mockClientInstance.listDirectory.mockImplementation(async () => {
      const err = new Error("Not found") as Error & { statusCode?: number };
      err.statusCode = 404;
      throw err;
    });

    await installApm({ baseDir: testDir, logger });

    expect(mockClientInstance.getDefaultBranch).toHaveBeenCalledWith("acme", "security");
    expect(mockClientInstance.resolveRefToSha).toHaveBeenCalledWith("acme", "security", "trunk");
  });

  it("reuses the locked commit SHA on subsequent runs and skips re-resolution", async () => {
    await writeManifest(
      `dependencies:
  apm:
    - acme/security#v1.0.0
`,
    );
    mockClientInstance.listDirectory.mockResolvedValue([]);

    // First pass: populate the lockfile.
    await installApm({ baseDir: testDir, logger });
    expect(mockClientInstance.resolveRefToSha).toHaveBeenCalledTimes(1);

    // Second pass: lockfile should short-circuit ref resolution.
    mockClientInstance.resolveRefToSha.mockResolvedValue(SECOND_SHA);
    await installApm({ baseDir: testDir, logger });
    expect(mockClientInstance.resolveRefToSha).toHaveBeenCalledTimes(1);

    const lock = await readApmLock(testDir);
    expect(lock?.dependencies[0]?.resolved_commit).toBe(VALID_SHA);
  });

  it("--update forces ref re-resolution and lockfile rewrite", async () => {
    await writeManifest(
      `dependencies:
  apm:
    - acme/security#v1.0.0
`,
    );
    mockClientInstance.listDirectory.mockResolvedValue([]);

    await installApm({ baseDir: testDir, logger });
    mockClientInstance.resolveRefToSha.mockResolvedValue(SECOND_SHA);

    await installApm({ baseDir: testDir, logger, options: { update: true } });
    expect(mockClientInstance.resolveRefToSha).toHaveBeenCalledTimes(2);

    const lock = await readApmLock(testDir);
    expect(lock?.dependencies[0]?.resolved_commit).toBe(SECOND_SHA);
  });

  it("--frozen fails when the lockfile is missing", async () => {
    await writeManifest(
      `dependencies:
  apm:
    - acme/security#v1.0.0
`,
    );
    mockClientInstance.listDirectory.mockResolvedValue([]);

    await expect(
      installApm({ baseDir: testDir, logger, options: { frozen: true } }),
    ).rejects.toThrow(/apm.lock.yaml is missing/);
  });

  it("--frozen fails when the lockfile is missing a declared dependency", async () => {
    await writeManifest(
      `dependencies:
  apm:
    - acme/security#v1.0.0
    - acme/new#v1.0.0
`,
    );
    mockClientInstance.listDirectory.mockResolvedValue([]);
    await installApm({ baseDir: testDir, logger });

    await writeManifest(
      `dependencies:
  apm:
    - acme/security#v1.0.0
    - acme/added#v1.0.0
`,
    );
    await expect(
      installApm({ baseDir: testDir, logger, options: { frozen: true } }),
    ).rejects.toThrow(/missing entries for/);
  });

  it("--frozen succeeds and does not rewrite the lockfile when all deps are locked", async () => {
    await writeManifest(
      `dependencies:
  apm:
    - acme/security#v1.0.0
`,
    );
    mockClientInstance.listDirectory.mockResolvedValue([]);
    await installApm({ baseDir: testDir, logger });

    const before = await readFileContent(getApmLockPath(testDir));
    await installApm({ baseDir: testDir, logger, options: { frozen: true } });
    const after = await readFileContent(getApmLockPath(testDir));
    expect(after).toBe(before);
  });

  it("--frozen fails when the manifest ref drifts from the locked ref", async () => {
    await writeManifest(
      `dependencies:
  apm:
    - acme/security#v1.0.0
`,
    );
    mockClientInstance.listDirectory.mockResolvedValue([]);
    await installApm({ baseDir: testDir, logger });

    await writeManifest(
      `dependencies:
  apm:
    - acme/security#v2.0.0
`,
    );
    await expect(
      installApm({ baseDir: testDir, logger, options: { frozen: true } }),
    ).rejects.toThrow(/manifest ref does not match/);
  });

  it("--frozen fails when deployed content no longer matches content_hash", async () => {
    await writeManifest(
      `dependencies:
  apm:
    - acme/security#v1.0.0
`,
    );
    mockClientInstance.listDirectory.mockImplementation(
      async (_owner: string, _repo: string, path: string) => {
        if (path === ".apm/instructions") {
          return [
            {
              name: "a.instructions.md",
              path: ".apm/instructions/a.instructions.md",
              type: "file",
              size: 100,
            },
          ];
        }
        // Other primitive dirs (e.g., .apm/skills) are absent.
        return [];
      },
    );
    mockClientInstance.getFileContent.mockResolvedValue("original content");

    await installApm({ baseDir: testDir, logger });

    // Simulate tampered upstream: same SHA, different bytes on next install.
    mockClientInstance.getFileContent.mockResolvedValue("tampered content");

    await expect(
      installApm({ baseDir: testDir, logger, options: { frozen: true } }),
    ).rejects.toThrow(/content_hash mismatch/);
  });

  it("preserves the existing lock entry when a dependency fails to install", async () => {
    await writeManifest(
      `dependencies:
  apm:
    - acme/security#v1.0.0
`,
    );
    mockClientInstance.listDirectory.mockResolvedValue([]);
    await installApm({ baseDir: testDir, logger });
    const lockBefore = await readFileContent(getApmLockPath(testDir));

    mockClientInstance.resolveRefToSha.mockRejectedValue(new Error("network error"));

    const result = await installApm({
      baseDir: testDir,
      logger,
      options: { update: true },
    });
    expect(result.failedDependencyCount).toBe(1);

    // The lockfile on disk must be untouched so the previous SHA survives.
    const lockAfter = await readFileContent(getApmLockPath(testDir));
    expect(lockAfter).toBe(lockBefore);
  });
});
