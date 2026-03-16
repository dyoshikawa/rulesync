import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchFiles, formatFetchSummary } from "../../lib/fetch.js";
import { GitHubClientError } from "../../lib/github-client.js";
import type { FetchSummary } from "../../types/fetch.js";
import { createMockLogger } from "./__test__/mock-logger.js";
import { fetchCommand } from "./fetch.js";

// Mock dependencies
vi.mock("../../lib/fetch.js");
vi.mock("../../lib/github-client.js", async () => {
  const actual = await vi.importActual<typeof import("../../lib/github-client.js")>(
    "../../lib/github-client.js",
  );
  return {
    ...actual,
    GitHubClientError: actual.GitHubClientError,
  };
});

describe("fetchCommand", () => {
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mockLogger = createMockLogger();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("successful fetch", () => {
    it("should fetch files and log success", async () => {
      const mockSummary: FetchSummary = {
        source: "owner/repo",
        ref: "main",
        files: [
          { relativePath: "rules/overview.md", status: "created" },
          { relativePath: "mcp.json", status: "created" },
        ],
        created: 2,
        overwritten: 0,
        skipped: 0,
      };

      vi.mocked(fetchFiles).mockResolvedValue(mockSummary);
      vi.mocked(formatFetchSummary).mockReturnValue("Fetched 2 files");

      await fetchCommand(mockLogger, {
        source: "owner/repo",
      });

      expect(fetchFiles).toHaveBeenCalledWith({
        source: "owner/repo",
        options: {
          target: undefined,
          features: undefined,
          ref: undefined,
          path: undefined,
          output: undefined,
          conflict: undefined,
          token: undefined,
          verbose: undefined,
          silent: undefined,
        },
      });
      expect(mockLogger.success).toHaveBeenCalledWith("Fetched 2 files");
    });

    it("should pass all options to fetchFiles", async () => {
      const mockSummary: FetchSummary = {
        source: "owner/repo",
        ref: "develop",
        files: [],
        created: 0,
        overwritten: 0,
        skipped: 0,
      };

      vi.mocked(fetchFiles).mockResolvedValue(mockSummary);
      vi.mocked(formatFetchSummary).mockReturnValue("No files fetched");

      await fetchCommand(mockLogger, {
        source: "owner/repo",
        target: "rulesync",
        features: ["rules", "mcp"],
        ref: "develop",
        path: "packages/shared",
        output: "custom-output",
        conflict: "skip",
        token: "my-token",
        verbose: true,
        silent: false,
      });

      expect(fetchFiles).toHaveBeenCalledWith({
        source: "owner/repo",
        options: {
          target: "rulesync",
          features: ["rules", "mcp"],
          ref: "develop",
          path: "packages/shared",
          output: "custom-output",
          conflict: "skip",
          token: "my-token",
          verbose: true,
          silent: false,
        },
      });
    });

    it("should warn when no files were fetched", async () => {
      const mockSummary: FetchSummary = {
        source: "owner/repo",
        ref: "main",
        files: [],
        created: 0,
        overwritten: 0,
        skipped: 0,
      };

      vi.mocked(fetchFiles).mockResolvedValue(mockSummary);
      vi.mocked(formatFetchSummary).mockReturnValue("No files fetched");

      await fetchCommand(mockLogger, {
        source: "owner/repo",
      });

      expect(mockLogger.warn).toHaveBeenCalledWith("No files were fetched.");
    });
  });

  describe("error handling", () => {
    it("should handle GitHubClientError with 401 status", async () => {
      vi.mocked(fetchFiles).mockRejectedValue(new GitHubClientError("Authentication failed", 401));

      await expect(fetchCommand(mockLogger, { source: "owner/repo" })).rejects.toThrow(
        "GitHub API Error: Authentication failed",
      );
    });

    it("should handle GitHubClientError with 403 status", async () => {
      vi.mocked(fetchFiles).mockRejectedValue(new GitHubClientError("Access forbidden", 403));

      await expect(fetchCommand(mockLogger, { source: "owner/repo" })).rejects.toThrow(
        "GitHub API Error: Access forbidden",
      );
    });

    it("should handle GitHubClientError with 404 status", async () => {
      vi.mocked(fetchFiles).mockRejectedValue(new GitHubClientError("Not found", 404));

      await expect(fetchCommand(mockLogger, { source: "owner/repo" })).rejects.toThrow(
        "GitHub API Error: Not found",
      );
    });

    it("should handle generic errors", async () => {
      vi.mocked(fetchFiles).mockRejectedValue(new Error("Network error"));

      await expect(fetchCommand(mockLogger, { source: "owner/repo" })).rejects.toThrow(
        "Network error",
      );
    });
  });
});
