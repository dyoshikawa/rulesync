import { Semaphore } from "es-toolkit/promise";
import { join } from "node:path";

import type { Feature } from "../types/features.js";
import type { FetchTarget } from "../types/fetch-targets.js";
import type {
  ConflictStrategy,
  FetchFileResult,
  FetchOptions,
  FetchSummary,
  GitHubFileEntry,
  ParsedSource,
} from "../types/fetch.js";
import type { GitProvider } from "../types/git-provider.js";
import type { ToolTarget } from "../types/tool-targets.js";

import {
  MAX_FILE_SIZE,
  RULESYNC_AIIGNORE_FILE_NAME,
  RULESYNC_HOOKS_FILE_NAME,
  RULESYNC_MCP_FILE_NAME,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../constants/rulesync-paths.js";
import { CommandsProcessor } from "../features/commands/commands-processor.js";
import { HooksProcessor } from "../features/hooks/hooks-processor.js";
import { IgnoreProcessor } from "../features/ignore/ignore-processor.js";
import { McpProcessor } from "../features/mcp/mcp-processor.js";
import { RulesProcessor } from "../features/rules/rules-processor.js";
import { SkillsProcessor } from "../features/skills/skills-processor.js";
import { SubagentsProcessor } from "../features/subagents/subagents-processor.js";
import { ALL_FEATURES } from "../types/features.js";
import { ALL_GIT_PROVIDERS } from "../types/git-provider.js";
import {
  checkPathTraversal,
  createTempDirectory,
  fileExists,
  removeTempDirectory,
  writeFileContent,
} from "../utils/file.js";
import { logger } from "../utils/logger.js";
import { GitHubClient, GitHubClientError } from "./github-client.js";

/**
 * Feature to path mapping for filtering (rulesync format)
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
 * Check if target is a tool target (not rulesync)
 */
function isToolTarget(target: FetchTarget): target is ToolTarget {
  return target !== "rulesync";
}

/**
 * Result of feature conversion
 */
type FeatureConversionResult = {
  converted: number;
  convertedPaths: string[];
};

/**
 * Processor type for feature conversion
 */
type FeatureProcessor = {
  loadToolFiles(): Promise<unknown[]>;
  convertToolFilesToRulesyncFiles(
    toolFiles: unknown[],
  ): Promise<
    Array<{ getRelativeDirPath(): string; getRelativeFilePath(): string; getFileContent(): string }>
  >;
};

/**
 * Process feature conversion for a single feature type
 * @param processor - The processor to use for loading and converting files
 * @param outputDir - Output directory for converted files
 * @returns The paths of converted files
 */
async function processFeatureConversion(params: {
  processor: FeatureProcessor;
  outputDir: string;
}): Promise<{ paths: string[] }> {
  const { processor, outputDir } = params;
  const paths: string[] = [];

  const toolFiles = await processor.loadToolFiles();
  if (toolFiles.length === 0) {
    return { paths: [] };
  }

  const rulesyncFiles = await processor.convertToolFilesToRulesyncFiles(toolFiles);
  for (const file of rulesyncFiles) {
    const relativePath = join(file.getRelativeDirPath(), file.getRelativeFilePath());
    const outputPath = join(outputDir, relativePath);
    await writeFileContent(outputPath, file.getFileContent());
    paths.push(relativePath);
  }

  return { paths };
}

/**
 * Convert fetched tool-specific files to rulesync format
 * @param tempDir - Temporary directory containing tool-specific files
 * @param outputDir - Output directory for rulesync files
 * @param target - Tool target to convert from
 * @param features - Features to convert
 * @returns Number of converted files and their paths
 */
async function convertFetchedFilesToRulesync(params: {
  tempDir: string;
  outputDir: string;
  target: ToolTarget;
  features: Feature[];
}): Promise<FeatureConversionResult> {
  const { tempDir, outputDir, target, features } = params;
  const convertedPaths: string[] = [];

  // Feature conversion configurations
  // Each config defines how to get supported targets and create a processor
  const featureConfigs: Array<{
    feature: Feature;
    getTargets: () => ToolTarget[];
    createProcessor: () => FeatureProcessor;
  }> = [
    {
      feature: "rules",
      getTargets: () => RulesProcessor.getToolTargets({ global: false }),
      createProcessor: () =>
        new RulesProcessor({ baseDir: tempDir, toolTarget: target, global: false }),
    },
    {
      feature: "commands",
      getTargets: () =>
        CommandsProcessor.getToolTargets({ global: false, includeSimulated: false }),
      createProcessor: () =>
        new CommandsProcessor({ baseDir: tempDir, toolTarget: target, global: false }),
    },
    {
      feature: "subagents",
      getTargets: () =>
        SubagentsProcessor.getToolTargets({ global: false, includeSimulated: false }),
      createProcessor: () =>
        new SubagentsProcessor({ baseDir: tempDir, toolTarget: target, global: false }),
    },
    {
      feature: "ignore",
      getTargets: () => IgnoreProcessor.getToolTargets(),
      createProcessor: () => new IgnoreProcessor({ baseDir: tempDir, toolTarget: target }),
    },
    {
      feature: "mcp",
      getTargets: () => McpProcessor.getToolTargets({ global: false }),
      createProcessor: () =>
        new McpProcessor({ baseDir: tempDir, toolTarget: target, global: false }),
    },
    {
      feature: "hooks",
      getTargets: () => HooksProcessor.getToolTargets({ global: false }),
      createProcessor: () =>
        new HooksProcessor({ baseDir: tempDir, toolTarget: target, global: false }),
    },
  ];

  // Process each feature using data-driven approach
  for (const config of featureConfigs) {
    if (!features.includes(config.feature)) {
      continue;
    }
    const supportedTargets = config.getTargets();
    if (!supportedTargets.includes(target)) {
      continue;
    }
    const processor = config.createProcessor();
    const result = await processFeatureConversion({ processor, outputDir });
    convertedPaths.push(...result.paths);
  }

  // Skills conversion is not yet supported in fetch command
  // Note: Skills are more complex as they are directory-based.
  // Users can use the import command for skills conversion.
  if (features.includes("skills")) {
    logger.debug(
      "Skills conversion is not yet supported in fetch command. Use import command instead.",
    );
  }

  return { converted: convertedPaths.length, convertedPaths };
}

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

const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);
const GITLAB_HOSTS = new Set(["gitlab.com", "www.gitlab.com"]);

const MAX_RECURSION_DEPTH = 15;
const FETCH_CONCURRENCY_LIMIT = 10;

/**
 * Parse URL format into components
 */
function parseUrl(url: string): ParsedSource {
  const urlObj = new URL(url);
  const host = urlObj.hostname.toLowerCase();

  let provider: GitProvider;
  if (GITHUB_HOSTS.has(host)) {
    provider = "github";
  } else if (GITLAB_HOSTS.has(host)) {
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
 *
 * When target is "rulesync" (default), files are fetched as-is.
 * When target is a tool target (e.g., "claudecode"), files are fetched to a temp directory,
 * converted to rulesync format, and written to the output directory.
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
  const target: FetchTarget = options.target ?? "rulesync";

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

  // If target is a tool format, use conversion flow
  if (isToolTarget(target)) {
    return fetchAndConvertToolFiles({
      client,
      parsed,
      ref,
      resolvedPath,
      enabledFeatures,
      target,
      outputDir,
      baseDir,
      conflictStrategy,
    });
  }

  // Create semaphore for concurrency control
  const semaphore = new Semaphore(FETCH_CONCURRENCY_LIMIT);

  // Collect all files to fetch from feature directories directly
  const filesToFetch = await collectFeatureFiles({
    client,
    owner: parsed.owner,
    repo: parsed.repo,
    basePath: resolvedPath,
    ref,
    enabledFeatures,
    semaphore,
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

  // Process files in parallel with concurrency control
  const outputBasePath = join(baseDir, outputDir);

  // Validate paths and check file sizes first (synchronous checks)
  for (const { relativePath, size } of filesToFetch) {
    checkPathTraversal({
      relativePath,
      intendedRootDir: outputBasePath,
    });

    if (size > MAX_FILE_SIZE) {
      throw new GitHubClientError(
        `File "${relativePath}" exceeds maximum size limit (${(size / 1024 / 1024).toFixed(2)}MB > ${MAX_FILE_SIZE / 1024 / 1024}MB)`,
      );
    }
  }

  const results = await Promise.all(
    filesToFetch.map(async ({ remotePath, relativePath }) => {
      const localPath = join(outputBasePath, relativePath);
      const exists = await fileExists(localPath);

      if (exists && conflictStrategy === "skip") {
        logger.debug(`Skipping existing file: ${relativePath}`);
        return { relativePath, status: "skipped" as const };
      }

      await semaphore.acquire();
      try {
        const content = await client.getFileContent(parsed.owner, parsed.repo, remotePath, ref);
        await writeFileContent(localPath, content);
      } finally {
        semaphore.release();
      }

      const status = exists ? ("overwritten" as const) : ("created" as const);
      logger.debug(`Wrote: ${relativePath} (${status})`);
      return { relativePath, status };
    }),
  );

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
  semaphore: Semaphore;
}): Promise<Array<{ remotePath: string; relativePath: string; size: number }>> {
  const { client, owner, repo, basePath, ref, enabledFeatures, semaphore } = params;

  const tasks = enabledFeatures.flatMap((feature) =>
    FEATURE_PATHS[feature].map((featurePath) => ({ feature, featurePath })),
  );

  const results = await Promise.all(
    tasks.map(async ({ featurePath }) => {
      const fullPath =
        basePath === "." || basePath === "" ? featurePath : join(basePath, featurePath);
      const collected: Array<{ remotePath: string; relativePath: string; size: number }> = [];

      try {
        // Check if it's a file (mcp.json, .aiignore, hooks.json)
        if (featurePath.includes(".")) {
          // Try to get the file directly
          try {
            await semaphore.acquire();
            let entries: GitHubFileEntry[];
            try {
              entries = await client.listDirectory(
                owner,
                repo,
                basePath === "." || basePath === "" ? "." : basePath,
                ref,
              );
            } finally {
              semaphore.release();
            }
            const fileEntry = entries.find((e) => e.name === featurePath && e.type === "file");
            if (fileEntry) {
              collected.push({
                remotePath: fileEntry.path,
                relativePath: featurePath,
                size: fileEntry.size,
              });
            }
          } catch (error) {
            // Only skip 404 errors (file not found), re-throw other errors
            if (isNotFoundError(error)) {
              logger.debug(`File not found: ${fullPath}`);
            } else {
              throw error;
            }
          }
        } else {
          // It's a directory (rules/, commands/, skills/, subagents/)
          const dirFiles = await listDirectoryRecursive(
            client,
            owner,
            repo,
            fullPath,
            ref,
            0,
            semaphore,
          );

          for (const file of dirFiles) {
            // Calculate relative path from base
            const relativePath =
              basePath === "." || basePath === ""
                ? file.path
                : file.path.substring(basePath.length + 1);

            collected.push({
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
          return collected;
        }
        throw error;
      }

      return collected;
    }),
  );

  return results.flat();
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
  depth = 0,
  semaphore?: Semaphore,
): Promise<GitHubFileEntry[]> {
  if (depth > MAX_RECURSION_DEPTH) {
    throw new Error(
      `Maximum recursion depth (${MAX_RECURSION_DEPTH}) exceeded while listing directory: ${path}`,
    );
  }

  let entries: GitHubFileEntry[];
  if (semaphore) {
    await semaphore.acquire();
    try {
      entries = await client.listDirectory(owner, repo, path, ref);
    } finally {
      semaphore.release();
    }
  } else {
    entries = await client.listDirectory(owner, repo, path, ref);
  }

  const files: GitHubFileEntry[] = [];
  const directories: GitHubFileEntry[] = [];

  for (const entry of entries) {
    if (entry.type === "file") {
      files.push(entry);
    } else if (entry.type === "dir") {
      directories.push(entry);
    }
  }

  const subResults = await Promise.all(
    directories.map((dir) =>
      listDirectoryRecursive(client, owner, repo, dir.path, ref, depth + 1, semaphore),
    ),
  );

  return [...files, ...subResults.flat()];
}

/**
 * Fetch tool-specific files and convert them to rulesync format
 */
async function fetchAndConvertToolFiles(params: {
  client: GitHubClient;
  parsed: ParsedSource;
  ref: string;
  resolvedPath: string;
  enabledFeatures: Feature[];
  target: ToolTarget;
  outputDir: string;
  baseDir: string;
  conflictStrategy: ConflictStrategy;
}): Promise<FetchSummary> {
  const {
    client,
    parsed,
    ref,
    resolvedPath,
    enabledFeatures,
    target,
    outputDir,
    baseDir,
    conflictStrategy: _conflictStrategy,
  } = params;

  // Create a unique temporary directory
  const tempDir = await createTempDirectory();
  logger.debug(`Created temp directory: ${tempDir}`);

  // Create semaphore for concurrency control
  const semaphore = new Semaphore(FETCH_CONCURRENCY_LIMIT);

  try {
    // Collect files using rulesync feature paths (rules/, commands/, etc.)
    // External repos use these paths directly without tool-specific prefixes
    const filesToFetch = await collectFeatureFiles({
      client,
      owner: parsed.owner,
      repo: parsed.repo,
      basePath: resolvedPath,
      ref,
      enabledFeatures,
      semaphore,
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

    // Validate file sizes first
    for (const { relativePath, size } of filesToFetch) {
      if (size > MAX_FILE_SIZE) {
        throw new GitHubClientError(
          `File "${relativePath}" exceeds maximum size limit (${(size / 1024 / 1024).toFixed(2)}MB > ${MAX_FILE_SIZE / 1024 / 1024}MB)`,
        );
      }
    }

    // Fetch files to temp directory with tool-specific structure in parallel
    // Map rulesync paths to tool-specific paths
    const toolPaths = getToolPathMapping(target);

    await Promise.all(
      filesToFetch.map(async ({ remotePath, relativePath }) => {
        // Map the relative path to tool-specific structure
        const toolRelativePath = mapToToolPath(relativePath, toolPaths);
        checkPathTraversal({
          relativePath: toolRelativePath,
          intendedRootDir: tempDir,
        });
        const localPath = join(tempDir, toolRelativePath);

        // Fetch and write file
        await semaphore.acquire();
        try {
          const content = await client.getFileContent(parsed.owner, parsed.repo, remotePath, ref);
          await writeFileContent(localPath, content);
        } finally {
          semaphore.release();
        }
        logger.debug(`Fetched to temp: ${toolRelativePath}`);
        return toolRelativePath;
      }),
    );

    // Convert fetched files to rulesync format
    const outputBasePath = join(baseDir, outputDir);
    const { converted, convertedPaths } = await convertFetchedFilesToRulesync({
      tempDir,
      outputDir: outputBasePath,
      target,
      features: enabledFeatures,
    });

    // Build results based on conversion with actual file paths
    const results: FetchFileResult[] = convertedPaths.map((relativePath) => ({
      relativePath,
      status: "created" as const,
    }));

    logger.info(`Converted ${converted} files from ${target} format to rulesync format`);

    return {
      source: `${parsed.owner}/${parsed.repo}`,
      ref,
      files: results,
      created: results.filter((r) => r.status === "created").length,
      overwritten: results.filter((r) => r.status === "overwritten").length,
      skipped: results.filter((r) => r.status === "skipped").length,
    };
  } finally {
    // Clean up temp directory
    await removeTempDirectory(tempDir);
  }
}

/**
 * Get tool-specific path mapping for a target
 * Returns a mapping from rulesync feature paths to tool-specific paths
 */
function getToolPathMapping(target: ToolTarget): {
  rules?: { root?: string; nonRoot?: string };
  commands?: string;
  subagents?: string;
  skills?: string;
} {
  // Get tool-specific paths from each processor class
  const mapping: {
    rules?: { root?: string; nonRoot?: string };
    commands?: string;
    subagents?: string;
    skills?: string;
  } = {};

  // Rules paths
  const supportedRulesTargets = RulesProcessor.getToolTargets({ global: false });
  if (supportedRulesTargets.includes(target)) {
    const factory = RulesProcessor.getFactory(target);
    if (factory) {
      const paths = factory.class.getSettablePaths({ global: false });
      mapping.rules = {
        root: paths.root?.relativeFilePath,
        nonRoot: paths.nonRoot?.relativeDirPath,
      };
    }
  }

  // Commands paths
  const supportedCommandsTargets = CommandsProcessor.getToolTargets({
    global: false,
    includeSimulated: false,
  });
  if (supportedCommandsTargets.includes(target)) {
    const factory = CommandsProcessor.getFactory(target);
    if (factory) {
      const paths = factory.class.getSettablePaths({ global: false });
      mapping.commands = paths.relativeDirPath;
    }
  }

  // Subagents paths
  const supportedSubagentsTargets = SubagentsProcessor.getToolTargets({
    global: false,
    includeSimulated: false,
  });
  if (supportedSubagentsTargets.includes(target)) {
    const factory = SubagentsProcessor.getFactory(target);
    if (factory) {
      const paths = factory.class.getSettablePaths({ global: false });
      mapping.subagents = paths.relativeDirPath;
    }
  }

  // Skills paths
  const supportedSkillsTargets = SkillsProcessor.getToolTargets({ global: false });
  if (supportedSkillsTargets.includes(target)) {
    const factory = SkillsProcessor.getFactory(target);
    if (factory) {
      const paths = factory.class.getSettablePaths({ global: false });
      mapping.skills = paths.relativeDirPath;
    }
  }

  return mapping;
}

/**
 * Map a rulesync-style relative path to tool-specific path
 */
function mapToToolPath(
  relativePath: string,
  toolPaths: ReturnType<typeof getToolPathMapping>,
): string {
  // Check if this is a rules file
  if (relativePath.startsWith("rules/")) {
    const restPath = relativePath.substring("rules/".length);
    if (toolPaths.rules?.nonRoot) {
      return join(toolPaths.rules.nonRoot, restPath);
    }
  }

  // Check if this is a root rule file (e.g., CLAUDE.md, AGENTS.md)
  if (toolPaths.rules?.root && relativePath === toolPaths.rules.root) {
    return relativePath;
  }

  // Check if this is a commands file
  if (relativePath.startsWith("commands/")) {
    const restPath = relativePath.substring("commands/".length);
    if (toolPaths.commands) {
      return join(toolPaths.commands, restPath);
    }
  }

  // Check if this is a subagents file
  if (relativePath.startsWith("subagents/")) {
    const restPath = relativePath.substring("subagents/".length);
    if (toolPaths.subagents) {
      return join(toolPaths.subagents, restPath);
    }
  }

  // Check if this is a skills file
  if (relativePath.startsWith("skills/")) {
    const restPath = relativePath.substring("skills/".length);
    if (toolPaths.skills) {
      return join(toolPaths.skills, restPath);
    }
  }

  // Default: return as-is
  return relativePath;
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
