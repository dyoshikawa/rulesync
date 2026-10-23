import { mkdir, readdir, symlink } from "node:fs/promises";
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

    const result = await installApm({ projectRoot: testDir, logger });

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

    const result = await installApm({ projectRoot: testDir, logger });

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

  it.skipIf(process.platform === "win32")(
    "refuses to deploy through a symbolic link that leads outside projectRoot",
    async () => {
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
          const err = new Error(`Not found: ${path}`) as Error & { statusCode?: number };
          err.statusCode = 404;
          throw err;
        },
      );
      mockClientInstance.getFileContent.mockResolvedValue("planted");
      const projectRoot = join(testDir, "project");
      const outsideDir = join(testDir, "outside");
      await mkdir(join(projectRoot, ".github"), { recursive: true });
      await mkdir(outsideDir, { recursive: true });
      await symlink(outsideDir, join(projectRoot, ".github", "instructions"));
      await writeFileContent(
        getApmManifestPath(projectRoot),
        `dependencies:
  apm:
    - acme/security#v1.0.0
`,
      );

      await installApm({ projectRoot, logger }).catch(() => undefined);

      expect(await readdir(outsideDir)).toEqual([]);
    },
  );

  it.skipIf(process.platform === "win32")(
    "refuses to deploy through a symbolic link that stays inside projectRoot",
    async () => {
      mockClientInstance.listDirectory.mockImplementation(
        async (_owner: string, _repo: string, path: string) => {
          if (path === ".apm/instructions") {
            return [
              {
                name: "x.instructions.md",
                path: ".apm/instructions/x.instructions.md",
                type: "file",
                size: 100,
              },
            ];
          }
          const err = new Error(`Not found: ${path}`) as Error & { statusCode?: number };
          err.statusCode = 404;
          throw err;
        },
      );
      mockClientInstance.getFileContent.mockResolvedValue("planted");
      const gitConfig = join(testDir, ".git", "config");
      await writeFileContent(gitConfig, "[core]\n");
      await mkdir(join(testDir, ".github", "instructions"), { recursive: true });
      await symlink(
        "../../.git/config",
        join(testDir, ".github", "instructions", "x.instructions.md"),
      );
      await writeManifest(
        `dependencies:
  apm:
    - acme/security#v1.0.0
`,
      );

      const result = await installApm({ projectRoot: testDir, logger });

      expect(result.failedDependencyCount).toBe(1);
      expect(await readFileContent(gitConfig)).toBe("[core]\n");
    },
  );

  it.skipIf(process.platform === "win32")(
    "refuses to deploy through a symlinked deploy directory inside projectRoot",
    async () => {
      mockClientInstance.listDirectory.mockImplementation(
        async (_owner: string, _repo: string, path: string) => {
          if (path === ".apm/instructions") {
            return [
              {
                name: "x.instructions.md",
                path: ".apm/instructions/x.instructions.md",
                type: "file",
                size: 100,
              },
            ];
          }
          const err = new Error(`Not found: ${path}`) as Error & { statusCode?: number };
          err.statusCode = 404;
          throw err;
        },
      );
      mockClientInstance.getFileContent.mockResolvedValue("planted");
      await mkdir(join(testDir, ".git"), { recursive: true });
      await mkdir(join(testDir, ".github"), { recursive: true });
      await symlink("../.git", join(testDir, ".github", "instructions"));
      await writeManifest(
        `dependencies:
  apm:
    - acme/security#v1.0.0
`,
      );

      await installApm({ projectRoot: testDir, logger }).catch(() => undefined);

      expect(await readdir(join(testDir, ".git"))).toEqual([]);
    },
  );

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

    await installApm({ projectRoot: testDir, logger });

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
    await installApm({ projectRoot: testDir, logger });
    expect(mockClientInstance.resolveRefToSha).toHaveBeenCalledTimes(1);

    // Second pass: lockfile should short-circuit ref resolution.
    mockClientInstance.resolveRefToSha.mockResolvedValue(SECOND_SHA);
    await installApm({ projectRoot: testDir, logger });
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

    await installApm({ projectRoot: testDir, logger });
    mockClientInstance.resolveRefToSha.mockResolvedValue(SECOND_SHA);

    await installApm({ projectRoot: testDir, logger, options: { update: true } });
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
      installApm({ projectRoot: testDir, logger, options: { frozen: true } }),
    ).rejects.toThrow(/rulesync-apm.lock.yaml is missing/);
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
    await installApm({ projectRoot: testDir, logger });

    await writeManifest(
      `dependencies:
  apm:
    - acme/security#v1.0.0
    - acme/added#v1.0.0
`,
    );
    await expect(
      installApm({ projectRoot: testDir, logger, options: { frozen: true } }),
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
    await installApm({ projectRoot: testDir, logger });

    const before = await readFileContent(getApmLockPath(testDir));
    await installApm({ projectRoot: testDir, logger, options: { frozen: true } });
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
    await installApm({ projectRoot: testDir, logger });

    await writeManifest(
      `dependencies:
  apm:
    - acme/security#v2.0.0
`,
    );
    await expect(
      installApm({ projectRoot: testDir, logger, options: { frozen: true } }),
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

    await installApm({ projectRoot: testDir, logger });

    // Simulate tampered upstream: same SHA, different bytes on next install.
    mockClientInstance.getFileContent.mockResolvedValue("tampered content");

    await expect(
      installApm({ projectRoot: testDir, logger, options: { frozen: true } }),
    ).rejects.toThrow(/content_hash mismatch/);
  });

  it("writes preserved-for-failure lock entries in manifest order, not completion order", async () => {
    // Seed lockfile with two deps in a known manifest order.
    await writeManifest(
      `dependencies:
  apm:
    - acme/first#v1.0.0
    - acme/second#v1.0.0
`,
    );
    mockClientInstance.listDirectory.mockResolvedValue([]);
    mockClientInstance.resolveRefToSha.mockImplementation(async (_owner: string, repo: string) =>
      repo === "first" ? VALID_SHA : SECOND_SHA,
    );
    await installApm({ projectRoot: testDir, logger });
    const lockBefore = await readApmLock(testDir);
    expect(lockBefore?.dependencies.map((d) => d.repo_url)).toEqual([
      "https://github.com/acme/first",
      "https://github.com/acme/second",
    ]);

    // Now make the FIRST dep fail slowly while the SECOND dep succeeds fast.
    // Without ordering logic, the failed-first dep's preserved entry would
    // land after the succeeded-second dep in the rewritten lockfile.
    mockClientInstance.resolveRefToSha.mockImplementation(async (_owner: string, repo: string) => {
      if (repo === "first") {
        await new Promise((r) => setTimeout(r, 20));
        throw new Error("network error on first");
      }
      return SECOND_SHA;
    });

    const result = await installApm({
      projectRoot: testDir,
      logger,
      options: { update: true },
    });
    expect(result.failedDependencyCount).toBe(1);

    const lockAfter = await readApmLock(testDir);
    // Manifest-order preservation: "first" (preserved) must stay at index 0.
    expect(lockAfter?.dependencies.map((d) => d.repo_url)).toEqual([
      "https://github.com/acme/first",
      "https://github.com/acme/second",
    ]);
  });

  it("preserves the existing lock entry when a dependency fails to install", async () => {
    await writeManifest(
      `dependencies:
  apm:
    - acme/security#v1.0.0
`,
    );
    mockClientInstance.listDirectory.mockResolvedValue([]);
    await installApm({ projectRoot: testDir, logger });
    const lockBefore = await readApmLock(testDir);

    mockClientInstance.resolveRefToSha.mockRejectedValue(new Error("network error"));

    const result = await installApm({
      projectRoot: testDir,
      logger,
      options: { update: true },
    });
    expect(result.failedDependencyCount).toBe(1);

    // The previously pinned SHA must survive the failed re-install: the
    // lockfile is rewritten (only `generated_at` drifts) but the dependency
    // entry itself is preserved verbatim.
    const lockAfter = await readApmLock(testDir);
    expect(lockAfter?.dependencies).toEqual(lockBefore?.dependencies);
  });

  it("removes files that were deployed previously but are no longer in the upstream tree", async () => {
    await writeManifest(
      `dependencies:
  apm:
    - acme/security#v1.0.0
`,
    );

    // First install: two instruction files A and B.
    mockClientInstance.listDirectory.mockImplementation(
      async (_owner: string, _repo: string, path: string) => {
        if (path === ".apm/instructions") {
          return [
            {
              name: "a.instructions.md",
              path: ".apm/instructions/a.instructions.md",
              type: "file",
              size: 10,
            },
            {
              name: "b.instructions.md",
              path: ".apm/instructions/b.instructions.md",
              type: "file",
              size: 10,
            },
          ];
        }
        return [];
      },
    );
    mockClientInstance.getFileContent.mockImplementation(
      async (_owner: string, _repo: string, path: string) => `content of ${path}`,
    );

    await installApm({ projectRoot: testDir, logger });
    expect(await fileExists(join(testDir, ".github/instructions/a.instructions.md"))).toBe(true);
    expect(await fileExists(join(testDir, ".github/instructions/b.instructions.md"))).toBe(true);

    // Second install: only A remains upstream.
    mockClientInstance.listDirectory.mockImplementation(
      async (_owner: string, _repo: string, path: string) => {
        if (path === ".apm/instructions") {
          return [
            {
              name: "a.instructions.md",
              path: ".apm/instructions/a.instructions.md",
              type: "file",
              size: 10,
            },
          ];
        }
        return [];
      },
    );

    await installApm({ projectRoot: testDir, logger, options: { update: true } });

    expect(await fileExists(join(testDir, ".github/instructions/a.instructions.md"))).toBe(true);
    // B must be removed both from disk and from the lockfile.
    expect(await fileExists(join(testDir, ".github/instructions/b.instructions.md"))).toBe(false);
    const lock = await readApmLock(testDir);
    expect(lock?.dependencies[0]?.deployed_files).toEqual([
      ".github/instructions/a.instructions.md",
    ]);
  });

  it("--frozen refuses tampered content WITHOUT overwriting the on-disk file", async () => {
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
        return [];
      },
    );
    mockClientInstance.getFileContent.mockResolvedValue("original content");
    await installApm({ projectRoot: testDir, logger });

    const deployedPath = join(testDir, ".github/instructions/a.instructions.md");
    const before = await readFileContent(deployedPath);
    expect(before).toBe("original content");

    // Upstream starts returning tampered bytes under the same SHA.
    mockClientInstance.getFileContent.mockResolvedValue("tampered content");

    await expect(
      installApm({ projectRoot: testDir, logger, options: { frozen: true } }),
    ).rejects.toThrow(/content_hash mismatch/);

    // The on-disk file must still contain the original bytes, not the
    // tampered payload.
    const after = await readFileContent(deployedPath);
    expect(after).toBe("original content");
  });

  it("deploys files from under dep.path (object-form path field)", async () => {
    await writeManifest(
      `dependencies:
  apm:
    - git: https://github.com/acme/mono.git
      path: packages/security
      ref: v1.0.0
`,
    );
    mockClientInstance.listDirectory.mockImplementation(
      async (_owner: string, _repo: string, path: string) => {
        if (path === "packages/security/.apm/instructions") {
          return [
            {
              name: "s.instructions.md",
              path: "packages/security/.apm/instructions/s.instructions.md",
              type: "file",
              size: 20,
            },
          ];
        }
        return [];
      },
    );
    mockClientInstance.getFileContent.mockImplementation(
      async (_owner: string, _repo: string, path: string) => `content of ${path}`,
    );

    const result = await installApm({ projectRoot: testDir, logger });
    expect(result.deployedFileCount).toBe(1);
    const deployed = await readFileContent(join(testDir, ".github/instructions/s.instructions.md"));
    expect(deployed).toBe("content of packages/security/.apm/instructions/s.instructions.md");
    const lock = await readApmLock(testDir);
    expect(lock?.dependencies[0]?.virtual_path).toBe("packages/security");
  });

  it("refuses to remove stale files whose recorded path escapes projectRoot", async () => {
    // Hand-craft a lockfile whose deployed_files contains attacker-controlled
    // paths. `deployed_files` is only schema-validated as a string array, so
    // a hostile repo could plant this and trigger arbitrary `removeFile` on
    // the next `rulesync install` run. The guard must skip such entries
    // with a warn log so that the remove never actually happens.
    //
    // We cannot safely write a file *outside* testDir from a test (the
    // testing guidelines forbid polluting anything outside the project
    // test directory), so we prove the defense by asserting (a) the guard
    // warns for each offending entry and (b) legitimate in-projectRoot cleanup
    // still proceeds as a control.
    const absoluteOutside = "/tmp/rulesync-apm-test-absolute-target.md";
    const lockYaml = `lockfile_version: "1"
generated_at: "2026-04-20T00:00:00Z"
apm_version: "0.7.7"
dependencies:
  - repo_url: https://github.com/acme/security
    resolved_commit: ${VALID_SHA}
    resolved_ref: v1.0.0
    depth: 1
    package_type: apm_package
    deployed_files:
      - ../escape-one.md
      - ${absoluteOutside}
      - .github/instructions/old.instructions.md
`;
    await writeFileContent(getApmLockPath(testDir), lockYaml);

    // Plant the "clean" stale file that lives inside projectRoot so we can
    // verify the normal cleanup path still works even when the guard skips
    // its neighbors.
    await writeFileContent(
      join(testDir, ".github/instructions/old.instructions.md"),
      "stale legit",
    );

    await writeManifest(
      `dependencies:
  apm:
    - acme/security#v1.0.0
`,
    );
    // New install returns no files, so prior entries become stale.
    mockClientInstance.listDirectory.mockResolvedValue([]);

    const localLogger = createMockLogger();
    await installApm({ projectRoot: testDir, logger: localLogger, options: { update: true } });

    // Legit in-projectRoot stale file is still removed (control: cleanup works).
    expect(await fileExists(join(testDir, ".github/instructions/old.instructions.md"))).toBe(false);
    // Warn logs were emitted for the two refused entries.
    const warnMessages = localLogger.warn.mock.calls.map((args) => String(args[0]));
    expect(warnMessages.some((m) => m.includes("../escape-one.md"))).toBe(true);
    expect(warnMessages.some((m) => m.includes(absoluteOutside))).toBe(true);
  });

  function staleLockYaml(deployedFiles: string[]): string {
    return `lockfile_version: "1"
generated_at: "2026-04-20T00:00:00Z"
apm_version: "0.7.7"
dependencies:
  - repo_url: https://github.com/acme/security
    resolved_commit: ${VALID_SHA}
    resolved_ref: v1.0.0
    depth: 1
    package_type: apm_package
    deployed_files:
${deployedFiles.map((file) => `      - ${file}`).join("\n")}
`;
  }

  it.skipIf(process.platform === "win32")(
    "refuses to remove a stale file that a symbolic link leads outside projectRoot",
    async () => {
      const projectRoot = join(testDir, "project");
      const outsideDir = join(testDir, "outside");
      await writeFileContent(join(outsideDir, "old.instructions.md"), "outside");
      await mkdir(join(projectRoot, ".github"), { recursive: true });
      await symlink(outsideDir, join(projectRoot, ".github", "instructions"));
      await writeFileContent(
        getApmLockPath(projectRoot),
        staleLockYaml([".github/instructions/old.instructions.md"]),
      );
      await writeFileContent(
        getApmManifestPath(projectRoot),
        `dependencies:
  apm:
    - acme/security#v1.0.0
`,
      );
      mockClientInstance.listDirectory.mockResolvedValue([]);

      const localLogger = createMockLogger();
      await installApm({ projectRoot, logger: localLogger, options: { update: true } });

      expect(await fileExists(join(outsideDir, "old.instructions.md"))).toBe(true);
      expect(localLogger.warn).toHaveBeenCalledWith(
        expect.stringMatching(
          /^Refusing to remove stale apm file "\.github\/instructions\/old\.instructions\.md": Refusing to follow a symbolic link/,
        ),
      );
    },
  );

  it.skipIf(process.platform === "win32")(
    "reports a filesystem error during stale-file removal as it is",
    async () => {
      // A regular file where a directory is expected: lstat reports ENOTDIR.
      await writeFileContent(join(testDir, ".github", "instructions", "plain"), "not a directory");
      await writeFileContent(
        getApmLockPath(testDir),
        staleLockYaml([".github/instructions/plain/old.instructions.md"]),
      );
      await writeManifest(
        `dependencies:
  apm:
    - acme/security#v1.0.0
`,
      );
      mockClientInstance.listDirectory.mockResolvedValue([]);

      const localLogger = createMockLogger();
      await installApm({ projectRoot: testDir, logger: localLogger, options: { update: true } });

      const warnMessages = localLogger.warn.mock.calls.map((args) => String(args[0]));
      expect(
        warnMessages.some(
          (m) =>
            m.startsWith(
              'Skipping removal of stale apm file ".github/instructions/plain/old.instructions.md":',
            ) && m.includes("ENOTDIR"),
        ),
      ).toBe(true);
      expect(warnMessages.some((m) => m.includes("symbolic link"))).toBe(false);
    },
  );

  it.skipIf(process.platform === "win32")(
    "--frozen checks every target before writing any of them",
    async () => {
      const projectRoot = join(testDir, "project");
      const outsideDir = join(testDir, "outside");
      await mkdir(join(projectRoot, ".github"), { recursive: true });
      await mkdir(outsideDir, { recursive: true });
      // `.github/instructions/...` sorts before `.github/skills/...`, so the
      // rejected target is the second one written.
      await symlink(outsideDir, join(projectRoot, ".github", "skills"));
      // A hash rulesync did not write skips the integrity check, so the run
      // reaches the deferred writes.
      await writeFileContent(
        getApmLockPath(projectRoot),
        `lockfile_version: "1"
generated_at: "2026-04-20T00:00:00Z"
apm_version: "0.7.7"
dependencies:
  - repo_url: https://github.com/acme/security
    resolved_commit: ${VALID_SHA}
    resolved_ref: v1.0.0
    depth: 1
    package_type: apm_package
    content_hash: "sha256:legacy"
    deployed_files:
      - .github/instructions/a.instructions.md
      - .github/skills/s/SKILL.md
`,
      );
      await writeFileContent(
        getApmManifestPath(projectRoot),
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
                size: 10,
              },
            ];
          }
          if (path === ".apm/skills") {
            return [{ name: "s", path: ".apm/skills/s", type: "dir", size: 0 }];
          }
          if (path === ".apm/skills/s") {
            return [{ name: "SKILL.md", path: ".apm/skills/s/SKILL.md", type: "file", size: 10 }];
          }
          return [];
        },
      );
      mockClientInstance.getFileContent.mockResolvedValue("content");

      await installApm({ projectRoot, logger, options: { frozen: true } }).catch(() => undefined);

      expect(await readdir(outsideDir)).toEqual([]);
      expect(await fileExists(join(projectRoot, ".github/instructions/a.instructions.md"))).toBe(
        false,
      );
    },
  );

  it("preserves top-level mcp_servers and other loose fields across install rewrites", async () => {
    // A lockfile produced by the upstream `apm` CLI may carry extra top-level
    // fields (mcp_servers, custom extensions, etc.). Rulesync must not wipe
    // these when it rewrites the lockfile — only dependencies/generated_at
    // should be owned by us.
    const validHash = `sha256:${"0".repeat(64)}`;
    const lockYaml = `lockfile_version: "1"
generated_at: "2026-04-20T00:00:00Z"
apm_version: "0.7.7"
mcp_servers:
  - security-scanner
  - code-reviewer
custom_extension:
  foo: bar
dependencies:
  - repo_url: https://github.com/acme/security
    resolved_commit: ${VALID_SHA}
    resolved_ref: v1.0.0
    depth: 1
    package_type: apm_package
    content_hash: ${validHash}
    deployed_files: []
`;
    await writeFileContent(getApmLockPath(testDir), lockYaml);

    await writeManifest(
      `dependencies:
  apm:
    - acme/security#v1.0.0
`,
    );
    mockClientInstance.listDirectory.mockResolvedValue([]);

    await installApm({ projectRoot: testDir, logger, options: { update: true } });

    const after = await readApmLock(testDir);
    expect(after?.mcp_servers).toEqual(["security-scanner", "code-reviewer"]);
    expect((after as unknown as { custom_extension: unknown }).custom_extension).toEqual({
      foo: "bar",
    });
  });

  it("tolerates a non-rulesync content_hash under --frozen without tripping integrity", async () => {
    // The upstream `apm` CLI may write content_hash values that do not match
    // the rulesync regex. readApmLock must accept them (regression for the
    // hard regex) AND frozen installs must not throw `content_hash mismatch`
    // for such entries — the commit SHA is still the integrity anchor.
    const lockYaml = `lockfile_version: "1"
generated_at: "2026-04-20T00:00:00Z"
apm_version: "0.7.7"
dependencies:
  - repo_url: https://github.com/acme/security
    resolved_commit: ${VALID_SHA}
    resolved_ref: v1.0.0
    depth: 1
    package_type: apm_package
    content_hash: "sha256:legacy"
    deployed_files:
      - .github/instructions/a.instructions.md
`;
    await writeFileContent(getApmLockPath(testDir), lockYaml);

    // readApmLock must not throw on the legacy-shape hash.
    const parsed = await readApmLock(testDir);
    expect(parsed?.dependencies[0]?.content_hash).toBe("sha256:legacy");

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
        return [];
      },
    );
    // Content is totally different from what the legacy hash supposedly
    // covered. Rulesync must NOT raise `content_hash mismatch` here because
    // the recorded hash is not a rulesync-written value.
    mockClientInstance.getFileContent.mockResolvedValue("arbitrary content");

    await expect(
      installApm({ projectRoot: testDir, logger, options: { frozen: true } }),
    ).resolves.toBeDefined();
  });

  it("skips tree entries whose path escapes remoteBase with a warning", async () => {
    await writeManifest(
      `dependencies:
  apm:
    - acme/security#v1.0.0
`,
    );

    // A malicious tree entry pretends to live under .apm/instructions but
    // its `path` actually resolves outside of it. Such entries must be
    // skipped rather than written to disk.
    mockClientInstance.listDirectory.mockImplementation(
      async (_owner: string, _repo: string, path: string) => {
        if (path === ".apm/instructions") {
          return [
            {
              name: "escape.md",
              path: "../escape.md",
              type: "file",
              size: 10,
            },
          ];
        }
        return [];
      },
    );
    mockClientInstance.getFileContent.mockResolvedValue("evil");

    const result = await installApm({ projectRoot: testDir, logger });
    expect(result.deployedFileCount).toBe(0);
    // The escape payload must not appear anywhere under projectRoot.
    expect(await fileExists(join(testDir, "escape.md"))).toBe(false);
    expect(await fileExists(join(testDir, ".github/instructions/escape.md"))).toBe(false);
  });
});
