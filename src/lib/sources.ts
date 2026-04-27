import { join, resolve, sep } from "node:path";

import { Semaphore } from "es-toolkit/promise";

import type { SourceEntry } from "../config/config.js";
import {
  FETCH_CONCURRENCY_LIMIT,
  MAX_FILE_SIZE,
  RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH,
} from "../constants/rulesync-paths.js";
import { getLocalSkillDirNames } from "../features/skills/skills-utils.js";
import { formatError } from "../utils/error.js";
import {
  checkPathTraversal,
  directoryExists,
  removeDirectory,
  writeFileContent,
} from "../utils/file.js";
import type { Logger } from "../utils/logger.js";
import {
  GitClientError,
  fetchSkillFiles,
  resolveDefaultRef,
  resolveRefToSha,
  validateRef,
} from "./git-client.js";
import { GitHubClient, GitHubClientError, logGitHubAuthHints } from "./github-client.js";
import { listDirectoryRecursive, withSemaphore } from "./github-utils.js";
import { parseSource } from "./source-parser.js";
import {
  type LockedSkill,
  type LockedSource,
  type SourcesLock,
  computeSkillIntegrity,
  createEmptyLock,
  getLockedSkillNames,
  getLockedSource,
  normalizeSourceKey,
  readLockFile,
  setLockedSource,
  writeLockFile,
} from "./sources-lock.js";

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
  fetchedSkillCount: number;
  sourcesProcessed: number;
};

type RemoteSkillFile = {
  relativePath: string;
  content: string;
};

/**
 * Resolve declared sources, fetch remote skills into .rulesync/skills/.curated/,
 * and update the lockfile.
 */
export async function resolveAndFetchSources(params: {
  sources: SourceEntry[];
  projectRoot: string;
  options?: ResolveAndFetchSourcesOptions;
  logger: Logger;
}): Promise<ResolveAndFetchSourcesResult> {
  const { sources, projectRoot, options = {}, logger } = params;

  if (sources.length === 0) {
    return { fetchedSkillCount: 0, sourcesProcessed: 0 };
  }

  if (options.skipSources) {
    logger.info("Skipping source fetching.");
    return { fetchedSkillCount: 0, sourcesProcessed: 0 };
  }

  // Read existing lockfile
  let lock: SourcesLock = options.updateSources
    ? createEmptyLock()
    : await readLockFile({ projectRoot, logger });

  // Frozen mode: validate lockfile covers all declared sources.
  // Missing curated skills are fetched using locked refs.
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

  // Determine local skills (in .rulesync/skills/ but not in .curated/)
  const localSkillNames = await getLocalSkillDirNames(projectRoot);

  let totalSkillCount = 0;
  const allFetchedSkillNames = new Set<string>();

  for (const sourceEntry of sources) {
    try {
      const transport = sourceEntry.transport ?? "github";
      let result: { skillCount: number; fetchedSkillNames: string[]; updatedLock: SourcesLock };
      if (transport === "git") {
        result = await fetchSourceViaGit({
          sourceEntry,
          projectRoot,
          lock,
          localSkillNames,
          alreadyFetchedSkillNames: allFetchedSkillNames,
          updateSources: options.updateSources ?? false,
          frozen: options.frozen ?? false,
          logger,
        });
      } else {
        result = await fetchSource({
          sourceEntry,
          client,
          projectRoot,
          lock,
          localSkillNames,
          alreadyFetchedSkillNames: allFetchedSkillNames,
          updateSources: options.updateSources ?? false,
          logger,
        });
      }
      const { skillCount, fetchedSkillNames, updatedLock } = result;

      lock = updatedLock;
      totalSkillCount += skillCount;
      for (const name of fetchedSkillNames) {
        allFetchedSkillNames.add(name);
      }
    } catch (error) {
      logger.error(`Failed to fetch source "${sourceEntry.source}": ${formatError(error)}`);
      if (error instanceof GitHubClientError) {
        logGitHubAuthHints({ error, logger });
      } else if (error instanceof GitClientError) {
        logGitClientHints({ error, logger });
      }
    }
  }

  // Prune stale lockfile entries whose keys are not in the current sources (immutable)
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
    await writeLockFile({ projectRoot, lock, logger });
  } else {
    logger.debug("Lockfile unchanged, skipping write.");
  }

  return { fetchedSkillCount: totalSkillCount, sourcesProcessed: sources.length };
}

/**
 * Log contextual hints for GitClientError to help users troubleshoot.
 */
function logGitClientHints(params: { error: GitClientError; logger: Logger }): void {
  const { error, logger } = params;
  if (error.message.includes("not installed")) {
    logger.info("Hint: Install git and ensure it is available on your PATH.");
  } else {
    logger.info("Hint: Check your git credentials (SSH keys, credential helper, or access token).");
  }
}

/**
 * Check if all locked skills exist on disk in the curated directory.
 */
async function checkLockedSkillsExist(curatedDir: string, skillNames: string[]): Promise<boolean> {
  if (skillNames.length === 0) return true;
  for (const name of skillNames) {
    if (!(await directoryExists(join(curatedDir, name)))) {
      return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Shared helpers for fetchSource and fetchSourceViaGit
// ---------------------------------------------------------------------------

/**
 * Remove previously curated skill directories for a source before re-fetching.
 * Validates that each path resolves within the curated directory to prevent traversal.
 */
async function cleanPreviousCuratedSkills(params: {
  curatedDir: string;
  lockedSkillNames: string[];
  logger: Logger;
}): Promise<void> {
  const { curatedDir, lockedSkillNames, logger } = params;
  const resolvedCuratedDir = resolve(curatedDir);
  for (const prevSkill of lockedSkillNames) {
    const prevDir = join(curatedDir, prevSkill);
    if (!resolve(prevDir).startsWith(resolvedCuratedDir + sep)) {
      logger.warn(
        `Skipping removal of "${prevSkill}": resolved path is outside the curated directory.`,
      );
      continue;
    }
    if (await directoryExists(prevDir)) {
      await removeDirectory(prevDir);
    }
  }
}

/**
 * Check whether a skill should be skipped during fetching.
 * Returns true (with appropriate logging) if the skill should be skipped.
 */
function shouldSkipSkill(params: {
  skillName: string;
  sourceKey: string;
  localSkillNames: Set<string>;
  alreadyFetchedSkillNames: Set<string>;
  logger: Logger;
}): boolean {
  const { skillName, sourceKey, localSkillNames, alreadyFetchedSkillNames, logger } = params;
  if (skillName.includes("..") || skillName.includes("/") || skillName.includes("\\")) {
    logger.warn(
      `Skipping skill with invalid name "${skillName}" from ${sourceKey}: contains path traversal characters.`,
    );
    return true;
  }
  if (localSkillNames.has(skillName)) {
    logger.debug(
      `Skipping remote skill "${skillName}" from ${sourceKey}: local skill takes precedence.`,
    );
    return true;
  }
  if (alreadyFetchedSkillNames.has(skillName)) {
    logger.warn(
      `Skipping duplicate skill "${skillName}" from ${sourceKey}: already fetched from another source.`,
    );
    return true;
  }
  return false;
}

/**
 * Write skill files to disk, compute integrity, and check against the lockfile.
 * Returns the computed LockedSkill entry.
 */
async function writeSkillAndComputeIntegrity(params: {
  skillName: string;
  files: Array<{ relativePath: string; content: string }>;
  curatedDir: string;
  locked: LockedSource | undefined;
  resolvedSha: string;
  sourceKey: string;
  logger: Logger;
}): Promise<LockedSkill> {
  const { skillName, files, curatedDir, locked, resolvedSha, sourceKey, logger } = params;
  const written: Array<{ path: string; content: string }> = [];

  for (const file of files) {
    checkPathTraversal({
      relativePath: file.relativePath,
      intendedRootDir: join(curatedDir, skillName),
    });
    await writeFileContent(join(curatedDir, skillName, file.relativePath), file.content);
    written.push({ path: file.relativePath, content: file.content });
  }

  const integrity = computeSkillIntegrity(written);
  const lockedSkillEntry = locked?.skills[skillName];
  if (
    lockedSkillEntry?.integrity &&
    lockedSkillEntry.integrity !== integrity &&
    resolvedSha === locked?.resolvedRef
  ) {
    logger.warn(
      `Integrity mismatch for skill "${skillName}" from ${sourceKey}: expected "${lockedSkillEntry.integrity}", got "${integrity}". Content may have been tampered with.`,
    );
  }

  return { integrity };
}

/**
 * Merge newly fetched skills with existing locked skills and update the lockfile.
 */
function buildLockUpdate(params: {
  lock: SourcesLock;
  sourceKey: string;
  fetchedSkills: Record<string, LockedSkill>;
  locked: LockedSource | undefined;
  requestedRef: string | undefined;
  resolvedSha: string;
  remoteSkillNames: string[];
  logger: Logger;
}): { updatedLock: SourcesLock; fetchedNames: string[] } {
  const {
    lock,
    sourceKey,
    fetchedSkills,
    locked,
    requestedRef,
    resolvedSha,
    remoteSkillNames,
    logger,
  } = params;
  const fetchedNames = Object.keys(fetchedSkills);

  // Merge back locked skills that still exist in the remote but were skipped
  // (due to local precedence, already-fetched, etc.). Skills no longer present
  // in the remote (e.g. renamed or deleted upstream) are intentionally dropped.
  const remoteSet = new Set(remoteSkillNames);
  const mergedSkills: Record<string, LockedSkill> = { ...fetchedSkills };
  if (locked) {
    for (const [skillName, skillEntry] of Object.entries(locked.skills)) {
      if (!(skillName in mergedSkills) && remoteSet.has(skillName)) {
        mergedSkills[skillName] = skillEntry;
      }
    }
  }

  const updatedLock = setLockedSource(lock, sourceKey, {
    requestedRef,
    resolvedRef: resolvedSha,
    resolvedAt: new Date().toISOString(),
    skills: mergedSkills,
  });

  logger.info(
    `Fetched ${fetchedNames.length} skill(s) from ${sourceKey}: ${fetchedNames.join(", ") || "(none)"}`,
  );

  return { updatedLock, fetchedNames };
}

function getFirstPathSeparatorIndex(path: string): number {
  const slashIndex = path.indexOf("/");
  const backslashIndex = path.indexOf("\\");
  if (slashIndex === -1) return backslashIndex;
  if (backslashIndex === -1) return slashIndex;
  return Math.min(slashIndex, backslashIndex);
}

function groupRemoteFilesBySkillRoot(params: {
  remoteFiles: RemoteSkillFile[];
  skillFilter: string[];
  isWildcard: boolean;
}): Map<string, RemoteSkillFile[]> {
  const { remoteFiles, skillFilter, isWildcard } = params;
  const grouped = new Map<string, RemoteSkillFile[]>();
  const rootLevelFiles: RemoteSkillFile[] = [];

  for (const file of remoteFiles) {
    const separatorIndex = getFirstPathSeparatorIndex(file.relativePath);
    if (separatorIndex === -1) {
      rootLevelFiles.push(file);
      continue;
    }

    const skillName = file.relativePath.substring(0, separatorIndex);
    if (skillName.length === 0) {
      continue;
    }

    const innerPath = file.relativePath.substring(separatorIndex + 1);
    const groupedFiles = grouped.get(skillName) ?? [];
    groupedFiles.push({ relativePath: innerPath, content: file.content });
    grouped.set(skillName, groupedFiles);
  }

  if (grouped.size === 0 && !isWildcard && skillFilter.length === 1) {
    const [singleSkillName] = skillFilter;
    if (singleSkillName !== undefined && rootLevelFiles.length > 0) {
      grouped.set(singleSkillName, rootLevelFiles);
    }
  }

  return grouped;
}

// ---------------------------------------------------------------------------
// Transport-specific fetch functions
// ---------------------------------------------------------------------------

/**
 * Fetch skills from a single source entry via the GitHub REST API.
 */
async function fetchSource(params: {
  sourceEntry: SourceEntry;
  client: GitHubClient;
  projectRoot: string;
  lock: SourcesLock;
  localSkillNames: Set<string>;
  alreadyFetchedSkillNames: Set<string>;
  updateSources: boolean;
  logger: Logger;
}): Promise<{
  skillCount: number;
  fetchedSkillNames: string[];
  updatedLock: SourcesLock;
}> {
  const {
    sourceEntry,
    client,
    projectRoot,
    localSkillNames,
    alreadyFetchedSkillNames,
    updateSources,
    logger,
  } = params;
  const { lock } = params;

  const parsed = parseSource(sourceEntry.source);

  if (parsed.provider === "gitlab") {
    logger.warn(`GitLab sources are not yet supported. Skipping "${sourceEntry.source}".`);
    return { skillCount: 0, fetchedSkillNames: [], updatedLock: lock };
  }

  const sourceKey = sourceEntry.source;
  const locked = getLockedSource(lock, sourceKey);
  const lockedSkillNames = locked ? getLockedSkillNames(locked) : [];

  // Resolve the ref to a commit SHA
  let ref: string;
  let resolvedSha: string;
  let requestedRef: string | undefined;

  if (locked && !updateSources) {
    // Use the locked SHA for deterministic fetching
    ref = locked.resolvedRef;
    resolvedSha = locked.resolvedRef;
    requestedRef = locked.requestedRef;
    logger.debug(`Using locked ref for ${sourceKey}: ${resolvedSha}`);
  } else {
    // Resolve the ref (or default branch) to a SHA
    requestedRef = parsed.ref ?? (await client.getDefaultBranch(parsed.owner, parsed.repo));
    resolvedSha = await client.resolveRefToSha(parsed.owner, parsed.repo, requestedRef);
    ref = resolvedSha;
    logger.debug(`Resolved ${sourceKey} ref "${requestedRef}" to SHA: ${resolvedSha}`);
  }

  const curatedDir = join(projectRoot, RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH);

  // Skip re-fetch if SHA matches lockfile and curated skills exist on disk
  if (locked && resolvedSha === locked.resolvedRef && !updateSources) {
    const allExist = await checkLockedSkillsExist(curatedDir, lockedSkillNames);
    if (allExist) {
      logger.debug(`SHA unchanged for ${sourceKey}, skipping re-fetch.`);
      return {
        skillCount: 0,
        fetchedSkillNames: lockedSkillNames,
        updatedLock: lock,
      };
    }
  }

  // Determine which skills to fetch
  const skillFilter = sourceEntry.skills ?? ["*"];
  const isWildcard = skillFilter.length === 1 && skillFilter[0] === "*";
  const semaphore = new Semaphore(FETCH_CONCURRENCY_LIMIT);
  const fetchedSkills: Record<string, LockedSkill> = {};

  // List the skills/ directory in the remote repo.
  // If a path is given in the source URL, it points directly to the skills directory.
  // Otherwise, look for "skills/" at the repo root.
  const skillsBasePath = parsed.path ?? "skills";
  let remoteSkillDirs: Array<{ name: string; path: string }>;
  let remoteSkillNames: string[] = [];
  let fallbackHandled = false;

  try {
    const entries = await client.listDirectory(parsed.owner, parsed.repo, skillsBasePath, ref);
    remoteSkillDirs = entries
      .filter((e) => e.type === "dir")
      .map((e) => ({ name: e.name, path: e.path }));

    if (remoteSkillDirs.length === 0 && !isWildcard && skillFilter.length === 1) {
      const rootFiles = entries.filter((entry) => entry.type === "file");
      const rootSkillFiles: RemoteSkillFile[] = [];

      for (const file of rootFiles) {
        if (file.size > MAX_FILE_SIZE) {
          logger.warn(
            `Skipping file "${file.path}" (${(file.size / 1024 / 1024).toFixed(2)}MB exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit).`,
          );
          continue;
        }
        const content = await withSemaphore(semaphore, () =>
          client.getFileContent(parsed.owner, parsed.repo, file.path, ref),
        );
        rootSkillFiles.push({ relativePath: file.name, content });
      }

      const groupedRootFiles = groupRemoteFilesBySkillRoot({
        remoteFiles: rootSkillFiles,
        skillFilter,
        isWildcard,
      });
      const [fallbackSkillName] = groupedRootFiles.keys();
      if (fallbackSkillName !== undefined) {
        fallbackHandled = true;
        remoteSkillNames = [fallbackSkillName];

        if (
          !shouldSkipSkill({
            skillName: fallbackSkillName,
            sourceKey,
            localSkillNames,
            alreadyFetchedSkillNames,
            logger,
          })
        ) {
          fetchedSkills[fallbackSkillName] = await writeSkillAndComputeIntegrity({
            skillName: fallbackSkillName,
            files: groupedRootFiles.get(fallbackSkillName) ?? [],
            curatedDir,
            locked,
            resolvedSha,
            sourceKey,
            logger,
          });
          logger.debug(`Fetched skill "${fallbackSkillName}" from ${sourceKey}`);
        }
      }
    }
  } catch (error) {
    if (error instanceof GitHubClientError && error.statusCode === 404) {
      logger.warn(`No skills/ directory found in ${sourceKey}. Skipping.`);
      return { skillCount: 0, fetchedSkillNames: [], updatedLock: lock };
    }
    throw error;
  }

  // Filter skills by name
  const filteredDirs = isWildcard
    ? remoteSkillDirs
    : remoteSkillDirs.filter((d) => skillFilter.includes(d.name));
  if (!fallbackHandled) {
    remoteSkillNames = filteredDirs.map((d) => d.name);
  }

  if (locked) {
    await cleanPreviousCuratedSkills({ curatedDir, lockedSkillNames, logger });
  }

  for (const skillDir of filteredDirs) {
    if (
      shouldSkipSkill({
        skillName: skillDir.name,
        sourceKey,
        localSkillNames,
        alreadyFetchedSkillNames,
        logger,
      })
    ) {
      continue;
    }

    // Recursively fetch all files in this skill directory
    const allFiles = await listDirectoryRecursive({
      client,
      owner: parsed.owner,
      repo: parsed.repo,
      path: skillDir.path,
      ref,
      semaphore,
    });

    // Filter out files exceeding MAX_FILE_SIZE
    const files = allFiles.filter((file) => {
      if (file.size > MAX_FILE_SIZE) {
        logger.warn(
          `Skipping file "${file.path}" (${(file.size / 1024 / 1024).toFixed(2)}MB exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit).`,
        );
        return false;
      }
      return true;
    });

    // Fetch all file contents
    const skillFiles: Array<{ relativePath: string; content: string }> = [];
    for (const file of files) {
      const relativeToSkill = file.path.substring(skillDir.path.length + 1);
      const content = await withSemaphore(semaphore, () =>
        client.getFileContent(parsed.owner, parsed.repo, file.path, ref),
      );
      skillFiles.push({ relativePath: relativeToSkill, content });
    }

    fetchedSkills[skillDir.name] = await writeSkillAndComputeIntegrity({
      skillName: skillDir.name,
      files: skillFiles,
      curatedDir,
      locked,
      resolvedSha,
      sourceKey,
      logger,
    });
    logger.debug(`Fetched skill "${skillDir.name}" from ${sourceKey}`);
  }

  const result = buildLockUpdate({
    lock,
    sourceKey,
    fetchedSkills,
    locked,
    requestedRef,
    resolvedSha,
    remoteSkillNames,
    logger,
  });

  return {
    skillCount: result.fetchedNames.length,
    fetchedSkillNames: result.fetchedNames,
    updatedLock: result.updatedLock,
  };
}

/**
 * Fetch skills from a single source using git CLI (works with any git remote).
 */
async function fetchSourceViaGit(params: {
  sourceEntry: SourceEntry;
  projectRoot: string;
  lock: SourcesLock;
  localSkillNames: Set<string>;
  alreadyFetchedSkillNames: Set<string>;
  updateSources: boolean;
  frozen: boolean;
  logger: Logger;
}): Promise<{ skillCount: number; fetchedSkillNames: string[]; updatedLock: SourcesLock }> {
  const {
    sourceEntry,
    projectRoot,
    localSkillNames,
    alreadyFetchedSkillNames,
    updateSources,
    frozen,
    logger,
  } = params;
  const { lock } = params;
  const url = sourceEntry.source;
  const locked = getLockedSource(lock, url);
  const lockedSkillNames = locked ? getLockedSkillNames(locked) : [];

  let resolvedSha: string;
  let requestedRef: string | undefined;
  if (locked && !updateSources) {
    resolvedSha = locked.resolvedRef;
    requestedRef = locked.requestedRef;
    // Validate locked ref before passing to git commands
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

  const curatedDir = join(projectRoot, RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH);
  if (locked && resolvedSha === locked.resolvedRef && !updateSources) {
    if (await checkLockedSkillsExist(curatedDir, lockedSkillNames)) {
      return { skillCount: 0, fetchedSkillNames: lockedSkillNames, updatedLock: lock };
    }
  }

  // Resolve requestedRef lazily (deferred from locked path to avoid unnecessary network calls)
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

  const skillFilter = sourceEntry.skills ?? ["*"];
  const isWildcard = skillFilter.length === 1 && skillFilter[0] === "*";
  const remoteFiles = await fetchSkillFiles({
    url,
    ref: requestedRef,
    skillsPath: sourceEntry.path ?? "skills",
  });

  const skillFileMap = groupRemoteFilesBySkillRoot({ remoteFiles, skillFilter, isWildcard });

  const allNames = [...skillFileMap.keys()];
  const filteredNames = isWildcard ? allNames : allNames.filter((n) => skillFilter.includes(n));

  if (locked) {
    await cleanPreviousCuratedSkills({ curatedDir, lockedSkillNames, logger });
  }

  const fetchedSkills: Record<string, LockedSkill> = {};
  for (const skillName of filteredNames) {
    if (
      shouldSkipSkill({
        skillName,
        sourceKey: url,
        localSkillNames,
        alreadyFetchedSkillNames,
        logger,
      })
    ) {
      continue;
    }

    fetchedSkills[skillName] = await writeSkillAndComputeIntegrity({
      skillName,
      files: skillFileMap.get(skillName) ?? [],
      curatedDir,
      locked,
      resolvedSha,
      sourceKey: url,
      logger,
    });
  }

  const result = buildLockUpdate({
    lock,
    sourceKey: url,
    fetchedSkills,
    locked,
    requestedRef,
    resolvedSha,
    remoteSkillNames: filteredNames,
    logger,
  });
  return {
    skillCount: result.fetchedNames.length,
    fetchedSkillNames: result.fetchedNames,
    updatedLock: result.updatedLock,
  };
}
