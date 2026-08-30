import { chmod, link, lstat, symlink } from "node:fs/promises";
import { join, posix } from "node:path";

import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { createMockLogger } from "../test-utils/mock-logger.js";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import {
  directoryExists,
  ensureDir,
  fileExists,
  readFileContent,
  writeFileContent,
} from "../utils/file.js";
import { fetchFiles, formatFetchSummary } from "./fetch.js";
import { parseSource } from "./source-parser.js";

const logger = createMockLogger();

let mockClientInstance: any;

const { promptSkillSelectionMock, isInteractiveTerminalMock } = vi.hoisted(() => ({
  promptSkillSelectionMock: vi.fn(),
  isInteractiveTerminalMock: vi.fn(),
}));

vi.mock("./skill-prompt.js", () => ({
  promptSkillSelection: promptSkillSelectionMock,
  isInteractiveTerminal: isInteractiveTerminalMock,
}));

vi.mock("./github-client.js", () => ({
  GitHubClient: class MockGitHubClient {
    static resolveToken = vi.fn();

    validateRepository(...args: any[]) {
      return mockClientInstance.validateRepository(...args);
    }
    getDefaultBranch(...args: any[]) {
      return mockClientInstance.getDefaultBranch(...args);
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
}));

function mockMixedFeatureRepository(): { rulePath: string; skillPath: string } {
  const rulePath = posix.join("rules", "overview.md");
  const skillDirPath = posix.join("skills", "test-skill");
  const skillPath = posix.join(skillDirPath, "SKILL.md");

  mockClientInstance.listDirectory.mockImplementation(
    (owner: string, repo: string, path: string) => {
      if (path === "rules") {
        return Promise.resolve([
          {
            name: "overview.md",
            path: rulePath,
            type: "file",
            sha: "abc",
            size: 200,
            download_url: "https://example.com",
          },
        ]);
      }
      if (path === "skills") {
        return Promise.resolve([
          {
            name: "test-skill",
            path: skillDirPath,
            type: "dir",
            sha: "def",
            size: 0,
            download_url: null,
          },
        ]);
      }
      if (path === skillDirPath) {
        return Promise.resolve([
          {
            name: "SKILL.md",
            path: skillPath,
            type: "file",
            sha: "ghi",
            size: 150,
            download_url: "https://example.com",
          },
        ]);
      }
      const error = new Error("Not found");
      Object.assign(error, { statusCode: 404 });
      return Promise.reject(error);
    },
  );

  return { rulePath, skillPath };
}

describe("parseSource", () => {
  describe("GitHub URL parsing", () => {
    it("should parse basic GitHub URL", () => {
      const result = parseSource("https://github.com/owner/repo");
      expect(result).toEqual({
        provider: "github",
        owner: "owner",
        repo: "repo",
      });
    });

    it("should parse GitHub URL with /tree/branch", () => {
      const result = parseSource("https://github.com/owner/repo/tree/main");
      expect(result).toEqual({
        provider: "github",
        owner: "owner",
        repo: "repo",
        ref: "main",
        path: undefined,
      });
    });

    it("should parse GitHub URL with /tree/branch/path", () => {
      const result = parseSource("https://github.com/owner/repo/tree/develop/packages/frontend");
      expect(result).toEqual({
        provider: "github",
        owner: "owner",
        repo: "repo",
        ref: "develop",
        path: "packages/frontend",
      });
    });

    it("should parse GitHub URL with /blob/branch/path", () => {
      const result = parseSource("https://github.com/owner/repo/blob/main/src/index.ts");
      expect(result).toEqual({
        provider: "github",
        owner: "owner",
        repo: "repo",
        ref: "main",
        path: "src/index.ts",
      });
    });

    it("should strip .git suffix from repo name", () => {
      const result = parseSource("https://github.com/owner/repo.git");
      expect(result).toEqual({
        provider: "github",
        owner: "owner",
        repo: "repo",
      });
    });

    it("should parse www.github.com URL", () => {
      const result = parseSource("https://www.github.com/owner/repo");
      expect(result).toEqual({
        provider: "github",
        owner: "owner",
        repo: "repo",
      });
    });

    it("should throw error for invalid GitHub URL", () => {
      expect(() => parseSource("https://github.com/owner")).toThrow(/Invalid github URL/);
    });
  });

  describe("GitLab URL parsing", () => {
    it("should parse basic GitLab URL", () => {
      const result = parseSource("https://gitlab.com/owner/repo");
      expect(result).toEqual({
        provider: "gitlab",
        owner: "owner",
        repo: "repo",
      });
    });

    it("should parse GitLab URL with /tree/branch", () => {
      const result = parseSource("https://gitlab.com/owner/repo/tree/main");
      expect(result).toEqual({
        provider: "gitlab",
        owner: "owner",
        repo: "repo",
        ref: "main",
        path: undefined,
      });
    });

    it("should parse www.gitlab.com URL", () => {
      const result = parseSource("https://www.gitlab.com/owner/repo");
      expect(result).toEqual({
        provider: "gitlab",
        owner: "owner",
        repo: "repo",
      });
    });
  });

  describe("prefix format parsing", () => {
    it("should parse github:owner/repo", () => {
      const result = parseSource("github:owner/repo");
      expect(result).toEqual({
        provider: "github",
        owner: "owner",
        repo: "repo",
      });
    });

    it("should parse gitlab:owner/repo", () => {
      const result = parseSource("gitlab:owner/repo");
      expect(result).toEqual({
        provider: "gitlab",
        owner: "owner",
        repo: "repo",
      });
    });

    it("should parse github:owner/repo@ref", () => {
      const result = parseSource("github:owner/repo@v1.0.0");
      expect(result).toEqual({
        provider: "github",
        owner: "owner",
        repo: "repo",
        ref: "v1.0.0",
      });
    });

    it("should parse gitlab:owner/repo:path", () => {
      const result = parseSource("gitlab:owner/repo:subdir");
      expect(result).toEqual({
        provider: "gitlab",
        owner: "owner",
        repo: "repo",
        path: "subdir",
      });
    });

    it("should parse github:owner/repo@ref:path", () => {
      const result = parseSource("github:owner/repo@main:packages/frontend");
      expect(result).toEqual({
        provider: "github",
        owner: "owner",
        repo: "repo",
        ref: "main",
        path: "packages/frontend",
      });
    });
  });

  describe("shorthand parsing", () => {
    it("should parse basic owner/repo (defaults to github)", () => {
      const result = parseSource("owner/repo");
      expect(result).toEqual({
        provider: "github",
        owner: "owner",
        repo: "repo",
      });
    });

    it("should parse owner/repo@ref", () => {
      const result = parseSource("owner/repo@main");
      expect(result).toEqual({
        provider: "github",
        owner: "owner",
        repo: "repo",
        ref: "main",
      });
    });

    it("should parse owner/repo:path", () => {
      const result = parseSource("owner/repo:packages/frontend");
      expect(result).toEqual({
        provider: "github",
        owner: "owner",
        repo: "repo",
        path: "packages/frontend",
      });
    });

    it("should parse owner/repo@ref:path", () => {
      const result = parseSource("owner/repo@v1.0.0:packages/frontend");
      expect(result).toEqual({
        provider: "github",
        owner: "owner",
        repo: "repo",
        ref: "v1.0.0",
        path: "packages/frontend",
      });
    });

    it("should throw error for invalid shorthand", () => {
      expect(() => parseSource("invalid")).toThrow(/Invalid source/);
    });

    it("should throw error for empty owner or repo", () => {
      expect(() => parseSource("/repo")).toThrow(/Invalid source/);
      expect(() => parseSource("owner/")).toThrow(/Invalid source/);
    });

    it("should throw error for empty ref after @", () => {
      expect(() => parseSource("owner/repo@")).toThrow(/Ref cannot be empty/);
    });

    it("should throw error for empty path after :", () => {
      expect(() => parseSource("owner/repo:")).toThrow(/Path cannot be empty/);
    });
  });

  describe("unknown provider handling", () => {
    it("should throw error for unknown URL host", () => {
      expect(() => parseSource("https://bitbucket.org/owner/repo")).toThrow(
        /Unknown Git provider for host/,
      );
    });

    it("should reject subdomain spoofing attempts for GitHub", () => {
      expect(() => parseSource("https://phishing.github.com/owner/repo")).toThrow(
        /Unknown Git provider for host/,
      );
      expect(() => parseSource("https://evil.github.com/owner/repo")).toThrow(
        /Unknown Git provider for host/,
      );
    });

    it("should reject subdomain spoofing attempts for GitLab", () => {
      expect(() => parseSource("https://phishing.gitlab.com/owner/repo")).toThrow(
        /Unknown Git provider for host/,
      );
      expect(() => parseSource("https://evil.gitlab.com/owner/repo")).toThrow(
        /Unknown Git provider for host/,
      );
    });

    it("should reject suffix spoofing attempts", () => {
      expect(() => parseSource("https://notgithub.com/owner/repo")).toThrow(
        /Unknown Git provider for host/,
      );
      expect(() => parseSource("https://notgitlab.com/owner/repo")).toThrow(
        /Unknown Git provider for host/,
      );
    });
  });
});

describe("fetchFiles", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);

    mockClientInstance = {
      validateRepository: vi.fn().mockResolvedValue(true),
      getDefaultBranch: vi.fn().mockResolvedValue("main"),
      listDirectory: vi.fn(),
      getFileContent: vi.fn(),
    };
  });

  afterEach(async () => {
    await cleanup();
    vi.clearAllMocks();
  });

  it("should throw error for GitLab provider", async () => {
    await expect(
      fetchFiles({ logger, source: "gitlab:owner/repo", outputRoot: testDir }),
    ).rejects.toThrow("GitLab is not yet supported");
  });

  it("should fetch files from feature directories directly", async () => {
    // Mock directory listing at root level
    mockClientInstance.listDirectory.mockImplementation(
      (owner: string, repo: string, path: string) => {
        if (path === "rules") {
          return Promise.resolve([
            {
              name: "overview.md",
              path: "rules/overview.md",
              type: "file",
              sha: "abc",
              size: 200,
              download_url: "https://example.com",
            },
          ]);
        }
        if (path === "skills") {
          return Promise.resolve([
            {
              name: "test-skill",
              path: "skills/test-skill",
              type: "dir",
              sha: "def",
              size: 0,
              download_url: null,
            },
          ]);
        }
        if (path === "skills/test-skill") {
          return Promise.resolve([
            {
              name: "SKILL.md",
              path: "skills/test-skill/SKILL.md",
              type: "file",
              sha: "ghi",
              size: 150,
              download_url: "https://example.com",
            },
          ]);
        }
        if (path === ".") {
          return Promise.resolve([
            {
              name: "mcp.json",
              path: "mcp.json",
              type: "file",
              sha: "jkl",
              size: 100,
              download_url: "https://example.com",
            },
          ]);
        }
        // Return 404 for other paths
        const error = new Error("Not found");
        Object.assign(error, { statusCode: 404 });
        return Promise.reject(error);
      },
    );

    mockClientInstance.getFileContent.mockImplementation(
      (owner: string, repo: string, path: string) => {
        if (path === "rules/overview.md") {
          return Promise.resolve("# Overview\n\nTest content");
        }
        if (path === "skills/test-skill/SKILL.md") {
          return Promise.resolve("# Skill\n\nTest skill");
        }
        if (path === "mcp.json") {
          return Promise.resolve('{"mcpServers": {}}');
        }
        return Promise.resolve("");
      },
    );

    const summary = await fetchFiles({
      logger,
      source: "owner/repo",
      options: { features: ["rules", "skills", "mcp"] },
      outputRoot: testDir,
    });

    expect(summary.source).toBe("owner/repo");
    expect(summary.ref).toBe("main");
    expect(summary.created).toBe(3);
    expect(summary.files).toHaveLength(3);

    // Verify files were written to .rulesync (default output)
    const overviewPath = join(testDir, ".rulesync", "rules", "overview.md");
    const skillPath = join(testDir, ".rulesync", "skills", "test-skill", "SKILL.md");
    const mcpPath = join(testDir, ".rulesync", "mcp.json");

    expect(await fileExists(overviewPath)).toBe(true);
    expect(await fileExists(skillPath)).toBe(true);
    expect(await fileExists(mcpPath)).toBe(true);

    const overviewContent = await readFileContent(overviewPath);
    expect(overviewContent).toBe("# Overview\n\nTest content");
  });

  it("should filter files by features", async () => {
    mockClientInstance.listDirectory.mockImplementation(
      (owner: string, repo: string, path: string) => {
        if (path === "rules") {
          return Promise.resolve([
            {
              name: "overview.md",
              path: "rules/overview.md",
              type: "file",
              sha: "abc",
              size: 200,
              download_url: "https://example.com",
            },
          ]);
        }
        if (path === "commands") {
          return Promise.resolve([
            {
              name: "test.md",
              path: "commands/test.md",
              type: "file",
              sha: "def",
              size: 150,
              download_url: "https://example.com",
            },
          ]);
        }
        // Return 404 for other paths
        const error = new Error("Not found");
        Object.assign(error, { statusCode: 404 });
        return Promise.reject(error);
      },
    );

    mockClientInstance.getFileContent.mockResolvedValue("content");

    const summary = await fetchFiles({
      logger,
      source: "owner/repo",
      options: { features: ["rules"] },
      outputRoot: testDir,
    });

    expect(summary.files).toHaveLength(1);
    expect(summary.files[0]?.relativePath).toBe("rules/overview.md");
  });

  it("should fetch only skills when features are omitted", async () => {
    const { skillPath } = mockMixedFeatureRepository();
    mockClientInstance.getFileContent.mockResolvedValue("# Skill\n\nTest skill");

    const summary = await fetchFiles({
      logger,
      source: "owner/repo",
      outputRoot: testDir,
    });

    expect(summary.files).toEqual([{ relativePath: skillPath, status: "created" }]);
    expect(mockClientInstance.listDirectory).not.toHaveBeenCalledWith(
      "owner",
      "repo",
      "rules",
      "main",
    );
  });

  it("should fetch all features when the wildcard is explicit", async () => {
    const { rulePath, skillPath } = mockMixedFeatureRepository();
    mockClientInstance.getFileContent.mockResolvedValue("content");

    const summary = await fetchFiles({
      logger,
      source: "owner/repo",
      options: { features: ["*"] },
      outputRoot: testDir,
    });

    expect(summary.files.map((file) => file.relativePath)).toEqual([rulePath, skillPath]);
  });

  it("should fetch no features when an empty array is explicit", async () => {
    const summary = await fetchFiles({
      logger,
      source: "owner/repo",
      options: { features: [] },
      outputRoot: testDir,
    });

    expect(summary.files).toEqual([]);
    expect(mockClientInstance.listDirectory).not.toHaveBeenCalled();
  });

  it("should skip existing files with skip strategy", async () => {
    // Create an existing file
    await ensureDir(join(testDir, ".rulesync", "rules"));
    await writeFileContent(join(testDir, ".rulesync", "rules", "existing.md"), "existing content");

    mockClientInstance.listDirectory.mockImplementation(
      (owner: string, repo: string, path: string) => {
        if (path === "rules") {
          return Promise.resolve([
            {
              name: "existing.md",
              path: "rules/existing.md",
              type: "file",
              sha: "abc",
              size: 200,
              download_url: "https://example.com",
            },
            {
              name: "new.md",
              path: "rules/new.md",
              type: "file",
              sha: "def",
              size: 150,
              download_url: "https://example.com",
            },
          ]);
        }
        // Return 404 for other paths
        const error = new Error("Not found");
        Object.assign(error, { statusCode: 404 });
        return Promise.reject(error);
      },
    );

    mockClientInstance.getFileContent.mockResolvedValue("new content");

    const summary = await fetchFiles({
      logger,
      source: "owner/repo",
      options: { conflict: "skip", features: ["rules"] },
      outputRoot: testDir,
    });

    expect(summary.created).toBe(1);
    expect(summary.skipped).toBe(1);

    // Verify existing file was not modified
    const existingContent = await readFileContent(
      join(testDir, ".rulesync", "rules", "existing.md"),
    );
    expect(existingContent).toBe("existing content");
  });

  it("should overwrite existing files with overwrite strategy", async () => {
    // Create an existing file
    await ensureDir(join(testDir, ".rulesync", "rules"));
    await writeFileContent(join(testDir, ".rulesync", "rules", "existing.md"), "old content");

    mockClientInstance.listDirectory.mockImplementation(
      (owner: string, repo: string, path: string) => {
        if (path === "rules") {
          return Promise.resolve([
            {
              name: "existing.md",
              path: "rules/existing.md",
              type: "file",
              sha: "abc",
              size: 200,
              download_url: "https://example.com",
            },
          ]);
        }
        // Return 404 for other paths
        const error = new Error("Not found");
        Object.assign(error, { statusCode: 404 });
        return Promise.reject(error);
      },
    );

    mockClientInstance.getFileContent.mockResolvedValue("new content");

    const summary = await fetchFiles({
      logger,
      source: "owner/repo",
      options: { conflict: "overwrite", features: ["rules"] },
      outputRoot: testDir,
    });

    expect(summary.overwritten).toBe(1);

    // Verify file was overwritten
    const content = await readFileContent(join(testDir, ".rulesync", "rules", "existing.md"));
    expect(content).toBe("new content");
  });

  it("should use custom output directory", async () => {
    mockClientInstance.listDirectory.mockImplementation(
      (owner: string, repo: string, path: string) => {
        if (path === "rules") {
          return Promise.resolve([
            {
              name: "overview.md",
              path: "rules/overview.md",
              type: "file",
              sha: "abc",
              size: 100,
              download_url: "https://example.com",
            },
          ]);
        }
        // Return 404 for other paths
        const error = new Error("Not found");
        Object.assign(error, { statusCode: 404 });
        return Promise.reject(error);
      },
    );

    mockClientInstance.getFileContent.mockResolvedValue("content");

    await fetchFiles({
      logger,
      source: "owner/repo",
      options: { output: "custom-output", features: ["rules"] },
      outputRoot: testDir,
    });

    // Verify file was written to custom directory
    const filePath = join(testDir, "custom-output", "rules", "overview.md");
    expect(await fileExists(filePath)).toBe(true);
  });

  it("should use ref from options over source", async () => {
    // Create a proper mock error with statusCode property
    class MockGitHubClientError extends Error {
      statusCode?: number;
      constructor(message: string, statusCode?: number) {
        super(message);
        this.statusCode = statusCode;
      }
    }

    mockClientInstance.listDirectory.mockImplementation(() => {
      return Promise.reject(new MockGitHubClientError("Not found", 404));
    });

    await fetchFiles({
      logger,
      source: "owner/repo@main",
      options: { ref: "develop", features: ["rules"] },
      outputRoot: testDir,
    });

    expect(mockClientInstance.listDirectory).toHaveBeenCalledWith(
      "owner",
      "repo",
      "rules",
      "develop",
      expect.anything(),
    );
  });

  it("should handle repository with subdirectory path", async () => {
    mockClientInstance.listDirectory.mockImplementation(
      (owner: string, repo: string, path: string) => {
        if (path === "packages/shared/rules") {
          return Promise.resolve([
            {
              name: "overview.md",
              path: "packages/shared/rules/overview.md",
              type: "file",
              sha: "abc",
              size: 100,
              download_url: "https://example.com",
            },
          ]);
        }
        // Return 404 for other paths
        const error = new Error("Not found");
        Object.assign(error, { statusCode: 404 });
        return Promise.reject(error);
      },
    );

    mockClientInstance.getFileContent.mockResolvedValue("content");

    const summary = await fetchFiles({
      logger,
      source: "owner/repo:packages/shared",
      options: { features: ["rules"] },
      outputRoot: testDir,
    });

    expect(summary.created).toBe(1);
    expect(summary.files[0]?.relativePath).toBe("rules/overview.md");
  });

  it.each([
    ["POSIX style input", "owner/repo:packages/shared"],
    ["Windows style input (backslashes in subdir)", "owner/repo:packages\\shared"],
    ["mixed separators in subdir", "owner/repo:packages/shared\\nested"],
  ])("should send forward-slash paths to GitHub API (%s)", async (_label, source) => {
    mockClientInstance.listDirectory.mockImplementation(
      (owner: string, repo: string, path: string) => {
        // Verify no backslashes in any path sent to GitHub API
        expect(path, `GitHub API path "${path}" must not contain backslashes`).not.toContain("\\");

        if (path.endsWith("/rules")) {
          return Promise.resolve([
            {
              name: "overview.md",
              path: `${path}/overview.md`,
              type: "file",
              sha: "abc",
              size: 100,
              download_url: "https://example.com",
            },
          ]);
        }
        if (!path.endsWith("/rules") && !path.includes(".")) {
          return Promise.resolve([
            {
              name: "mcp.json",
              path: `${path}/mcp.json`,
              type: "file",
              sha: "def",
              size: 50,
              download_url: "https://example.com",
            },
          ]);
        }
        const error = new Error("Not found");
        Object.assign(error, { statusCode: 404 });
        return Promise.reject(error);
      },
    );

    mockClientInstance.getFileContent.mockResolvedValue("content");

    const summary = await fetchFiles({
      logger,
      source,
      options: { features: ["rules", "mcp"] },
      outputRoot: testDir,
    });

    expect(summary.created).toBeGreaterThanOrEqual(1);

    // Double-check: all listDirectory calls used forward-slash paths
    for (const call of mockClientInstance.listDirectory.mock.calls) {
      const apiPath = call[2] as string;
      expect(apiPath, `GitHub API path "${apiPath}" must use forward slashes`).not.toContain("\\");
    }
  });

  it("should reject path traversal attempts", async () => {
    mockClientInstance.listDirectory.mockImplementation(
      (owner: string, repo: string, path: string) => {
        if (path === "rules") {
          return Promise.resolve([
            {
              // Malicious path attempting traversal
              name: "malicious.md",
              path: "rules/../../../etc/passwd",
              type: "file",
              sha: "def",
              size: 100,
              download_url: "https://example.com",
            },
          ]);
        }
        // Return 404 for other paths
        const error = new Error("Not found");
        Object.assign(error, { statusCode: 404 });
        return Promise.reject(error);
      },
    );

    mockClientInstance.getFileContent.mockResolvedValue("malicious content");

    await expect(
      fetchFiles({
        logger,
        source: "owner/repo",
        options: { features: ["rules"] },
        outputRoot: testDir,
      }),
      // A `..` segment is turned away while the remote listing is still being
      // collected, before anything is written or pruned.
    ).rejects.toThrow(/Unsafe path in the remote repository/);
  });

  it("should reject output directory path traversal attempts", async () => {
    await expect(
      fetchFiles({
        logger,
        source: "owner/repo",
        outputRoot: testDir,
        options: {
          output: "../../outside",
        },
      }),
    ).rejects.toThrow("Path traversal detected");
  });

  it("should reject files exceeding size limit", async () => {
    mockClientInstance.listDirectory.mockImplementation(
      (owner: string, repo: string, path: string) => {
        if (path === "rules") {
          return Promise.resolve([
            {
              name: "large.md",
              path: "rules/large.md",
              type: "file",
              sha: "abc",
              size: 11 * 1024 * 1024, // 11MB, exceeds 10MB limit
              download_url: "https://example.com",
            },
          ]);
        }
        // Return 404 for other paths
        const error = new Error("Not found");
        Object.assign(error, { statusCode: 404 });
        return Promise.reject(error);
      },
    );

    await expect(
      fetchFiles({
        logger,
        source: "owner/repo",
        options: { features: ["rules"] },
        outputRoot: testDir,
      }),
    ).rejects.toThrow("exceeds maximum size limit");
  });

  it("should not let an oversized file's name rewrite the error it is reported in", async () => {
    mockClientInstance.listDirectory.mockImplementation(
      (owner: string, repo: string, path: string) => {
        if (path === "rules") {
          return Promise.resolve([
            {
              name: "large\u001b[2K.md",
              path: "rules/large\u001b[2K.md",
              type: "file",
              sha: "abc",
              size: 11 * 1024 * 1024,
              download_url: "https://example.com",
            },
          ]);
        }
        const error = new Error("Not found");
        Object.assign(error, { statusCode: 404 });
        return Promise.reject(error);
      },
    );

    // The path is the remote repository's to choose, and the message is read in
    // a terminal, so an escape sequence in it must not survive.
    await expect(
      fetchFiles({
        logger,
        source: "owner/repo",
        options: { features: ["rules"] },
        outputRoot: testDir,
      }),
    ).rejects.toThrow(/"rules\/large\[2K\.md" exceeds maximum size limit/);
  });

  it("should throw error when directory recursion exceeds maximum depth", async () => {
    // Create a mock that returns a nested directory at every level
    let callCount = 0;
    mockClientInstance.listDirectory.mockImplementation(() => {
      callCount++;
      return Promise.resolve([
        {
          name: `level-${callCount}`,
          path: `${"nested/".repeat(callCount)}level-${callCount}`,
          type: "dir",
          size: 0,
        },
      ]);
    });

    await expect(
      fetchFiles({
        logger,
        source: "owner/repo",
        options: { features: ["rules"] },
        outputRoot: testDir,
      }),
    ).rejects.toThrow(/Maximum recursion depth.*exceeded/);
  });

  describe("parallel fetching behavior", () => {
    it("should fetch multiple files concurrently", async () => {
      const callOrder: string[] = [];
      const resolvers = new Map<string, () => void>();
      let getFileContentCallCount = 0;

      mockClientInstance.listDirectory.mockImplementation(
        (_owner: string, _repo: string, path: string) => {
          if (path === "rules") {
            return Promise.resolve([
              {
                name: "a.md",
                path: "rules/a.md",
                type: "file",
                sha: "a",
                size: 10,
                download_url: "https://example.com",
              },
              {
                name: "b.md",
                path: "rules/b.md",
                type: "file",
                sha: "b",
                size: 10,
                download_url: "https://example.com",
              },
              {
                name: "c.md",
                path: "rules/c.md",
                type: "file",
                sha: "c",
                size: 10,
                download_url: "https://example.com",
              },
            ]);
          }
          const error = new Error("Not found");
          Object.assign(error, { statusCode: 404 });
          return Promise.reject(error);
        },
      );

      mockClientInstance.getFileContent.mockImplementation(
        (_owner: string, _repo: string, path: string) => {
          getFileContentCallCount++;
          callOrder.push(`start:${path}`);
          return new Promise((resolve) => {
            resolvers.set(path, () => {
              callOrder.push(`end:${path}`);
              resolve(`content of ${path}`);
            });
          });
        },
      );

      const resultPromise = fetchFiles({
        logger,
        source: "owner/repo",
        options: { features: ["rules"] },
        outputRoot: testDir,
      });

      // Wait for all 3 getFileContent calls to be made
      await vi.waitFor(() => {
        expect(getFileContentCallCount).toBe(3);
      });

      // At this point, all 3 fetches should have started
      const starts = callOrder.filter((e) => e.startsWith("start:"));
      expect(starts.length).toBe(3);

      // Verify no fetches have completed yet
      const firstEnd = callOrder.findIndex((e) => e.startsWith("end:"));
      expect(firstEnd).toBe(-1);

      // Now resolve all the promises
      resolvers.forEach((resolve) => resolve());

      const result = await resultPromise;
      expect(result.files).toHaveLength(3);
      expect(result.created).toBe(3);
    });

    it("should propagate errors from parallel fetches correctly", async () => {
      mockClientInstance.listDirectory.mockImplementation(
        (_owner: string, _repo: string, path: string) => {
          if (path === "rules") {
            return Promise.resolve([
              {
                name: "a.md",
                path: "rules/a.md",
                type: "file",
                sha: "a",
                size: 10,
                download_url: "https://example.com",
              },
              {
                name: "b.md",
                path: "rules/b.md",
                type: "file",
                sha: "b",
                size: 10,
                download_url: "https://example.com",
              },
            ]);
          }
          const error = new Error("Not found");
          Object.assign(error, { statusCode: 404 });
          return Promise.reject(error);
        },
      );

      mockClientInstance.getFileContent.mockImplementation(
        (_owner: string, _repo: string, path: string) => {
          if (path === "rules/b.md") {
            return Promise.reject(new Error("API rate limit exceeded"));
          }
          return Promise.resolve(`content of ${path}`);
        },
      );

      await expect(
        fetchFiles({
          logger,
          source: "owner/repo",
          options: { features: ["rules"] },
          outputRoot: testDir,
        }),
      ).rejects.toThrow("API rate limit exceeded");
    });

    it("should fetch recursive directories concurrently", async () => {
      const apiCallTimestamps: Array<{ path: string; time: number }> = [];
      const startTime = Date.now();

      mockClientInstance.listDirectory.mockImplementation(
        (_owner: string, _repo: string, path: string) => {
          apiCallTimestamps.push({ path, time: Date.now() - startTime });
          if (path === "rules") {
            return Promise.resolve([
              {
                name: "dir1",
                path: "rules/dir1",
                type: "dir",
                sha: "d1",
                size: 0,
                download_url: null,
              },
              {
                name: "dir2",
                path: "rules/dir2",
                type: "dir",
                sha: "d2",
                size: 0,
                download_url: null,
              },
            ]);
          }
          if (path === "rules/dir1") {
            return Promise.resolve([
              {
                name: "a.md",
                path: "rules/dir1/a.md",
                type: "file",
                sha: "a",
                size: 10,
                download_url: "https://example.com",
              },
            ]);
          }
          if (path === "rules/dir2") {
            return Promise.resolve([
              {
                name: "b.md",
                path: "rules/dir2/b.md",
                type: "file",
                sha: "b",
                size: 10,
                download_url: "https://example.com",
              },
            ]);
          }
          const error = new Error("Not found");
          Object.assign(error, { statusCode: 404 });
          return Promise.reject(error);
        },
      );

      mockClientInstance.getFileContent.mockResolvedValue("content");

      const result = await fetchFiles({
        logger,
        source: "owner/repo",
        options: { features: ["rules"] },
        outputRoot: testDir,
      });

      expect(result.files).toHaveLength(2);
      expect(result.created).toBe(2);

      // dir1 and dir2 should be listed (indicating recursive traversal)
      const dirPaths = apiCallTimestamps.map((c) => c.path);
      expect(dirPaths).toContain("rules/dir1");
      expect(dirPaths).toContain("rules/dir2");
    });
  });
});

describe("fetchFiles with skill selection", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  function mockMultiSkillRepository(): void {
    mockClientInstance.listDirectory.mockImplementation(
      (_owner: string, _repo: string, path: string) => {
        if (path === "skills") {
          return Promise.resolve([
            {
              name: "skill-a",
              path: "skills/skill-a",
              type: "dir",
              sha: "aaa",
              size: 0,
              download_url: null,
            },
            {
              name: "skill-b",
              path: "skills/skill-b",
              type: "dir",
              sha: "bbb",
              size: 0,
              download_url: null,
            },
          ]);
        }
        if (path === "skills/skill-a") {
          return Promise.resolve([
            {
              name: "SKILL.md",
              path: "skills/skill-a/SKILL.md",
              type: "file",
              sha: "ccc",
              size: 100,
              download_url: "https://example.com",
            },
          ]);
        }
        if (path === "skills/skill-b") {
          return Promise.resolve([
            {
              name: "SKILL.md",
              path: "skills/skill-b/SKILL.md",
              type: "file",
              sha: "ddd",
              size: 100,
              download_url: "https://example.com",
            },
          ]);
        }
        const error = new Error("Not found");
        Object.assign(error, { statusCode: 404 });
        return Promise.reject(error);
      },
    );

    mockClientInstance.getFileContent.mockResolvedValue("# Skill");
  }

  /**
   * The two-skill repository above, plus a directory per name in `names`, each
   * holding one `SKILL.md`.
   *
   * Every test below asks the same question of a name a repository could
   * publish — is it offered, is it fetched, is it warned about — and differs
   * only in the name. Spelling the listing out once per test buried that one
   * difference under twenty lines of identical mock, so the listing lives here
   * and each test names only what it is about.
   */
  function mockSkillRepositoryWithSkills(names: string[]): void {
    mockMultiSkillRepository();
    const baseImplementation = mockClientInstance.listDirectory.getMockImplementation();
    const extraPaths = new Set(names.map((name) => `skills/${name}`));
    mockClientInstance.listDirectory.mockImplementation(
      (owner: string, repo: string, path: string, ref: string) => {
        if (path === "skills") {
          return baseImplementation(owner, repo, path, ref).then(
            (entries: Array<Record<string, unknown>>) => [
              ...entries,
              ...names.map((name) => ({ name, path: `skills/${name}`, type: "dir" })),
            ],
          );
        }
        if (extraPaths.has(path)) {
          return Promise.resolve([
            {
              name: "SKILL.md",
              path: `${path}/SKILL.md`,
              type: "file",
              sha: "eee",
              size: 40,
              download_url: "https://example.com",
            },
          ]);
        }
        return baseImplementation(owner, repo, path, ref);
      },
    );
  }

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);

    mockClientInstance = {
      validateRepository: vi.fn().mockResolvedValue(true),
      getDefaultBranch: vi.fn().mockResolvedValue("main"),
      listDirectory: vi.fn(),
      getFileContent: vi.fn(),
    };
  });

  afterEach(async () => {
    await cleanup();
    vi.clearAllMocks();
  });

  it("should fetch only the skills named in the skills option", async () => {
    mockMultiSkillRepository();

    const summary = await fetchFiles({
      logger,
      source: "owner/repo",
      options: { skills: ["skill-a"] },
      outputRoot: testDir,
    });

    expect(summary.files).toEqual([{ relativePath: "skills/skill-a/SKILL.md", status: "created" }]);
    expect(await fileExists(join(testDir, ".rulesync", "skills", "skill-a", "SKILL.md"))).toBe(
      true,
    );
    expect(await fileExists(join(testDir, ".rulesync", "skills", "skill-b", "SKILL.md"))).toBe(
      false,
    );
    expect(promptSkillSelectionMock).not.toHaveBeenCalled();
  });

  it("should keep non-skill files untouched when filtering skills", async () => {
    mockMultiSkillRepository();
    const baseImplementation = mockClientInstance.listDirectory.getMockImplementation();
    mockClientInstance.listDirectory.mockImplementation(
      (owner: string, repo: string, path: string, ref: string) => {
        if (path === "rules") {
          return Promise.resolve([
            {
              name: "overview.md",
              path: "rules/overview.md",
              type: "file",
              sha: "eee",
              size: 100,
              download_url: "https://example.com",
            },
          ]);
        }
        return baseImplementation(owner, repo, path, ref);
      },
    );

    const summary = await fetchFiles({
      logger,
      source: "owner/repo",
      options: { features: ["rules", "skills"], skills: ["skill-b"] },
      outputRoot: testDir,
    });

    const relativePaths = summary.files.map((f) => f.relativePath).toSorted();
    expect(relativePaths).toEqual(["rules/overview.md", "skills/skill-b/SKILL.md"]);
  });

  it("should throw error for unknown skill names listing available skills", async () => {
    mockMultiSkillRepository();

    await expect(
      fetchFiles({
        logger,
        source: "owner/repo",
        options: { skills: ["skill-a", "no-such-skill"] },
        outputRoot: testDir,
      }),
    ).rejects.toThrow('Unknown skill(s): "no-such-skill". Available skills: "skill-a", "skill-b"');
  });

  it("should throw error when skills option is used without the skills feature", async () => {
    await expect(
      fetchFiles({
        logger,
        source: "owner/repo",
        options: { features: ["rules"], skills: ["skill-a"] },
        outputRoot: testDir,
      }),
    ).rejects.toThrow("require the skills feature");
  });

  it("should throw error when interactive option is used without the skills feature", async () => {
    await expect(
      fetchFiles({
        logger,
        source: "owner/repo",
        options: { features: ["rules"], interactive: true },
        outputRoot: testDir,
      }),
    ).rejects.toThrow("require the skills feature");
  });

  it("should fetch skills selected via the interactive prompt", async () => {
    mockMultiSkillRepository();
    isInteractiveTerminalMock.mockReturnValue(true);
    promptSkillSelectionMock.mockResolvedValue(["skill-b"]);

    const summary = await fetchFiles({
      logger,
      source: "owner/repo",
      options: { interactive: true },
      outputRoot: testDir,
    });

    expect(promptSkillSelectionMock).toHaveBeenCalledWith({
      availableSkills: ["skill-a", "skill-b"],
      preselectedSkills: [],
      localSkillNames: [],
    });
    expect(summary.files).toEqual([{ relativePath: "skills/skill-b/SKILL.md", status: "created" }]);
  });

  it("should pass skills option as preselected skills to the interactive prompt", async () => {
    mockMultiSkillRepository();
    isInteractiveTerminalMock.mockReturnValue(true);
    promptSkillSelectionMock.mockResolvedValue(["skill-a"]);

    await fetchFiles({
      logger,
      source: "owner/repo",
      options: { interactive: true, skills: ["skill-a"] },
      outputRoot: testDir,
    });

    expect(promptSkillSelectionMock).toHaveBeenCalledWith({
      availableSkills: ["skill-a", "skill-b"],
      preselectedSkills: ["skill-a"],
      localSkillNames: [],
    });
  });

  it("should throw error when interactive option is used without a TTY", async () => {
    mockMultiSkillRepository();
    isInteractiveTerminalMock.mockReturnValue(false);

    await expect(
      fetchFiles({
        logger,
        source: "owner/repo",
        options: { interactive: true },
        outputRoot: testDir,
      }),
    ).rejects.toThrow("requires an interactive terminal");
    expect(promptSkillSelectionMock).not.toHaveBeenCalled();
    // Fail-fast: no GitHub API call should happen before the TTY check
    expect(mockClientInstance.validateRepository).not.toHaveBeenCalled();
  });

  it("should not treat flat files directly under skills/ as selectable skills", async () => {
    mockMultiSkillRepository();
    const baseImplementation = mockClientInstance.listDirectory.getMockImplementation();
    mockClientInstance.listDirectory.mockImplementation(
      (owner: string, repo: string, path: string, ref: string) => {
        if (path === "skills") {
          return baseImplementation(owner, repo, path, ref).then(
            (entries: Array<Record<string, unknown>>) => [
              ...entries,
              {
                name: "README.md",
                path: "skills/README.md",
                type: "file",
                sha: "fff",
                size: 50,
                download_url: "https://example.com",
              },
            ],
          );
        }
        return baseImplementation(owner, repo, path, ref);
      },
    );
    isInteractiveTerminalMock.mockReturnValue(true);
    promptSkillSelectionMock.mockResolvedValue(["skill-a"]);

    const summary = await fetchFiles({
      logger,
      source: "owner/repo",
      options: { interactive: true },
      outputRoot: testDir,
    });

    // README.md is not offered as a skill, and passes through the filter
    expect(promptSkillSelectionMock).toHaveBeenCalledWith({
      availableSkills: ["skill-a", "skill-b"],
      preselectedSkills: [],
      localSkillNames: [],
    });
    const relativePaths = summary.files.map((f) => f.relativePath).toSorted();
    expect(relativePaths).toEqual(["skills/README.md", "skills/skill-a/SKILL.md"]);
  });

  it("should not fetch a skill directory whose name is invisible once stripped", async () => {
    mockSkillRepositoryWithSkills(["\u200e"]);
    isInteractiveTerminalMock.mockReturnValue(true);
    promptSkillSelectionMock.mockResolvedValue([]);

    const summary = await fetchFiles({
      logger,
      source: "owner/repo",
      options: { interactive: true },
      outputRoot: testDir,
    });

    // The directory is never offered, so selecting nothing must write nothing.
    expect(promptSkillSelectionMock).toHaveBeenCalledWith({
      availableSkills: ["skill-a", "skill-b"],
      preselectedSkills: [],
      localSkillNames: [],
    });
    expect(summary.files).toEqual([]);
    // Nothing is left of the name to print, so the warning says so rather than
    // trailing off after a "shown here" that shows nothing.
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Skipping one skill directory whose name contains hidden"),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Nothing is left of the name once the hidden characters"),
    );
  });

  it("should not let a skill that only displays as another one ride along with it", async () => {
    mockSkillRepositoryWithSkills(["skill\u200e-a"]);
    isInteractiveTerminalMock.mockReturnValue(true);
    promptSkillSelectionMock.mockResolvedValue(["skill-a"]);

    const summary = await fetchFiles({
      logger,
      source: "owner/repo",
      options: { interactive: true },
      outputRoot: testDir,
    });

    const relativePaths = summary.files.map((f) => f.relativePath).toSorted();
    expect(relativePaths).toEqual(["skills/skill-a/SKILL.md"]);
    // The stripped name reads exactly like the skill that WAS fetched, so the
    // warning has to quote it rather than assert that "skill-a" was skipped.
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('you did select: "skill-a".'));
  });

  it("should not fetch a skill directory whose name hides a zero-width character", async () => {
    // A zero-width space is not a control character, so nothing about this name
    // is caught by the control-character strip alone \u2014 yet it is drawn exactly
    // like the plain "pdf" a user would read it as.
    mockSkillRepositoryWithSkills(["pd\u200bf"]);
    isInteractiveTerminalMock.mockReturnValue(true);
    promptSkillSelectionMock.mockResolvedValue(["skill-a"]);

    const summary = await fetchFiles({
      logger,
      source: "owner/repo",
      options: { interactive: true },
      outputRoot: testDir,
    });

    // Never offered, so it cannot be picked, and picking everything else does
    // not drag it along.
    expect(promptSkillSelectionMock).toHaveBeenCalledWith({
      availableSkills: ["skill-a", "skill-b"],
      preselectedSkills: [],
      localSkillNames: [],
    });
    expect(summary.files.map((f) => f.relativePath)).toEqual(["skills/skill-a/SKILL.md"]);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('"pdf"'));
  });

  it("should drop a skill directory with a hidden character even with no selection", async () => {
    mockSkillRepositoryWithSkills(["pd\u3164f"]);

    // Neither --skills nor --interactive: everything the repository publishes
    // is fetched, which is exactly why the name that cannot be shown honestly
    // has to be left out here too.
    const summary = await fetchFiles({
      logger,
      source: "owner/repo",
      options: {},
      outputRoot: testDir,
    });

    const relativePaths = summary.files.map((f) => f.relativePath).toSorted();
    expect(relativePaths).toEqual(["skills/skill-a/SKILL.md", "skills/skill-b/SKILL.md"]);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('"pdf"'));
  });

  it("should fetch a name whose zero-width joiner is how its script is written", async () => {
    // Persian for "settings", written the way Persian writes it: a zero-width
    // non-joiner (U+200C) between the two words. Refusing this would refuse an
    // ordinary name rather than a disguise, so the joiner is judged by the
    // company it keeps \u2014 here, Arabic letters rather than Latin ones.
    const persianName = "\u062a\u0646\u0638\u06cc\u0645\u200c\u0627\u062a";
    mockSkillRepositoryWithSkills([persianName]);

    const summary = await fetchFiles({
      logger,
      source: "owner/repo",
      options: {},
      outputRoot: testDir,
    });

    expect(summary.files.map((f) => f.relativePath).toSorted()).toEqual([
      "skills/skill-a/SKILL.md",
      "skills/skill-b/SKILL.md",
      `skills/${persianName}/SKILL.md`,
    ]);
    expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining("hidden characters"));
  });

  it("should fetch a name that is an emoji keycap", async () => {
    // U+0031 U+FE0F U+20E3: the digit, the variation selector that asks for its
    // emoji form, and the enclosing keycap that draws the box. The base is a
    // digit rather than a pictograph, so nothing but the shape of the whole
    // sequence tells this from a name padded with a variation selector.
    const keycapName = "1\ufe0f\u20e3";
    mockSkillRepositoryWithSkills([keycapName]);

    const summary = await fetchFiles({
      logger,
      source: "owner/repo",
      options: {},
      outputRoot: testDir,
    });

    expect(summary.files.map((f) => f.relativePath).toSorted()).toEqual([
      `skills/${keycapName}/SKILL.md`,
      "skills/skill-a/SKILL.md",
      "skills/skill-b/SKILL.md",
    ]);
    expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining("hidden characters"));
  });

  it("should not fetch a skill directory whose name is nothing but blank space", async () => {
    // Every character shows something \u2014 an ideographic space shows a gap \u2014 so
    // nothing here is hidden; the row the prompt would draw is still blank.
    mockSkillRepositoryWithSkills(["\u3000 "]);

    const summary = await fetchFiles({
      logger,
      source: "owner/repo",
      options: {},
      outputRoot: testDir,
    });

    expect(summary.files.map((f) => f.relativePath).toSorted()).toEqual([
      "skills/skill-a/SKILL.md",
      "skills/skill-b/SKILL.md",
    ]);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("nothing to show here"));
  });

  it("should count two indistinguishable unsafe names as two skipped directories", async () => {
    mockSkillRepositoryWithSkills(["\u200e", "\u200f"]);
    isInteractiveTerminalMock.mockReturnValue(true);
    promptSkillSelectionMock.mockResolvedValue([]);

    const summary = await fetchFiles({
      logger,
      source: "owner/repo",
      options: { interactive: true },
      outputRoot: testDir,
    });

    expect(summary.files).toEqual([]);
    // Both strip down to the same empty string, so counting them by their
    // stripped form would report one directory instead of two.
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Skipping 2 skill directories whose names contain hidden"),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Nothing is left of those names once the hidden characters"),
    );
  });

  it("should count the unsafe names it does not spell out", async () => {
    // Twelve directories, each named for a real word with a zero-width space in
    // it: the warning spells out ten and says how many it did not.
    mockSkillRepositoryWithSkills(
      Array.from({ length: 12 }, (_unused, index) => `pd\u200bf-${index}`),
    );

    const summary = await fetchFiles({
      logger,
      source: "owner/repo",
      options: {},
      outputRoot: testDir,
    });

    expect(summary.files.map((file) => file.relativePath).toSorted()).toEqual([
      "skills/skill-a/SKILL.md",
      "skills/skill-b/SKILL.md",
    ]);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("and 2 more"));
  });

  it("should skip a skill directory named with marks that have nothing to sit on", async () => {
    // A combining acute accent on its own: it survives every strip, and draws
    // as a smear over whatever the terminal puts beside it.
    mockSkillRepositoryWithSkills(["\u0301"]);

    const summary = await fetchFiles({
      logger,
      source: "owner/repo",
      options: {},
      outputRoot: testDir,
    });

    expect(summary.files.map((file) => file.relativePath).toSorted()).toEqual([
      "skills/skill-a/SKILL.md",
      "skills/skill-b/SKILL.md",
    ]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Skipping one skill directory whose name contains hidden"),
    );
  });

  it("should say which fetched names read alike when there is no prompt to say it in", async () => {
    // "copy" spelled with a zero for the o: nothing about either name is
    // hidden, so both are fetched, and a run with no prompt has nowhere else to
    // be told that the two read the same.
    mockSkillRepositoryWithSkills(["copy", "c0py"]);

    const summary = await fetchFiles({
      logger,
      source: "owner/repo",
      options: {},
      outputRoot: testDir,
    });

    expect(summary.files.map((file) => file.relativePath)).toContain("skills/c0py/SKILL.md");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("may not be told apart on sight"),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("differs from it only by lookalike letters"),
    );
  });

  it("should say when a fetched name reaches past the row it is drawn on", async () => {
    // Nothing else on the list shares its display form, so the padding is only
    // reported by the note the name carries on its own \u2014 and a run with no
    // prompt has nowhere but the warning to be told.
    mockSkillRepositoryWithSkills(["pdf "]);

    const summary = await fetchFiles({
      logger,
      source: "owner/repo",
      options: {},
      outputRoot: testDir,
    });

    expect(summary.files.map((file) => file.relativePath)).toContain("skills/pdf /SKILL.md");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("carries more whitespace than the row shows"),
    );
  });

  it("should judge a --skills run against every name the repository publishes", async () => {
    // The user asks for one of the two by name, as a scripted run does. The
    // twin is what makes the requested name confusable, and it is not on the
    // list of what was fetched — so a warning that only looked at the fetched
    // names would find nothing to say.
    mockSkillRepositoryWithSkills(["copy", "c0py"]);

    const summary = await fetchFiles({
      logger,
      source: "owner/repo",
      options: { skills: ["c0py"] },
      outputRoot: testDir,
    });

    const fetched = summary.files.map((file) => file.relativePath);
    expect(fetched).toContain("skills/c0py/SKILL.md");
    expect(fetched).not.toContain("skills/copy/SKILL.md");
    const warning = logger.warn.mock.calls
      .map(([message]) => String(message))
      .find((message) => message.includes("may not be told apart on sight"));
    expect(warning).toContain("differs from it only by lookalike letters");
    // Only what this run writes is listed: the twin explains the note, it is
    // not itself a name the user has to check.
    expect(warning).toContain('"c0py"');
    expect(warning).not.toContain('"copy"');
  });

  it("should judge a fetched name against the skills already in the output directory", async () => {
    // The attack the remote listing cannot show: the repository publishes only
    // the imitation, so there is no twin beside it to compare, and the name is
    // plain ASCII in one script. What it reads like is a skill the user has
    // had all along.
    await ensureDir(join(testDir, ".rulesync", "skills", "deploy"));
    mockSkillRepositoryWithSkills(["dep1oy"]);

    const summary = await fetchFiles({
      logger,
      source: "owner/repo",
      options: {},
      outputRoot: testDir,
    });

    expect(summary.files.map((file) => file.relativePath)).toContain("skills/dep1oy/SKILL.md");
    const warning = logger.warn.mock.calls
      .map(([message]) => String(message))
      .find((message) => message.includes("may not be told apart on sight"));
    expect(warning).toContain("a local skill differs from it only by lookalike letters");
    expect(warning).toContain('"dep1oy"');
  });

  it("should not mark a fetched name against the local skill of the same name", async () => {
    // The ordinary case: fetching the same repository a second time refreshes
    // the skills it wrote the first time. Every row would carry a note if a
    // local name spelled exactly like a remote one counted as a collision.
    await ensureDir(join(testDir, ".rulesync", "skills", "skill-a"));
    mockMultiSkillRepository();

    await fetchFiles({ logger, source: "owner/repo", options: {}, outputRoot: testDir });

    expect(logger.warn).not.toHaveBeenCalledWith(
      expect.stringContaining("may not be told apart on sight"),
    );
  });

  it("should pass the local skill names to the interactive prompt", async () => {
    await ensureDir(join(testDir, ".rulesync", "skills", "deploy"));
    mockMultiSkillRepository();
    isInteractiveTerminalMock.mockReturnValue(true);
    promptSkillSelectionMock.mockResolvedValue([]);

    await fetchFiles({
      logger,
      source: "owner/repo",
      options: { interactive: true },
      outputRoot: testDir,
    });

    expect(promptSkillSelectionMock).toHaveBeenCalledWith({
      availableSkills: ["skill-a", "skill-b"],
      preselectedSkills: [],
      localSkillNames: ["deploy"],
    });
  });

  it("should count the lookalike names it does not spell out", async () => {
    // Six pairs, each a name and the same name with a capital I for the l:
    // twelve noted names, of which the warning spells out ten.
    mockSkillRepositoryWithSkills(
      Array.from({ length: 6 }, (_unused, index) => [`rules-${index}`, `ruIes-${index}`]).flat(),
    );

    await fetchFiles({ logger, source: "owner/repo", options: {}, outputRoot: testDir });

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("; and 2 more"));
  });

  it("should warn and fetch nothing when interactive is used but no skills exist", async () => {
    isInteractiveTerminalMock.mockReturnValue(true);
    mockClientInstance.listDirectory.mockImplementation(() => {
      const error = new Error("Not found");
      Object.assign(error, { statusCode: 404 });
      return Promise.reject(error);
    });

    const summary = await fetchFiles({
      logger,
      source: "owner/repo",
      options: { interactive: true },
      outputRoot: testDir,
    });

    expect(summary.files).toHaveLength(0);
    expect(promptSkillSelectionMock).not.toHaveBeenCalled();
  });

  it("should validate skill names in the tool-target conversion flow too", async () => {
    mockMultiSkillRepository();

    await expect(
      fetchFiles({
        logger,
        source: "owner/repo",
        options: { target: "claudecode", skills: ["no-such-skill"] },
        outputRoot: testDir,
      }),
    ).rejects.toThrow('Unknown skill(s): "no-such-skill"');
  });

  it("should apply the interactive selection in the tool-target conversion flow too", async () => {
    mockMultiSkillRepository();
    isInteractiveTerminalMock.mockReturnValue(true);
    promptSkillSelectionMock.mockResolvedValue(["skill-a"]);

    await fetchFiles({
      logger,
      source: "owner/repo",
      options: { target: "claudecode", interactive: true },
      outputRoot: testDir,
    });

    expect(promptSkillSelectionMock).toHaveBeenCalledWith({
      availableSkills: ["skill-a", "skill-b"],
      preselectedSkills: [],
      localSkillNames: [],
    });
  });

  it("should fetch no skill files when the interactive selection is empty", async () => {
    mockMultiSkillRepository();
    isInteractiveTerminalMock.mockReturnValue(true);
    promptSkillSelectionMock.mockResolvedValue([]);

    const summary = await fetchFiles({
      logger,
      source: "owner/repo",
      options: { interactive: true },
      outputRoot: testDir,
    });

    expect(summary.files).toHaveLength(0);
  });
});

describe("fetchFiles with target option", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);

    mockClientInstance = {
      validateRepository: vi.fn().mockResolvedValue(true),
      getDefaultBranch: vi.fn().mockResolvedValue("main"),
      listDirectory: vi.fn(),
      getFileContent: vi.fn(),
    };
  });

  afterEach(async () => {
    await cleanup();
    vi.clearAllMocks();
  });

  it("should maintain current behavior with target: rulesync", async () => {
    mockClientInstance.listDirectory.mockImplementation(
      (owner: string, repo: string, path: string) => {
        if (path === "rules") {
          return Promise.resolve([
            {
              name: "overview.md",
              path: "rules/overview.md",
              type: "file",
              sha: "abc",
              size: 200,
              download_url: "https://example.com",
            },
          ]);
        }
        const error = new Error("Not found");
        Object.assign(error, { statusCode: 404 });
        return Promise.reject(error);
      },
    );

    mockClientInstance.getFileContent.mockResolvedValue("# Overview\n\nTest content");

    const summary = await fetchFiles({
      logger,
      source: "owner/repo",
      options: { features: ["rules"], target: "rulesync" },
      outputRoot: testDir,
    });

    expect(summary.source).toBe("owner/repo");
    expect(summary.ref).toBe("main");
    expect(summary.created).toBe(1);

    // Verify file was written to .rulesync (default output)
    const overviewPath = join(testDir, ".rulesync", "rules", "overview.md");
    expect(await fileExists(overviewPath)).toBe(true);
    const content = await readFileContent(overviewPath);
    expect(content).toBe("# Overview\n\nTest content");
  });

  it("should maintain current behavior with no target specified", async () => {
    mockClientInstance.listDirectory.mockImplementation(
      (owner: string, repo: string, path: string) => {
        if (path === "rules") {
          return Promise.resolve([
            {
              name: "overview.md",
              path: "rules/overview.md",
              type: "file",
              sha: "abc",
              size: 200,
              download_url: "https://example.com",
            },
          ]);
        }
        const error = new Error("Not found");
        Object.assign(error, { statusCode: 404 });
        return Promise.reject(error);
      },
    );

    mockClientInstance.getFileContent.mockResolvedValue("# Overview\n\nTest content");

    const summary = await fetchFiles({
      logger,
      source: "owner/repo",
      options: { features: ["rules"] },
      outputRoot: testDir,
    });

    expect(summary.created).toBe(1);

    // Verify file was written to .rulesync (default output)
    const overviewPath = join(testDir, ".rulesync", "rules", "overview.md");
    expect(await fileExists(overviewPath)).toBe(true);
  });

  it("should convert claudecode format to rulesync format", async () => {
    // Mock directory listing for rules
    mockClientInstance.listDirectory.mockImplementation(
      (owner: string, repo: string, path: string) => {
        if (path === "rules") {
          return Promise.resolve([
            {
              name: "coding-guidelines.md",
              path: "rules/coding-guidelines.md",
              type: "file",
              sha: "abc",
              size: 200,
              download_url: "https://example.com",
            },
          ]);
        }
        const error = new Error("Not found");
        Object.assign(error, { statusCode: 404 });
        return Promise.reject(error);
      },
    );

    // Mock file content - claudecode format (markdown with frontmatter)
    const claudecodeRuleContent = `---
description: "Coding guidelines for the project"
globs: ["**/*.ts"]
alwaysApply: false
---

# Coding Guidelines

Follow these guidelines for TypeScript development.
`;
    mockClientInstance.getFileContent.mockResolvedValue(claudecodeRuleContent);

    const summary = await fetchFiles({
      logger,
      source: "owner/repo",
      options: { features: ["rules"], target: "claudecode" },
      outputRoot: testDir,
    });

    expect(summary.source).toBe("owner/repo");
    expect(summary.ref).toBe("main");
    // Conversion should produce files
    expect(summary.created).toBeGreaterThanOrEqual(0);
  });

  it("should handle unsupported feature/target combination gracefully", async () => {
    // Mock an empty response
    mockClientInstance.listDirectory.mockImplementation(() => {
      const error = new Error("Not found");
      Object.assign(error, { statusCode: 404 });
      return Promise.reject(error);
    });

    // Try to fetch skills with claudecode target
    // Skills conversion is not supported, so it should skip gracefully
    const summary = await fetchFiles({
      logger,
      source: "owner/repo",
      options: { features: ["skills"], target: "claudecode" },
      outputRoot: testDir,
    });

    // Should return empty summary without errors
    expect(summary.files).toHaveLength(0);
    expect(summary.created).toBe(0);
  });

  it("should clean up temp directory after conversion", async () => {
    // Mock directory listing
    mockClientInstance.listDirectory.mockImplementation(
      (owner: string, repo: string, path: string) => {
        if (path === "rules") {
          return Promise.resolve([
            {
              name: "test.md",
              path: "rules/test.md",
              type: "file",
              sha: "abc",
              size: 100,
              download_url: "https://example.com",
            },
          ]);
        }
        const error = new Error("Not found");
        Object.assign(error, { statusCode: 404 });
        return Promise.reject(error);
      },
    );

    mockClientInstance.getFileContent.mockResolvedValue("# Test\n\nContent");

    // Run fetch with tool target
    await fetchFiles({
      logger,
      source: "owner/repo",
      options: { features: ["rules"], target: "claudecode" },
      outputRoot: testDir,
    });

    // Verify no temp directories remain
    // The temp directory pattern is rulesync-fetch-*
    const os = await import("node:os");
    const fs = await import("node:fs/promises");
    const tmpDir = os.tmpdir();
    const entries = await fs.readdir(tmpDir);
    const rulesyncTempDirs = entries.filter((e) => e.startsWith("rulesync-fetch-"));

    // All temp directories should be cleaned up
    expect(rulesyncTempDirs).toHaveLength(0);
  });

  it("should handle commands conversion with claudecode target", async () => {
    // Mock directory listing for commands
    mockClientInstance.listDirectory.mockImplementation(
      (owner: string, repo: string, path: string) => {
        if (path === "commands") {
          return Promise.resolve([
            {
              name: "review.md",
              path: "commands/review.md",
              type: "file",
              sha: "def",
              size: 150,
              download_url: "https://example.com",
            },
          ]);
        }
        const error = new Error("Not found");
        Object.assign(error, { statusCode: 404 });
        return Promise.reject(error);
      },
    );

    // Mock command file content
    const commandContent = `---
description: "Review code changes"
---

Review the current changes and provide feedback.
`;
    mockClientInstance.getFileContent.mockResolvedValue(commandContent);

    const summary = await fetchFiles({
      logger,
      source: "owner/repo",
      options: { features: ["commands"], target: "claudecode" },
      outputRoot: testDir,
    });

    expect(summary.source).toBe("owner/repo");
    // Commands should be processed
    expect(summary.files).toBeDefined();
  });

  it("should handle multiple features with target conversion", async () => {
    // Mock directory listing for multiple features
    mockClientInstance.listDirectory.mockImplementation(
      (owner: string, repo: string, path: string) => {
        if (path === "rules") {
          return Promise.resolve([
            {
              name: "overview.md",
              path: "rules/overview.md",
              type: "file",
              sha: "abc",
              size: 200,
              download_url: "https://example.com",
            },
          ]);
        }
        if (path === "commands") {
          return Promise.resolve([
            {
              name: "test.md",
              path: "commands/test.md",
              type: "file",
              sha: "def",
              size: 150,
              download_url: "https://example.com",
            },
          ]);
        }
        const error = new Error("Not found");
        Object.assign(error, { statusCode: 404 });
        return Promise.reject(error);
      },
    );

    mockClientInstance.getFileContent.mockImplementation(
      (owner: string, repo: string, path: string) => {
        if (path === "rules/overview.md") {
          return Promise.resolve("---\ndescription: Overview\n---\n\n# Overview");
        }
        if (path === "commands/test.md") {
          return Promise.resolve("---\ndescription: Test command\n---\n\nTest content");
        }
        return Promise.resolve("");
      },
    );

    const summary = await fetchFiles({
      logger,
      source: "owner/repo",
      options: { features: ["rules", "commands"], target: "claudecode" },
      outputRoot: testDir,
    });

    expect(summary.source).toBe("owner/repo");
    // Both features should be processed
    expect(summary.files).toBeDefined();
  });

  it("should cache directory listing API calls for file-based features with same basePath", async () => {
    mockClientInstance.listDirectory.mockImplementation(
      (owner: string, repo: string, path: string) => {
        if (path === ".") {
          return Promise.resolve([
            {
              name: ".aiignore",
              path: ".aiignore",
              type: "file",
              sha: "abc",
              size: 50,
              download_url: "https://example.com",
            },
            {
              name: "mcp.json",
              path: "mcp.json",
              type: "file",
              sha: "def",
              size: 100,
              download_url: "https://example.com",
            },
            {
              name: "hooks.json",
              path: "hooks.json",
              type: "file",
              sha: "ghi",
              size: 75,
              download_url: "https://example.com",
            },
          ]);
        }
        const error = new Error("Not found");
        Object.assign(error, { statusCode: 404 });
        return Promise.reject(error);
      },
    );

    mockClientInstance.getFileContent.mockImplementation(
      (owner: string, repo: string, path: string) => {
        switch (path) {
          case ".aiignore":
            return Promise.resolve("node_modules/\ndist/");
          case "mcp.json":
            return Promise.resolve('{"mcpServers": {}}');
          case "hooks.json":
            return Promise.resolve('{"pre-commit": []}');
          default:
            return Promise.resolve("");
        }
      },
    );

    const summary = await fetchFiles({
      logger,
      source: "owner/repo",
      options: { features: ["ignore", "mcp", "hooks"] },
      outputRoot: testDir,
    });

    // Verify all files were fetched
    expect(summary.created).toBe(3);
    expect(summary.files).toHaveLength(3);

    // Verify listDirectory was called only once for the shared basePath
    expect(mockClientInstance.listDirectory).toHaveBeenCalledTimes(1);
    expect(mockClientInstance.listDirectory).toHaveBeenCalledWith("owner", "repo", ".", "main");
  });

  it("should make separate API calls for features with different base paths", async () => {
    mockClientInstance.listDirectory.mockImplementation(
      (owner: string, repo: string, path: string) => {
        if (path === ".") {
          return Promise.resolve([
            {
              name: "mcp.json",
              path: "mcp.json",
              type: "file",
              sha: "abc",
              size: 100,
              download_url: "https://example.com",
            },
          ]);
        }
        if (path === "subdir") {
          return Promise.resolve([
            {
              name: ".aiignore",
              path: "subdir/.aiignore",
              type: "file",
              sha: "def",
              size: 50,
              download_url: "https://example.com",
            },
          ]);
        }
        const error = new Error("Not found");
        Object.assign(error, { statusCode: 404 });
        return Promise.reject(error);
      },
    );

    mockClientInstance.getFileContent.mockImplementation(
      (owner: string, repo: string, path: string) => {
        switch (path) {
          case "mcp.json":
            return Promise.resolve('{"mcpServers": {}}');
          case "subdir/.aiignore":
            return Promise.resolve("node_modules/");
          default:
            return Promise.resolve("");
        }
      },
    );

    // First fetch from root
    await fetchFiles({
      logger,
      source: "owner/repo",
      options: { features: ["mcp"] },
      outputRoot: testDir,
    });

    // Second fetch from subdir
    await fetchFiles({
      logger,
      source: "owner/repo:subdir",
      options: { features: ["ignore"] },
      outputRoot: testDir,
    });

    // Verify separate API calls were made for different base paths
    expect(mockClientInstance.listDirectory).toHaveBeenCalledWith("owner", "repo", ".", "main");
    expect(mockClientInstance.listDirectory).toHaveBeenCalledWith(
      "owner",
      "repo",
      "subdir",
      "main",
    );
    expect(mockClientInstance.listDirectory).toHaveBeenCalledTimes(2);
  });
});

describe("fetchFiles skill pruning", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;
  let skillsRoot: string;

  /**
   * A repository with one skill whose only remaining file is SKILL.md, plus a
   * second skill so selection can leave one of them alone.
   */
  function mockSkillRepository(): void {
    mockClientInstance.listDirectory.mockImplementation(
      (_owner: string, _repo: string, path: string) => {
        if (path === "skills") {
          return Promise.resolve([
            {
              name: "skill-a",
              path: "skills/skill-a",
              type: "dir",
              sha: "aaa",
              size: 0,
              download_url: null,
            },
            {
              name: "skill-b",
              path: "skills/skill-b",
              type: "dir",
              sha: "bbb",
              size: 0,
              download_url: null,
            },
          ]);
        }
        if (path === "skills/skill-a") {
          return Promise.resolve([
            {
              name: "SKILL.md",
              path: "skills/skill-a/SKILL.md",
              type: "file",
              sha: "ccc",
              size: 100,
              download_url: "https://example.com",
            },
          ]);
        }
        if (path === "skills/skill-b") {
          return Promise.resolve([
            {
              name: "SKILL.md",
              path: "skills/skill-b/SKILL.md",
              type: "file",
              sha: "ddd",
              size: 100,
              download_url: "https://example.com",
            },
          ]);
        }
        const error = new Error("Not found");
        Object.assign(error, { statusCode: 404 });
        return Promise.reject(error);
      },
    );

    mockClientInstance.getFileContent.mockResolvedValue("# Skill");
  }

  /**
   * A repository with a single skill of the given name, whose only file is
   * SKILL.md. The tests that pin how a remote skill name is read back differ
   * only in that name.
   */
  function mockSingleSkillRepository(name: string): void {
    mockClientInstance.listDirectory.mockImplementation(
      (_owner: string, _repo: string, path: string) => {
        if (path === "skills") {
          return Promise.resolve([
            {
              name,
              path: `skills/${name}`,
              type: "dir",
              sha: "aaa",
              size: 0,
              download_url: null,
            },
          ]);
        }
        if (path === `skills/${name}`) {
          return Promise.resolve([
            {
              name: "SKILL.md",
              path: `skills/${name}/SKILL.md`,
              type: "file",
              sha: "bbb",
              size: 100,
              download_url: "https://example.com",
            },
          ]);
        }
        const error = new Error("Not found");
        Object.assign(error, { statusCode: 404 });
        return Promise.reject(error);
      },
    );

    mockClientInstance.getFileContent.mockResolvedValue("# Skill");
  }

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
    skillsRoot = join(testDir, ".rulesync", "skills");

    mockClientInstance = {
      validateRepository: vi.fn().mockResolvedValue(true),
      getDefaultBranch: vi.fn().mockResolvedValue("main"),
      listDirectory: vi.fn(),
      getFileContent: vi.fn(),
    };
  });

  afterEach(async () => {
    await cleanup();
    vi.clearAllMocks();
  });

  it("should delete a local file the remote skill no longer has", async () => {
    mockSkillRepository();
    await writeFileContent(join(skillsRoot, "skill-a", "reference.md"), "# Stale");

    const summary = await fetchFiles({ logger, source: "owner/repo", outputRoot: testDir });

    expect(summary.deleted).toBe(1);
    expect(summary.files).toContainEqual({
      relativePath: "skills/skill-a/reference.md",
      status: "deleted",
    });
    expect(await fileExists(join(skillsRoot, "skill-a", "reference.md"))).toBe(false);
    expect(await fileExists(join(skillsRoot, "skill-a", "SKILL.md"))).toBe(true);
  });

  it("should remove a directory that pruning emptied and report it", async () => {
    mockSkillRepository();
    await writeFileContent(join(skillsRoot, "skill-a", "scripts", "run.sh"), "echo stale");

    const summary = await fetchFiles({ logger, source: "owner/repo", outputRoot: testDir });

    expect(summary.files).toContainEqual({
      relativePath: "skills/skill-a/scripts/run.sh",
      status: "deleted",
    });
    expect(summary.files).toContainEqual({
      relativePath: "skills/skill-a/scripts/",
      status: "deleted",
    });
    expect(summary.deleted).toBe(2);
    expect(await directoryExists(join(skillsRoot, "skill-a", "scripts"))).toBe(false);
  });

  it("should report a stale directory that was already empty", async () => {
    mockSkillRepository();
    await ensureDir(join(skillsRoot, "skill-a", "scripts"));

    const summary = await fetchFiles({ logger, source: "owner/repo", outputRoot: testDir });

    expect(summary.files).toContainEqual({
      relativePath: "skills/skill-a/scripts/",
      status: "deleted",
    });
    expect(summary.deleted).toBe(1);
    expect(await directoryExists(join(skillsRoot, "skill-a", "scripts"))).toBe(false);
  });

  it("should keep a nested directory that still has a fetched file under it", async () => {
    mockClientInstance.listDirectory.mockImplementation(
      (_owner: string, _repo: string, path: string) => {
        if (path === "skills") {
          return Promise.resolve([
            {
              name: "skill-a",
              path: "skills/skill-a",
              type: "dir",
              sha: "aaa",
              size: 0,
              download_url: null,
            },
          ]);
        }
        if (path === "skills/skill-a") {
          return Promise.resolve([
            {
              name: "scripts",
              path: "skills/skill-a/scripts",
              type: "dir",
              sha: "bbb",
              size: 0,
              download_url: null,
            },
          ]);
        }
        if (path === "skills/skill-a/scripts") {
          return Promise.resolve([
            {
              name: "run.sh",
              path: "skills/skill-a/scripts/run.sh",
              type: "file",
              sha: "ccc",
              size: 10,
              download_url: "https://example.com",
            },
          ]);
        }
        const error = new Error("Not found");
        Object.assign(error, { statusCode: 404 });
        return Promise.reject(error);
      },
    );
    mockClientInstance.getFileContent.mockResolvedValue("echo hi");
    await writeFileContent(join(skillsRoot, "skill-a", "scripts", "old.sh"), "echo stale");

    const summary = await fetchFiles({ logger, source: "owner/repo", outputRoot: testDir });

    expect(summary.files).toContainEqual({
      relativePath: "skills/skill-a/scripts/old.sh",
      status: "deleted",
    });
    expect(summary.deleted).toBe(1);
    expect(await directoryExists(join(skillsRoot, "skill-a", "scripts"))).toBe(true);
    expect(await fileExists(join(skillsRoot, "skill-a", "scripts", "run.sh"))).toBe(true);
  });

  it("should not prune a skill whose remote listing was incomplete", async () => {
    mockClientInstance.listDirectory.mockImplementation(
      (_owner: string, _repo: string, path: string) => {
        if (path === "skills") {
          return Promise.resolve([
            {
              name: "skill-a",
              path: "skills/skill-a",
              type: "dir",
              sha: "aaa",
              size: 0,
              download_url: null,
            },
          ]);
        }
        if (path === "skills/skill-a") {
          return Promise.resolve([
            {
              name: "SKILL.md",
              path: "skills/skill-a/SKILL.md",
              type: "file",
              sha: "ccc",
              size: 100,
              download_url: "https://example.com",
            },
            // An entry kind the walk cannot fetch, so the listing it produces is
            // not the whole remote skill.
            {
              name: "shared",
              path: "skills/skill-a/shared",
              type: "symlink",
              sha: "ddd",
              size: 0,
              download_url: null,
            },
          ]);
        }
        const error = new Error("Not found");
        Object.assign(error, { statusCode: 404 });
        return Promise.reject(error);
      },
    );
    mockClientInstance.getFileContent.mockResolvedValue("# Skill");
    const stale = join(skillsRoot, "skill-a", "reference.md");
    await writeFileContent(stale, "# Stale");

    const summary = await fetchFiles({ logger, source: "owner/repo", outputRoot: testDir });

    expect(summary.deleted).toBe(0);
    expect(await fileExists(stale)).toBe(true);
  });

  it("should skip a remote path whose backslash makes the skill directory ambiguous", async () => {
    // `skills/.\evil/SKILL.md` is written as a directory literally called
    // `.\evil`, but reads back as the skill `.`, whose directory is the whole
    // of `skills/` — so the prune would empty every skill on disk.
    mockSingleSkillRepository(".\\evil");
    const mine = join(skillsRoot, "alpha", "SKILL.md");
    await writeFileContent(mine, "# Mine");

    const summary = await fetchFiles({ logger, source: "owner/repo", outputRoot: testDir });

    expect(summary.created).toBe(0);
    expect(summary.deleted).toBe(0);
    expect(await fileExists(mine)).toBe(true);
  });

  it("should skip a remote path whose backslash targets another skill", async () => {
    // `skills/victim\evil/` is written as its own directory, but reads back as
    // the skill `victim`, whose local directory this run never wrote.
    mockSingleSkillRepository("victim\\evil");
    const victim = join(skillsRoot, "victim", "notes.md");
    await writeFileContent(victim, "# Mine");

    const summary = await fetchFiles({ logger, source: "owner/repo", outputRoot: testDir });

    expect(summary.created).toBe(0);
    expect(summary.deleted).toBe(0);
    expect(await fileExists(victim)).toBe(true);
  });

  it("should skip a remote path whose colon names an existing skill directory", async () => {
    // On Windows `pdf::$INDEX_ALLOCATION` is not a directory of its own but
    // another spelling of `pdf`, so the fetch would write into the user's own
    // `pdf` skill while the prune, which compares names, treats it as a skill
    // this run never wrote.
    mockSingleSkillRepository("pdf::$INDEX_ALLOCATION");
    const victim = join(skillsRoot, "pdf", "notes.md");
    await writeFileContent(victim, "# Mine");

    const summary = await fetchFiles({ logger, source: "owner/repo", outputRoot: testDir });

    expect(summary.created).toBe(0);
    expect(summary.deleted).toBe(0);
    expect(await fileExists(victim)).toBe(true);
  });

  it.skipIf(process.platform === "win32")(
    "should keep a local name the fetched file also answers to",
    async () => {
      // A hard link is the portable stand-in for what a case-insensitive or
      // NFD-normalizing filesystem does on its own: two names, one file. The
      // fetch writes through `SKILL.md`, so `alias.md` is the file it just
      // wrote and must survive a prune that only knows the remote spelling.
      mockSkillRepository();
      const fetched = join(skillsRoot, "skill-a", "SKILL.md");
      const alias = join(skillsRoot, "skill-a", "alias.md");
      await writeFileContent(fetched, "# Local");
      await link(fetched, alias);

      const summary = await fetchFiles({ logger, source: "owner/repo", outputRoot: testDir });

      expect(summary.deleted).toBe(0);
      expect(await fileExists(alias)).toBe(true);
    },
  );

  it("should not prune a skill a backslash path was dropped from", async () => {
    // The dropped file is still upstream; it just cannot be written under a
    // name every system reads the same way. Pruning against a list it is
    // missing from would delete the local copy of a file the remote still has.
    mockClientInstance.listDirectory.mockImplementation(
      (_owner: string, _repo: string, path: string) => {
        if (path === "skills") {
          return Promise.resolve([
            {
              name: "skill-a",
              path: "skills/skill-a",
              type: "dir",
              sha: "aaa",
              size: 0,
              download_url: null,
            },
          ]);
        }
        if (path === "skills/skill-a") {
          return Promise.resolve([
            {
              name: "SKILL.md",
              path: "skills/skill-a/SKILL.md",
              type: "file",
              sha: "bbb",
              size: 100,
              download_url: "https://example.com",
            },
            {
              name: "notes\\draft.md",
              path: "skills/skill-a/notes\\draft.md",
              type: "file",
              sha: "ccc",
              size: 100,
              download_url: "https://example.com",
            },
          ]);
        }
        const error = new Error("Not found");
        Object.assign(error, { statusCode: 404 });
        return Promise.reject(error);
      },
    );
    mockClientInstance.getFileContent.mockResolvedValue("# Skill");
    const stillUpstream = join(skillsRoot, "skill-a", "notes\\draft.md");
    await writeFileContent(stillUpstream, "# Kept");

    const summary = await fetchFiles({ logger, source: "owner/repo", outputRoot: testDir });

    expect(summary.deleted).toBe(0);
    expect(await fileExists(stillUpstream)).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("the remote listing for it came back incomplete"),
    );
  });

  it.skipIf(process.platform === "win32")(
    "should keep a symbolic link standing in for a directory the fetch wrote through",
    async () => {
      // The write resolves through the link, so the fetched file lands behind
      // it. Unlinking it would orphan what this run just fetched.
      // The link is kept here by its name matching a fetched path. The identity
      // clause that also keeps it — the link resolving to a directory this run
      // wrote through under a different local spelling — only comes into play on
      // a case-insensitive or normalizing filesystem, which cannot be staged
      // here, so this test does not pin that half.
      mockSkillRepository();
      const shared = join(testDir, "shared", "scripts");
      await ensureDir(shared);
      await ensureDir(join(skillsRoot, "skill-a"));
      await symlink(shared, join(skillsRoot, "skill-a", "scripts"));

      mockClientInstance.listDirectory.mockImplementation(
        (_owner: string, _repo: string, path: string) => {
          if (path === "skills") {
            return Promise.resolve([
              {
                name: "skill-a",
                path: "skills/skill-a",
                type: "dir",
                sha: "aaa",
                size: 0,
                download_url: null,
              },
            ]);
          }
          if (path === "skills/skill-a") {
            return Promise.resolve([
              {
                name: "scripts",
                path: "skills/skill-a/scripts",
                type: "dir",
                sha: "bbb",
                size: 0,
                download_url: null,
              },
            ]);
          }
          if (path === "skills/skill-a/scripts") {
            return Promise.resolve([
              {
                name: "run.py",
                path: "skills/skill-a/scripts/run.py",
                type: "file",
                sha: "ccc",
                size: 10,
                download_url: "https://example.com",
              },
            ]);
          }
          const error = new Error("Not found");
          Object.assign(error, { statusCode: 404 });
          return Promise.reject(error);
        },
      );
      mockClientInstance.getFileContent.mockResolvedValue("print()");

      const summary = await fetchFiles({ logger, source: "owner/repo", outputRoot: testDir });

      expect(summary.deleted).toBe(0);
      expect(await fileExists(join(shared, "run.py"))).toBe(true);
      // `lstat`, not `fileExists`: the latter follows the link and would pass
      // just as well had the link been replaced by a real directory.
      expect((await lstat(join(skillsRoot, "skill-a", "scripts"))).isSymbolicLink()).toBe(true);
    },
  );

  it("should warn about the deletions on top of listing them", async () => {
    mockSkillRepository();
    await writeFileContent(join(skillsRoot, "skill-a", "reference.md"), "# Stale");

    await fetchFiles({ logger, source: "owner/repo", outputRoot: testDir });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Deleted 1 local path inside the skill directories this fetch wrote"),
    );
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("--no-prune"));
  });

  it("should not warn about deletions when there were none", async () => {
    mockSkillRepository();

    await fetchFiles({ logger, source: "owner/repo", outputRoot: testDir });

    expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining("Deleted "));
  });

  it("should not prune a skill directory named like a Windows short name", async () => {
    // `REPORT~1` opens whatever long name it stands for on a volume that
    // generates short names, so it may not be the directory it reads as.
    mockSingleSkillRepository("REPORT~1");
    const stale = join(skillsRoot, "REPORT~1", "reference.md");
    await writeFileContent(stale, "# Stale");

    const summary = await fetchFiles({ logger, source: "owner/repo", outputRoot: testDir });

    expect(summary.deleted).toBe(0);
    expect(await fileExists(stale)).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("its name is one some systems resolve to a different directory"),
    );
  });

  it("should quote the name it names in a prune warning", async () => {
    // The name is a sentence of the remote's choosing, and it ends in a dot, so
    // it reaches the warning through the guard above. Quoted, the sentence is
    // plainly part of the name; spliced in bare it would read as the start of
    // the warning itself.
    const forged = "docs. Nothing was skipped.";
    mockSingleSkillRepository(forged);
    await writeFileContent(join(skillsRoot, forged, "reference.md"), "# Stale");

    const summary = await fetchFiles({ logger, source: "owner/repo", outputRoot: testDir });

    expect(summary.deleted).toBe(0);
    expect(await fileExists(join(skillsRoot, forged, "reference.md"))).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        `Not pruning ${JSON.stringify(`skills/${forged}`)}: its name is one some systems resolve`,
      ),
    );
  });

  // Root ignores the permission bits the failure is staged with, and Windows
  // does not have them.
  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "should quote the name when a prune stops partway through",
    async () => {
      // The name is a sentence about what was deleted, which is the very thing
      // this warning reports, and the error text follows it. Quoted, the
      // sentence is plainly part of the name.
      const forged = "docs. Everything was deleted";
      mockSingleSkillRepository(forged);
      // The stale file sits in a directory the prune may read but not delete
      // from, so the walk reaches it and the removal fails. The skill root
      // itself stays writable, since the fetch writes into it before pruning.
      const staleDir = join(skillsRoot, forged, "reference");
      await writeFileContent(join(staleDir, "stale.md"), "# Stale");
      await chmod(staleDir, 0o500);
      // Registered with the runner rather than left to a `finally`, so the mode
      // is put back even if this test is cut short before its body ends.
      onTestFinished(async () => {
        await chmod(staleDir, 0o700);
      });

      const summary = await fetchFiles({ logger, source: "owner/repo", outputRoot: testDir });

      expect(summary.deleted).toBe(0);
      expect(await fileExists(join(staleDir, "stale.md"))).toBe(true);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          `Stopped partway through pruning ${JSON.stringify(`skills/${forged}`)}.`,
        ),
      );
    },
  );

  it("should not prune a skill directory a local one differs from only in case", async () => {
    // macOS and Windows resolve `skills/PDF` to the existing `skills/pdf`, so
    // the write lands in the local skill's own directory and a prune of it
    // would judge that skill's files stale.
    mockSingleSkillRepository("PDF");
    const localFile = join(skillsRoot, "pdf", "SKILL.md");
    await writeFileContent(localFile, "# Local skill");

    const summary = await fetchFiles({ logger, source: "owner/repo", outputRoot: testDir });

    expect(summary.deleted).toBe(0);
    expect(await fileExists(localFile)).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(
      // The sibling this one is confused with is a name from the same place, so
      // it is quoted like any other.
      expect.stringContaining(`${JSON.stringify("skills/pdf")} is also there and differs only`),
    );
  });

  it("should not prune a skill directory a local one differs from only in composition", async () => {
    // macOS stores a name decomposed, so the remote `caf\u00e9` written with a
    // combining accent lands in the existing directory written with the
    // composed letter, exactly as a case variant would.
    const composed = "caf\u00e9";
    const decomposed = "cafe\u0301";
    mockSingleSkillRepository(decomposed);
    const localFile = join(skillsRoot, composed, "SKILL.md");
    await writeFileContent(localFile, "# Local skill");

    const summary = await fetchFiles({ logger, source: "owner/repo", outputRoot: testDir });

    expect(summary.deleted).toBe(0);
    expect(await fileExists(localFile)).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("differs only in ways some filesystems ignore"),
    );
  });

  it("should prune a skill directory whose name only contains a tilde", async () => {
    // `~2` in the middle of a name is not the short-name shape, so the guard
    // above it must not claim this directory.
    mockSingleSkillRepository("data~2parser");
    const stale = join(skillsRoot, "data~2parser", "reference.md");
    await writeFileContent(stale, "# Stale");

    const summary = await fetchFiles({ logger, source: "owner/repo", outputRoot: testDir });

    expect(summary.deleted).toBe(1);
    expect(await fileExists(stale)).toBe(false);
  });

  it("should not prune a skill directory whose name ends in a dot", async () => {
    // Windows resolves `skills/dotted.` to `skills/dotted`, so the prune would
    // empty one directory while the summary named another.
    mockSingleSkillRepository("dotted.");
    const stale = join(skillsRoot, "dotted.", "reference.md");
    await writeFileContent(stale, "# Stale");

    const summary = await fetchFiles({ logger, source: "owner/repo", outputRoot: testDir });

    expect(summary.deleted).toBe(0);
    expect(await fileExists(stale)).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("its name is one some systems resolve to a different directory"),
    );
  });

  it.skipIf(process.platform === "win32")(
    "should not let a deleted file's name rewrite the summary",
    async () => {
      mockSkillRepository();
      // A local name, read back off the disk, never went through the checks a
      // remote path does — so the record of the deletion must not be able to
      // erase the line it is printed on.
      const stale = join(skillsRoot, "skill-a", "sneaky\u001b[2K-file.md");
      await writeFileContent(stale, "# Stale");

      const summary = await fetchFiles({ logger, source: "owner/repo", outputRoot: testDir });

      expect(summary.deleted).toBe(1);
      expect(formatFetchSummary(summary)).not.toContain("\u001b");
      expect(formatFetchSummary(summary)).toContain("sneaky[2K-file.md");
    },
  );

  it("should not prune below the depth a fetch can reach", async () => {
    mockSkillRepository();
    // One level past the ceiling the remote walk stops at, so nothing this deep
    // could have been fetched and nothing this deep may be deleted.
    const tooDeep = join(skillsRoot, "skill-a", ...Array.from({ length: 16 }, (_, i) => `d${i}`));
    const buried = join(tooDeep, "reference.md");
    await writeFileContent(buried, "# Buried");

    const summary = await fetchFiles({ logger, source: "owner/repo", outputRoot: testDir });

    expect(summary.deleted).toBe(0);
    expect(await fileExists(buried)).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("Not pruning below"));
  });

  it.skipIf(process.platform === "win32")(
    "should not prune a skill directory that is itself a symbolic link",
    async () => {
      mockSkillRepository();
      const sharedSkill = join(testDir, "shared", "skill-a");
      await writeFileContent(join(sharedSkill, "reference.md"), "# Shared");
      await ensureDir(skillsRoot);
      await symlink(sharedSkill, join(skillsRoot, "skill-a"));

      const summary = await fetchFiles({ logger, source: "owner/repo", outputRoot: testDir });

      expect(summary.deleted).toBe(0);
      expect(await fileExists(join(sharedSkill, "reference.md"))).toBe(true);
    },
  );

  it("should leave a skill that was not selected untouched", async () => {
    mockSkillRepository();
    await writeFileContent(join(skillsRoot, "skill-b", "reference.md"), "# Mine");

    const summary = await fetchFiles({
      logger,
      source: "owner/repo",
      options: { skills: ["skill-a"] },
      outputRoot: testDir,
    });

    expect(summary.deleted).toBe(0);
    expect(await fileExists(join(skillsRoot, "skill-b", "reference.md"))).toBe(true);
  });

  it("should leave non-skill features untouched", async () => {
    mockSkillRepository();
    const baseImplementation = mockClientInstance.listDirectory.getMockImplementation();
    mockClientInstance.listDirectory.mockImplementation(
      (owner: string, repo: string, path: string, ref: string) => {
        if (path === "rules") {
          return Promise.resolve([
            {
              name: "overview.md",
              path: "rules/overview.md",
              type: "file",
              sha: "eee",
              size: 100,
              download_url: "https://example.com",
            },
          ]);
        }
        return baseImplementation(owner, repo, path, ref);
      },
    );
    const staleRule = join(testDir, ".rulesync", "rules", "stale.md");
    await writeFileContent(staleRule, "# Stale rule");

    const summary = await fetchFiles({
      logger,
      source: "owner/repo",
      options: { features: ["rules", "skills"] },
      outputRoot: testDir,
    });

    expect(summary.deleted).toBe(0);
    expect(await fileExists(staleRule)).toBe(true);
  });

  it("should keep stale files when pruning is turned off", async () => {
    mockSkillRepository();
    const stale = join(skillsRoot, "skill-a", "reference.md");
    await writeFileContent(stale, "# Stale");

    const summary = await fetchFiles({
      logger,
      source: "owner/repo",
      options: { prune: false },
      outputRoot: testDir,
    });

    expect(summary.deleted).toBe(0);
    expect(await fileExists(stale)).toBe(true);
  });

  it("should keep stale files when --conflict skip was given", async () => {
    mockSkillRepository();
    const stale = join(skillsRoot, "skill-a", "reference.md");
    await writeFileContent(stale, "# Stale");

    const summary = await fetchFiles({
      logger,
      source: "owner/repo",
      options: { conflict: "skip" },
      outputRoot: testDir,
    });

    expect(summary.deleted).toBe(0);
    expect(await fileExists(stale)).toBe(true);
  });

  it.skipIf(process.platform === "win32")(
    "should unlink a stale symbolic link without touching what it points at",
    async () => {
      mockSkillRepository();
      const outsideFile = join(testDir, "outside.md");
      await writeFileContent(outsideFile, "# Outside");
      await ensureDir(join(skillsRoot, "skill-a"));
      await symlink(outsideFile, join(skillsRoot, "skill-a", "linked.md"));

      const summary = await fetchFiles({ logger, source: "owner/repo", outputRoot: testDir });

      expect(summary.files).toContainEqual({
        relativePath: "skills/skill-a/linked.md",
        status: "deleted",
      });
      expect(await fileExists(join(skillsRoot, "skill-a", "linked.md"))).toBe(false);
      expect(await fileExists(outsideFile)).toBe(true);
    },
  );

  it.skipIf(process.platform === "win32")(
    "should not walk into a symbolically linked directory outside the output tree",
    async () => {
      mockSkillRepository();
      const outsideDir = join(testDir, "outside");
      await writeFileContent(join(outsideDir, "keep.md"), "# Outside");
      await ensureDir(join(skillsRoot, "skill-a"));
      await symlink(outsideDir, join(skillsRoot, "skill-a", "linked"));

      await fetchFiles({ logger, source: "owner/repo", outputRoot: testDir });

      // The link itself is stale, so it goes; the directory it named does not.
      expect(await fileExists(join(skillsRoot, "skill-a", "linked"))).toBe(false);
      expect(await fileExists(join(outsideDir, "keep.md"))).toBe(true);
    },
  );
});

describe("formatFetchSummary", () => {
  it("should format summary correctly", () => {
    const summary = {
      source: "owner/repo",
      ref: "main",
      files: [
        { relativePath: "rules/overview.md", status: "created" as const },
        { relativePath: "mcp.json", status: "overwritten" as const },
        { relativePath: "commands/test.md", status: "skipped" as const },
      ],
      created: 1,
      overwritten: 1,
      skipped: 1,
      deleted: 0,
    };

    const output = formatFetchSummary(summary);

    expect(output).toContain("Fetched from owner/repo@main:");
    expect(output).toContain("rules/overview.md (created)");
    expect(output).toContain("mcp.json (overwritten)");
    expect(output).toContain("commands/test.md (skipped - already exists)");
    expect(output).toContain("1 created");
    expect(output).toContain("1 overwritten");
    expect(output).toContain("1 skipped");
  });

  it("should format deleted files distinctly from written ones", () => {
    const summary = {
      source: "owner/repo",
      ref: "main",
      files: [
        { relativePath: "skills/foo/SKILL.md", status: "created" as const },
        { relativePath: "skills/foo/reference.md", status: "deleted" as const },
      ],
      created: 1,
      overwritten: 0,
      skipped: 0,
      deleted: 1,
    };

    const output = formatFetchSummary(summary);

    expect(output).toContain(
      "\u2717 skills/foo/reference.md (deleted - no longer in the remote skill)",
    );
    expect(output).toContain("\u2713 skills/foo/SKILL.md (created)");
    expect(output).toContain("1 created, 1 deleted");
  });

  it("should format empty summary correctly", () => {
    const summary = {
      source: "owner/repo",
      ref: "main",
      files: [],
      created: 0,
      overwritten: 0,
      skipped: 0,
      deleted: 0,
    };

    const output = formatFetchSummary(summary);

    expect(output).toContain("Fetched from owner/repo@main:");
    expect(output).toContain("Summary: no files");
  });
});
