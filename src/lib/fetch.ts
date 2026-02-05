import { join } from "node:path";

import type { Feature } from "../types/features.js";
import type {
  ConflictStrategy,
  FetchFileResult,
  FetchOptions,
  FetchSummary,
  GitHubFileEntry,
  ParsedSource,
} from "../types/fetch.js";
import type { GitProvider } from "../types/git-provider.js";

import {
  MAX_FILE_SIZE,
  RULESYNC_AIIGNORE_FILE_NAME,
  RULESYNC_HOOKS_FILE_NAME,
  RULESYNC_MCP_FILE_NAME,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../constants/rulesync-paths.js";
import { ALL_FEATURES } from "../types/features.js";
import { ALL_GIT_PROVIDERS } from "../types/git-provider.js";
import { checkPathTraversal, fileExists, writeFileContent } from "../utils/file.js";
import { logger } from "../utils/logger.js";
import { GitHubClient, GitHubClientError } from "./github-client.js";

/**
 * Feature to path mapping for filtering
 */
const FEATURE_PATHS: Record<Feature, string[]> = {
  rules: ["rules"],
  commands: ["commands"],
  subagents: ["subagents"],
  skills: ["skills"],
  ignore: [RULESYNC_AIIGNORE_FILE_NAME],
  mcp: [RULESYNC_MCP_FILE_NAME],
  hooks: [RULESYNC_HOOKS_FILE_NAME],
};

/**
 * Parse source specification into components
 * Supports:
 * - URL format: https://github.com/owner/repo, https://gitlab.com/owner/repo
 * - Prefix format: github:owner/repo, gitlab:owner/repo
 * - Shorthand format: owner/repo (defaults to GitHub)
 * - With ref: owner/repo@ref
 * - With path: owner/repo:path
 * - Combined: owner/repo@ref:path
 */
export function parseSource(source: string): ParsedSource {
  // Handle full URL format (https://...)
  if (source.startsWith("http://") || source.startsWith("https://")) {
    return parseUrl(source);
  }

  // Handle prefix format (github:owner/repo, gitlab:owner/repo)
  if (source.includes(":") && !source.includes("://")) {
    const colonIndex = source.indexOf(":");
    const prefix = source.substring(0, colonIndex);
    const rest = source.substring(colonIndex + 1);

    // Check if prefix is a known provider using type guard
    const provider = ALL_GIT_PROVIDERS.find((p) => p === prefix);
    if (provider) {
      return { provider, ...parseShorthand(rest) };
    }

    // If prefix is not a known provider, treat the whole thing as shorthand
    // This handles cases like owner/repo:path where "owner/repo" contains no provider prefix
    return { provider: "github", ...parseShorthand(source) };
  }

  // Handle shorthand: owner/repo[@ref][:path] - defaults to GitHub
  return { provider: "github", ...parseShorthand(source) };
}

/**
 * Parse URL format into components
 */
function parseUrl(url: string): ParsedSource {
  const urlObj = new URL(url);
  const host = urlObj.hostname.toLowerCase();

  let provider: GitProvider;
  if (host === "github.com" || host.endsWith(".github.com")) {
    provider = "github";
  } else if (host === "gitlab.com" || host.includes("gitlab")) {
    provider = "gitlab";
  } else {
    throw new Error(
      `Unknown Git provider for host: ${host}. Supported providers: ${ALL_GIT_PROVIDERS.join(", ")}`,
    );
  }

  // Split by path segments
  const segments = urlObj.pathname.split("/").filter(Boolean);

  if (segments.length < 2) {
    throw new Error(`Invalid ${provider} URL: ${url}. Expected format: https://${host}/owner/repo`);
  }

  const owner = segments[0];
  const repo = segments[1]?.replace(/\.git$/, "");

  // Check for /tree/ref/path or /blob/ref/path pattern
  if (segments.length > 2 && (segments[2] === "tree" || segments[2] === "blob")) {
    const ref = segments[3];
    const path = segments.length > 4 ? segments.slice(4).join("/") : undefined;
    return {
      provider,
      owner: owner ?? "",
      repo: repo ?? "",
      ref,
      path,
    };
  }

  return {
    provider,
    owner: owner ?? "",
    repo: repo ?? "",
  };
}

/**
 * Parse shorthand format (without provider prefix)
 */
function parseShorthand(source: string): Omit<ParsedSource, "provider"> {
  // Pattern: owner/repo[@ref][:path]
  let remaining = source;
  let path: string | undefined;
  let ref: string | undefined;

  // Extract path first (after :)
  const colonIndex = remaining.indexOf(":");
  if (colonIndex !== -1) {
    path = remaining.substring(colonIndex + 1);
    if (!path) {
      throw new Error(`Invalid source: ${source}. Path cannot be empty after ":".`);
    }
    remaining = remaining.substring(0, colonIndex);
  }

  // Extract ref (after @)
  const atIndex = remaining.indexOf("@");
  if (atIndex !== -1) {
    ref = remaining.substring(atIndex + 1);
    if (!ref) {
      throw new Error(`Invalid source: ${source}. Ref cannot be empty after "@".`);
    }
    remaining = remaining.substring(0, atIndex);
  }

  // Parse owner/repo
  const slashIndex = remaining.indexOf("/");
  if (slashIndex === -1) {
    throw new Error(
      `Invalid source: ${source}. Expected format: owner/repo, owner/repo@ref, or owner/repo:path`,
    );
  }

  const owner = remaining.substring(0, slashIndex);
  const repo = remaining.substring(slashIndex + 1);

  if (!owner || !repo) {
    throw new Error(`Invalid source: ${source}. Both owner and repo are required.`);
  }

  return {
    owner,
    repo,
    ref,
    path,
  };
}

/**
 * Resolve features from options, handling wildcard
 */
function resolveFeatures(features?: string[]): Feature[] {
  if (!features || features.length === 0 || features.includes("*")) {
    return [...ALL_FEATURES];
  }
  // eslint-disable-next-line no-type-assertion/no-type-assertion
  return features.filter((f): f is Feature => ALL_FEATURES.includes(f as Feature));
}

/**
 * Type guard for error objects with statusCode
 */
function hasStatusCode(error: unknown): error is { statusCode: number } {
  if (typeof error !== "object" || error === null || !("statusCode" in error)) {
    return false;
  }
  const maybeStatus = Object.getOwnPropertyDescriptor(error, "statusCode")?.value;
  return typeof maybeStatus === "number";
}

/**
 * Check if error is a 404 "not found" error
 */
function isNotFoundError(error: unknown): boolean {
  if (error instanceof GitHubClientError && error.statusCode === 404) {
    return true;
  }
  // Also handle plain objects with statusCode property (for test mocks)
  if (hasStatusCode(error) && error.statusCode === 404) {
    return true;
  }
  return false;
}

/**
 * Parameters for fetch operation
 */
export type FetchParams = {
  source: string;
  options?: FetchOptions;
  baseDir?: string;
};

/**
 * Fetch files from a Git repository
 * Searches for feature directories (rules/, commands/, skills/, etc.) directly at the specified path
 */
export async function fetchFiles(params: FetchParams): Promise<FetchSummary> {
  const { source, options = {}, baseDir = process.cwd() } = params;

  // Parse source
  const parsed = parseSource(source);

  // Check if provider is supported
  if (parsed.provider === "gitlab") {
    throw new Error(
      "GitLab is not yet supported. Currently only GitHub repositories are supported.",
    );
  }

  // Resolve options
  const resolvedRef = options.ref ?? parsed.ref;
  const resolvedPath = options.path ?? parsed.path ?? ".";
  const outputDir = options.output ?? RULESYNC_RELATIVE_DIR_PATH;
  const conflictStrategy: ConflictStrategy = options.conflict ?? "overwrite";
  const enabledFeatures = resolveFeatures(options.features);

  // Validate output directory to prevent path traversal attacks
  checkPathTraversal({
    relativePath: outputDir,
    intendedRootDir: baseDir,
  });

  // Initialize GitHub client
  const token = GitHubClient.resolveToken(options.token);
  const client = new GitHubClient({ token });

  // Validate repository
  logger.debug(`Validating repository: ${parsed.owner}/${parsed.repo}`);
  const isValid = await client.validateRepository(parsed.owner, parsed.repo);
  if (!isValid) {
    throw new GitHubClientError(
      `Repository not found: ${parsed.owner}/${parsed.repo}. Check the repository name and your access permissions.`,
      404,
    );
  }

  // Resolve ref to use
  const ref = resolvedRef ?? (await client.getDefaultBranch(parsed.owner, parsed.repo));
  logger.debug(`Using ref: ${ref}`);

  // Collect all files to fetch from feature directories directly
  const filesToFetch = await collectFeatureFiles({
    client,
    owner: parsed.owner,
    repo: parsed.repo,
    basePath: resolvedPath,
    ref,
    enabledFeatures,
  });

  if (filesToFetch.length === 0) {
    logger.warn(`No files found matching enabled features: ${enabledFeatures.join(", ")}`);
    return {
      source: `${parsed.owner}/${parsed.repo}`,
      ref,
      files: [],
      created: 0,
      overwritten: 0,
      skipped: 0,
    };
  }

  // Process files
  const results: FetchFileResult[] = [];
  const outputBasePath = join(baseDir, outputDir);

  for (const { remotePath, relativePath, size } of filesToFetch) {
    // Validate path to prevent path traversal attacks
    checkPathTraversal({
      relativePath,
      intendedRootDir: outputBasePath,
    });

    // Check file size limit
    if (size > MAX_FILE_SIZE) {
      throw new GitHubClientError(
        `File "${relativePath}" exceeds maximum size limit (${(size / 1024 / 1024).toFixed(2)}MB > ${MAX_FILE_SIZE / 1024 / 1024}MB)`,
      );
    }

    const localPath = join(outputBasePath, relativePath);
    const exists = await fileExists(localPath);

    let status: FetchFileResult["status"];

    if (exists && conflictStrategy === "skip") {
      status = "skipped";
      logger.debug(`Skipping existing file: ${relativePath}`);
    } else {
      // Fetch and write file (writeFileContent handles directory creation)
      const content = await client.getFileContent(parsed.owner, parsed.repo, remotePath, ref);
      await writeFileContent(localPath, content);

      status = exists ? "overwritten" : "created";
      logger.debug(`Wrote: ${relativePath} (${status})`);
    }

    results.push({ relativePath, status });
  }

  // Calculate summary
  const summary: FetchSummary = {
    source: `${parsed.owner}/${parsed.repo}`,
    ref,
    files: results,
    created: results.filter((r) => r.status === "created").length,
    overwritten: results.filter((r) => r.status === "overwritten").length,
    skipped: results.filter((r) => r.status === "skipped").length,
  };

  return summary;
}

/**
 * Collect files from feature directories
 */
async function collectFeatureFiles(params: {
  client: GitHubClient;
  owner: string;
  repo: string;
  basePath: string;
  ref: string;
  enabledFeatures: Feature[];
}): Promise<Array<{ remotePath: string; relativePath: string; size: number }>> {
  const { client, owner, repo, basePath, ref, enabledFeatures } = params;
  const filesToFetch: Array<{ remotePath: string; relativePath: string; size: number }> = [];

  for (const feature of enabledFeatures) {
    const featurePaths = FEATURE_PATHS[feature];

    for (const featurePath of featurePaths) {
      const fullPath =
        basePath === "." || basePath === "" ? featurePath : join(basePath, featurePath);

      try {
        // Check if it's a file (mcp.json, .aiignore, hooks.json)
        if (featurePath.includes(".")) {
          // Try to get the file directly
          try {
            const entries = await client.listDirectory(
              owner,
              repo,
              basePath === "." || basePath === "" ? "." : basePath,
              ref,
            );
            const fileEntry = entries.find((e) => e.name === featurePath && e.type === "file");
            if (fileEntry) {
              filesToFetch.push({
                remotePath: fileEntry.path,
                relativePath: featurePath,
                size: fileEntry.size,
              });
            }
          } catch {
            // File not found, skip
            logger.debug(`File not found: ${fullPath}`);
          }
        } else {
          // It's a directory (rules/, commands/, skills/, subagents/)
          const dirFiles = await listDirectoryRecursive(client, owner, repo, fullPath, ref);

          for (const file of dirFiles) {
            // Calculate relative path from base
            const relativePath =
              basePath === "." || basePath === ""
                ? file.path
                : file.path.substring(basePath.length + 1);

            filesToFetch.push({
              remotePath: file.path,
              relativePath,
              size: file.size,
            });
          }
        }
      } catch (error) {
        // Check for 404 errors (feature not found)
        if (isNotFoundError(error)) {
          // Feature directory/file not found, skip silently
          logger.debug(`Feature not found: ${fullPath}`);
          continue;
        }
        throw error;
      }
    }
  }

  return filesToFetch;
}

/**
 * Recursively list all files in a directory
 */
async function listDirectoryRecursive(
  client: GitHubClient,
  owner: string,
  repo: string,
  path: string,
  ref?: string,
): Promise<GitHubFileEntry[]> {
  const entries = await client.listDirectory(owner, repo, path, ref);
  const files: GitHubFileEntry[] = [];

  for (const entry of entries) {
    if (entry.type === "file") {
      files.push(entry);
    } else if (entry.type === "dir") {
      const subFiles = await listDirectoryRecursive(client, owner, repo, entry.path, ref);
      files.push(...subFiles);
    }
  }

  return files;
}

/**
 * Format fetch summary for display
 */
export function formatFetchSummary(summary: FetchSummary): string {
  const lines: string[] = [];

  lines.push(`Fetched from ${summary.source}@${summary.ref}:`);

  for (const file of summary.files) {
    const icon = file.status === "skipped" ? "-" : "\u2713";
    const statusText =
      file.status === "created"
        ? "(created)"
        : file.status === "overwritten"
          ? "(overwritten)"
          : "(skipped - already exists)";
    lines.push(`  ${icon} ${file.relativePath} ${statusText}`);
  }

  const parts: string[] = [];
  if (summary.created > 0) parts.push(`${summary.created} created`);
  if (summary.overwritten > 0) parts.push(`${summary.overwritten} overwritten`);
  if (summary.skipped > 0) parts.push(`${summary.skipped} skipped`);

  lines.push("");
  const summaryText = parts.length > 0 ? parts.join(", ") : "no files";
  lines.push(`Summary: ${summaryText}`);

  return lines.join("\n");
}

// Legacy export for backward compatibility during migration
export { fetchFiles as fetchFromGitHub };
