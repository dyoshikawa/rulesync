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
