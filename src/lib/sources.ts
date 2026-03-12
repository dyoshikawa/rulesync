import { basename, join, resolve, sep } from "node:path";

import { Semaphore } from "es-toolkit/promise";

import { type SourceEntry, resolveSourceFeatures } from "../config/config.js";
import {
  FEATURE_LOCAL_DIR_PATHS,
  FEATURE_REMOTE_DIR_PATHS,
  FEATURE_REMOTE_SUBDIR_NAMES,
  FEATURE_SOURCE_DIR_NAMES,
  FETCH_CONCURRENCY_LIMIT,
  MAX_FILE_SIZE,
} from "../constants/rulesync-paths.js";
import { ALL_DIRECTORY_FEATURES, type DirectoryFeature } from "../types/features.js";
import { formatError } from "../utils/error.js";
import {
  checkPathTraversal,
  directoryExists,
  fileExists,
  findFilesByGlobs,
  removeDirectory,
  removeFile,
  writeFileContent,
} from "../utils/file.js";
import { logger } from "../utils/logger.js";
import {
  GitClientError,
  fetchDirectoryFiles,
  resolveDefaultRef,
  resolveRefToSha,
  validateRef,
} from "./git-client.js";
import { GitHubClient, GitHubClientError, logGitHubAuthHints } from "./github-client.js";
import { listDirectoryRecursive, withSemaphore } from "./github-utils.js";
import { parseSource } from "./source-parser.js";
import {
  type LockedItem,
  type LockedSource,
  type SourcesLock,
  computeItemIntegrity,
  createEmptyLock,
  getLockedFeatureItems,
  getLockedFeatureNames,
  getLockedSource,
  normalizeSourceKey,
  readLockFile,
  setLockedSource,
  writeLockFile,
} from "./sources-lock.js";

/**
 * Features where each item is a subdirectory (e.g. skills/my-skill/SKILL.md).
 * All other directory features are file-based (e.g. rules/my-rule.md).
 */
const SUBDIRECTORY_ITEM_FEATURES = new Set<string>(["skills"]);

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
  /** @deprecated Use fetchedItemCount instead. */
  fetchedSkillCount: number;
  fetchedItemCount: number;
  sourcesProcessed: number;
};

/**
 * Resolve declared sources, fetch remote items into their respective remote directories,
 * and update the lockfile.
 */
export async function resolveAndFetchSources(params: {
  sources: SourceEntry[];
  baseDir: string;
  options?: ResolveAndFetchSourcesOptions;
}): Promise<ResolveAndFetchSourcesResult> {
  const { sources, baseDir, options = {} } = params;

  if (sources.length === 0) {
    return { fetchedSkillCount: 0, fetchedItemCount: 0, sourcesProcessed: 0 };
  }

  if (options.skipSources) {
    logger.info("Skipping source fetching.");
    return { fetchedSkillCount: 0, fetchedItemCount: 0, sourcesProcessed: 0 };
  }

  // Read existing lockfile
  let lock: SourcesLock = options.updateSources
    ? createEmptyLock()
    : await readLockFile({ baseDir });

  // Frozen mode: validate lockfile covers all declared sources.
  if (options.frozen) {
    const missingKeys: string[] = [];

    for (const source of sources) {
      const locked = getLockedSource(lock, source.source);
      if (!locked) {
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

  // Determine local item names per feature
  const localNames = await getLocalItemNames(baseDir);

  let totalItemCount = 0;
  let totalSkillCount = 0;
  const allFetchedNames: Record<string, Set<string>> = {};

  for (const sourceEntry of sources) {
    try {
      const transport = sourceEntry.transport ?? "github";
      const features = resolveSourceFeatures(sourceEntry);
      let result: FetchResult;
      if (transport === "git") {
        result = await fetchSourceViaGit({
          sourceEntry,
          features,
          baseDir,
          lock,
          localNames,
          allFetchedNames,
          updateSources: options.updateSources ?? false,
          frozen: options.frozen ?? false,
        });
      } else {
        result = await fetchSource({
          sourceEntry,
          features,
          client,
          baseDir,
          lock,
          localNames,
          allFetchedNames,
          updateSources: options.updateSources ?? false,
        });
      }

      lock = result.updatedLock;
      totalItemCount += result.itemCount;
      totalSkillCount += result.skillCount;
      for (const [feature, names] of Object.entries(result.fetchedNames)) {
        const set = allFetchedNames[feature] ?? new Set<string>();
        for (const name of names) {
          set.add(name);
        }
        allFetchedNames[feature] = set;
      }
    } catch (error) {
      logger.error(`Failed to fetch source "${sourceEntry.source}": ${formatError(error)}`);
      if (error instanceof GitHubClientError) {
        logGitHubAuthHints(error);
      } else if (error instanceof GitClientError) {
        logGitClientHints(error);
      }
    }
  }

  // Prune stale lockfile entries whose keys are not in the current sources
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

  return {
    fetchedSkillCount: totalSkillCount,
    fetchedItemCount: totalItemCount,
    sourcesProcessed: sources.length,
  };
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

type FetchResult = {
  itemCount: number;
  skillCount: number;
  fetchedNames: Record<string, string[]>;
  updatedLock: SourcesLock;
};

// ---------------------------------------------------------------------------
// Local item detection
// ---------------------------------------------------------------------------

/**
 * Get local item directory names for all directory features.
 * Local items are those in the feature directory but NOT in the remote subdirectory.
 */
async function getLocalItemNames(baseDir: string): Promise<Record<string, Set<string>>> {
  const result: Record<string, Set<string>> = {};
  for (const feature of ALL_DIRECTORY_FEATURES) {
    const localDir = FEATURE_LOCAL_DIR_PATHS[feature];
    const fullDir = join(baseDir, localDir);
    const names = new Set<string>();
    if (await directoryExists(fullDir)) {
      const remoteDirName = FEATURE_REMOTE_SUBDIR_NAMES[feature];
      if (SUBDIRECTORY_ITEM_FEATURES.has(feature)) {
        // Skills: each item is a subdirectory
        const dirPaths = await findFilesByGlobs(join(fullDir, "*"), { type: "dir" });
        for (const dirPath of dirPaths) {
          const name = basename(dirPath);
          if (name !== remoteDirName) {
            names.add(name);
          }
        }
      } else {
        // File-based features (rules, commands, subagents): each item is a .md file
        const filePaths = await findFilesByGlobs(join(fullDir, "*.md"));
        for (const filePath of filePaths) {
          names.add(basename(filePath));
        }
      }
    }
    result[feature] = names;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Log contextual hints for GitClientError to help users troubleshoot.
 */
function logGitClientHints(error: GitClientError): void {
  if (error.message.includes("not installed")) {
    logger.info("Hint: Install git and ensure it is available on your PATH.");
  } else {
    logger.info("Hint: Check your git credentials (SSH keys, credential helper, or access token).");
  }
}

/**
 * Check if all locked items exist on disk in the remote directory.
 * For subdirectory-item features (skills), checks for directories.
 * For file-item features (rules, commands, subagents), checks for files.
 */
async function checkLockedItemsExist(
  remoteDir: string,
  itemNames: string[],
  feature: string,
): Promise<boolean> {
  if (itemNames.length === 0) return true;
  const isSubdirFeature = SUBDIRECTORY_ITEM_FEATURES.has(feature);
  for (const name of itemNames) {
    const path = join(remoteDir, name);
    const exists = isSubdirFeature ? await directoryExists(path) : await fileExists(path);
    if (!exists) return false;
  }
  return true;
}

/**
 * Remove previously fetched remote items for a source before re-fetching.
 * For subdirectory-item features, removes directories.
 * For file-item features, removes individual files.
 * Validates that each path resolves within the remote directory to prevent traversal.
 */
async function cleanPreviousRemoteItems(
  remoteDir: string,
  lockedItemNames: string[],
  feature: string,
): Promise<void> {
  const resolvedRemoteDir = resolve(remoteDir);
  const isSubdirFeature = SUBDIRECTORY_ITEM_FEATURES.has(feature);
  for (const prevItem of lockedItemNames) {
    const prevPath = join(remoteDir, prevItem);
    if (!resolve(prevPath).startsWith(resolvedRemoteDir + sep)) {
      logger.warn(
        `Skipping removal of "${prevItem}": resolved path is outside the remote directory.`,
      );
      continue;
    }
    if (isSubdirFeature) {
      if (await directoryExists(prevPath)) {
        await removeDirectory(prevPath);
      }
    } else {
      if (await fileExists(prevPath)) {
        await removeFile(prevPath);
      }
    }
  }
}

/**
 * Check whether an item should be skipped during fetching.
 * Returns true (with appropriate logging) if the item should be skipped.
 */
function shouldSkipItem(params: {
  itemName: string;
  feature: string;
  sourceKey: string;
  localNames: Set<string>;
  alreadyFetchedNames: Set<string>;
}): boolean {
  const { itemName, feature, sourceKey, localNames, alreadyFetchedNames } = params;
  if (itemName.includes("..") || itemName.includes("/") || itemName.includes("\\")) {
    logger.warn(
      `Skipping ${feature} item with invalid name "${itemName}" from ${sourceKey}: contains path traversal characters.`,
    );
    return true;
  }
  if (localNames.has(itemName)) {
    logger.debug(
      `Skipping remote ${feature} "${itemName}" from ${sourceKey}: local item takes precedence.`,
    );
    return true;
  }
  if (alreadyFetchedNames.has(itemName)) {
    logger.warn(
      `Skipping duplicate ${feature} "${itemName}" from ${sourceKey}: already fetched from another source.`,
    );
    return true;
  }
  return false;
}

/**
 * Write item files to disk, compute integrity, and check against the lockfile.
 * Returns the computed LockedItem entry.
 */
async function writeItemAndComputeIntegrity(params: {
  itemName: string;
  feature: string;
  files: Array<{ relativePath: string; content: string }>;
  remoteDir: string;
  locked: LockedSource | undefined;
  resolvedSha: string;
  sourceKey: string;
}): Promise<LockedItem> {
  const { itemName, feature, files, remoteDir, locked, resolvedSha, sourceKey } = params;
  const written: Array<{ path: string; content: string }> = [];

  for (const file of files) {
    checkPathTraversal({
      relativePath: file.relativePath,
      intendedRootDir: join(remoteDir, itemName),
    });
    await writeFileContent(join(remoteDir, itemName, file.relativePath), file.content);
    written.push({ path: file.relativePath, content: file.content });
  }

  const integrity = computeItemIntegrity(written);
  const lockedItems = locked ? getLockedFeatureItems(locked, feature) : {};
  const lockedEntry = lockedItems[itemName];
  if (
    lockedEntry?.integrity &&
    lockedEntry.integrity !== integrity &&
    resolvedSha === locked?.resolvedRef
  ) {
    logger.warn(
      `Integrity mismatch for ${feature} "${itemName}" from ${sourceKey}: expected "${lockedEntry.integrity}", got "${integrity}". Content may have been tampered with.`,
    );
  }

  return { integrity };
}

/**
 * Write a single file item to disk, compute integrity, and check against the lockfile.
 * Used for file-based features (rules, commands, subagents) where each file is its own item.
 */
async function writeFileItemAndComputeIntegrity(params: {
  filePath: string;
  content: string;
  remoteDir: string;
  feature: string;
  locked: LockedSource | undefined;
  resolvedSha: string;
  sourceKey: string;
}): Promise<LockedItem> {
  const { filePath, content, remoteDir, feature, locked, resolvedSha, sourceKey } = params;

  checkPathTraversal({
    relativePath: filePath,
    intendedRootDir: remoteDir,
  });
  await writeFileContent(join(remoteDir, filePath), content);

  const integrity = computeItemIntegrity([{ path: filePath, content }]);
  const lockedItems = locked ? getLockedFeatureItems(locked, feature) : {};
  const lockedEntry = lockedItems[filePath];
  if (
    lockedEntry?.integrity &&
    lockedEntry.integrity !== integrity &&
    resolvedSha === locked?.resolvedRef
  ) {
    logger.warn(
      `Integrity mismatch for ${feature} "${filePath}" from ${sourceKey}: expected "${lockedEntry.integrity}", got "${integrity}". Content may have been tampered with.`,
    );
  }

  return { integrity };
}

/**
 * Build a per-feature lockfile update.
 * Merges newly fetched items with existing locked items and returns the updated lock.
 */
function buildFeatureLockItems(params: {
  feature: string;
  fetchedItems: Record<string, LockedItem>;
  locked: LockedSource | undefined;
  remoteItemNames: string[];
}): Record<string, LockedItem> {
  const { feature, fetchedItems, locked, remoteItemNames } = params;

  // Merge back locked items that still exist in the remote but were skipped
  const remoteSet = new Set(remoteItemNames);
  const merged: Record<string, LockedItem> = { ...fetchedItems };
  if (locked) {
    const lockedItems = getLockedFeatureItems(locked, feature);
    for (const [name, entry] of Object.entries(lockedItems)) {
      if (!(name in merged) && remoteSet.has(name)) {
        merged[name] = entry;
      }
    }
  }

  return merged;
}

/**
 * Build the complete lock update for a source across all features.
 */
function buildLockUpdate(params: {
  lock: SourcesLock;
  sourceKey: string;
  features: DirectoryFeature[];
  perFeatureFetched: Record<string, Record<string, LockedItem>>;
  perFeatureRemoteNames: Record<string, string[]>;
  locked: LockedSource | undefined;
  requestedRef: string | undefined;
  resolvedSha: string;
}): { updatedLock: SourcesLock; fetchedNames: Record<string, string[]>; totalCount: number } {
  const {
    lock,
    sourceKey,
    features,
    perFeatureFetched,
    perFeatureRemoteNames,
    locked,
    requestedRef,
    resolvedSha,
  } = params;

  const lockedEntry: LockedSource = {
    requestedRef,
    resolvedRef: resolvedSha,
    resolvedAt: new Date().toISOString(),
    skills: locked?.skills ?? {},
  };

  const fetchedNames: Record<string, string[]> = {};
  let totalCount = 0;

  for (const feature of features) {
    const featureItems = buildFeatureLockItems({
      feature,
      fetchedItems: perFeatureFetched[feature] ?? {},
      locked,
      remoteItemNames: perFeatureRemoteNames[feature] ?? [],
    });

    const names = Object.keys(perFeatureFetched[feature] ?? {});
    fetchedNames[feature] = names;
    totalCount += names.length;

    // Set the feature's items on the locked entry
    lockedEntry[feature] = featureItems;

    if (names.length > 0) {
      logger.info(
        `Fetched ${names.length} ${feature} item(s) from ${sourceKey}: ${names.join(", ")}`,
      );
    }
  }

  const updatedLock = setLockedSource(lock, sourceKey, lockedEntry);
  return { updatedLock, fetchedNames, totalCount };
}

/** Look up a feature key in a map, throwing if missing. */
function requireFeaturePath(map: Record<string, string>, feature: string, mapName: string): string {
  const value = map[feature];
  if (value === undefined) {
    throw new Error(`Unknown feature "${feature}" in ${mapName}`);
  }
  return value;
}

/**
 * Resolve the remote directory path for a feature within a source entry.
 * When the source has explicit features, path is a base directory.
 * When no features are specified (skills-only backward compat), path IS the skills directory.
 */
function resolveRemoteFeaturePath(
  feature: string,
  sourceEntry: SourceEntry,
  hasExplicitFeatures: boolean,
): string {
  const sourceDirName = requireFeaturePath(
    FEATURE_SOURCE_DIR_NAMES,
    feature,
    "FEATURE_SOURCE_DIR_NAMES",
  );
  if (hasExplicitFeatures) {
    // Features explicitly set: path is a base, feature dir is underneath
    const basePath = sourceEntry.path ?? "";
    return basePath ? `${basePath}/${sourceDirName}` : sourceDirName;
  }
  // No explicit features (skills-only backward compat): path IS the feature dir
  return sourceEntry.path ?? sourceDirName;
}

// ---------------------------------------------------------------------------
// Transport: GitHub REST API
// ---------------------------------------------------------------------------

/**
 * Fetch items from a single source entry via the GitHub REST API.
 */
async function fetchSource(params: {
  sourceEntry: SourceEntry;
  features: DirectoryFeature[];
  client: GitHubClient;
  baseDir: string;
  lock: SourcesLock;
  localNames: Record<string, Set<string>>;
  allFetchedNames: Record<string, Set<string>>;
  updateSources: boolean;
}): Promise<FetchResult> {
  const { sourceEntry, features, client, baseDir, localNames, allFetchedNames, updateSources } =
    params;
  const { lock } = params;

  const parsed = parseSource(sourceEntry.source);

  if (parsed.provider === "gitlab") {
    logger.warn(`GitLab sources are not yet supported. Skipping "${sourceEntry.source}".`);
    return { itemCount: 0, skillCount: 0, fetchedNames: {}, updatedLock: lock };
  }

  const sourceKey = sourceEntry.source;
  const locked = getLockedSource(lock, sourceKey);
  const hasExplicitFeatures = sourceEntry.features !== undefined && sourceEntry.features.length > 0;

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

  // Check if we can skip re-fetch (all features up-to-date on disk)
  if (locked && resolvedSha === locked.resolvedRef && !updateSources) {
    let allExist = true;
    for (const feature of features) {
      const remoteDir = join(
        baseDir,
        requireFeaturePath(FEATURE_REMOTE_DIR_PATHS, feature, "FEATURE_REMOTE_DIR_PATHS"),
      );
      const lockedNames = getLockedFeatureNames(locked, feature);
      if (!(await checkLockedItemsExist(remoteDir, lockedNames, feature))) {
        allExist = false;
        break;
      }
    }
    if (allExist) {
      logger.debug(`SHA unchanged for ${sourceKey}, skipping re-fetch.`);
      const fetchedNames: Record<string, string[]> = {};
      for (const feature of features) {
        fetchedNames[feature] = getLockedFeatureNames(locked, feature);
      }
      return { itemCount: 0, skillCount: 0, fetchedNames, updatedLock: lock };
    }
  }

  const skillFilter = sourceEntry.skills ?? ["*"];
  const isSkillWildcard = skillFilter.length === 1 && skillFilter[0] === "*";
  const semaphore = new Semaphore(FETCH_CONCURRENCY_LIMIT);
  const perFeatureFetched: Record<string, Record<string, LockedItem>> = {};
  const perFeatureRemoteNames: Record<string, string[]> = {};

  for (const feature of features) {
    const remoteDir = join(
      baseDir,
      requireFeaturePath(FEATURE_REMOTE_DIR_PATHS, feature, "FEATURE_REMOTE_DIR_PATHS"),
    );
    const featureLocalNames = localNames[feature] ?? new Set<string>();
    const featureAlreadyFetched = allFetchedNames[feature] ?? new Set<string>();
    const lockedItemNames = locked ? getLockedFeatureNames(locked, feature) : [];
    const isSubdirFeature = SUBDIRECTORY_ITEM_FEATURES.has(feature);

    // Clean previous remote items
    if (locked) {
      await cleanPreviousRemoteItems(remoteDir, lockedItemNames, feature);
    }

    // Determine the remote path for this feature
    const remotePath = resolveRemoteFeaturePath(feature, sourceEntry, hasExplicitFeatures);

    // List the feature directory in the remote repo
    let entries: Array<{ name: string; path: string; type: string }>;
    try {
      entries = await client.listDirectory(parsed.owner, parsed.repo, remotePath, ref);
    } catch (error) {
      if (error instanceof GitHubClientError && error.statusCode === 404) {
        logger.debug(`No ${feature}/ directory found in ${sourceKey}. Skipping feature.`);
        perFeatureFetched[feature] = {};
        perFeatureRemoteNames[feature] = [];
        continue;
      }
      throw error;
    }

    const fetchedItems: Record<string, LockedItem> = {};

    if (isSubdirFeature) {
      // Skills: each item is a directory
      const remoteDirs = entries
        .filter((e) => e.type === "dir")
        .map((e) => ({ name: e.name, path: e.path }));

      const filteredDirs =
        feature === "skills" && !isSkillWildcard
          ? remoteDirs.filter((d) => skillFilter.includes(d.name))
          : remoteDirs;

      perFeatureRemoteNames[feature] = filteredDirs.map((d) => d.name);

      for (const itemDir of filteredDirs) {
        if (
          shouldSkipItem({
            itemName: itemDir.name,
            feature,
            sourceKey,
            localNames: featureLocalNames,
            alreadyFetchedNames: featureAlreadyFetched,
          })
        ) {
          continue;
        }

        const allFiles = await listDirectoryRecursive({
          client,
          owner: parsed.owner,
          repo: parsed.repo,
          path: itemDir.path,
          ref,
          semaphore,
        });

        const files = allFiles.filter((file) => {
          if (file.size > MAX_FILE_SIZE) {
            logger.warn(
              `Skipping file "${file.path}" (${(file.size / 1024 / 1024).toFixed(2)}MB exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit).`,
            );
            return false;
          }
          return true;
        });

        const itemFiles: Array<{ relativePath: string; content: string }> = [];
        for (const file of files) {
          const relativeToItem = file.path.substring(itemDir.path.length + 1);
          const content = await withSemaphore(semaphore, () =>
            client.getFileContent(parsed.owner, parsed.repo, file.path, ref),
          );
          itemFiles.push({ relativePath: relativeToItem, content });
        }

        fetchedItems[itemDir.name] = await writeItemAndComputeIntegrity({
          itemName: itemDir.name,
          feature,
          files: itemFiles,
          remoteDir,
          locked,
          resolvedSha,
          sourceKey,
        });
        logger.debug(`Fetched ${feature} "${itemDir.name}" from ${sourceKey}`);
      }
    } else {
      // Rules, commands, subagents: each file is its own item
      const remoteFileEntries = entries.filter((e) => e.type === "file");
      perFeatureRemoteNames[feature] = remoteFileEntries.map((f) => f.name);

      for (const fileEntry of remoteFileEntries) {
        if (
          shouldSkipItem({
            itemName: fileEntry.name,
            feature,
            sourceKey,
            localNames: featureLocalNames,
            alreadyFetchedNames: featureAlreadyFetched,
          })
        ) {
          continue;
        }

        const content = await withSemaphore(semaphore, () =>
          client.getFileContent(parsed.owner, parsed.repo, fileEntry.path, ref),
        );

        fetchedItems[fileEntry.name] = await writeFileItemAndComputeIntegrity({
          filePath: fileEntry.name,
          content,
          remoteDir,
          feature,
          locked,
          resolvedSha,
          sourceKey,
        });
        logger.debug(`Fetched ${feature} "${fileEntry.name}" from ${sourceKey}`);
      }
    }

    perFeatureFetched[feature] = fetchedItems;
  }

  const result = buildLockUpdate({
    lock,
    sourceKey,
    features,
    perFeatureFetched,
    perFeatureRemoteNames,
    locked,
    requestedRef,
    resolvedSha,
  });

  return {
    itemCount: result.totalCount,
    skillCount: Object.keys(perFeatureFetched["skills"] ?? {}).length,
    fetchedNames: result.fetchedNames,
    updatedLock: result.updatedLock,
  };
}

// ---------------------------------------------------------------------------
// Transport: git CLI
// ---------------------------------------------------------------------------

/**
 * Fetch items from a single source using git CLI (works with any git remote).
 */
async function fetchSourceViaGit(params: {
  sourceEntry: SourceEntry;
  features: DirectoryFeature[];
  baseDir: string;
  lock: SourcesLock;
  localNames: Record<string, Set<string>>;
  allFetchedNames: Record<string, Set<string>>;
  updateSources: boolean;
  frozen: boolean;
}): Promise<FetchResult> {
  const { sourceEntry, features, baseDir, localNames, allFetchedNames, updateSources, frozen } =
    params;
  const { lock } = params;
  const url = sourceEntry.source;
  const locked = getLockedSource(lock, url);
  const hasExplicitFeatures = sourceEntry.features !== undefined && sourceEntry.features.length > 0;

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

  // Check if we can skip re-fetch (all features up-to-date on disk)
  if (locked && resolvedSha === locked.resolvedRef && !updateSources) {
    let allExist = true;
    for (const feature of features) {
      const remoteDir = join(
        baseDir,
        requireFeaturePath(FEATURE_REMOTE_DIR_PATHS, feature, "FEATURE_REMOTE_DIR_PATHS"),
      );
      const lockedNames = getLockedFeatureNames(locked, feature);
      if (!(await checkLockedItemsExist(remoteDir, lockedNames, feature))) {
        allExist = false;
        break;
      }
    }
    if (allExist) {
      const fetchedNames: Record<string, string[]> = {};
      for (const feature of features) {
        fetchedNames[feature] = getLockedFeatureNames(locked, feature);
      }
      return { itemCount: 0, skillCount: 0, fetchedNames, updatedLock: lock };
    }
  }

  // Resolve requestedRef lazily
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

  // Build the mapping of feature to remote path
  const featurePathMap = new Map<DirectoryFeature, string>();
  for (const feature of features) {
    featurePathMap.set(
      feature,
      resolveRemoteFeaturePath(feature, sourceEntry, hasExplicitFeatures),
    );
  }

  // Single clone with all feature paths via sparse-checkout
  const filesByPath = await fetchDirectoryFiles({
    url,
    ref: requestedRef,
    paths: [...featurePathMap.values()],
  });

  const skillFilter = sourceEntry.skills ?? ["*"];
  const isSkillWildcard = skillFilter.length === 1 && skillFilter[0] === "*";
  const perFeatureFetched: Record<string, Record<string, LockedItem>> = {};
  const perFeatureRemoteNames: Record<string, string[]> = {};

  for (const feature of features) {
    const featurePath = featurePathMap.get(feature) ?? "";
    const remoteDir = join(
      baseDir,
      requireFeaturePath(FEATURE_REMOTE_DIR_PATHS, feature, "FEATURE_REMOTE_DIR_PATHS"),
    );
    const featureLocalNames = localNames[feature] ?? new Set<string>();
    const featureAlreadyFetched = allFetchedNames[feature] ?? new Set<string>();
    const lockedItemNames = locked ? getLockedFeatureNames(locked, feature) : [];
    const remoteFiles = filesByPath[featurePath] ?? [];
    const isSubdirFeature = SUBDIRECTORY_ITEM_FEATURES.has(feature);

    // Clean previous remote items
    if (locked) {
      await cleanPreviousRemoteItems(remoteDir, lockedItemNames, feature);
    }

    const fetchedItems: Record<string, LockedItem> = {};

    if (isSubdirFeature) {
      // Skills: group files by first path component (directory name)
      const itemFileMap = new Map<string, Array<{ relativePath: string; content: string }>>();
      for (const file of remoteFiles) {
        const idx = file.relativePath.indexOf("/");
        if (idx === -1) continue;
        const name = file.relativePath.substring(0, idx);
        const inner = file.relativePath.substring(idx + 1);
        const arr = itemFileMap.get(name) ?? [];
        arr.push({ relativePath: inner, content: file.content });
        itemFileMap.set(name, arr);
      }

      const allNames = [...itemFileMap.keys()];
      const filteredNames =
        feature === "skills" && !isSkillWildcard
          ? allNames.filter((n) => skillFilter.includes(n))
          : allNames;

      perFeatureRemoteNames[feature] = filteredNames;

      for (const itemName of filteredNames) {
        if (
          shouldSkipItem({
            itemName,
            feature,
            sourceKey: url,
            localNames: featureLocalNames,
            alreadyFetchedNames: featureAlreadyFetched,
          })
        ) {
          continue;
        }

        fetchedItems[itemName] = await writeItemAndComputeIntegrity({
          itemName,
          feature,
          files: itemFileMap.get(itemName) ?? [],
          remoteDir,
          locked,
          resolvedSha,
          sourceKey: url,
        });
      }
    } else {
      // Rules, commands, subagents: each file is its own item
      const allFileNames = remoteFiles.map((f) => f.relativePath);
      perFeatureRemoteNames[feature] = allFileNames;

      for (const file of remoteFiles) {
        const itemName = file.relativePath;
        if (
          shouldSkipItem({
            itemName,
            feature,
            sourceKey: url,
            localNames: featureLocalNames,
            alreadyFetchedNames: featureAlreadyFetched,
          })
        ) {
          continue;
        }

        fetchedItems[itemName] = await writeFileItemAndComputeIntegrity({
          filePath: file.relativePath,
          content: file.content,
          remoteDir,
          feature,
          locked,
          resolvedSha,
          sourceKey: url,
        });
      }
    }

    perFeatureFetched[feature] = fetchedItems;
  }

  const result = buildLockUpdate({
    lock,
    sourceKey: url,
    features,
    perFeatureFetched,
    perFeatureRemoteNames,
    locked,
    requestedRef,
    resolvedSha,
  });

  return {
    itemCount: result.totalCount,
    skillCount: Object.keys(perFeatureFetched["skills"] ?? {}).length,
    fetchedNames: result.fetchedNames,
    updatedLock: result.updatedLock,
  };
}
