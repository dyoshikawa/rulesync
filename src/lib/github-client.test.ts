import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GitHubClient, GitHubClientError } from "./github-client.js";

describe("GitHubClient", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    delete process.env["GITHUB_TOKEN"];
    delete process.env["GH_TOKEN"];
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe("resolveToken", () => {
    it("should return explicit token when provided", () => {
      process.env["GITHUB_TOKEN"] = "env-token";
      const token = GitHubClient.resolveToken("explicit-token");
      expect(token).toBe("explicit-token");
    });

    it("should return GITHUB_TOKEN from environment", () => {
      process.env["GITHUB_TOKEN"] = "github-token";
      const token = GitHubClient.resolveToken();
      expect(token).toBe("github-token");
    });

    it("should return GH_TOKEN from environment when GITHUB_TOKEN is not set", () => {
      process.env["GH_TOKEN"] = "gh-token";
      const token = GitHubClient.resolveToken();
      expect(token).toBe("gh-token");
    });

    it("should prefer GITHUB_TOKEN over GH_TOKEN", () => {
      process.env["GITHUB_TOKEN"] = "github-token";
      process.env["GH_TOKEN"] = "gh-token";
      const token = GitHubClient.resolveToken();
      expect(token).toBe("github-token");
    });

    it("should return undefined when no token is available", () => {
      const token = GitHubClient.resolveToken();
      expect(token).toBeUndefined();
    });
  });

  describe("constructor", () => {
    it("should accept HTTPS base URL", () => {
      expect(() => {
        new GitHubClient({ baseUrl: "https://github.example.com/api" });
      }).not.toThrow();
    });

    it("should reject HTTP base URL", () => {
      expect(() => {
        new GitHubClient({ baseUrl: "http://github.example.com/api" });
      }).toThrow("GitHub API base URL must use HTTPS");
    });

    it("should use default HTTPS URL when not specified", () => {
      expect(() => {
        new GitHubClient({});
      }).not.toThrow();
    });
  });

  describe("getDefaultBranch", () => {
    it("should return the default branch from repository info", async () => {
      const mockFetch = vi.spyOn(global, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ default_branch: "main", private: false }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const client = new GitHubClient();
      const branch = await client.getDefaultBranch("owner", "repo");

      expect(branch).toBe("main");
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/owner/repo",
        expect.objectContaining({
          headers: expect.objectContaining({
            Accept: "application/vnd.github+json",
          }),
        }),
      );
    });

    it("should throw GitHubClientError on 404", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "Not Found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const client = new GitHubClient();

      await expect(client.getDefaultBranch("owner", "nonexistent")).rejects.toThrow(
        GitHubClientError,
      );
    });
  });

  describe("listDirectory", () => {
    it("should return directory contents", async () => {
      const mockContents = [
        {
          name: "file1.md",
          path: "rules/file1.md",
          sha: "abc",
          size: 100,
          type: "file",
          download_url: "https://example.com",
        },
        {
          name: "subdir",
          path: "rules/subdir",
          sha: "def",
          size: 0,
          type: "dir",
          download_url: null,
        },
      ];

      vi.spyOn(global, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(mockContents), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const client = new GitHubClient();
      const entries = await client.listDirectory("owner", "repo", "rules", "main");

      expect(entries).toHaveLength(2);
      expect(entries[0]?.name).toBe("file1.md");
      expect(entries[1]?.type).toBe("dir");
    });

    it("should throw error when path is a file", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ name: "file.md", type: "file" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const client = new GitHubClient();

      await expect(client.listDirectory("owner", "repo", "file.md")).rejects.toThrow(
        'Path "file.md" is not a directory',
      );
    });

    it("should include ref in query parameter", async () => {
      const mockFetch = vi.spyOn(global, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const client = new GitHubClient();
      await client.listDirectory("owner", "repo", "path", "feature-branch");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/owner/repo/contents/path?ref=feature-branch",
        expect.anything(),
      );
    });
  });

  describe("getFileContent", () => {
    it("should return raw file content", async () => {
      const fileContent = "# Hello World\n\nThis is a test file.";
      const mockFetch = vi.spyOn(global, "fetch").mockResolvedValueOnce(
        new Response(fileContent, {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        }),
      );

      const client = new GitHubClient();
      const content = await client.getFileContent("owner", "repo", "README.md");

      expect(content).toBe(fileContent);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/owner/repo/contents/README.md",
        expect.objectContaining({
          headers: expect.objectContaining({
            Accept: "application/vnd.github.raw+json",
          }),
        }),
      );
    });
  });

  describe("validateRepository", () => {
    it("should return true for existing repository", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ default_branch: "main", private: false }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const client = new GitHubClient();
      const isValid = await client.validateRepository("owner", "repo");

      expect(isValid).toBe(true);
    });

    it("should return false for non-existent repository", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "Not Found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const client = new GitHubClient();
      const isValid = await client.validateRepository("owner", "nonexistent");

      expect(isValid).toBe(false);
    });
  });

  describe("authentication", () => {
    it("should include Authorization header when token is provided", async () => {
      const mockFetch = vi.spyOn(global, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ default_branch: "main", private: false }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const client = new GitHubClient({ token: "my-token" });
      await client.getDefaultBranch("owner", "repo");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer my-token",
          }),
        }),
      );
    });

    it("should not include Authorization header when no token is provided", async () => {
      const mockFetch = vi.spyOn(global, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ default_branch: "main", private: false }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const client = new GitHubClient();
      await client.getDefaultBranch("owner", "repo");

      const calledHeaders = mockFetch.mock.calls[0]?.[1]?.headers as Record<string, string>;
      expect(calledHeaders["Authorization"]).toBeUndefined();
    });
  });

  describe("error handling", () => {
    it("should handle 401 authentication error", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "Bad credentials" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const client = new GitHubClient();

      await expect(client.getDefaultBranch("owner", "repo")).rejects.toThrow(
        /Authentication failed/,
      );
    });

    it("should handle 403 rate limit error", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "API rate limit exceeded" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const client = new GitHubClient();

      await expect(client.getDefaultBranch("owner", "repo")).rejects.toThrow(/rate limit/);
    });

    it("should handle 403 permission error", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "Repository access blocked" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const client = new GitHubClient();

      await expect(client.getDefaultBranch("owner", "repo")).rejects.toThrow(/Access forbidden/);
    });
  });

  describe("validateRef", () => {
    it("should return true for valid branch", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ ref: "refs/heads/main" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const client = new GitHubClient();
      const isValid = await client.validateRef("owner", "repo", "main");

      expect(isValid).toBe(true);
    });

    it("should return true for valid tag", async () => {
      // First call fails (branch check), second succeeds (tag check)
      vi.spyOn(global, "fetch")
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ message: "Not Found" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ ref: "refs/tags/v1.0.0" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );

      const client = new GitHubClient();
      const isValid = await client.validateRef("owner", "repo", "v1.0.0");

      expect(isValid).toBe(true);
    });

    it("should return true for valid commit SHA", async () => {
      // First two calls fail (branch and tag check), third succeeds (commit check)
      vi.spyOn(global, "fetch")
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ message: "Not Found" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ message: "Not Found" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ sha: "abc123" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );

      const client = new GitHubClient();
      const isValid = await client.validateRef("owner", "repo", "abc123");

      expect(isValid).toBe(true);
    });

    it("should return false for non-existent ref", async () => {
      // All three calls fail
      vi.spyOn(global, "fetch")
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ message: "Not Found" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ message: "Not Found" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ message: "Not Found" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          }),
        );

      const client = new GitHubClient();
      const isValid = await client.validateRef("owner", "repo", "nonexistent");

      expect(isValid).toBe(false);
    });
  });

  describe("getFileInfo", () => {
    it("should return file info for existing file", async () => {
      const fileInfo = {
        name: "test.md",
        path: "rules/test.md",
        sha: "abc123",
        size: 100,
        type: "file",
        download_url: "https://example.com",
      };

      vi.spyOn(global, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(fileInfo), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const client = new GitHubClient();
      const result = await client.getFileInfo("owner", "repo", "rules/test.md");

      expect(result).toEqual(fileInfo);
    });

    it("should return null for directory path", async () => {
      // Directory returns array, not object
      vi.spyOn(global, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify([{ name: "file.md" }]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const client = new GitHubClient();
      const result = await client.getFileInfo("owner", "repo", "rules");

      expect(result).toBeNull();
    });

    it("should return null for non-existent file", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "Not Found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const client = new GitHubClient();
      const result = await client.getFileInfo("owner", "repo", "nonexistent.md");

      expect(result).toBeNull();
    });

    it("should throw error for file exceeding size limit", async () => {
      const fileInfo = {
        name: "large.bin",
        path: "large.bin",
        sha: "abc123",
        size: 11 * 1024 * 1024, // 11MB, exceeds 10MB limit
        type: "file",
        download_url: "https://example.com",
      };

      vi.spyOn(global, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(fileInfo), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const client = new GitHubClient();

      await expect(client.getFileInfo("owner", "repo", "large.bin")).rejects.toThrow(
        /exceeds maximum size limit/,
      );
    });
  });
});
