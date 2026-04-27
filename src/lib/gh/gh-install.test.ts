import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SourceEntry } from "../../config/config.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { fileExists, readFileContent } from "../../utils/file.js";
import { installGh } from "./gh-install.js";
import { getGhLockPath, readGhLock } from "./gh-lock.js";

let mockClientInstance: any;

vi.mock("../github-client.js", () => ({
  GitHubClient: class MockGitHubClient {
    static resolveToken = vi.fn().mockReturnValue(undefined);

    getDefaultBranch(...args: any[]) {
      return mockClientInstance.getDefaultBranch(...args);
    }
    getLatestRelease(...args: any[]) {
      return mockClientInstance.getLatestRelease(...args);
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
    getFileInfo(...args: any[]) {
      return mockClientInstance.getFileInfo(...args);
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

function makeNotFound(): Error & { statusCode: number } {
  const err = new Error("Not found") as Error & { statusCode: number };
  err.statusCode = 404;
  return err;
}

function source(overrides: Partial<SourceEntry> & { source: string }): SourceEntry {
  return overrides;
}

describe("installGh", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;
  const logger = createMockLogger();

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());

    mockClientInstance = {
      getDefaultBranch: vi.fn().mockResolvedValue("main"),
      getLatestRelease: vi.fn().mockResolvedValue({
        tag_name: "v1.0.0",
        name: "v1.0.0",
        prerelease: false,
        draft: false,
        assets: [],
      }),
      resolveRefToSha: vi.fn().mockResolvedValue(VALID_SHA),
      listDirectory: vi.fn(),
      getFileContent: vi.fn(),
      getFileInfo: vi.fn(),
    };
  });

  afterEach(async () => {
    await cleanup();
    vi.clearAllMocks();
  });

  function setupSingleSkill(skillName: string, agent = "github-copilot"): void {
    mockClientInstance.listDirectory.mockImplementation(
      async (_owner: string, _repo: string, path: string) => {
        if (path === "skills") {
          return [{ name: skillName, path: `skills/${skillName}`, type: "dir", size: 0 }];
        }
        if (path === `skills/${skillName}`) {
          return [
            {
              name: "SKILL.md",
              path: `skills/${skillName}/SKILL.md`,
              type: "file",
              size: 50,
            },
          ];
        }
        throw makeNotFound();
      },
    );
    mockClientInstance.getFileInfo.mockImplementation(async (_o: string, _r: string, p: string) => {
      if (p === `skills/${skillName}/SKILL.md`) {
        return { name: "SKILL.md", path: p, type: "file", size: 50 };
      }
      return null;
    });
    mockClientInstance.getFileContent.mockImplementation(
      async (_o: string, _r: string, p: string) => `# ${skillName}\n\nbody for ${p}\n`,
    );
    void agent;
  }

  it("returns early on empty sources", async () => {
    const result = await installGh({ outputRoot: testDir, sources: [], logger });
    expect(result).toEqual({
      sourcesProcessed: 0,
      installedSkillCount: 0,
      failedSourceCount: 0,
    });
  });

  it("rejects non-github sources with a clear error", async () => {
    await expect(
      installGh({
        outputRoot: testDir,
        sources: [source({ source: "https://gitlab.com/owner/repo" })],
        logger,
      }),
    ).rejects.toThrow(/--mode gh only supports GitHub sources/);
  });

  it("rejects entry.transport='git' with a field-specific error", async () => {
    await expect(
      installGh({
        outputRoot: testDir,
        sources: [source({ source: "owner/repo", transport: "git" })],
        logger,
      }),
    ).rejects.toThrow(/"transport" is not supported/);
  });

  it("rejects entry.path with a field-specific error", async () => {
    await expect(
      installGh({
        outputRoot: testDir,
        sources: [source({ source: "owner/repo", path: "exports/skills" })],
        logger,
      }),
    ).rejects.toThrow(/"path" is not supported/);
  });

  it("--frozen fails up-front for a brand-new source not in the lockfile (no API calls)", async () => {
    // Seed a lockfile that covers ONE source. The new install asks for two
    // sources — the second has no installations at all in the lock.
    setupSingleSkill("s");
    await installGh({
      outputRoot: testDir,
      sources: [source({ source: "owner/first" })],
      logger,
    });

    // Reset call counts so we can prove the second --frozen run never hits
    // the GitHub API for the brand-new "owner/added" source.
    mockClientInstance.getLatestRelease.mockClear();
    mockClientInstance.listDirectory.mockClear();
    mockClientInstance.resolveRefToSha.mockClear();

    await expect(
      installGh({
        outputRoot: testDir,
        sources: [source({ source: "owner/first" }), source({ source: "owner/added" })],
        options: { frozen: true },
        logger,
      }),
    ).rejects.toThrow(/missing entries for/);

    // Critical: the eager pre-flight must throw BEFORE any GitHub API call
    // is issued, both to save quota and (the actual reason) to prevent a
    // sibling source from writing to disk before this throw lands.
    expect(mockClientInstance.getLatestRelease).not.toHaveBeenCalled();
    expect(mockClientInstance.listDirectory).not.toHaveBeenCalled();
    expect(mockClientInstance.resolveRefToSha).not.toHaveBeenCalled();
  });

  it("--frozen never writes any source's bytes when one sibling source fails", async () => {
    // Seed two distinct sources (different agents so they land at different
    // paths) so frozen pre-flight passes and we can observe per-source
    // write behavior independently.
    mockClientInstance.listDirectory.mockImplementation(
      async (_o: string, _r: string, p: string) => {
        if (p === "skills") {
          return [{ name: "s", path: "skills/s", type: "dir", size: 0 }];
        }
        if (p === "skills/s") {
          return [{ name: "SKILL.md", path: "skills/s/SKILL.md", type: "file", size: 10 }];
        }
        throw makeNotFound();
      },
    );
    mockClientInstance.getFileInfo.mockImplementation(async (_o: string, _r: string, p: string) =>
      p === "skills/s/SKILL.md" ? { name: "SKILL.md", path: p, type: "file", size: 10 } : null,
    );
    mockClientInstance.getFileContent.mockResolvedValue("# original\n");

    await installGh({
      outputRoot: testDir,
      sources: [
        source({ source: "owner/repo", agent: "github-copilot" }),
        source({ source: "owner/repo", agent: "claude-code" }),
      ],
      logger,
    });

    const copilotPath = join(testDir, ".agents/skills/s/SKILL.md");
    const claudePath = join(testDir, ".claude/skills/s/SKILL.md");
    const originalCopilot = await readFileContent(copilotPath);
    const originalClaude = await readFileContent(claudePath);

    // Now under --frozen, return tampered bytes ONLY for the github-copilot
    // installation (use the call sequence: copilot is the first source so
    // its install runs first under Promise.all). The integrity check will
    // throw for it. Under deferred-write semantics, the claude-code source
    // (which would otherwise pass all checks AND write its bytes in
    // installSource) must NOT touch the on-disk file before the throw.
    let getContentCalls = 0;
    mockClientInstance.getFileContent.mockImplementation(async () => {
      getContentCalls += 1;
      // First call: copilot -> tampered (will fail integrity).
      // Second call: claude -> different bytes, would normally land on disk.
      return getContentCalls === 1 ? "# tampered copilot\n" : "# would-write-claude\n";
    });

    await expect(
      installGh({
        outputRoot: testDir,
        sources: [
          source({ source: "owner/repo", agent: "github-copilot" }),
          source({ source: "owner/repo", agent: "claude-code" }),
        ],
        options: { frozen: true },
        logger,
      }),
    ).rejects.toThrow(/content_hash mismatch/);

    // Both files must remain at their pre-frozen bytes. If the claude-code
    // source had been allowed to write inside its own installSource (the
    // pre-fix behavior), claudePath would now contain "# would-write-claude\n".
    expect(await readFileContent(copilotPath)).toBe(originalCopilot);
    expect(await readFileContent(claudePath)).toBe(originalClaude);
  });

  it("discovers skills via skills/<name>/SKILL.md and writes them with default agent (github-copilot)", async () => {
    setupSingleSkill("git-commit");
    const result = await installGh({
      outputRoot: testDir,
      sources: [source({ source: "owner/repo" })],
      logger,
    });
    expect(result.sourcesProcessed).toBe(1);
    expect(result.installedSkillCount).toBe(1);
    expect(result.failedSourceCount).toBe(0);

    // Default agent github-copilot, project scope -> .agents/skills.
    const skillPath = join(testDir, ".agents/skills/git-commit/SKILL.md");
    expect(await fileExists(skillPath)).toBe(true);
    const content = await readFileContent(skillPath);
    expect(content).toContain("source: https://github.com/owner/repo");
    expect(content).toContain("repository: owner/repo");
    expect(content).toContain("ref: v1.0.0");

    const lock = await readGhLock(testDir);
    expect(lock?.installations).toHaveLength(1);
    expect(lock?.installations[0]).toMatchObject({
      source: "owner/repo",
      owner: "owner",
      repo: "repo",
      agent: "github-copilot",
      scope: "project",
      skill: "git-commit",
      resolved_ref: "v1.0.0",
      resolved_commit: VALID_SHA,
      install_dir: ".agents/skills",
      deployed_files: [".agents/skills/git-commit/SKILL.md"],
    });
  });

  it("honors entry.agent (claude-code) and writes under .claude/skills", async () => {
    setupSingleSkill("git-commit");
    await installGh({
      outputRoot: testDir,
      sources: [source({ source: "owner/repo", agent: "claude-code" })],
      logger,
    });
    expect(await fileExists(join(testDir, ".claude/skills/git-commit/SKILL.md"))).toBe(true);
  });

  it("honors entry.skills filter and warns about missing names", async () => {
    mockClientInstance.listDirectory.mockImplementation(
      async (_o: string, _r: string, p: string) => {
        if (p === "skills") {
          return [
            { name: "wanted", path: "skills/wanted", type: "dir", size: 0 },
            { name: "ignored", path: "skills/ignored", type: "dir", size: 0 },
          ];
        }
        if (p === "skills/wanted") {
          return [{ name: "SKILL.md", path: "skills/wanted/SKILL.md", type: "file", size: 10 }];
        }
        if (p === "skills/ignored") {
          return [{ name: "SKILL.md", path: "skills/ignored/SKILL.md", type: "file", size: 10 }];
        }
        throw makeNotFound();
      },
    );
    mockClientInstance.getFileInfo.mockImplementation(async (_o: string, _r: string, p: string) =>
      p.endsWith("/SKILL.md") ? { name: "SKILL.md", path: p, type: "file", size: 10 } : null,
    );
    mockClientInstance.getFileContent.mockResolvedValue("# x\n");

    const localLogger = createMockLogger();
    const result = await installGh({
      outputRoot: testDir,
      sources: [source({ source: "owner/repo", skills: ["wanted", "missing"] })],
      logger: localLogger,
    });
    expect(result.installedSkillCount).toBe(1);
    expect(await fileExists(join(testDir, ".agents/skills/wanted/SKILL.md"))).toBe(true);
    expect(await fileExists(join(testDir, ".agents/skills/ignored/SKILL.md"))).toBe(false);

    const warns = localLogger.warn.mock.calls.map((args) => String(args[0]));
    expect(warns.some((m) => m.includes('"missing"'))).toBe(true);
  });

  it("uses entry.ref when present, skipping latest-release lookup", async () => {
    setupSingleSkill("s");
    await installGh({
      outputRoot: testDir,
      sources: [source({ source: "owner/repo", ref: "feature-branch" })],
      logger,
    });
    expect(mockClientInstance.getLatestRelease).not.toHaveBeenCalled();
    expect(mockClientInstance.resolveRefToSha).toHaveBeenCalledWith(
      "owner",
      "repo",
      "feature-branch",
    );
  });

  it("falls back to default branch when latest release returns 404", async () => {
    setupSingleSkill("s");
    mockClientInstance.getLatestRelease.mockRejectedValue(makeNotFound());
    mockClientInstance.getDefaultBranch.mockResolvedValue("trunk");

    await installGh({
      outputRoot: testDir,
      sources: [source({ source: "owner/repo" })],
      logger,
    });
    expect(mockClientInstance.getDefaultBranch).toHaveBeenCalledWith("owner", "repo");
    expect(mockClientInstance.resolveRefToSha).toHaveBeenCalledWith("owner", "repo", "trunk");

    // When falling back to a branch (not a release tag), the SKILL.md ref
    // recorded in the injected frontmatter should be the resolved commit SHA.
    const content = await readFileContent(join(testDir, ".agents/skills/s/SKILL.md"));
    expect(content).toContain(`ref: ${VALID_SHA}`);
  });

  it("--frozen fails when the lockfile is missing", async () => {
    setupSingleSkill("s");
    await expect(
      installGh({
        outputRoot: testDir,
        sources: [source({ source: "owner/repo" })],
        options: { frozen: true },
        logger,
      }),
    ).rejects.toThrow(/rulesync-gh\.lock\.yaml is missing/);
  });

  it("--update re-resolves refs even when the lockfile is present", async () => {
    setupSingleSkill("s");
    await installGh({
      outputRoot: testDir,
      sources: [source({ source: "owner/repo" })],
      logger,
    });
    expect(mockClientInstance.resolveRefToSha).toHaveBeenCalledTimes(1);

    // Bump SHA to simulate upstream movement and re-run with --update.
    mockClientInstance.resolveRefToSha.mockResolvedValue(SECOND_SHA);
    await installGh({
      outputRoot: testDir,
      sources: [source({ source: "owner/repo" })],
      options: { update: true },
      logger,
    });
    const lock = await readGhLock(testDir);
    expect(lock?.installations[0]?.resolved_commit).toBe(SECOND_SHA);
  });

  it("removes stale files no longer present in the new lockfile", async () => {
    // First install: skill with SKILL.md + extra.md.
    mockClientInstance.listDirectory.mockImplementation(
      async (_o: string, _r: string, p: string) => {
        if (p === "skills") {
          return [{ name: "s", path: "skills/s", type: "dir", size: 0 }];
        }
        if (p === "skills/s") {
          return [
            { name: "SKILL.md", path: "skills/s/SKILL.md", type: "file", size: 10 },
            { name: "extra.md", path: "skills/s/extra.md", type: "file", size: 10 },
          ];
        }
        throw makeNotFound();
      },
    );
    mockClientInstance.getFileInfo.mockImplementation(async (_o: string, _r: string, p: string) =>
      p === "skills/s/SKILL.md" ? { name: "SKILL.md", path: p, type: "file", size: 10 } : null,
    );
    mockClientInstance.getFileContent.mockImplementation(
      async (_o: string, _r: string, p: string) => `content of ${p}`,
    );

    await installGh({
      outputRoot: testDir,
      sources: [source({ source: "owner/repo" })],
      logger,
    });
    expect(await fileExists(join(testDir, ".agents/skills/s/SKILL.md"))).toBe(true);
    expect(await fileExists(join(testDir, ".agents/skills/s/extra.md"))).toBe(true);

    // Second install: extra.md disappears upstream.
    mockClientInstance.listDirectory.mockImplementation(
      async (_o: string, _r: string, p: string) => {
        if (p === "skills") {
          return [{ name: "s", path: "skills/s", type: "dir", size: 0 }];
        }
        if (p === "skills/s") {
          return [{ name: "SKILL.md", path: "skills/s/SKILL.md", type: "file", size: 10 }];
        }
        throw makeNotFound();
      },
    );

    await installGh({
      outputRoot: testDir,
      sources: [source({ source: "owner/repo" })],
      options: { update: true },
      logger,
    });
    expect(await fileExists(join(testDir, ".agents/skills/s/SKILL.md"))).toBe(true);
    expect(await fileExists(join(testDir, ".agents/skills/s/extra.md"))).toBe(false);

    const lock = await readGhLock(testDir);
    expect(lock?.installations[0]?.deployed_files).toEqual([".agents/skills/s/SKILL.md"]);
  });

  it("writes the lockfile path correctly", async () => {
    setupSingleSkill("s");
    await installGh({
      outputRoot: testDir,
      sources: [source({ source: "owner/repo" })],
      logger,
    });
    expect(await fileExists(getGhLockPath(testDir))).toBe(true);
  });
});
