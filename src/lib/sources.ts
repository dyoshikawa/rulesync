import { join, resolve, sep } from "node:path";

import { Semaphore } from "es-toolkit/promise";

import { type SourceEntry, resolveSourceFeatures } from "../config/config.js";
import {
  FETCH_CONCURRENCY_LIMIT,
  MAX_FILE_SIZE,
  RULESYNC_AIIGNORE_FILE_NAME,
  RULESYNC_HOOKS_FILE_NAME,
  RULESYNC_MCP_FILE_NAME,
  RULESYNC_SOURCES_RELATIVE_DIR_PATH,
} from "../constants/rulesync-paths.js";
import type { Feature } from "../types/features.js";
import { formatError } from "../utils/error.js";
import {
  checkPathTraversal,
  directoryExists,
  ensureDir,
  removeDirectory,
  writeFileContent,
} from "../utils/file.js";
import { logger } from "../utils/logger.js";
import {
  GitClientError,
  fetchSourceCacheFiles,
  resolveDefaultRef,
  resolveRefToSha,
  validateRef,
} from "./git-client.js";
import { GitHubClient, GitHubClientError, logGitHubAuthHints } from "./github-client.js";
import { listDirectoryRecursive, withSemaphore } from "./github-utils.js";
import { sourceKeyToDirName } from "./source-cache.js";
import { parseSource } from "./source-parser.js";
import {
  type LockedFile,
  type LockedSource,
  type SourcesLock,
  computeFileIntegrity,
  createEmptyLock,
  getLockedSource,
  normalizeSourceKey,
  readLockFile,
  setLockedSource,
  writeLockFile,
} from "./sources-lock.js";

// ---------------------------------------------------------------------------
// Feature path mapping
// ---------------------------------------------------------------------------

/** Directory features whose remote content lives under a subdirectory. */
const DIRECTORY_FEATURES: Feature[] = ["skills", "rules", "commands", "subagents"];

/** File features whose remote content is a single file. */
const FILE_FEATURES: Record<Feature, string> = {
  mcp: RULESYNC_MCP_FILE_NAME,
  hooks: RULESYNC_HOOKS_FILE_NAME,
  ignore: RULESYNC_AIIGNORE_FILE_NAME,
  // Directory features don't use this mapping
  skills: "",
  rules: "",
  commands: "",
  subagents: "",
};

/**
 * Check if a relative path belongs to any of the requested features.
 * Used to filter out files that sparse checkout may include from sibling
 * directories when the basePath is a parent of multiple feature dirs.
 */
function isPathInFeatures(relativePath: string, features: Feature[]): boolean {
  for (const feature of features) {
    if (DIRECTORY_FEATURES.includes(feature)) {
      if (relativePath.startsWith(feature + "/")) return true;
    } else {
      if (relativePath === FILE_FEATURES[feature]) return true;
    }
  }
  return false;
}

/** Map a feature to its remote path(s) relative to the source root. */
function featureToRemotePath(feature: Feature): string {
  if (DIRECTORY_FEATURES.includes(feature)) {
    return feature;
  }
  return FILE_FEATURES[feature];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type ResolveAndFetchSourcesOptions = {
  /** Force re-resolve all refs, ignoring the lockfile. */
  updateSources?: boolean;
  /** Skip fetching entirely (use what's already on disk). */
  skipSources?: boolean;
  /** Fail if lockfile is missing or doesn't match sources (for CI). */
  frozen?: boolean;
  /** GitHub token for private repositories. */
  token?: string;
};

export type ResolveAndFetchSourcesResult = {
  fetchedFileCount: number;
  sourcesProcessed: number;
};

/**
 * Resolve declared sources, fetch remote content into .rulesync/.sources/,
 * and update the lockfile.
 */
export async function resolveAndFetchSources(params: {
  sources: SourceEntry[];
  baseDir: string;
  options?: ResolveAndFetchSourcesOptions;
}): Promise<ResolveAndFetchSourcesResult> {
  const { sources, baseDir, options = {} } = params;

  if (sources.length === 0) {
    return { fetchedFileCount: 0, sourcesProcessed: 0 };
  }

  if (options.skipSources) {
    logger.info("Skipping source fetching.");
    return { fetchedFileCount: 0, sourcesProcessed: 0 };
  }

  // Read existing lockfile
  let lock: SourcesLock = options.updateSources
    ? createEmptyLock()
    : await readLockFile({ baseDir });

  // Frozen mode: validate lockfile covers all declared sources
  if (options.frozen) {
    const missingKeys: string[] = [];
    for (const source of sources) {
      if (!getLockedSource(lock, source.source)) {
        missingKeys.push(source.source);
      }
    }
    if (missingKeys.length > 0) {
      throw new Error(
        `Frozen install failed: lockfile is missing entries for: ${missingKeys.join(", ")}. Run 'rulesync install' to update the lockfile.`,
      );
    }
  }

  const originalLockJson = JSON.stringify(lock);

  // Resolve GitHub token
  const token = GitHubClient.resolveToken(options.token);
  const client = new GitHubClient({ token });

  let totalFileCount = 0;

  for (const sourceEntry of sources) {
    try {
      const transport = sourceEntry.transport ?? "github";
      let result: { fileCount: number; updatedLock: SourcesLock };
      if (transport === "git") {
        result = await fetchSourceViaGit({
          sourceEntry,
          baseDir,
          lock,
          updateSources: options.updateSources ?? false,
          frozen: options.frozen ?? false,
        });
      } else {
        result = await fetchSourceViaGitHub({
          sourceEntry,
          client,
          baseDir,
          lock,
          updateSources: options.updateSources ?? false,
        });
      }

      lock = result.updatedLock;
      totalFileCount += result.fileCount;
    } catch (error) {
      logger.error(`Failed to fetch source "${sourceEntry.source}": ${formatError(error)}`);
      if (error instanceof GitHubClientError) {
        logGitHubAuthHints(error);
      } else if (error instanceof GitClientError) {
        logGitClientHints(error);
      }
    }
  }

  // Prune stale lockfile entries
  const sourceKeys = new Set(sources.map((s) => normalizeSourceKey(s.source)));
  const prunedSources: typeof lock.sources = {};
  for (const [key, value] of Object.entries(lock.sources)) {
    if (sourceKeys.has(normalizeSourceKey(key))) {
      prunedSources[key] = value;
    } else {
      logger.debug(`Pruned stale lockfile entry: ${key}`);
    }
  }
  lock = { lockfileVersion: lock.lockfileVersion, sources: prunedSources };

  // Only write lockfile if it has changed (and not in frozen mode)
  if (!options.frozen && JSON.stringify(lock) !== originalLockJson) {
    await writeLockFile({ baseDir, lock });
  } else {
    logger.debug("Lockfile unchanged, skipping write.");
  }

  return { fetchedFileCount: totalFileCount, sourcesProcessed: sources.length };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function logGitClientHints(error: GitClientError): void {
  if (error.message.includes("not installed")) {
    logger.info("Hint: Install git and ensure it is available on your PATH.");
  } else {
    logger.info("Hint: Check your git credentials (SSH keys, credential helper, or access token).");
  }
}

/**
 * Check if a source cache directory exists on disk.
 */
async function sourceCacheExists(baseDir: string, sourceKey: string): Promise<boolean> {
  const cachePath = join(
    baseDir,
    RULESYNC_SOURCES_RELATIVE_DIR_PATH,
    sourceKeyToDirName(sourceKey),
  );
  return directoryExists(cachePath);
}

/**
 * Clean and recreate a source cache directory.
 */
async function cleanSourceCache(params: { baseDir: string; sourceKey: string }): Promise<string> {
  const cachePath = join(
    params.baseDir,
    RULESYNC_SOURCES_RELATIVE_DIR_PATH,
    sourceKeyToDirName(params.sourceKey),
  );
  const resolvedCachePath = resolve(cachePath);
  const resolvedSourcesDir = resolve(join(params.baseDir, RULESYNC_SOURCES_RELATIVE_DIR_PATH));
  if (!resolvedCachePath.startsWith(resolvedSourcesDir + sep)) {
    throw new Error(`Source cache path "${cachePath}" escapes the sources directory.`);
  }
  if (await directoryExists(cachePath)) {
    await removeDirectory(cachePath);
  }
  await ensureDir(cachePath);
  return cachePath;
}

/**
 * Write a file to the source cache and compute its integrity.
 */
async function writeAndTrackFile(params: {
  cachePath: string;
  relativePath: string;
  content: string;
  locked: LockedSource | undefined;
  resolvedSha: string;
  sourceKey: string;
}): Promise<{ relativePath: string; integrity: string }> {
  const { cachePath, relativePath, content, locked, resolvedSha, sourceKey } = params;

  checkPathTraversal({ relativePath, intendedRootDir: cachePath });
  await writeFileContent(join(cachePath, relativePath), content);

  const integrity = computeFileIntegrity(content);
  const lockedEntry = locked?.files[relativePath];
  if (
    lockedEntry?.integrity &&
    lockedEntry.integrity !== integrity &&
    resolvedSha === locked?.resolvedRef
  ) {
    logger.warn(
      `Integrity mismatch for "${relativePath}" from ${sourceKey}: expected "${lockedEntry.integrity}", got "${integrity}".`,
    );
  }

  return { relativePath, integrity };
}

// ---------------------------------------------------------------------------
// GitHub API transport
// ---------------------------------------------------------------------------

async function fetchSourceViaGitHub(params: {
  sourceEntry: SourceEntry;
  client: GitHubClient;
  baseDir: string;
  lock: SourcesLock;
  updateSources: boolean;
}): Promise<{ fileCount: number; updatedLock: SourcesLock }> {
  const { sourceEntry, client, baseDir, updateSources } = params;
  const { lock } = params;

  const parsed = parseSource(sourceEntry.source);
  if (parsed.provider === "gitlab") {
    logger.warn(`GitLab sources are not yet supported. Skipping "${sourceEntry.source}".`);
    return { fileCount: 0, updatedLock: lock };
  }

  const sourceKey = sourceEntry.source;
  const locked = getLockedSource(lock, sourceKey);
  const features = resolveSourceFeatures(sourceEntry);

  // Resolve the ref to a commit SHA
  let ref: string;
  let resolvedSha: string;
  let requestedRef: string | undefined;

  if (locked && !updateSources) {
    ref = locked.resolvedRef;
    resolvedSha = locked.resolvedRef;
    requestedRef = locked.requestedRef;
    logger.debug(`Using locked ref for ${sourceKey}: ${resolvedSha}`);
  } else {
    requestedRef = parsed.ref ?? (await client.getDefaultBranch(parsed.owner, parsed.repo));
    resolvedSha = await client.resolveRefToSha(parsed.owner, parsed.repo, requestedRef);
    ref = resolvedSha;
    logger.debug(`Resolved ${sourceKey} ref "${requestedRef}" to SHA: ${resolvedSha}`);
  }

  // Skip re-fetch if SHA matches and cache exists
  if (locked && resolvedSha === locked.resolvedRef && !updateSources) {
    if (await sourceCacheExists(baseDir, sourceKey)) {
      logger.debug(`SHA unchanged for ${sourceKey}, skipping re-fetch.`);
      return { fileCount: 0, updatedLock: lock };
    }
  }

  // Clean and prepare cache directory
  const cachePath = await cleanSourceCache({ baseDir, sourceKey });
  const semaphore = new Semaphore(FETCH_CONCURRENCY_LIMIT);
  const files: Record<string, LockedFile> = {};
  const basePath = parsed.path;
  const skillFilter = sourceEntry.skills ?? ["*"];
  const isSkillWildcard = skillFilter.length === 1 && skillFilter[0] === "*";

  for (const feature of features) {
    const remotePath = basePath
      ? join(basePath, featureToRemotePath(feature))
      : featureToRemotePath(feature);

    if (DIRECTORY_FEATURES.includes(feature)) {
      // Directory feature: list and fetch subdirectories/files
      try {
        const entries = await client.listDirectory(parsed.owner, parsed.repo, remotePath, ref);

        if (feature === "skills") {
          // Skills: each entry is a subdirectory
          const skillDirs = entries
            .filter((e) => e.type === "dir")
            .filter((d) => isSkillWildcard || skillFilter.includes(d.name));

          for (const skillDir of skillDirs) {
            const allFiles = await listDirectoryRecursive({
              client,
              owner: parsed.owner,
              repo: parsed.repo,
              path: skillDir.path,
              ref,
              semaphore,
            });

            for (const file of allFiles) {
              if (file.size > MAX_FILE_SIZE) {
                logger.warn(
                  `Skipping file "${file.path}" (${(file.size / 1024 / 1024).toFixed(2)}MB exceeds limit).`,
                );
                continue;
              }
              const content = await withSemaphore(semaphore, () =>
                client.getFileContent(parsed.owner, parsed.repo, file.path, ref),
              );
              const relPath = join(
                "skills",
                skillDir.name,
                file.path.substring(skillDir.path.length + 1),
              );
              const result = await writeAndTrackFile({
                cachePath,
                relativePath: relPath,
                content,
                locked,
                resolvedSha,
                sourceKey,
              });
              files[result.relativePath] = { integrity: result.integrity };
            }
          }
        } else {
          // rules/commands/subagents: each entry is a file
          const fileEntries = entries.filter((e) => e.type === "file");
          for (const fileEntry of fileEntries) {
            if (fileEntry.size && fileEntry.size > MAX_FILE_SIZE) {
              logger.warn(`Skipping file "${fileEntry.path}" (exceeds size limit).`);
              continue;
            }
            const content = await withSemaphore(semaphore, () =>
              client.getFileContent(parsed.owner, parsed.repo, fileEntry.path, ref),
            );
            const relPath = join(feature, fileEntry.name);
            const result = await writeAndTrackFile({
              cachePath,
              relativePath: relPath,
              content,
              locked,
              resolvedSha,
              sourceKey,
            });
            files[result.relativePath] = { integrity: result.integrity };
          }
        }
      } catch (error) {
        if (error instanceof GitHubClientError && error.statusCode === 404) {
          logger.debug(`No ${feature}/ directory found in ${sourceKey}.`);
          continue;
        }
        throw error;
      }
    } else {
      // Single-file feature (mcp.json, hooks.json, .aiignore)
      try {
        const content = await withSemaphore(semaphore, () =>
          client.getFileContent(parsed.owner, parsed.repo, remotePath, ref),
        );
        const fileName = FILE_FEATURES[feature];
        const result = await writeAndTrackFile({
          cachePath,
          relativePath: fileName,
          content,
          locked,
          resolvedSha,
          sourceKey,
        });
        files[result.relativePath] = { integrity: result.integrity };
      } catch (error) {
        if (error instanceof GitHubClientError && error.statusCode === 404) {
          logger.debug(`No ${featureToRemotePath(feature)} found in ${sourceKey}.`);
          continue;
        }
        throw error;
      }
    }
  }

  const fileCount = Object.keys(files).length;
  const updatedLock = setLockedSource(lock, sourceKey, {
    requestedRef,
    resolvedRef: resolvedSha,
    resolvedAt: new Date().toISOString(),
    files,
  });

  logger.info(`Fetched ${fileCount} file(s) from ${sourceKey}.`);
  return { fileCount, updatedLock };
}

// ---------------------------------------------------------------------------
// Git CLI transport
// ---------------------------------------------------------------------------

async function fetchSourceViaGit(params: {
  sourceEntry: SourceEntry;
  baseDir: string;
  lock: SourcesLock;
  updateSources: boolean;
  frozen: boolean;
}): Promise<{ fileCount: number; updatedLock: SourcesLock }> {
  const { sourceEntry, baseDir, updateSources, frozen } = params;
  const { lock } = params;
  const url = sourceEntry.source;
  const locked = getLockedSource(lock, url);
  const features = resolveSourceFeatures(sourceEntry);

  // Resolve ref
  let resolvedSha: string;
  let requestedRef: string | undefined;
  if (locked && !updateSources) {
    resolvedSha = locked.resolvedRef;
    requestedRef = locked.requestedRef;
    if (requestedRef) {
      validateRef(requestedRef);
    }
  } else if (sourceEntry.ref) {
    requestedRef = sourceEntry.ref;
    resolvedSha = await resolveRefToSha(url, requestedRef);
  } else {
    const def = await resolveDefaultRef(url);
    requestedRef = def.ref;
    resolvedSha = def.sha;
  }

  // Skip re-fetch if SHA matches and cache exists
  if (locked && resolvedSha === locked.resolvedRef && !updateSources) {
    if (await sourceCacheExists(baseDir, url)) {
      return { fileCount: 0, updatedLock: lock };
    }
  }

  // Resolve requestedRef lazily if needed
  if (!requestedRef) {
    if (frozen) {
      throw new Error(
        `Frozen install failed: lockfile entry for "${url}" is missing requestedRef. Run 'rulesync install' to update the lockfile.`,
      );
    }
    const def = await resolveDefaultRef(url);
    requestedRef = def.ref;
    resolvedSha = def.sha;
  }

  // Build paths to fetch via sparse checkout
  const remotePaths = features.map((f) => featureToRemotePath(f));
  const remoteFiles = await fetchSourceCacheFiles({
    url,
    ref: requestedRef,
    paths: remotePaths,
    basePath: sourceEntry.path,
  });

  // Clean and prepare cache directory
  const cachePath = await cleanSourceCache({ baseDir, sourceKey: url });
  const files: Record<string, LockedFile> = {};

  // Apply skill filter
  const skillFilter = sourceEntry.skills ?? ["*"];
  const isSkillWildcard = skillFilter.length === 1 && skillFilter[0] === "*";

  for (const file of remoteFiles) {
    // Filter out files that don't belong to the requested features.
    // Sparse checkout from a basePath may include sibling files.
    if (!isPathInFeatures(file.relativePath, features)) {
      continue;
    }

    // Apply skill filter for skills
    if (file.relativePath.startsWith("skills/")) {
      const parts = file.relativePath.split("/");
      const skillName = parts[1];
      if (skillName && !isSkillWildcard && !skillFilter.includes(skillName)) {
        continue;
      }
    }

    const result = await writeAndTrackFile({
      cachePath,
      relativePath: file.relativePath,
      content: file.content,
      locked,
      resolvedSha,
      sourceKey: url,
    });
    files[result.relativePath] = { integrity: result.integrity };
  }

  const fileCount = Object.keys(files).length;
  const updatedLock = setLockedSource(lock, url, {
    requestedRef,
    resolvedRef: resolvedSha,
    resolvedAt: new Date().toISOString(),
    files,
  });

  logger.info(`Fetched ${fileCount} file(s) from ${url}.`);
  return { fileCount, updatedLock };
}
