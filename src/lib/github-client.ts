import type {
  GitHubApiError,
  GitHubClientConfig,
  GitHubFileEntry,
  GitHubRepoInfo,
} from "../types/fetch.js";

import { GitHubFileEntrySchema, GitHubRepoInfoSchema } from "../types/fetch.js";
import { formatError } from "../utils/error.js";

const DEFAULT_BASE_URL = "https://api.github.com";
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * Error class for GitHub API errors
 */
export class GitHubClientError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly apiError?: GitHubApiError,
  ) {
    super(message);
    this.name = "GitHubClientError";
  }
}

/**
 * Client for interacting with GitHub API
 */
export class GitHubClient {
  private readonly token?: string;
  private readonly baseUrl: string;

  constructor(config: GitHubClientConfig = {}) {
    this.token = config.token;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  }

  /**
   * Get authentication token from various sources
   */
  static resolveToken(explicitToken?: string): string | undefined {
    if (explicitToken) {
      return explicitToken;
    }
    return process.env["GITHUB_TOKEN"] ?? process.env["GH_TOKEN"];
  }

  /**
   * Get the default branch of a repository
   */
  async getDefaultBranch(owner: string, repo: string): Promise<string> {
    const repoInfo = await this.getRepoInfo(owner, repo);
    return repoInfo.default_branch;
  }

  /**
   * Get repository information
   */
  async getRepoInfo(owner: string, repo: string): Promise<GitHubRepoInfo> {
    const url = `${this.baseUrl}/repos/${owner}/${repo}`;
    const response = await this.fetch(url);
    const data: unknown = await response.json();
    const parsed = GitHubRepoInfoSchema.safeParse(data);
    if (!parsed.success) {
      throw new GitHubClientError(`Invalid repository info response: ${formatError(parsed.error)}`);
    }
    return parsed.data;
  }

  /**
   * List contents of a directory in a repository
   */
  async listDirectory(
    owner: string,
    repo: string,
    path: string,
    ref?: string,
  ): Promise<GitHubFileEntry[]> {
    const encodedPath = path
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    let url = `${this.baseUrl}/repos/${owner}/${repo}/contents/${encodedPath}`;
    if (ref) {
      url += `?ref=${encodeURIComponent(ref)}`;
    }

    const response = await this.fetch(url);
    const data: unknown = await response.json();

    // API returns single object for files, array for directories
    if (!Array.isArray(data)) {
      throw new GitHubClientError(`Path "${path}" is not a directory`);
    }

    const entries: GitHubFileEntry[] = [];
    for (const item of data) {
      const parsed = GitHubFileEntrySchema.safeParse(item);
      if (parsed.success) {
        entries.push(parsed.data);
      }
    }
    return entries;
  }

  /**
   * Get raw file content from a repository
   */
  async getFileContent(owner: string, repo: string, path: string, ref?: string): Promise<string> {
    const encodedPath = path
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    let url = `${this.baseUrl}/repos/${owner}/${repo}/contents/${encodedPath}`;
    if (ref) {
      url += `?ref=${encodeURIComponent(ref)}`;
    }

    const response = await this.fetch(url, {
      headers: {
        Accept: "application/vnd.github.raw+json",
      },
    });

    return response.text();
  }

  /**
   * Check if a file exists and is within size limits
   */
  async getFileInfo(
    owner: string,
    repo: string,
    path: string,
    ref?: string,
  ): Promise<GitHubFileEntry | null> {
    const encodedPath = path
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    let url = `${this.baseUrl}/repos/${owner}/${repo}/contents/${encodedPath}`;
    if (ref) {
      url += `?ref=${encodeURIComponent(ref)}`;
    }

    try {
      const response = await this.fetch(url);
      const data: unknown = await response.json();

      // Ensure it's a file, not a directory
      if (Array.isArray(data)) {
        return null; // It's a directory
      }

      const parsed = GitHubFileEntrySchema.safeParse(data);
      if (!parsed.success) {
        return null;
      }

      if (parsed.data.size > MAX_FILE_SIZE) {
        throw new GitHubClientError(
          `File "${path}" exceeds maximum size limit of ${MAX_FILE_SIZE / 1024 / 1024}MB`,
        );
      }

      return parsed.data;
    } catch (error) {
      if (error instanceof GitHubClientError && error.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Validate that a repository exists and is accessible
   */
  async validateRepository(owner: string, repo: string): Promise<boolean> {
    try {
      await this.getRepoInfo(owner, repo);
      return true;
    } catch (error) {
      if (error instanceof GitHubClientError && error.statusCode === 404) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Validate that a ref (branch/tag/commit) exists
   */
  async validateRef(owner: string, repo: string, ref: string): Promise<boolean> {
    // Try to get a file list at root with the ref to validate it exists
    const url = `${this.baseUrl}/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(ref)}`;
    try {
      await this.fetch(url);
      return true;
    } catch (error) {
      if (error instanceof GitHubClientError && error.statusCode === 404) {
        // Try tags
        const tagUrl = `${this.baseUrl}/repos/${owner}/${repo}/git/ref/tags/${encodeURIComponent(ref)}`;
        try {
          await this.fetch(tagUrl);
          return true;
        } catch (tagError) {
          if (tagError instanceof GitHubClientError && tagError.statusCode === 404) {
            // Try as commit SHA
            const commitUrl = `${this.baseUrl}/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`;
            try {
              await this.fetch(commitUrl);
              return true;
            } catch {
              return false;
            }
          }
          throw tagError;
        }
      }
      throw error;
    }
  }

  /**
   * Internal fetch wrapper with authentication and error handling
   */
  private async fetch(url: string, options: RequestInit = {}): Promise<Response> {
    const headers: Record<string, string> = {
      Accept:
        options.headers && "Accept" in options.headers
          ? String(options.headers.Accept)
          : "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };

    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    const response = await fetch(url, {
      ...options,
      headers: {
        ...headers,
        ...options.headers,
      },
    });

    if (!response.ok) {
      let apiError: GitHubApiError | undefined;
      try {
        const errorData: unknown = await response.json();
        if (typeof errorData === "object" && errorData !== null && "message" in errorData) {
          // eslint-disable-next-line no-type-assertion/no-type-assertion
          apiError = errorData as GitHubApiError;
        }
      } catch {
        // Ignore JSON parse errors
      }

      const errorMessage = this.getErrorMessage(response.status, apiError);
      throw new GitHubClientError(errorMessage, response.status, apiError);
    }

    return response;
  }

  /**
   * Get human-readable error message for HTTP status codes
   */
  private getErrorMessage(statusCode: number, apiError?: GitHubApiError): string {
    const baseMessage = apiError?.message ?? `HTTP ${statusCode}`;

    switch (statusCode) {
      case 401:
        return `Authentication failed: ${baseMessage}. Check your GitHub token.`;
      case 403:
        if (baseMessage.toLowerCase().includes("rate limit")) {
          return `GitHub API rate limit exceeded. ${this.token ? "Try again later." : "Consider using a GitHub token."}`;
        }
        return `Access forbidden: ${baseMessage}. Check repository permissions.`;
      case 404:
        return `Not found: ${baseMessage}`;
      case 422:
        return `Invalid request: ${baseMessage}`;
      default:
        return `GitHub API error: ${baseMessage}`;
    }
  }
}
