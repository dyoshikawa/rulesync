import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getGhLockPath } from "../../lib/gh/gh-lock.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { fileExists, readFileContent, writeFileContent } from "../../utils/file.js";
import { installCommand } from "./install.js";

// Mock only the network boundary. Everything else (config loader, lockfile
// read/write, filesystem deployment) runs for real against a temp directory —
// this is the happy-path E2E for --mode gh.
let mockClientInstance: any;

vi.mock("../../lib/github-client.js", () => ({
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

describe("installCommand --mode gh (happy path)", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;
  const logger = createMockLogger();

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);

    mockClientInstance = {
      getDefaultBranch: vi.fn().mockResolvedValue("main"),
      getLatestRelease: vi.fn().mockResolvedValue({
        tag_name: "v1.2.3",
        name: "v1.2.3",
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

  it("installs declared sources into agent dirs and writes rulesync-gh.lock.yaml", async () => {
    // rulesync.jsonc with a gh-mode source pinned to claude-code / project scope.
    await writeFileContent(
      join(testDir, "rulesync.jsonc"),
      `{
  "targets": ["claudecode"],
  "features": ["rules"],
  "sources": [
    { "source": "acme/skills", "agent": "claude-code", "scope": "project" }
  ]
}
`,
    );

    mockClientInstance.listDirectory.mockImplementation(
      async (_owner: string, _repo: string, path: string) => {
        if (path === "skills") {
          return [{ name: "git-commit", path: "skills/git-commit", type: "dir", size: 0 }];
        }
        if (path === "skills/git-commit") {
          return [
            {
              name: "SKILL.md",
              path: "skills/git-commit/SKILL.md",
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
    mockClientInstance.getFileInfo.mockImplementation(
      async (_owner: string, _repo: string, path: string) =>
        path === "skills/git-commit/SKILL.md"
          ? { name: "SKILL.md", path, type: "file", size: 100 }
          : null,
    );
    mockClientInstance.getFileContent.mockImplementation(
      async (_owner: string, _repo: string, path: string) => `# Git Commit\n\nbody from ${path}\n`,
    );

    await installCommand(logger, { mode: "gh" });

    const skillPath = join(testDir, ".claude/skills/git-commit/SKILL.md");
    expect(await fileExists(skillPath)).toBe(true);
    const content = await readFileContent(skillPath);
    // Provenance frontmatter must be injected at the top.
    expect(content.startsWith("---\n")).toBe(true);
    expect(content).toContain("source: https://github.com/acme/skills");
    expect(content).toContain("repository: acme/skills");
    expect(content).toContain("ref: v1.2.3");
    // Original body preserved.
    expect(content).toContain("# Git Commit");

    expect(await fileExists(getGhLockPath(testDir))).toBe(true);
    const lockContent = await readFileContent(getGhLockPath(testDir));
    expect(lockContent).toContain("lockfile_version:");
    expect(lockContent).toContain("agent: claude-code");
    expect(lockContent).toContain("scope: project");
    expect(lockContent).toContain(VALID_SHA);
    expect(lockContent).toContain(".claude/skills/git-commit/SKILL.md");
  });
});
