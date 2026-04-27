import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SourceEntry } from "../../config/config.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { fileExists, readFileContent, writeFileContent } from "../../utils/file.js";
import { installGh } from "./gh-install.js";
import { getGhLockPath } from "./gh-lock.js";

// Mock the GitHub network boundary like the sibling gh-install.test.ts does.
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

// Pseudo-home pattern from .claude/rules/testing-guidelines.md. We mock
// `getHomeDirectory` so user-scope writes land under a controlled testDir
// rather than the real $HOME.
const { getHomeDirectoryMock } = vi.hoisted(() => ({
  getHomeDirectoryMock: vi.fn(),
}));
vi.mock("../../utils/file.js", async () => {
  const actual = await vi.importActual<typeof import("../../utils/file.js")>("../../utils/file.js");
  return {
    ...actual,
    getHomeDirectory: getHomeDirectoryMock,
  };
});

const VALID_SHA = "a".repeat(40);

function source(overrides: Partial<SourceEntry> & { source: string }): SourceEntry {
  return overrides;
}

function makeNotFound(): Error & { statusCode: number } {
  const err = new Error("Not found") as Error & { statusCode: number };
  err.statusCode = 404;
  return err;
}

describe("installGh — user scope", () => {
  let projectDir: string;
  let projectCleanup: () => Promise<void>;
  let homeDir: string;
  let homeCleanup: () => Promise<void>;
  const logger = createMockLogger();

  beforeEach(async () => {
    ({ testDir: projectDir, cleanup: projectCleanup } = await setupTestDirectory());
    ({ testDir: homeDir, cleanup: homeCleanup } = await setupTestDirectory({ home: true }));
    getHomeDirectoryMock.mockReturnValue(homeDir);

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
    await projectCleanup();
    await homeCleanup();
    getHomeDirectoryMock.mockClear();
    vi.clearAllMocks();
  });

  function setupSingleSkill(skillName: string, files: Array<{ name: string; size?: number }>) {
    mockClientInstance.listDirectory.mockImplementation(
      async (_o: string, _r: string, p: string) => {
        if (p === "skills") {
          return [{ name: skillName, path: `skills/${skillName}`, type: "dir", size: 0 }];
        }
        if (p === `skills/${skillName}`) {
          return files.map((f) => ({
            name: f.name,
            // The malicious-tree cases below override `path` with `..`-laden
            // values; honor any name shaped like a relative path here.
            path: f.name.includes("..") ? f.name : `skills/${skillName}/${f.name}`,
            type: "file",
            size: f.size ?? 10,
          }));
        }
        throw makeNotFound();
      },
    );
    mockClientInstance.getFileInfo.mockImplementation(async (_o: string, _r: string, p: string) =>
      p === `skills/${skillName}/SKILL.md`
        ? { name: "SKILL.md", path: p, type: "file", size: 10 }
        : null,
    );
    mockClientInstance.getFileContent.mockImplementation(
      async (_o: string, _r: string, p: string) => `# ${skillName}\nfrom ${p}\n`,
    );
  }

  it("writes claude-code user-scope files under <home>/.claude/skills/<skill>/", async () => {
    setupSingleSkill("git-commit", [{ name: "SKILL.md" }]);

    const result = await installGh({
      projectRoot: projectDir,
      sources: [source({ source: "owner/repo", agent: "claude-code", scope: "user" })],
      logger,
    });

    expect(result.installedSkillCount).toBe(1);
    // Files must NOT land in the project tree.
    expect(await fileExists(join(projectDir, ".claude/skills/git-commit/SKILL.md"))).toBe(false);
    // Files MUST land under the pseudo-home dir.
    const userPath = join(homeDir, ".claude/skills/git-commit/SKILL.md");
    expect(await fileExists(userPath)).toBe(true);
    expect(await readFileContent(userPath)).toContain("source: https://github.com/owner/repo");

    // The lockfile itself still lives at the project root (next to rulesync.jsonc).
    expect(await fileExists(getGhLockPath(projectDir))).toBe(true);
  });

  it("writes antigravity user-scope files under <home>/.gemini/antigravity/skills/<skill>/", async () => {
    setupSingleSkill("av-skill", [{ name: "SKILL.md" }]);

    await installGh({
      projectRoot: projectDir,
      sources: [source({ source: "owner/repo", agent: "antigravity", scope: "user" })],
      logger,
    });

    const userPath = join(homeDir, ".gemini/antigravity/skills/av-skill/SKILL.md");
    expect(await fileExists(userPath)).toBe(true);
  });

  it("rejects a malicious upstream tree entry whose path escapes the skill directory", async () => {
    // Upstream lists a file whose `path` resolves outside the skills/ tree
    // via a `..` segment. The path-traversal hardening in installSource
    // (rooted at the install dir for user scope = pseudo-home dir) must
    // skip / refuse such entries rather than write them under <home>.
    mockClientInstance.listDirectory.mockImplementation(
      async (_o: string, _r: string, p: string) => {
        if (p === "skills") {
          return [{ name: "evil", path: "skills/evil", type: "dir", size: 0 }];
        }
        if (p === "skills/evil") {
          return [
            { name: "SKILL.md", path: "skills/evil/SKILL.md", type: "file", size: 10 },
            // Attacker-controlled path: would resolve to <home>/escape.md.
            { name: "escape.md", path: "../../../../escape.md", type: "file", size: 10 },
          ];
        }
        throw makeNotFound();
      },
    );
    mockClientInstance.getFileInfo.mockImplementation(async (_o: string, _r: string, p: string) =>
      p === "skills/evil/SKILL.md" ? { name: "SKILL.md", path: p, type: "file", size: 10 } : null,
    );
    mockClientInstance.getFileContent.mockResolvedValue("payload\n");

    const localLogger = createMockLogger();
    await installGh({
      projectRoot: projectDir,
      sources: [source({ source: "owner/repo", agent: "claude-code", scope: "user" })],
      logger: localLogger,
    });

    // The legitimate SKILL.md was deployed.
    expect(await fileExists(join(homeDir, ".claude/skills/evil/SKILL.md"))).toBe(true);
    // The escape attempt did NOT land at <home>/escape.md or anywhere else.
    expect(await fileExists(join(homeDir, "escape.md"))).toBe(false);
    expect(await fileExists(join(projectDir, "escape.md"))).toBe(false);
    // A skip warning was emitted for the escape entry.
    const warnMessages = localLogger.warn.mock.calls.map((args) => String(args[0]));
    expect(warnMessages.some((m) => m.includes("escape.md") || m.includes(".."))).toBe(true);
  });

  it("respects the user-scope root when removing stale files from a previous install", async () => {
    // First install: deploy SKILL.md + extra.md under user scope.
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
      async (_o: string, _r: string, p: string) => `content of ${p}\n`,
    );

    await installGh({
      projectRoot: projectDir,
      sources: [source({ source: "owner/repo", agent: "claude-code", scope: "user" })],
      logger,
    });
    expect(await fileExists(join(homeDir, ".claude/skills/s/extra.md"))).toBe(true);

    // Second install: extra.md is gone from the upstream tree. Stale-file
    // cleanup must (a) remove it from <home>/.claude/skills/s/, NOT from
    // the project dir, and (b) leave the legitimate SKILL.md in place.
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
      projectRoot: projectDir,
      sources: [source({ source: "owner/repo", agent: "claude-code", scope: "user" })],
      options: { update: true },
      logger,
    });

    expect(await fileExists(join(homeDir, ".claude/skills/s/SKILL.md"))).toBe(true);
    expect(await fileExists(join(homeDir, ".claude/skills/s/extra.md"))).toBe(false);
    // Defense-in-depth: a same-named file inside the project dir must not
    // have been deleted by a wrong-scope cleanup.
    await writeFileContent(join(projectDir, ".claude/skills/s/extra.md"), "project-scope sentinel");
    // Re-run install to trigger another stale-cleanup pass; the sentinel
    // (which is not in any lockfile entry) must survive.
    await installGh({
      projectRoot: projectDir,
      sources: [source({ source: "owner/repo", agent: "claude-code", scope: "user" })],
      options: { update: true },
      logger,
    });
    expect(await fileExists(join(projectDir, ".claude/skills/s/extra.md"))).toBe(true);
  });
});
