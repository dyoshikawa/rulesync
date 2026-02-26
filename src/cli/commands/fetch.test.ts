import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchFiles, formatFetchSummary } from "../../lib/fetch.js";
import { GitHubClientError } from "../../lib/github-client.js";
import type { FetchSummary } from "../../types/fetch.js";
import { logger } from "../../utils/logger.js";
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
vi.mock("../../utils/logger.js");

describe("fetchCommand", () => {
  let mockExit: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockExit = vi.spyOn(process, "exit").mockImplementation(function () {
      throw new Error("Process exit");
    } as never);

    vi.mocked(logger.configure).mockImplementation(() => {});
    vi.mocked(logger.info).mockImplementation(() => {});
    vi.mocked(logger.success).mockImplementation(() => {});
    vi.mocked(logger.warn).mockImplementation(() => {});
    vi.mocked(logger.error).mockImplementation(() => {});
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

      await fetchCommand({
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
      expect(logger.success).toHaveBeenCalledWith("Fetched 2 files");
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

      await fetchCommand({
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

      await fetchCommand({
        source: "owner/repo",
      });

      expect(logger.warn).toHaveBeenCalledWith("No files were fetched.");
    });
  });

  describe("error handling", () => {
    it("should handle GitHubClientError with 401 status", async () => {
      vi.mocked(fetchFiles).mockRejectedValue(new GitHubClientError("Authentication failed", 401));

      await expect(fetchCommand({ source: "owner/repo" })).rejects.toThrow("Process exit");

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("GitHub API Error: Authentication failed"),
      );
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("GITHUB_TOKEN or GH_TOKEN"));
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("gh auth token"));
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("should handle GitHubClientError with 403 status", async () => {
      vi.mocked(fetchFiles).mockRejectedValue(new GitHubClientError("Access forbidden", 403));

      await expect(fetchCommand({ source: "owner/repo" })).rejects.toThrow("Process exit");

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("GitHub API Error: Access forbidden"),
      );
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("GITHUB_TOKEN or GH_TOKEN"));
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("gh auth token"));
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("should handle GitHubClientError with 404 status", async () => {
      vi.mocked(fetchFiles).mockRejectedValue(new GitHubClientError("Not found", 404));

      await expect(fetchCommand({ source: "owner/repo" })).rejects.toThrow("Process exit");

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("GitHub API Error: Not found"),
      );
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("should handle generic errors", async () => {
      vi.mocked(fetchFiles).mockRejectedValue(new Error("Network error"));

      await expect(fetchCommand({ source: "owner/repo" })).rejects.toThrow("Process exit");

      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("Network error"));
      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });

  describe("logger configuration", () => {
    it("should configure logger with verbose mode", async () => {
      vi.mocked(fetchFiles).mockResolvedValue({
        source: "owner/repo",
        ref: "main",
        files: [],
        created: 0,
        overwritten: 0,
        skipped: 0,
      });
      vi.mocked(formatFetchSummary).mockReturnValue("");

      await fetchCommand({
        source: "owner/repo",
        verbose: true,
      });

      expect(logger.configure).toHaveBeenCalledWith({
        verbose: true,
        silent: false,
      });
    });

    it("should configure logger with silent mode", async () => {
      vi.mocked(fetchFiles).mockResolvedValue({
        source: "owner/repo",
        ref: "main",
        files: [],
        created: 0,
        overwritten: 0,
        skipped: 0,
      });
      vi.mocked(formatFetchSummary).mockReturnValue("");

      await fetchCommand({
        source: "owner/repo",
        silent: true,
      });

      expect(logger.configure).toHaveBeenCalledWith({
        verbose: false,
        silent: true,
      });
    });
  });
});
