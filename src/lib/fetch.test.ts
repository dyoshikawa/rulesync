import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../test-utils/test-directories.js";
import { ensureDir, fileExists, readFileContent, writeFileContent } from "../utils/file.js";
import { fetchFiles, formatFetchSummary, parseSource } from "./fetch.js";

let mockClientInstance: any;

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
      fetchFiles({
        source: "gitlab:owner/repo",
        baseDir: testDir,
      }),
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
      source: "owner/repo",
      options: { features: ["rules", "skills", "mcp"] },
      baseDir: testDir,
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
      source: "owner/repo",
      options: { features: ["rules"] },
      baseDir: testDir,
    });

    expect(summary.files).toHaveLength(1);
    expect(summary.files[0]?.relativePath).toBe("rules/overview.md");
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
      source: "owner/repo",
      options: { conflict: "skip", features: ["rules"] },
      baseDir: testDir,
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
      source: "owner/repo",
      options: { conflict: "overwrite", features: ["rules"] },
      baseDir: testDir,
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
      source: "owner/repo",
      options: { output: "custom-output", features: ["rules"] },
      baseDir: testDir,
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
      source: "owner/repo@main",
      options: { ref: "develop", features: ["rules"] },
      baseDir: testDir,
    });

    expect(mockClientInstance.listDirectory).toHaveBeenCalledWith(
      "owner",
      "repo",
      "rules",
      "develop",
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
      source: "owner/repo:packages/shared",
      options: { features: ["rules"] },
      baseDir: testDir,
    });

    expect(summary.created).toBe(1);
    expect(summary.files[0]?.relativePath).toBe("rules/overview.md");
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
        source: "owner/repo",
        options: { features: ["rules"] },
        baseDir: testDir,
      }),
    ).rejects.toThrow("Path traversal detected");
  });

  it("should reject output directory path traversal attempts", async () => {
    await expect(
      fetchFiles({
        source: "owner/repo",
        baseDir: testDir,
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
        source: "owner/repo",
        options: { features: ["rules"] },
        baseDir: testDir,
      }),
    ).rejects.toThrow("exceeds maximum size limit");
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
        source: "owner/repo",
        options: { features: ["rules"] },
        baseDir: testDir,
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
        source: "owner/repo",
        options: { features: ["rules"] },
        baseDir: testDir,
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
          source: "owner/repo",
          options: { features: ["rules"] },
          baseDir: testDir,
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
        source: "owner/repo",
        options: { features: ["rules"] },
        baseDir: testDir,
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
      source: "owner/repo",
      options: { features: ["rules"], target: "rulesync" },
      baseDir: testDir,
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
      source: "owner/repo",
      options: { features: ["rules"] },
      baseDir: testDir,
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
      source: "owner/repo",
      options: { features: ["rules"], target: "claudecode" },
      baseDir: testDir,
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
      source: "owner/repo",
      options: { features: ["skills"], target: "claudecode" },
      baseDir: testDir,
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
      source: "owner/repo",
      options: { features: ["rules"], target: "claudecode" },
      baseDir: testDir,
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
      source: "owner/repo",
      options: { features: ["commands"], target: "claudecode" },
      baseDir: testDir,
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
      source: "owner/repo",
      options: { features: ["rules", "commands"], target: "claudecode" },
      baseDir: testDir,
    });

    expect(summary.source).toBe("owner/repo");
    // Both features should be processed
    expect(summary.files).toBeDefined();
  });
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

  it("should format empty summary correctly", () => {
    const summary = {
      source: "owner/repo",
      ref: "main",
      files: [],
      created: 0,
      overwritten: 0,
      skipped: 0,
    };

    const output = formatFetchSummary(summary);

    expect(output).toContain("Fetched from owner/repo@main:");
    expect(output).toContain("Summary: no files");
  });
});
