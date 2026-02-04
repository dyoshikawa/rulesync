import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../test-utils/test-directories.js";
import { ensureDir, fileExists, readFileContent, writeFileContent } from "../utils/file.js";
import { fetchFromGitHub, formatFetchSummary, parseSource } from "./fetch.js";

// Mocked client instance that will be configured in beforeEach
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
        owner: "owner",
        repo: "repo",
      });
    });

    it("should parse GitHub URL with /tree/branch", () => {
      const result = parseSource("https://github.com/owner/repo/tree/main");
      expect(result).toEqual({
        owner: "owner",
        repo: "repo",
        ref: "main",
        path: undefined,
      });
    });

    it("should parse GitHub URL with /tree/branch/path", () => {
      const result = parseSource("https://github.com/owner/repo/tree/develop/packages/frontend");
      expect(result).toEqual({
        owner: "owner",
        repo: "repo",
        ref: "develop",
        path: "packages/frontend",
      });
    });

    it("should parse GitHub URL with /blob/branch/path", () => {
      const result = parseSource("https://github.com/owner/repo/blob/main/src/index.ts");
      expect(result).toEqual({
        owner: "owner",
        repo: "repo",
        ref: "main",
        path: "src/index.ts",
      });
    });

    it("should throw error for invalid GitHub URL", () => {
      expect(() => parseSource("https://github.com/owner")).toThrow(/Invalid GitHub URL/);
    });
  });

  describe("shorthand parsing", () => {
    it("should parse basic owner/repo", () => {
      const result = parseSource("owner/repo");
      expect(result).toEqual({
        owner: "owner",
        repo: "repo",
      });
    });

    it("should parse owner/repo@ref", () => {
      const result = parseSource("owner/repo@main");
      expect(result).toEqual({
        owner: "owner",
        repo: "repo",
        ref: "main",
      });
    });

    it("should parse owner/repo:path", () => {
      const result = parseSource("owner/repo:packages/frontend");
      expect(result).toEqual({
        owner: "owner",
        repo: "repo",
        path: "packages/frontend",
      });
    });

    it("should parse owner/repo@ref:path", () => {
      const result = parseSource("owner/repo@v1.0.0:packages/frontend");
      expect(result).toEqual({
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
});

describe("fetchFromGitHub", () => {
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

  it("should fetch files from a repository", async () => {
    // Mock .rulesync directory listing
    mockClientInstance.listDirectory.mockImplementation(
      (owner: string, repo: string, path: string) => {
        if (path === ".rulesync") {
          return Promise.resolve([
            {
              name: "rules",
              path: ".rulesync/rules",
              type: "dir",
              sha: "abc",
              size: 0,
              download_url: null,
            },
            {
              name: "mcp.json",
              path: ".rulesync/mcp.json",
              type: "file",
              sha: "def",
              size: 100,
              download_url: "https://example.com",
            },
          ]);
        }
        if (path === ".rulesync/rules") {
          return Promise.resolve([
            {
              name: "overview.md",
              path: ".rulesync/rules/overview.md",
              type: "file",
              sha: "ghi",
              size: 200,
              download_url: "https://example.com",
            },
          ]);
        }
        return Promise.resolve([]);
      },
    );

    mockClientInstance.getFileContent.mockImplementation(
      (owner: string, repo: string, path: string) => {
        if (path === ".rulesync/mcp.json") {
          return Promise.resolve('{"mcpServers": {}}');
        }
        if (path === ".rulesync/rules/overview.md") {
          return Promise.resolve("# Overview\n\nTest content");
        }
        return Promise.resolve("");
      },
    );

    const summary = await fetchFromGitHub({
      source: "owner/repo",
      baseDir: testDir,
    });

    expect(summary.source).toBe("owner/repo");
    expect(summary.ref).toBe("main");
    expect(summary.created).toBe(2);
    expect(summary.files).toHaveLength(2);

    // Verify files were written
    const mcpPath = join(testDir, ".rulesync", "mcp.json");
    const overviewPath = join(testDir, ".rulesync", "rules", "overview.md");

    expect(await fileExists(mcpPath)).toBe(true);
    expect(await fileExists(overviewPath)).toBe(true);

    const mcpContent = await readFileContent(mcpPath);
    expect(mcpContent).toBe('{"mcpServers": {}}');
  });

  it("should filter files by features", async () => {
    mockClientInstance.listDirectory.mockImplementation(
      (owner: string, repo: string, path: string) => {
        if (path === ".rulesync") {
          return Promise.resolve([
            {
              name: "rules",
              path: ".rulesync/rules",
              type: "dir",
              sha: "abc",
              size: 0,
              download_url: null,
            },
            {
              name: "commands",
              path: ".rulesync/commands",
              type: "dir",
              sha: "def",
              size: 0,
              download_url: null,
            },
            {
              name: "mcp.json",
              path: ".rulesync/mcp.json",
              type: "file",
              sha: "ghi",
              size: 100,
              download_url: "https://example.com",
            },
          ]);
        }
        if (path === ".rulesync/rules") {
          return Promise.resolve([
            {
              name: "overview.md",
              path: ".rulesync/rules/overview.md",
              type: "file",
              sha: "jkl",
              size: 200,
              download_url: "https://example.com",
            },
          ]);
        }
        if (path === ".rulesync/commands") {
          return Promise.resolve([
            {
              name: "test.md",
              path: ".rulesync/commands/test.md",
              type: "file",
              sha: "mno",
              size: 150,
              download_url: "https://example.com",
            },
          ]);
        }
        return Promise.resolve([]);
      },
    );

    mockClientInstance.getFileContent.mockResolvedValue("content");

    const summary = await fetchFromGitHub({
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
        if (path === ".rulesync") {
          return Promise.resolve([
            {
              name: "rules",
              path: ".rulesync/rules",
              type: "dir",
              sha: "abc",
              size: 0,
              download_url: null,
            },
          ]);
        }
        if (path === ".rulesync/rules") {
          return Promise.resolve([
            {
              name: "existing.md",
              path: ".rulesync/rules/existing.md",
              type: "file",
              sha: "def",
              size: 200,
              download_url: "https://example.com",
            },
            {
              name: "new.md",
              path: ".rulesync/rules/new.md",
              type: "file",
              sha: "ghi",
              size: 150,
              download_url: "https://example.com",
            },
          ]);
        }
        return Promise.resolve([]);
      },
    );

    mockClientInstance.getFileContent.mockResolvedValue("new content");

    const summary = await fetchFromGitHub({
      source: "owner/repo",
      options: { conflict: "skip" },
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
        if (path === ".rulesync") {
          return Promise.resolve([
            {
              name: "rules",
              path: ".rulesync/rules",
              type: "dir",
              sha: "abc",
              size: 0,
              download_url: null,
            },
          ]);
        }
        if (path === ".rulesync/rules") {
          return Promise.resolve([
            {
              name: "existing.md",
              path: ".rulesync/rules/existing.md",
              type: "file",
              sha: "def",
              size: 200,
              download_url: "https://example.com",
            },
          ]);
        }
        return Promise.resolve([]);
      },
    );

    mockClientInstance.getFileContent.mockResolvedValue("new content");

    const summary = await fetchFromGitHub({
      source: "owner/repo",
      options: { conflict: "overwrite" },
      baseDir: testDir,
    });

    expect(summary.overwritten).toBe(1);

    // Verify file was overwritten
    const content = await readFileContent(join(testDir, ".rulesync", "rules", "existing.md"));
    expect(content).toBe("new content");
  });

  it("should respect dry-run option", async () => {
    mockClientInstance.listDirectory.mockImplementation(
      (owner: string, repo: string, path: string) => {
        if (path === ".rulesync") {
          return Promise.resolve([
            {
              name: "mcp.json",
              path: ".rulesync/mcp.json",
              type: "file",
              sha: "abc",
              size: 100,
              download_url: "https://example.com",
            },
          ]);
        }
        return Promise.resolve([]);
      },
    );

    mockClientInstance.getFileContent.mockResolvedValue('{"mcpServers": {}}');

    const summary = await fetchFromGitHub({
      source: "owner/repo",
      options: { dryRun: true },
      baseDir: testDir,
    });

    expect(summary.created).toBe(1);

    // Verify file was NOT written
    const mcpPath = join(testDir, ".rulesync", "mcp.json");
    expect(await fileExists(mcpPath)).toBe(false);
  });

  it("should use custom output directory", async () => {
    mockClientInstance.listDirectory.mockImplementation(
      (owner: string, repo: string, path: string) => {
        if (path === ".rulesync") {
          return Promise.resolve([
            {
              name: "mcp.json",
              path: ".rulesync/mcp.json",
              type: "file",
              sha: "abc",
              size: 100,
              download_url: "https://example.com",
            },
          ]);
        }
        return Promise.resolve([]);
      },
    );

    mockClientInstance.getFileContent.mockResolvedValue('{"mcpServers": {}}');

    await fetchFromGitHub({
      source: "owner/repo",
      options: { output: "custom-output" },
      baseDir: testDir,
    });

    // Verify file was written to custom directory
    const mcpPath = join(testDir, "custom-output", "mcp.json");
    expect(await fileExists(mcpPath)).toBe(true);
  });

  it("should use ref from options over source", async () => {
    mockClientInstance.listDirectory.mockResolvedValue([]);

    await fetchFromGitHub({
      source: "owner/repo@main",
      options: { ref: "develop" },
      baseDir: testDir,
    }).catch(() => {
      // Ignore error about no .rulesync directory
    });

    expect(mockClientInstance.listDirectory).toHaveBeenCalledWith(
      "owner",
      "repo",
      ".rulesync",
      "develop",
    );
  });

  it("should handle repository with subdirectory path", async () => {
    mockClientInstance.listDirectory.mockImplementation(
      (owner: string, repo: string, path: string) => {
        if (path === "packages/shared/.rulesync") {
          return Promise.resolve([
            {
              name: "mcp.json",
              path: "packages/shared/.rulesync/mcp.json",
              type: "file",
              sha: "abc",
              size: 100,
              download_url: "https://example.com",
            },
          ]);
        }
        return Promise.resolve([]);
      },
    );

    mockClientInstance.getFileContent.mockResolvedValue('{"mcpServers": {}}');

    const summary = await fetchFromGitHub({
      source: "owner/repo:packages/shared",
      baseDir: testDir,
    });

    expect(summary.created).toBe(1);
  });

  it("should reject path traversal attempts", async () => {
    mockClientInstance.listDirectory.mockImplementation(
      (owner: string, repo: string, path: string) => {
        if (path === ".rulesync") {
          return Promise.resolve([
            {
              name: "rules",
              path: ".rulesync/rules",
              type: "dir",
              sha: "abc",
              size: 0,
              download_url: null,
            },
          ]);
        }
        if (path === ".rulesync/rules") {
          return Promise.resolve([
            {
              // Malicious path attempting traversal
              name: "malicious.md",
              path: ".rulesync/rules/../../../etc/passwd",
              type: "file",
              sha: "def",
              size: 100,
              download_url: "https://example.com",
            },
          ]);
        }
        return Promise.resolve([]);
      },
    );

    mockClientInstance.getFileContent.mockResolvedValue("malicious content");

    await expect(
      fetchFromGitHub({
        source: "owner/repo",
        baseDir: testDir,
      }),
    ).rejects.toThrow("Path traversal detected");
  });

  it("should reject files exceeding size limit", async () => {
    mockClientInstance.listDirectory.mockImplementation(
      (owner: string, repo: string, path: string) => {
        if (path === ".rulesync") {
          return Promise.resolve([
            {
              name: "mcp.json",
              path: ".rulesync/mcp.json",
              type: "file",
              sha: "abc",
              size: 11 * 1024 * 1024, // 11MB, exceeds 10MB limit
              download_url: "https://example.com",
            },
          ]);
        }
        return Promise.resolve([]);
      },
    );

    await expect(
      fetchFromGitHub({
        source: "owner/repo",
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

    const output = formatFetchSummary(summary, false);

    expect(output).toContain("Fetched from owner/repo@main:");
    expect(output).toContain("rules/overview.md (created)");
    expect(output).toContain("mcp.json (overwritten)");
    expect(output).toContain("commands/test.md (skipped - already exists)");
    expect(output).toContain("1 created");
    expect(output).toContain("1 overwritten");
    expect(output).toContain("1 skipped");
  });

  it("should format dry-run summary correctly", () => {
    const summary = {
      source: "owner/repo",
      ref: "main",
      files: [{ relativePath: "rules/overview.md", status: "created" as const }],
      created: 1,
      overwritten: 0,
      skipped: 0,
    };

    const output = formatFetchSummary(summary, true);

    expect(output).toContain("[DRY RUN] Would fetch");
    expect(output).toContain("would 1 created");
  });
});
