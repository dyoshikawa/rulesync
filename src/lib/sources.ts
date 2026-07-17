import { join, posix, resolve, sep } from "node:path";

import { Semaphore } from "es-toolkit/promise";

import type { SourceEntry } from "../config/config.js";
import { SKILL_FILE_NAME } from "../constants/general.js";
import {
  FETCH_CONCURRENCY_LIMIT,
  MAX_FILE_SIZE,
  RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH,
} from "../constants/rulesync-paths.js";
import { getLocalSkillDirNames } from "../features/skills/skills-utils.js";
import type { GitHubFileEntry, ParsedSource } from "../types/fetch.js";
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
import {
  DEFAULT_NPM_REGISTRY_URL,
  fetchPackument,
  fetchTarball,
  getPackumentVersionDist,
  logNpmAuthHints,
  NpmClientError,
  resolveNpmToken,
  resolvePackumentVersion,
  shasumToSri,
  validateNpmPackageName,
  validateNpmRegistryUrl,
  verifyTarballIntegrity,
} from "./npm-client.js";
import {
  createEmptyNpmLock,
  getNpmLockedSkillNames,
  getNpmLockedSource,
  type NpmLockedSource,
  type NpmSourcesLock,
  normalizeNpmSourceKey,
  readNpmLockFile,
  setNpmLockedSource,
  writeNpmLockFile,
} from "./npm-sources-lock.js";
import { extractPackageTarball } from "./npm-tar.js";
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

  // Read existing lockfiles. npm-transport sources are pinned in a separate
  // lockfile (`rulesync-npm.lock.json`) because they lock a package version +
  // tarball integrity instead of a git commit SHA.
  let lock: SourcesLock = options.updateSources
    ? createEmptyLock()
    : await readLockFile({ projectRoot, logger });
  let npmLock: NpmSourcesLock = options.updateSources
    ? createEmptyNpmLock()
    : await readNpmLockFile({ projectRoot, logger });

  // Frozen mode: validate lockfiles cover all declared sources.
  // Missing curated skills are fetched using locked refs.
  if (options.frozen) {
    assertFrozenLockCoversSources({ lock, npmLock, sources });
  }

  const originalLockJson = JSON.stringify(lock);
  const originalNpmLockJson = JSON.stringify(npmLock);

  // Resolve GitHub token
  const token = GitHubClient.resolveToken(options.token);
  const client = new GitHubClient({ token });

  // Determine local skills (in .rulesync/skills/ but not in .curated/)
  const localSkillNames = await getLocalSkillDirNames(projectRoot);

  let totalSkillCount = 0;
  const allFetchedSkillNames = new Set<string>();

  for (const sourceEntry of sources) {
    try {
      const result = await fetchSingleSource({
        sourceEntry,
        client,
        projectRoot,
        lock,
        npmLock,
        localSkillNames,
        alreadyFetchedSkillNames: allFetchedSkillNames,
        updateSources: options.updateSources ?? false,
        frozen: options.frozen ?? false,
        logger,
      });

      lock = result.lock;
      npmLock = result.npmLock;
      totalSkillCount += result.skillCount;
      for (const name of result.fetchedSkillNames) {
        allFetchedSkillNames.add(name);
      }
    } catch (error) {
      logSourceFetchFailure({ sourceEntry, error, logger });
    }
  }

  lock = pruneStaleLockEntries({ lock, sources, logger });
  npmLock = pruneStaleNpmLockEntries({ npmLock, sources, logger });

  await writeLockFilesIfChanged({
    projectRoot,
    lock,
    npmLock,
    originalLockJson,
    originalNpmLockJson,
    frozen: options.frozen ?? false,
    logger,
  });

  return { fetchedSkillCount: totalSkillCount, sourcesProcessed: sources.length };
}

/**
 * Dispatch a single source to the npm fetcher or the git/github fetcher,
 * returning the (possibly) updated lock objects for both lockfiles.
 */
async function fetchSingleSource(params: {
  sourceEntry: SourceEntry;
  client: GitHubClient;
  projectRoot: string;
  lock: SourcesLock;
  npmLock: NpmSourcesLock;
  localSkillNames: Set<string>;
  alreadyFetchedSkillNames: Set<string>;
  updateSources: boolean;
  frozen: boolean;
  logger: Logger;
}): Promise<{
  skillCount: number;
  fetchedSkillNames: string[];
  lock: SourcesLock;
  npmLock: NpmSourcesLock;
}> {
  const { sourceEntry, lock, npmLock } = params;
  if ((sourceEntry.transport ?? "github") === "npm") {
    const result = await fetchSourceViaNpm({
      sourceEntry,
      projectRoot: params.projectRoot,
      npmLock,
      localSkillNames: params.localSkillNames,
      alreadyFetchedSkillNames: params.alreadyFetchedSkillNames,
      updateSources: params.updateSources,
      logger: params.logger,
    });
    return {
      skillCount: result.skillCount,
      fetchedSkillNames: result.fetchedSkillNames,
      lock,
      npmLock: result.updatedLock,
    };
  }
  const result = await fetchSourceByTransport({
    sourceEntry,
    client: params.client,
    projectRoot: params.projectRoot,
    lock,
    localSkillNames: params.localSkillNames,
    alreadyFetchedSkillNames: params.alreadyFetchedSkillNames,
    updateSources: params.updateSources,
    frozen: params.frozen,
    logger: params.logger,
  });
  return {
    skillCount: result.skillCount,
    fetchedSkillNames: result.fetchedSkillNames,
    lock: result.updatedLock,
    npmLock,
  };
}

/** Log a per-source fetch failure with transport-specific troubleshooting hints. */
function logSourceFetchFailure(params: {
  sourceEntry: SourceEntry;
  error: unknown;
  logger: Logger;
}): void {
  const { sourceEntry, error, logger } = params;
  logger.error(`Failed to fetch source "${sourceEntry.source}": ${formatError(error)}`);
  if (error instanceof GitHubClientError) {
    logGitHubAuthHints({ error, logger });
  } else if (error instanceof GitClientError) {
    logGitClientHints({ error, logger });
  } else if (error instanceof NpmClientError) {
    logNpmAuthHints({ error, logger });
  }
}

/** Write each lockfile only when it changed (and never in frozen mode). */
async function writeLockFilesIfChanged(params: {
  projectRoot: string;
  lock: SourcesLock;
  npmLock: NpmSourcesLock;
  originalLockJson: string;
  originalNpmLockJson: string;
  frozen: boolean;
  logger: Logger;
}): Promise<void> {
  const { projectRoot, lock, npmLock, originalLockJson, originalNpmLockJson, frozen, logger } =
    params;
  if (!frozen && JSON.stringify(lock) !== originalLockJson) {
    await writeLockFile({ projectRoot, lock, logger });
  } else {
    logger.debug("Lockfile unchanged, skipping write.");
  }
  if (!frozen && JSON.stringify(npmLock) !== originalNpmLockJson) {
    await writeNpmLockFile({ projectRoot, lock: npmLock, logger });
  } else {
    logger.debug("npm lockfile unchanged, skipping write.");
  }
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
 * Frozen mode: validate the lockfiles cover every declared source. Throws with
 * remediation guidance listing any uncovered source keys. npm-transport
 * sources are checked against the npm lockfile; everything else against the
 * main sources lockfile.
 */
function assertFrozenLockCoversSources(params: {
  lock: SourcesLock;
  npmLock: NpmSourcesLock;
  sources: SourceEntry[];
}): void {
  const { lock, npmLock, sources } = params;
  const missingKeys: string[] = [];

  for (const source of sources) {
    const locked =
      (source.transport ?? "github") === "npm"
        ? getNpmLockedSource(npmLock, source.source)
        : getLockedSource(lock, source.source);
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

/**
 * Dispatch a single source to the transport-specific fetcher (git CLI vs.
 * GitHub REST API), preserving the original default of "github".
 */
async function fetchSourceByTransport(params: {
  sourceEntry: SourceEntry;
  client: GitHubClient;
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
    client,
    projectRoot,
    lock,
    localSkillNames,
    alreadyFetchedSkillNames,
    updateSources,
    frozen,
    logger,
  } = params;
  const transport = sourceEntry.transport ?? "github";
  if (transport === "git") {
    return fetchSourceViaGit({
      sourceEntry,
      projectRoot,
      lock,
      localSkillNames,
      alreadyFetchedSkillNames,
      updateSources,
      frozen,
      logger,
    });
  }
  return fetchSource({
    sourceEntry,
    client,
    projectRoot,
    lock,
    localSkillNames,
    alreadyFetchedSkillNames,
    updateSources,
    logger,
  });
}

/**
 * Prune stale lockfile entries whose keys are not in the current sources
 * (immutable — returns a fresh lock object).
 */
function pruneStaleLockEntries(params: {
  lock: SourcesLock;
  sources: SourceEntry[];
  logger: Logger;
}): SourcesLock {
  const { lock, sources, logger } = params;
  const sourceKeys = new Set(
    sources
      .filter((s) => (s.transport ?? "github") !== "npm")
      .map((s) => normalizeSourceKey(s.source)),
  );
  const prunedSources: typeof lock.sources = {};
  for (const [key, value] of Object.entries(lock.sources)) {
    if (sourceKeys.has(normalizeSourceKey(key))) {
      prunedSources[key] = value;
    } else {
      logger.debug(`Pruned stale lockfile entry: ${key}`);
    }
  }
  return { lockfileVersion: lock.lockfileVersion, sources: prunedSources };
}

/**
 * Prune stale npm lockfile entries whose keys are not in the current
 * npm-transport sources (immutable — returns a fresh lock object).
 */
function pruneStaleNpmLockEntries(params: {
  npmLock: NpmSourcesLock;
  sources: SourceEntry[];
  logger: Logger;
}): NpmSourcesLock {
  const { npmLock, sources, logger } = params;
  const sourceKeys = new Set(
    sources
      .filter((s) => (s.transport ?? "github") === "npm")
      .map((s) => normalizeNpmSourceKey(s.source)),
  );
  const prunedSources: typeof npmLock.sources = {};
  for (const [key, value] of Object.entries(npmLock.sources)) {
    if (sourceKeys.has(normalizeNpmSourceKey(key))) {
      prunedSources[key] = value;
    } else {
      logger.debug(`Pruned stale npm lockfile entry: ${key}`);
    }
  }
  return { lockfileVersion: npmLock.lockfileVersion, sources: prunedSources };
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
 * Merge back locked skills that still exist in the remote but were skipped
 * during fetching (due to local precedence, already-fetched, etc.). Skills no
 * longer present in the remote (e.g. renamed or deleted upstream) are
 * intentionally dropped. Shared by the git/github and npm lock updates.
 */
function mergeFetchedWithLockedSkills(params: {
  fetchedSkills: Record<string, LockedSkill>;
  lockedSkills: Record<string, LockedSkill> | undefined;
  remoteSkillNames: string[];
}): Record<string, LockedSkill> {
  const { fetchedSkills, lockedSkills, remoteSkillNames } = params;
  const remoteSet = new Set(remoteSkillNames);
  const mergedSkills: Record<string, LockedSkill> = { ...fetchedSkills };
  if (lockedSkills) {
    for (const [skillName, skillEntry] of Object.entries(lockedSkills)) {
      if (!(skillName in mergedSkills) && remoteSet.has(skillName)) {
        mergedSkills[skillName] = skillEntry;
      }
    }
  }
  return mergedSkills;
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

  const mergedSkills = mergeFetchedWithLockedSkills({
    fetchedSkills,
    lockedSkills: locked?.skills,
    remoteSkillNames,
  });

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

/**
 * Decide whether a repository's root-level files should be installed as the
 * single requested skill (the "root fallback").
 *
 * A root fallback fires only when a single, non-wildcard skill was requested,
 * that skill's own directory is absent, and the repository root actually carries
 * a `SKILL.md`. Both the git transport (`groupRemoteFilesBySkillRoot`) and the
 * GitHub transport (`discoverGithubSkillDirs`) gate on these same conditions, so
 * the decision lives here to keep the two paths from drifting.
 */
function shouldUseRootFallback(params: {
  skillFilter: string[];
  isWildcard: boolean;
  hasRootSkillFile: boolean;
  hasRequestedSkillDir: boolean;
}): boolean {
  const { skillFilter, isWildcard, hasRootSkillFile, hasRequestedSkillDir } = params;
  const [singleSkillName] = skillFilter;
  return (
    !isWildcard &&
    skillFilter.length === 1 &&
    singleSkillName !== undefined &&
    hasRootSkillFile &&
    !hasRequestedSkillDir
  );
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

  const [singleSkillName] = skillFilter;
  const hasRootSkillFile = rootLevelFiles.some((file) => file.relativePath === SKILL_FILE_NAME);
  if (
    singleSkillName !== undefined &&
    shouldUseRootFallback({
      skillFilter,
      isWildcard,
      hasRootSkillFile,
      hasRequestedSkillDir: grouped.has(singleSkillName),
    })
  ) {
    grouped.set(singleSkillName, rootLevelFiles);
  }

  return grouped;
}

// ---------------------------------------------------------------------------
// Transport-specific fetch functions
// ---------------------------------------------------------------------------

/**
 * Resolve a GitHub source's ref to a commit SHA, preferring the locked SHA for
 * deterministic fetches and otherwise resolving the declared ref or default
 * branch. Returns the on-disk `ref` (SHA when freshly resolved, else locked
 * ref), the resolved SHA, and the requested ref.
 */
async function resolveGithubFetchRef(params: {
  parsed: ParsedSource;
  locked: LockedSource | undefined;
  updateSources: boolean;
  sourceKey: string;
  client: GitHubClient;
  logger: Logger;
}): Promise<{ ref: string; resolvedSha: string; requestedRef: string | undefined }> {
  const { parsed, locked, updateSources, sourceKey, client, logger } = params;
  if (locked && !updateSources) {
    // Use the locked SHA for deterministic fetching
    logger.debug(`Using locked ref for ${sourceKey}: ${locked.resolvedRef}`);
    return {
      ref: locked.resolvedRef,
      resolvedSha: locked.resolvedRef,
      requestedRef: locked.requestedRef,
    };
  }
  // Resolve the ref (or default branch) to a SHA
  const requestedRef = parsed.ref ?? (await client.getDefaultBranch(parsed.owner, parsed.repo));
  const resolvedSha = await client.resolveRefToSha(parsed.owner, parsed.repo, requestedRef);
  logger.debug(`Resolved ${sourceKey} ref "${requestedRef}" to SHA: ${resolvedSha}`);
  return { ref: resolvedSha, resolvedSha, requestedRef };
}

/**
 * Fallback path used when an explicit single-skill source points at a flat skill
 * with root-level files. Fetches and writes that skill into `fetchedSkills`.
 * Returns whether the fallback fired and the resulting remote skill names.
 */
async function fetchRootLevelFallbackSkill(params: {
  entries: GitHubFileEntry[];
  parsed: ParsedSource;
  ref: string;
  resolvedSha: string;
  skillFilter: string[];
  isWildcard: boolean;
  curatedDir: string;
  locked: LockedSource | undefined;
  sourceKey: string;
  localSkillNames: Set<string>;
  alreadyFetchedSkillNames: Set<string>;
  client: GitHubClient;
  semaphore: Semaphore;
  fetchedSkills: Record<string, LockedSkill>;
  logger: Logger;
}): Promise<{ handled: boolean; remoteSkillNames: string[] }> {
  const {
    entries,
    parsed,
    ref,
    resolvedSha,
    skillFilter,
    isWildcard,
    curatedDir,
    locked,
    sourceKey,
    localSkillNames,
    alreadyFetchedSkillNames,
    client,
    semaphore,
    fetchedSkills,
    logger,
  } = params;

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
  if (fallbackSkillName === undefined) {
    return { handled: false, remoteSkillNames: [] };
  }

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

  return { handled: true, remoteSkillNames: [fallbackSkillName] };
}

/**
 * Recursively fetch and write a single skill directory's files via the GitHub
 * REST API, returning its computed LockedSkill entry.
 */
async function fetchGithubSkillDir(params: {
  skillDir: { name: string; path: string };
  parsed: ParsedSource;
  ref: string;
  resolvedSha: string;
  curatedDir: string;
  locked: LockedSource | undefined;
  sourceKey: string;
  client: GitHubClient;
  semaphore: Semaphore;
  logger: Logger;
}): Promise<LockedSkill> {
  const {
    skillDir,
    parsed,
    ref,
    resolvedSha,
    curatedDir,
    locked,
    sourceKey,
    client,
    semaphore,
    logger,
  } = params;

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

  return writeSkillAndComputeIntegrity({
    skillName: skillDir.name,
    files: skillFiles,
    curatedDir,
    locked,
    resolvedSha,
    sourceKey,
    logger,
  });
}

/**
 * List the remote skills directory and apply the root-level fallback. Returns a
 * `notFound` sentinel when the directory 404s (so the caller can skip the
 * source), otherwise the discovered skill subdirectories plus any fallback skill
 * names already written into `fetchedSkills`.
 */
async function discoverGithubSkillDirs(params: {
  parsed: ParsedSource;
  ref: string;
  resolvedSha: string;
  skillFilter: string[];
  isWildcard: boolean;
  curatedDir: string;
  locked: LockedSource | undefined;
  sourceKey: string;
  localSkillNames: Set<string>;
  alreadyFetchedSkillNames: Set<string>;
  client: GitHubClient;
  semaphore: Semaphore;
  fetchedSkills: Record<string, LockedSkill>;
  logger: Logger;
}): Promise<
  | { status: "notFound" }
  | {
      status: "ok";
      remoteSkillDirs: Array<{ name: string; path: string }>;
      fallbackHandled: boolean;
      remoteSkillNames: string[];
    }
> {
  const {
    parsed,
    ref,
    resolvedSha,
    skillFilter,
    isWildcard,
    curatedDir,
    locked,
    sourceKey,
    localSkillNames,
    alreadyFetchedSkillNames,
    client,
    semaphore,
    fetchedSkills,
    logger,
  } = params;

  const skillsBasePath = parsed.path ?? "skills";
  try {
    const entries = await client.listDirectory(parsed.owner, parsed.repo, skillsBasePath, ref);
    const remoteSkillDirs = entries
      .filter((e) => e.type === "dir")
      .map((e) => ({ name: e.name, path: e.path }));

    const [singleSkillName] = skillFilter;
    const hasRequestedSkillDir =
      singleSkillName !== undefined && remoteSkillDirs.some((d) => d.name === singleSkillName);
    // Detect a root-level SKILL.md from the directory listing we already have, so
    // the fallback (and its full root-file fetch) is skipped when there is no
    // root skill to install — not just when the requested dir is absent.
    const hasRootSkillFile = entries.some(
      (entry) => entry.type === "file" && entry.name === SKILL_FILE_NAME,
    );
    if (
      shouldUseRootFallback({ skillFilter, isWildcard, hasRootSkillFile, hasRequestedSkillDir })
    ) {
      const fallback = await fetchRootLevelFallbackSkill({
        entries,
        parsed,
        ref,
        resolvedSha,
        skillFilter,
        isWildcard,
        curatedDir,
        locked,
        sourceKey,
        localSkillNames,
        alreadyFetchedSkillNames,
        client,
        semaphore,
        fetchedSkills,
        logger,
      });
      if (fallback.handled) {
        return {
          status: "ok",
          remoteSkillDirs,
          fallbackHandled: true,
          remoteSkillNames: fallback.remoteSkillNames,
        };
      }
    }

    return { status: "ok", remoteSkillDirs, fallbackHandled: false, remoteSkillNames: [] };
  } catch (error) {
    if (error instanceof GitHubClientError && error.statusCode === 404) {
      return { status: "notFound" };
    }
    throw error;
  }
}

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
  const { ref, resolvedSha, requestedRef } = await resolveGithubFetchRef({
    parsed,
    locked,
    updateSources,
    sourceKey,
    client,
    logger,
  });

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
  const discovery = await discoverGithubSkillDirs({
    parsed,
    ref,
    resolvedSha,
    skillFilter,
    isWildcard,
    curatedDir,
    locked,
    sourceKey,
    localSkillNames,
    alreadyFetchedSkillNames,
    client,
    semaphore,
    fetchedSkills,
    logger,
  });
  if (discovery.status === "notFound") {
    logger.warn(`No skills/ directory found in ${sourceKey}. Skipping.`);
    return { skillCount: 0, fetchedSkillNames: [], updatedLock: lock };
  }
  const { remoteSkillDirs, fallbackHandled, remoteSkillNames: fallbackSkillNames } = discovery;

  // Filter skills by name
  const filteredDirs = isWildcard
    ? remoteSkillDirs
    : remoteSkillDirs.filter((d) => skillFilter.includes(d.name));
  const remoteSkillNames = fallbackHandled ? fallbackSkillNames : filteredDirs.map((d) => d.name);

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

    fetchedSkills[skillDir.name] = await fetchGithubSkillDir({
      skillDir,
      parsed,
      ref,
      resolvedSha,
      curatedDir,
      locked,
      sourceKey,
      client,
      semaphore,
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

// ---------------------------------------------------------------------------
// npm transport (EXPERIMENTAL)
// ---------------------------------------------------------------------------

/**
 * Select the skill files inside an extracted npm package, mirroring the git
 * transport's discovery: files under `skills/` (or the configured `path`) are
 * grouped per subdirectory; a package whose `SKILL.md` sits at the package
 * root is installed as a single skill (root fallback via
 * {@link shouldUseRootFallback}), named after the requested skill or, for
 * wildcard fetches, after the package's base name.
 */
function selectNpmSkillFiles(params: {
  allFiles: RemoteSkillFile[];
  skillsPath: string;
  skillFilter: string[];
  isWildcard: boolean;
  packageName: string;
}): { remoteFiles: RemoteSkillFile[]; skillFilter: string[]; isWildcard: boolean } {
  const { allFiles, skillsPath, skillFilter, isWildcard, packageName } = params;

  const normalizedBase = posix.normalize(skillsPath.replace(/\\/g, "/")).replace(/\/+$/, "");
  const isRootPath = normalizedBase === "" || normalizedBase === ".";
  if (isRootPath) {
    return { remoteFiles: allFiles, skillFilter, isWildcard };
  }

  const prefix = `${normalizedBase}/`;
  const filesUnderBase = allFiles
    .filter((file) => file.relativePath.startsWith(prefix))
    .map((file) => ({
      relativePath: file.relativePath.substring(prefix.length),
      content: file.content,
    }));
  if (filesUnderBase.length > 0) {
    return { remoteFiles: filesUnderBase, skillFilter, isWildcard };
  }

  // Root fallback: the package itself is a single skill with SKILL.md at its
  // root. For wildcard fetches the skill name is derived from the package
  // base name (scope stripped), so `@acme/my-skill` installs as `my-skill`.
  const hasRootSkillFile = allFiles.some((file) => file.relativePath === SKILL_FILE_NAME);
  const fallbackFilter = isWildcard ? [npmPackageBaseName(packageName)] : skillFilter;
  const [singleSkillName] = fallbackFilter;
  if (
    fallbackFilter.length === 1 &&
    singleSkillName !== undefined &&
    shouldUseRootFallback({
      skillFilter: fallbackFilter,
      isWildcard: false,
      hasRootSkillFile,
      hasRequestedSkillDir: false,
    })
  ) {
    return { remoteFiles: allFiles, skillFilter: fallbackFilter, isWildcard: false };
  }

  return { remoteFiles: filesUnderBase, skillFilter, isWildcard };
}

/** Base name of an npm package: `@scope/name` -> `name`. */
function npmPackageBaseName(packageName: string): string {
  const slashIndex = packageName.indexOf("/");
  return slashIndex === -1 ? packageName : packageName.substring(slashIndex + 1);
}

/**
 * Resolve the version to fetch for an npm source: the locked version when
 * available (deterministic re-fetch), otherwise the declared `ref` (exact
 * version or dist-tag, defaulting to "latest") resolved via the packument.
 */
function resolveNpmFetchVersion(params: {
  sourceEntry: SourceEntry;
  locked: NpmLockedSource | undefined;
  updateSources: boolean;
}): { lockedVersion: string | undefined; requestedVersion: string | undefined } {
  const { sourceEntry, locked, updateSources } = params;
  if (locked && !updateSources) {
    return { lockedVersion: locked.resolvedVersion, requestedVersion: locked.requestedVersion };
  }
  return { lockedVersion: undefined, requestedVersion: sourceEntry.ref ?? "latest" };
}

/**
 * Resolve the package version via the registry packument, download the
 * tarball, and verify it against the registry (and, when re-fetching a locked
 * version, the locked) integrity metadata.
 */
async function downloadVerifiedNpmTarball(params: {
  packageName: string;
  registryUrl: string;
  token: string | undefined;
  lockedVersion: string | undefined;
  requestedVersion: string | undefined;
  locked: NpmLockedSource | undefined;
  logger: Logger;
}): Promise<{
  resolvedVersion: string;
  dist: { tarball: string; integrity?: string; shasum?: string };
  tarball: Buffer;
}> {
  const { packageName, registryUrl, token, lockedVersion, requestedVersion, locked, logger } =
    params;

  const packument = await fetchPackument({ registryUrl, packageName, token });
  const resolvedVersion =
    lockedVersion ??
    resolvePackumentVersion({
      packument,
      packageName,
      requested: requestedVersion ?? "latest",
    });
  logger.debug(`Resolved ${packageName}@${requestedVersion ?? "latest"} to ${resolvedVersion}`);

  const dist = getPackumentVersionDist({ packument, packageName, version: resolvedVersion });
  const tarball = await fetchTarball({ tarballUrl: dist.tarball, registryUrl, token });
  const context = `${packageName}@${resolvedVersion}`;
  verifyTarballIntegrity({
    tarball,
    integrity: dist.integrity,
    shasum: dist.shasum,
    context,
    logger,
  });
  // Defense in depth: when re-fetching a locked version, also verify against
  // the integrity recorded at lock time so a registry-side swap is detected.
  if (locked?.integrity && locked.resolvedVersion === resolvedVersion) {
    verifyTarballIntegrity({ tarball, integrity: locked.integrity, context, logger });
  }

  return { resolvedVersion, dist, tarball };
}

/**
 * Extract a verified npm tarball in memory and convert its entries into
 * remote skill files, skipping any file above MAX_FILE_SIZE.
 */
function extractNpmRemoteFiles(params: { tarball: Buffer; logger: Logger }): RemoteSkillFile[] {
  const { tarball, logger } = params;
  const extracted = extractPackageTarball({
    tarball,
    onSkippedEntry: (message) => logger.warn(message),
  });
  const allFiles: RemoteSkillFile[] = [];
  for (const entry of extracted) {
    if (entry.content.length > MAX_FILE_SIZE) {
      logger.warn(
        `Skipping file "${entry.relativePath}" (${(entry.content.length / 1024 / 1024).toFixed(2)}MB exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit).`,
      );
      continue;
    }
    allFiles.push({ relativePath: entry.relativePath, content: entry.content.toString("utf8") });
  }
  return allFiles;
}

/** Build the npm lockfile entry for a fetched source. */
function buildNpmLockEntry(params: {
  sourceEntry: SourceEntry;
  requestedVersion: string | undefined;
  resolvedVersion: string;
  dist: { integrity?: string; shasum?: string };
  mergedSkills: Record<string, LockedSkill>;
}): NpmLockedSource {
  const { sourceEntry, requestedVersion, resolvedVersion, dist, mergedSkills } = params;
  const integrity =
    dist.integrity ?? (dist.shasum !== undefined ? shasumToSri(dist.shasum) : undefined);
  return {
    ...(sourceEntry.registry !== undefined && { registry: sourceEntry.registry }),
    ...(requestedVersion !== undefined && { requestedVersion }),
    resolvedVersion,
    ...(integrity !== undefined && { integrity }),
    resolvedAt: new Date().toISOString(),
    skills: mergedSkills,
  };
}

/**
 * Fetch skills from a single npm-transport source (EXPERIMENTAL): resolve the
 * package version via the registry packument, download and verify the
 * tarball, extract it in-memory with the hardened tar reader, and install the
 * discovered skills into the curated directory.
 */
async function fetchSourceViaNpm(params: {
  sourceEntry: SourceEntry;
  projectRoot: string;
  npmLock: NpmSourcesLock;
  localSkillNames: Set<string>;
  alreadyFetchedSkillNames: Set<string>;
  updateSources: boolean;
  logger: Logger;
}): Promise<{ skillCount: number; fetchedSkillNames: string[]; updatedLock: NpmSourcesLock }> {
  const {
    sourceEntry,
    projectRoot,
    npmLock,
    localSkillNames,
    alreadyFetchedSkillNames,
    updateSources,
    logger,
  } = params;

  const packageName = sourceEntry.source;
  validateNpmPackageName(packageName);
  const registryUrl = sourceEntry.registry ?? DEFAULT_NPM_REGISTRY_URL;
  validateNpmRegistryUrl(registryUrl, { logger });
  const token = resolveNpmToken({ tokenEnv: sourceEntry.tokenEnv });

  const sourceKey = packageName;
  const locked = getNpmLockedSource(npmLock, sourceKey);
  const lockedSkillNames = locked ? getNpmLockedSkillNames(locked) : [];
  const curatedDir = join(projectRoot, RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH);

  const { lockedVersion, requestedVersion } = resolveNpmFetchVersion({
    sourceEntry,
    locked,
    updateSources,
  });

  // Skip re-fetch if the locked version's curated skills exist on disk
  if (lockedVersion !== undefined) {
    if (await checkLockedSkillsExist(curatedDir, lockedSkillNames)) {
      logger.debug(`Version unchanged for ${sourceKey}, skipping re-fetch.`);
      return { skillCount: 0, fetchedSkillNames: lockedSkillNames, updatedLock: npmLock };
    }
  }

  const { resolvedVersion, dist, tarball } = await downloadVerifiedNpmTarball({
    packageName,
    registryUrl,
    token,
    lockedVersion,
    requestedVersion,
    locked,
    logger,
  });

  const allFiles = extractNpmRemoteFiles({ tarball, logger });

  const declaredFilter = sourceEntry.skills ?? ["*"];
  const declaredWildcard = declaredFilter.length === 1 && declaredFilter[0] === "*";
  const { remoteFiles, skillFilter, isWildcard } = selectNpmSkillFiles({
    allFiles,
    skillsPath: sourceEntry.path ?? "skills",
    skillFilter: declaredFilter,
    isWildcard: declaredWildcard,
    packageName,
  });

  const skillFileMap = groupRemoteFilesBySkillRoot({ remoteFiles, skillFilter, isWildcard });
  const allNames = [...skillFileMap.keys()];
  const filteredNames = isWildcard ? allNames : allNames.filter((n) => skillFilter.includes(n));

  if (locked) {
    await cleanPreviousCuratedSkills({ curatedDir, lockedSkillNames, logger });
  }

  // Adapter so writeSkillAndComputeIntegrity can compare per-skill integrity
  // against the npm lock entry the same way it does for git sources.
  const lockedForIntegrityCheck: LockedSource | undefined = locked
    ? { resolvedRef: locked.resolvedVersion, skills: locked.skills }
    : undefined;

  const fetchedSkills: Record<string, LockedSkill> = {};
  for (const skillName of filteredNames) {
    if (
      shouldSkipSkill({
        skillName,
        sourceKey,
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
      locked: lockedForIntegrityCheck,
      resolvedSha: resolvedVersion,
      sourceKey,
      logger,
    });
    logger.debug(`Fetched skill "${skillName}" from ${sourceKey}`);
  }

  const fetchedNames = Object.keys(fetchedSkills);
  const mergedSkills = mergeFetchedWithLockedSkills({
    fetchedSkills,
    lockedSkills: locked?.skills,
    remoteSkillNames: filteredNames,
  });

  const updatedLock = setNpmLockedSource(
    npmLock,
    sourceKey,
    buildNpmLockEntry({ sourceEntry, requestedVersion, resolvedVersion, dist, mergedSkills }),
  );

  logger.info(
    `Fetched ${fetchedNames.length} skill(s) from ${sourceKey}: ${fetchedNames.join(", ") || "(none)"}`,
  );

  return {
    skillCount: fetchedNames.length,
    fetchedSkillNames: fetchedNames,
    updatedLock,
  };
}
