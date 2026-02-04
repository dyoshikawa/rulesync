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

import {
  RULESYNC_AIIGNORE_FILE_NAME,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../constants/rulesync-paths.js";
import { ALL_FEATURES } from "../types/features.js";
import { checkPathTraversal, fileExists, writeFileContent } from "../utils/file.js";
import { logger } from "../utils/logger.js";
import { GitHubClient, GitHubClientError } from "./github-client.js";

/**
 * Maximum file size to download (10MB)
 */
const MAX_FILE_SIZE = 10 * 1024 * 1024;

/**
 * Feature to path mapping for filtering
 */
const FEATURE_PATHS: Record<Feature, string[]> = {
  rules: ["rules"],
  commands: ["commands"],
  subagents: ["subagents"],
  skills: ["skills"],
  ignore: [RULESYNC_AIIGNORE_FILE_NAME],
  mcp: ["mcp.json"],
  hooks: ["hooks.json"],
};

/**
 * Parse source specification into components
 * Supports:
 * - https://github.com/owner/repo
 * - https://github.com/owner/repo/tree/branch
 * - owner/repo
 * - owner/repo@ref
 * - owner/repo:path
 * - owner/repo@ref:path
 */
export function parseSource(source: string): ParsedSource {
  // Handle full GitHub URL
  if (source.startsWith("https://github.com/")) {
    return parseGitHubUrl(source);
  }

  // Handle shorthand: owner/repo[@ref][:path]
  return parseShorthand(source);
}

function parseGitHubUrl(url: string): ParsedSource {
  // Remove protocol and domain
  const withoutProtocol = url.replace("https://github.com/", "");

  // Split by path segments
  const segments = withoutProtocol.split("/").filter(Boolean);

  if (segments.length < 2) {
    throw new Error(`Invalid GitHub URL: ${url}. Expected format: https://github.com/owner/repo`);
  }

  const owner = segments[0];
  const repo = segments[1];

  // Check for /tree/ref/path or /blob/ref/path pattern
  if (segments.length > 2 && (segments[2] === "tree" || segments[2] === "blob")) {
    const ref = segments[3];
    const path = segments.length > 4 ? segments.slice(4).join("/") : undefined;
    return {
      owner: owner ?? "",
      repo: repo ?? "",
      ref,
      path,
    };
  }

  return {
    owner: owner ?? "",
    repo: repo ?? "",
  };
}

function parseShorthand(source: string): ParsedSource {
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
 * Check if a path should be included based on enabled features
 */
function shouldIncludePath(relativePath: string, enabledFeatures: Feature[]): boolean {
  for (const feature of enabledFeatures) {
    const featurePaths = FEATURE_PATHS[feature];
    for (const featurePath of featurePaths) {
      if (relativePath === featurePath || relativePath.startsWith(`${featurePath}/`)) {
        return true;
      }
    }
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
 * Fetch rulesync files from a GitHub repository
 */
export async function fetchFromGitHub(params: FetchParams): Promise<FetchSummary> {
  const { source, options = {}, baseDir = process.cwd() } = params;

  // Configure logger
  // Parse source
  const parsed = parseSource(source);

  // Resolve options
  const resolvedRef = options.ref ?? parsed.ref;
  const resolvedPath = options.path ?? parsed.path ?? ".";
  const outputDir = options.output ?? RULESYNC_RELATIVE_DIR_PATH;
  const conflictStrategy: ConflictStrategy = options.conflict ?? "overwrite";
  const dryRun = options.dryRun ?? false;
  const enabledFeatures = resolveFeatures(options.features);

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

  // Build the path to .rulesync directory
  const rulesyncPath =
    resolvedPath === "." || resolvedPath === ""
      ? RULESYNC_RELATIVE_DIR_PATH
      : join(resolvedPath, RULESYNC_RELATIVE_DIR_PATH);

  // Check if .rulesync directory exists
  logger.debug(`Looking for .rulesync at: ${rulesyncPath}`);
  let rulesyncEntries: GitHubFileEntry[];
  try {
    rulesyncEntries = await client.listDirectory(parsed.owner, parsed.repo, rulesyncPath, ref);
  } catch (error) {
    if (error instanceof GitHubClientError && error.statusCode === 404) {
      throw new GitHubClientError(
        `No .rulesync directory found at "${rulesyncPath}" in ${parsed.owner}/${parsed.repo}@${ref}`,
        404,
      );
    }
    throw error;
  }

  // Collect all files to fetch
  const filesToFetch: Array<{ remotePath: string; relativePath: string; size: number }> = [];

  for (const entry of rulesyncEntries) {
    if (entry.type === "file") {
      // Handle top-level files like mcp.json, hooks.json, .aiignore
      const relativePath = entry.name;
      if (shouldIncludePath(relativePath, enabledFeatures)) {
        filesToFetch.push({
          remotePath: entry.path,
          relativePath,
          size: entry.size,
        });
      }
    } else if (entry.type === "dir") {
      // Handle directories like rules/, commands/, etc.
      const dirName = entry.name;
      if (
        shouldIncludePath(dirName, enabledFeatures) ||
        shouldIncludePath(`${dirName}/`, enabledFeatures)
      ) {
        // Recursively list directory contents
        const dirFiles = await listDirectoryRecursive(
          client,
          parsed.owner,
          parsed.repo,
          entry.path,
          ref,
        );
        for (const file of dirFiles) {
          // Calculate relative path from .rulesync
          const relativePath = file.path.substring(rulesyncPath.length + 1);
          filesToFetch.push({
            remotePath: file.path,
            relativePath,
            size: file.size,
          });
        }
      }
    }
  }

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
      if (!dryRun) {
        // Fetch and write file (writeFileContent handles directory creation)
        const content = await client.getFileContent(parsed.owner, parsed.repo, remotePath, ref);
        await writeFileContent(localPath, content);
      }

      status = exists ? "overwritten" : "created";
      logger.debug(`${dryRun ? "[DRY RUN] Would write" : "Wrote"}: ${relativePath} (${status})`);
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
export function formatFetchSummary(summary: FetchSummary, dryRun: boolean): string {
  const lines: string[] = [];

  const prefix = dryRun ? "[DRY RUN] Would fetch" : "Fetched";
  lines.push(`${prefix} from ${summary.source}@${summary.ref}:`);

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
  lines.push(`Summary: ${dryRun ? "would " : ""}${summaryText}`);

  return lines.join("\n");
}
