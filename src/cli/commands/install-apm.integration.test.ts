import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getApmLockPath } from "../../lib/apm/apm-lock.js";
import { getApmManifestPath } from "../../lib/apm/apm-manifest.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { fileExists, readFileContent, writeFileContent } from "../../utils/file.js";
import { installCommand } from "./install.js";

// Mock only the network boundary. Everything else (manifest parsing,
// lockfile read/write, filesystem deployment) runs for real against a
// temporary test directory — this is the happy-path E2E for --mode apm.
let mockClientInstance: any;

vi.mock("../../lib/github-client.js", () => ({
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

describe("installCommand --mode apm (happy path)", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;
  const logger = createMockLogger();

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);

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

  it("installs declared dependencies into .github/ and writes apm.lock.yaml", async () => {
    await writeFileContent(
      getApmManifestPath(testDir),
      `name: demo
version: 1.0.0
dependencies:
  apm:
    - acme/security#v1.0.0
`,
    );

    mockClientInstance.listDirectory.mockImplementation(
      async (_owner: string, _repo: string, path: string) => {
        if (path === ".apm/instructions") {
          return [
            {
              name: "sql-injection.instructions.md",
              path: ".apm/instructions/sql-injection.instructions.md",
              type: "file",
              size: 100,
            },
          ];
        }
        if (path === ".apm/skills") {
          return [
            {
              name: "security-audit",
              path: ".apm/skills/security-audit",
              type: "dir",
              size: 0,
            },
          ];
        }
        if (path === ".apm/skills/security-audit") {
          return [
            {
              name: "SKILL.md",
              path: ".apm/skills/security-audit/SKILL.md",
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
      async (_owner: string, _repo: string, path: string) => `# contents of ${path}\n`,
    );

    await installCommand(logger, { mode: "apm" });

    expect(
      await readFileContent(join(testDir, ".github/instructions/sql-injection.instructions.md")),
    ).toBe("# contents of .apm/instructions/sql-injection.instructions.md\n");
    expect(await readFileContent(join(testDir, ".github/skills/security-audit/SKILL.md"))).toBe(
      "# contents of .apm/skills/security-audit/SKILL.md\n",
    );

    expect(await fileExists(getApmLockPath(testDir))).toBe(true);
    const lockContent = await readFileContent(getApmLockPath(testDir));
    expect(lockContent).toContain("lockfile_version:");
    expect(lockContent).toContain("resolved_commit:");
    expect(lockContent).toContain(VALID_SHA);
    expect(lockContent).toContain(".github/instructions/sql-injection.instructions.md");
    expect(lockContent).toContain(".github/skills/security-audit/SKILL.md");
  });
});
