import { join, posix, resolve, sep } from "node:path";

import { Semaphore } from "es-toolkit/promise";

import type { SourceEntry } from "../config/config.js";
import { SKILL_FILE_NAME } from "../constants/general.js";
import {
  FETCH_CONCURRENCY_LIMIT,
  RULESYNC_CURATED_RULES_RELATIVE_DIR_PATH,
  MAX_FILE_SIZE,
  RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH,
  RULESYNC_NPM_SOURCES_LOCK_RELATIVE_FILE_PATH,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
  RULESYNC_SOURCES_LOCK_RELATIVE_FILE_PATH,
} from "../constants/rulesync-paths.js";
import { getLocalSkillDirNames } from "../features/skills/skills-utils.js";
import type { GitHubFileEntry, ParsedSource } from "../types/fetch.js";
import { formatError } from "../utils/error.js";
import {
  assertDirectoryIfExists,
  assertTreeContainsNoSymlinks,
  assertWritablePathInsideRoot,
  checkPathTraversal,
  directoryExists,
  fileExists,
  listFilePathsRecursively,
  readFileContent,
  removeFileStrict,
  removeDirectoryStrict,
  runWithDirectoryRollback,
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
  getNpmLockedRuleNames,
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
  type LockedRule,
  type LockedSource,
  type SourcesLock,
  computeRuleIntegrity,
  computeSkillIntegrity,
  getLockedRuleNames,
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
  /** Keep lock entries for sources omitted from this invocation. */
  preserveUnlistedLockEntries?: boolean;
  /** Treat a source resolving to no installed or locked skills as a failure. */
  requireResolvedSkills?: boolean;
  /** Treat a source resolving to no installed or locked rules as a failure. */
  requireResolvedRules?: boolean;
  /** Skill names owned by earlier sources and unavailable to this invocation. */
  reservedSkillNames?: string[];
  /** Rule names owned by earlier sources and unavailable to this invocation. */
  reservedRuleNames?: string[];
};

export type ResolveAndFetchSourcesResult = {
  fetchedSkillCount: number;
  fetchedRuleCount: number;
  sourcesProcessed: number;
  failedSourceCount: number;
};

function getEarlySourcesResult(params: {
  skipSources: boolean;
  logger: Logger;
}): ResolveAndFetchSourcesResult | undefined {
  if (!params.skipSources) {
    return undefined;
  }
  if (params.skipSources) {
    params.logger.info("Skipping source fetching.");
  }
  return {
    fetchedSkillCount: 0,
    fetchedRuleCount: 0,
    sourcesProcessed: 0,
    failedSourceCount: 0,
  };
}

type RemoteSkillFile = {
  relativePath: string;
  content: string;
};

type RemoteRuleFile = {
  name: string;
  content: string;
};

/**
 * Resolve declared sources, fetch remote rules and skills into their curated
 * directories, and update the lockfile.
 */
export async function resolveAndFetchSources(params: {
  sources: SourceEntry[];
  projectRoot: string;
  options?: ResolveAndFetchSourcesOptions;
  logger: Logger;
}): Promise<ResolveAndFetchSourcesResult> {
  const { sources, projectRoot, options = {}, logger } = params;
  const {
    updateSources = false,
    skipSources = false,
    frozen = false,
    preserveUnlistedLockEntries = false,
    requireResolvedSkills = false,
    requireResolvedRules = false,
    reservedSkillNames = [],
    reservedRuleNames = [],
  } = options;
  const earlyResult = getEarlySourcesResult({
    skipSources,
    logger,
  });
  if (earlyResult) {
    return earlyResult;
  }

  await assertSourceOutputPathsAreSafe(projectRoot);

  // Read existing lockfiles. npm-transport sources are pinned in a separate
  // lockfile (`rulesync-npm.lock.json`) because they lock a package version +
  // tarball integrity instead of a git commit SHA.
  let lock: SourcesLock = await readLockFile({ projectRoot, logger });
  let npmLock: NpmSourcesLock = await readNpmLockFile({ projectRoot, logger });

  // Frozen mode: validate lockfiles cover all declared sources.
  // Missing curated skills are fetched using locked refs.
  validateFrozenLockCoverage({ frozen, lock, npmLock, sources });

  const originalLockJson = JSON.stringify(lock);
  const originalNpmLockJson = JSON.stringify(npmLock);

  // Resolve GitHub token
  const token = GitHubClient.resolveToken(options.token);
  const client = new GitHubClient({ token });

  // Determine local skills (in .rulesync/skills/ but not in .curated/)
  const localSkillNames = await getLocalSkillDirNames(projectRoot);
  const localRuleNames = await getLocalRuleNames(projectRoot);

  if (!preserveUnlistedLockEntries && !frozen) {
    await cleanUnlistedSourceArtifacts({ projectRoot, lock, npmLock, sources, logger });
    lock = pruneStaleLockEntries({ lock, sources, logger });
    npmLock = pruneStaleNpmLockEntries({ npmLock, sources, logger });
  }

  let totalSkillCount = 0;
  let totalRuleCount = 0;
  let failedSourceCount = 0;
  const allFetchedSkillNames = new Set(reservedSkillNames);
  const allFetchedRuleNames = new Set(reservedRuleNames);

  for (const sourceEntry of sources) {
    try {
      const result = await runWithDirectoryRollback({
        directoryPaths: [
          join(projectRoot, RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH),
          join(projectRoot, RULESYNC_CURATED_RULES_RELATIVE_DIR_PATH),
        ],
        action: () =>
          fetchSingleSource({
            sourceEntry,
            client,
            projectRoot,
            lock,
            npmLock,
            localSkillNames,
            localRuleNames,
            alreadyFetchedSkillNames: allFetchedSkillNames,
            alreadyFetchedRuleNames: allFetchedRuleNames,
            updateSources,
            frozen,
            logger,
          }),
      });

      lock = result.lock;
      npmLock = result.npmLock;
      failedSourceCount += resolvedSourceFailureCount({
        requireSkills: requireResolvedSkills,
        requireRules: requireResolvedRules,
        resolvedSkillNames: result.fetchedSkillNames,
        resolvedRuleNames: result.fetchedRuleNames,
      });
      totalSkillCount += result.skillCount;
      totalRuleCount += result.ruleCount;
      addNamesToSet({ names: result.fetchedSkillNames, target: allFetchedSkillNames });
      addNamesToSet({ names: result.fetchedRuleNames, target: allFetchedRuleNames });
    } catch (error) {
      failedSourceCount += 1;
      logSourceFetchFailure({ sourceEntry, error, logger });
    }
  }

  await writeLockFilesIfChanged({
    projectRoot,
    lock,
    npmLock,
    originalLockJson,
    originalNpmLockJson,
    frozen,
    logger,
  });

  return {
    fetchedSkillCount: totalSkillCount,
    fetchedRuleCount: totalRuleCount,
    sourcesProcessed: sources.length,
    failedSourceCount,
  };
}

async function assertSourceOutputPathsAreSafe(projectRoot: string): Promise<void> {
  const curatedSkillsPath = join(projectRoot, RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH);
  const curatedRulesPath = join(projectRoot, RULESYNC_CURATED_RULES_RELATIVE_DIR_PATH);
  const sourcesLockPath = join(projectRoot, RULESYNC_SOURCES_LOCK_RELATIVE_FILE_PATH);
  const npmSourcesLockPath = join(projectRoot, RULESYNC_NPM_SOURCES_LOCK_RELATIVE_FILE_PATH);
  await Promise.all([
    assertWritablePathInsideRoot({ rootPath: projectRoot, targetPath: curatedSkillsPath }),
    assertWritablePathInsideRoot({ rootPath: projectRoot, targetPath: curatedRulesPath }),
    assertWritablePathInsideRoot({ rootPath: projectRoot, targetPath: sourcesLockPath }),
    assertWritablePathInsideRoot({ rootPath: projectRoot, targetPath: npmSourcesLockPath }),
    assertDirectoryIfExists(curatedSkillsPath),
    assertDirectoryIfExists(curatedRulesPath),
  ]);
  if (await directoryExists(curatedSkillsPath)) {
    await assertTreeContainsNoSymlinks(curatedSkillsPath);
  }
  if (await directoryExists(curatedRulesPath)) {
    await assertTreeContainsNoSymlinks(curatedRulesPath);
  }
}

function addNamesToSet(params: { names: string[]; target: Set<string> }): void {
  params.names.forEach((name) => params.target.add(name));
}

function resolvedSourceFailureCount({
  requireSkills,
  requireRules,
  resolvedSkillNames,
  resolvedRuleNames,
}: {
  requireSkills: boolean;
  requireRules: boolean;
  resolvedSkillNames: string[];
  resolvedRuleNames: string[];
}): number {
  return (requireSkills && resolvedSkillNames.length === 0) ||
    (requireRules && resolvedRuleNames.length === 0)
    ? 1
    : 0;
}

function getSourceFilters(sourceEntry: SourceEntry): {
  skills: string[] | undefined;
  rules: string[] | undefined;
} {
  const hasExplicitFeature = sourceEntry.skills !== undefined || sourceEntry.rules !== undefined;
  return {
    skills: sourceEntry.skills ?? (hasExplicitFeature ? undefined : ["*"]),
    rules: sourceEntry.rules,
  };
}

/** The subdirectory of the rules tree that holds the fetched copy of remote rules. */
const CURATED_RULES_SUBDIR_NAME = posix.relative(
  RULESYNC_RULES_RELATIVE_DIR_PATH,
  RULESYNC_CURATED_RULES_RELATIVE_DIR_PATH,
);

/**
 * The names of the rules the project holds itself, which take precedence over
 * the rules a source offers under the same name.
 *
 * Walked rather than globbed: globby reads a backslash as a path separator and
 * rewrites it in the paths it returns, so a rule file named `back\\slash.md`
 * would be recorded as the rule `back/slash`, which is not the name of any rule
 * on disk — a remote rule of that name would then be skipped in favour of a
 * local rule that does not exist.
 *
 * The curated subtree is named rather than left to the walk's hidden-entry
 * rule, which happens to cover it today only because the name starts with a
 * dot. Reading a fetched rule as a local one is not a small mistake: it would
 * take precedence over its own source and never be refreshed again. The prefix
 * is matched with the native separator alone, since a backslash inside a name
 * is the very thing the walk exists to preserve.
 */
async function getLocalRuleNames(projectRoot: string): Promise<Set<string>> {
  const rulesDir = join(projectRoot, RULESYNC_RULES_RELATIVE_DIR_PATH);
  const relativePaths = await listFilePathsRecursively(rulesDir, {
    nameFilter: (name) => name.toLowerCase().endsWith(".md"),
  });
  return new Set(
    relativePaths
      .filter((relativePath) => !relativePath.startsWith(`${CURATED_RULES_SUBDIR_NAME}${sep}`))
      .map((relativePath) => relativePath.replace(/\.md$/i, "")),
  );
}

export async function getInstalledSourceSkillNames({
  sources,
  projectRoot,
  logger,
}: {
  sources: SourceEntry[];
  projectRoot: string;
  logger: Logger;
}): Promise<string[]> {
  const lock = await readLockFile({ projectRoot, logger });
  const npmLock = await readNpmLockFile({ projectRoot, logger });
  const curatedDir = join(projectRoot, RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH);
  const skillNames = new Set<string>();
  for (const source of sources) {
    const npmTransport = (source.transport ?? "github") === "npm";
    const entry = npmTransport
      ? getNpmLockedSource(npmLock, source.source)
      : getLockedSource(lock, source.source);
    const lockedSkillNames = entry
      ? npmTransport
        ? getNpmLockedSkillNames(entry as NpmLockedSource)
        : getLockedSkillNames(entry as LockedSource)
      : [];
    if (entry === undefined || !(await checkLockedSkillsExist(curatedDir, lockedSkillNames))) {
      throw new Error(
        `Existing source "${source.source}" is not fully installed. Run 'rulesync install' before adding another source.`,
      );
    }
    lockedSkillNames.forEach((skillName) => skillNames.add(skillName));
  }
  return [...skillNames];
}

export async function getInstalledSourceRuleNames({
  sources,
  projectRoot,
  logger,
}: {
  sources: SourceEntry[];
  projectRoot: string;
  logger: Logger;
}): Promise<string[]> {
  const lock = await readLockFile({ projectRoot, logger });
  const npmLock = await readNpmLockFile({ projectRoot, logger });
  const curatedDir = join(projectRoot, RULESYNC_CURATED_RULES_RELATIVE_DIR_PATH);
  const ruleNames = new Set<string>();
  for (const source of sources) {
    if (getSourceFilters(source).rules === undefined) {
      continue;
    }
    const npmTransport = (source.transport ?? "github") === "npm";
    const entry = npmTransport
      ? getNpmLockedSource(npmLock, source.source)
      : getLockedSource(lock, source.source);
    const lockedRuleNames = entry
      ? npmTransport
        ? getNpmLockedRuleNames(entry as NpmLockedSource)
        : getLockedRuleNames(entry as LockedSource)
      : [];
    if (
      entry === undefined ||
      entry.rules === undefined ||
      !lockedRuleConfigMatches({ locked: entry, sourceEntry: source }) ||
      !(await checkLockedRulesAreValid({ curatedDir, locked: entry }))
    ) {
      throw new Error(
        `Existing source "${source.source}" is not fully installed. Run 'rulesync install' before adding another source.`,
      );
    }
    lockedRuleNames.forEach((ruleName) => ruleNames.add(ruleName));
  }
  return [...ruleNames];
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
  localRuleNames: Set<string>;
  alreadyFetchedSkillNames: Set<string>;
  alreadyFetchedRuleNames: Set<string>;
  updateSources: boolean;
  frozen: boolean;
  logger: Logger;
}): Promise<{
  skillCount: number;
  ruleCount: number;
  fetchedSkillNames: string[];
  fetchedRuleNames: string[];
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
      localRuleNames: params.localRuleNames,
      alreadyFetchedSkillNames: params.alreadyFetchedSkillNames,
      alreadyFetchedRuleNames: params.alreadyFetchedRuleNames,
      updateSources: params.updateSources,
      logger: params.logger,
    });
    return {
      skillCount: result.skillCount,
      ruleCount: result.ruleCount,
      fetchedSkillNames: result.fetchedSkillNames,
      fetchedRuleNames: result.fetchedRuleNames,
      lock,
      npmLock: result.updatedLock,
    };
  }
  const filters = getSourceFilters(sourceEntry);
  let updatedLock = lock;
  let skillCount = 0;
  let fetchedSkillNames: string[] = [];
  if (filters.skills !== undefined) {
    const result = await fetchSourceByTransport({
      sourceEntry: { ...sourceEntry, skills: filters.skills },
      client: params.client,
      projectRoot: params.projectRoot,
      lock: updatedLock,
      localSkillNames: params.localSkillNames,
      alreadyFetchedSkillNames: params.alreadyFetchedSkillNames,
      updateSources: params.updateSources,
      frozen: params.frozen,
      logger: params.logger,
    });
    updatedLock = result.updatedLock;
    skillCount = result.skillCount;
    fetchedSkillNames = result.fetchedSkillNames;
  }

  let ruleCount = 0;
  let fetchedRuleNames: string[] = [];
  if (filters.rules !== undefined) {
    const result = await fetchRulesByTransport({
      sourceEntry: { ...sourceEntry, rules: filters.rules },
      client: params.client,
      projectRoot: params.projectRoot,
      lock: updatedLock,
      localRuleNames: params.localRuleNames,
      alreadyFetchedRuleNames: params.alreadyFetchedRuleNames,
      // A preceding skill fetch has already resolved and locked this source.
      // Reuse that exact ref so one source cannot mix artifacts from two SHAs.
      updateSources: filters.skills === undefined ? params.updateSources : false,
      forceRefetch: filters.skills !== undefined && params.updateSources,
      frozen: params.frozen,
      logger: params.logger,
    });
    updatedLock = result.updatedLock;
    ruleCount = result.ruleCount;
    fetchedRuleNames = result.fetchedRuleNames;
  } else {
    updatedLock = await clearUndeclaredRules({
      lock: updatedLock,
      sourceEntry,
      projectRoot: params.projectRoot,
      alreadyFetchedRuleNames: params.alreadyFetchedRuleNames,
      logger: params.logger,
    });
  }
  return {
    skillCount,
    ruleCount,
    fetchedSkillNames,
    fetchedRuleNames,
    lock: updatedLock,
    npmLock,
  };
}

async function clearUndeclaredRules(params: {
  lock: SourcesLock;
  sourceEntry: SourceEntry;
  projectRoot: string;
  alreadyFetchedRuleNames: Set<string>;
  logger: Logger;
}): Promise<SourcesLock> {
  const { lock, sourceEntry, projectRoot, alreadyFetchedRuleNames, logger } = params;
  const locked = getLockedSource(lock, sourceEntry.source);
  if (locked?.rules === undefined) {
    return lock;
  }
  await cleanPreviousCuratedRules({
    curatedDir: join(projectRoot, RULESYNC_CURATED_RULES_RELATIVE_DIR_PATH),
    lockedRuleNames: getLockedRuleNames(locked),
    protectedRuleNames: alreadyFetchedRuleNames,
    logger,
  });
  return setLockedSource(lock, sourceEntry.source, {
    ...locked,
    rules: undefined,
    ruleSelection: undefined,
    rulesPath: undefined,
    resolvedRuleNames: undefined,
  });
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
    const rulesCovered =
      getSourceFilters(source).rules === undefined ||
      (locked !== undefined && lockedRuleConfigMatches({ locked, sourceEntry: source }));
    if (!locked || !rulesCovered) {
      missingKeys.push(source.source);
    }
  }
  if (missingKeys.length > 0) {
    throw new Error(
      `Frozen install failed: lockfile is missing entries for: ${missingKeys.join(", ")}. Run 'rulesync install' to update the lockfile.`,
    );
  }
}

function validateFrozenLockCoverage(params: {
  frozen: boolean;
  lock: SourcesLock;
  npmLock: NpmSourcesLock;
  sources: SourceEntry[];
}): void {
  if (params.frozen) {
    assertFrozenLockCoversSources(params);
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

async function cleanUnlistedSourceArtifacts(params: {
  projectRoot: string;
  lock: SourcesLock;
  npmLock: NpmSourcesLock;
  sources: SourceEntry[];
  logger: Logger;
}): Promise<void> {
  const { projectRoot, lock, npmLock, sources, logger } = params;
  const activeGitKeys = new Set(
    sources
      .filter((source) => (source.transport ?? "github") !== "npm")
      .map((source) => normalizeSourceKey(source.source)),
  );
  const activeNpmKeys = new Set(
    sources
      .filter((source) => (source.transport ?? "github") === "npm")
      .map((source) => normalizeNpmSourceKey(source.source)),
  );
  const activeEntries = [
    ...Object.entries(lock.sources)
      .filter(([key]) => activeGitKeys.has(normalizeSourceKey(key)))
      .map(([, entry]) => entry),
    ...Object.entries(npmLock.sources)
      .filter(([key]) => activeNpmKeys.has(normalizeNpmSourceKey(key)))
      .map(([, entry]) => entry),
  ];
  const protectedSkillNames = new Set(activeEntries.flatMap((entry) => Object.keys(entry.skills)));
  const protectedRuleNames = new Set(
    activeEntries.flatMap((entry) => Object.keys(entry.rules ?? {})),
  );
  const staleEntries = [
    ...Object.entries(lock.sources)
      .filter(([key]) => !activeGitKeys.has(normalizeSourceKey(key)))
      .map(([, entry]) => entry),
    ...Object.entries(npmLock.sources)
      .filter(([key]) => !activeNpmKeys.has(normalizeNpmSourceKey(key)))
      .map(([, entry]) => entry),
  ];
  const curatedSkillsDir = join(projectRoot, RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH);
  const curatedRulesDir = join(projectRoot, RULESYNC_CURATED_RULES_RELATIVE_DIR_PATH);
  for (const entry of staleEntries) {
    await cleanPreviousCuratedSkills({
      curatedDir: curatedSkillsDir,
      lockedSkillNames: Object.keys(entry.skills),
      protectedSkillNames,
      logger,
    });
    await cleanPreviousCuratedRules({
      curatedDir: curatedRulesDir,
      lockedRuleNames: Object.keys(entry.rules ?? {}),
      protectedRuleNames,
      logger,
    });
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

async function checkLockedRulesAreValid(params: {
  curatedDir: string;
  locked: Pick<LockedSource, "rules">;
}): Promise<boolean> {
  for (const [name, entry] of Object.entries(params.locked.rules ?? {})) {
    const filePath = join(params.curatedDir, `${name}.md`);
    if (!(await fileExists(filePath))) {
      return false;
    }
    if (computeRuleIntegrity(await readFileContent(filePath)) !== entry.integrity) {
      return false;
    }
  }
  return true;
}

async function canReuseLockedRules(params: {
  locked: LockedSource | NpmLockedSource;
  sourceEntry: SourceEntry;
  lockedRuleNames: string[];
  localRuleNames: Set<string>;
  alreadyFetchedRuleNames: Set<string>;
  curatedDir: string;
}): Promise<boolean> {
  const {
    locked,
    sourceEntry,
    lockedRuleNames,
    localRuleNames,
    alreadyFetchedRuleNames,
    curatedDir,
  } = params;
  if (!lockedRuleConfigMatches({ locked, sourceEntry })) {
    return false;
  }
  if (locked.resolvedRuleNames === undefined) {
    return false;
  }
  const availableRuleNames = new Set([
    ...lockedRuleNames,
    ...localRuleNames,
    ...alreadyFetchedRuleNames,
  ]);
  if (locked.resolvedRuleNames.some((ruleName) => !availableRuleNames.has(ruleName))) {
    return false;
  }
  if (
    lockedRuleNames.some(
      (ruleName) => localRuleNames.has(ruleName) || alreadyFetchedRuleNames.has(ruleName),
    )
  ) {
    return false;
  }
  return checkLockedRulesAreValid({ curatedDir, locked });
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
  protectedSkillNames?: Set<string>;
  logger: Logger;
}): Promise<void> {
  const { curatedDir, lockedSkillNames, protectedSkillNames = new Set(), logger } = params;
  const resolvedCuratedDir = resolve(curatedDir);
  for (const prevSkill of lockedSkillNames) {
    if (protectedSkillNames.has(prevSkill)) {
      continue;
    }
    const prevDir = join(curatedDir, prevSkill);
    if (!resolve(prevDir).startsWith(resolvedCuratedDir + sep)) {
      logger.warn(
        `Skipping removal of "${prevSkill}": resolved path is outside the curated directory.`,
      );
      continue;
    }
    if (await directoryExists(prevDir)) {
      await removeDirectoryStrict(prevDir);
    }
  }
}

async function cleanPreviousCuratedRules(params: {
  curatedDir: string;
  lockedRuleNames: string[];
  protectedRuleNames: Set<string>;
  logger: Logger;
}): Promise<void> {
  const { curatedDir, lockedRuleNames, protectedRuleNames, logger } = params;
  const resolvedCuratedDir = resolve(curatedDir);
  for (const prevRule of lockedRuleNames) {
    if (protectedRuleNames.has(prevRule)) {
      continue;
    }
    const prevFile = join(curatedDir, `${prevRule}.md`);
    if (!resolve(prevFile).startsWith(resolvedCuratedDir + sep)) {
      logger.warn(
        `Skipping removal of "${prevRule}": resolved path is outside the curated directory.`,
      );
      continue;
    }
    if (await fileExists(prevFile)) {
      await removeFileStrict(prevFile);
    }
  }
}

async function replaceCuratedRules(params: {
  rules: RemoteRuleFile[];
  curatedDir: string;
  locked: LockedSource | undefined;
  lockedRuleNames: string[];
  resolvedRef: string;
  sourceKey: string;
  localRuleNames: Set<string>;
  alreadyFetchedRuleNames: Set<string>;
  compareLockedIntegrity: boolean;
  logger: Logger;
}): Promise<Record<string, LockedRule>> {
  const {
    rules,
    curatedDir,
    locked,
    lockedRuleNames,
    resolvedRef,
    sourceKey,
    localRuleNames,
    alreadyFetchedRuleNames,
    compareLockedIntegrity,
    logger,
  } = params;
  const protectedRuleNames = alreadyFetchedRuleNames;
  const installableRules = rules.filter(
    (rule) =>
      !shouldSkipRule({
        ruleName: rule.name,
        sourceKey,
        localRuleNames,
        alreadyFetchedRuleNames,
        logger,
      }),
  );
  const previousContents = new Map<string, string>();
  for (const name of lockedRuleNames) {
    const path = join(curatedDir, `${name}.md`);
    if (!protectedRuleNames.has(name) && (await fileExists(path))) {
      previousContents.set(name, await readFileContent(path));
    }
  }

  try {
    await cleanPreviousCuratedRules({
      curatedDir,
      lockedRuleNames,
      protectedRuleNames,
      logger,
    });
    const fetchedRules: Record<string, LockedRule> = {};
    for (const rule of installableRules) {
      fetchedRules[rule.name] = await writeRuleAndComputeIntegrity({
        rule,
        curatedDir,
        locked,
        resolvedRef,
        sourceKey,
        compareLockedIntegrity,
        logger,
      });
    }
    return fetchedRules;
  } catch (error) {
    for (const rule of installableRules) {
      await removeFileStrict(join(curatedDir, `${rule.name}.md`));
    }
    for (const [name, content] of previousContents) {
      await writeFileContent(join(curatedDir, `${name}.md`), content);
    }
    throw error;
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

function shouldSkipRule(params: {
  ruleName: string;
  sourceKey: string;
  localRuleNames: Set<string>;
  alreadyFetchedRuleNames: Set<string>;
  logger: Logger;
}): boolean {
  const { ruleName, sourceKey, localRuleNames, alreadyFetchedRuleNames, logger } = params;
  if (!isValidRuleName(ruleName)) {
    logger.warn(`Skipping rule with invalid name "${ruleName}" from ${sourceKey}.`);
    return true;
  }
  if (localRuleNames.has(ruleName)) {
    logger.debug(
      `Skipping remote rule "${ruleName}" from ${sourceKey}: local rule takes precedence.`,
    );
    return true;
  }
  if (alreadyFetchedRuleNames.has(ruleName)) {
    logger.warn(
      `Skipping duplicate rule "${ruleName}" from ${sourceKey}: already fetched from another source.`,
    );
    return true;
  }
  return false;
}

function isValidRuleName(ruleName: string): boolean {
  return !(
    ruleName.includes("..") ||
    ruleName.includes("/") ||
    ruleName.includes("\\") ||
    ruleName.length === 0 ||
    ["__proto__", "constructor", "prototype"].includes(ruleName)
  );
}

async function writeRuleAndComputeIntegrity(params: {
  rule: RemoteRuleFile;
  curatedDir: string;
  locked: LockedSource | undefined;
  resolvedRef: string;
  sourceKey: string;
  compareLockedIntegrity?: boolean;
  logger: Logger;
}): Promise<LockedRule> {
  const {
    rule,
    curatedDir,
    locked,
    resolvedRef,
    sourceKey,
    compareLockedIntegrity = true,
    logger,
  } = params;
  const relativePath = `${rule.name}.md`;
  checkPathTraversal({ relativePath, intendedRootDir: curatedDir });
  await writeFileContent(join(curatedDir, relativePath), rule.content);
  const integrity = computeRuleIntegrity(rule.content);
  const lockedRuleEntry = locked?.rules?.[rule.name];
  if (
    compareLockedIntegrity &&
    lockedRuleEntry?.integrity &&
    lockedRuleEntry.integrity !== integrity &&
    resolvedRef === locked?.resolvedRef
  ) {
    logger.warn(
      `Integrity mismatch for rule "${rule.name}" from ${sourceKey}: expected "${lockedRuleEntry.integrity}", got "${integrity}". Content may have been tampered with.`,
    );
  }
  return { integrity };
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

function assertMatchingSkillsFound({
  skillNames,
  source,
}: {
  skillNames: string[];
  source: string;
}): void {
  if (skillNames.length === 0) {
    throw new Error(`No matching skills found in ${source}.`);
  }
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
    rules: locked?.rules ?? {},
    ruleSelection: locked?.ruleSelection,
    rulesPath: locked?.rulesPath,
    resolvedRuleNames: locked?.resolvedRuleNames,
  });

  logger.info(
    `Fetched ${fetchedNames.length} skill(s) from ${sourceKey}: ${fetchedNames.join(", ") || "(none)"}`,
  );

  return { updatedLock, fetchedNames };
}

function buildRuleLockUpdate(params: {
  lock: SourcesLock;
  sourceKey: string;
  fetchedRules: Record<string, LockedRule>;
  locked: LockedSource | undefined;
  requestedRef: string | undefined;
  resolvedRef: string;
  ruleSelection: string[];
  rulesPath: string;
  resolvedRuleNames: string[];
  logger: Logger;
}): { updatedLock: SourcesLock; fetchedNames: string[] } {
  const {
    lock,
    sourceKey,
    fetchedRules,
    locked,
    requestedRef,
    resolvedRef,
    ruleSelection,
    rulesPath,
    resolvedRuleNames,
    logger,
  } = params;
  const fetchedNames = Object.keys(fetchedRules);
  const updatedLock = setLockedSource(lock, sourceKey, {
    requestedRef,
    resolvedRef,
    resolvedAt: new Date().toISOString(),
    skills: locked?.skills ?? {},
    rules: fetchedRules,
    ruleSelection,
    rulesPath,
    resolvedRuleNames,
  });
  logger.info(
    `Fetched ${fetchedNames.length} rule(s) from ${sourceKey}: ${fetchedNames.join(", ") || "(none)"}`,
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

function normalizeRuleFilterName(name: string): string {
  return name.replace(/\.md$/i, "");
}

function normalizeRuleSelection(rules: string[]): string[] {
  return [...new Set(rules.map(normalizeRuleFilterName))].toSorted();
}

function normalizeRulesPath(rulesPath: string | undefined): string {
  return posix.normalize((rulesPath ?? "rules").replace(/\\/g, "/")).replace(/\/+$/, "");
}

function lockedRuleConfigMatches(params: {
  locked: Pick<LockedSource, "ruleSelection" | "rulesPath">;
  sourceEntry: SourceEntry;
}): boolean {
  const rules = getSourceFilters(params.sourceEntry).rules;
  if (rules === undefined || params.locked.ruleSelection === undefined) {
    return false;
  }
  const selection = normalizeRuleSelection(rules);
  return (
    selection.length === params.locked.ruleSelection.length &&
    selection.every((ruleName, index) => ruleName === params.locked.ruleSelection?.[index]) &&
    normalizeRulesPath(params.sourceEntry.rulesPath) === params.locked.rulesPath
  );
}

function assertMatchingRulesFound(params: { ruleNames: string[]; source: string }): void {
  if (params.ruleNames.length === 0) {
    throw new Error(`No matching rules found in ${params.source}.`);
  }
}

async function fetchRulesByTransport(params: {
  sourceEntry: SourceEntry;
  client: GitHubClient;
  projectRoot: string;
  lock: SourcesLock;
  localRuleNames: Set<string>;
  alreadyFetchedRuleNames: Set<string>;
  updateSources: boolean;
  forceRefetch: boolean;
  frozen: boolean;
  logger: Logger;
}): Promise<{ ruleCount: number; fetchedRuleNames: string[]; updatedLock: SourcesLock }> {
  if ((params.sourceEntry.transport ?? "github") === "git") {
    return fetchRulesViaGit(params);
  }
  return fetchRulesViaGithub(params);
}

async function fetchRulesViaGithub(params: {
  sourceEntry: SourceEntry;
  client: GitHubClient;
  projectRoot: string;
  lock: SourcesLock;
  localRuleNames: Set<string>;
  alreadyFetchedRuleNames: Set<string>;
  updateSources: boolean;
  forceRefetch: boolean;
  logger: Logger;
}): Promise<{ ruleCount: number; fetchedRuleNames: string[]; updatedLock: SourcesLock }> {
  const {
    sourceEntry,
    client,
    projectRoot,
    lock,
    localRuleNames,
    alreadyFetchedRuleNames,
    updateSources,
    forceRefetch,
    logger,
  } = params;
  const parsedFromSource = parseSource(sourceEntry.source);
  const parsed: ParsedSource = {
    ...parsedFromSource,
    ref: sourceEntry.ref ?? parsedFromSource.ref,
  };
  if (parsed.provider === "gitlab") {
    throw new Error(`GitLab sources are not yet supported: "${sourceEntry.source}".`);
  }
  const sourceKey = sourceEntry.source;
  const locked = getLockedSource(lock, sourceKey);
  const lockedRuleNames = locked ? getLockedRuleNames(locked) : [];
  const { ref, resolvedSha, requestedRef } = await resolveGithubFetchRef({
    parsed,
    locked,
    updateSources,
    sourceKey,
    client,
    logger,
  });
  const curatedDir = join(projectRoot, RULESYNC_CURATED_RULES_RELATIVE_DIR_PATH);
  if (
    locked &&
    resolvedSha === locked.resolvedRef &&
    !updateSources &&
    !forceRefetch &&
    (await canReuseLockedRules({
      locked,
      sourceEntry,
      lockedRuleNames,
      localRuleNames,
      alreadyFetchedRuleNames,
      curatedDir,
    }))
  ) {
    logger.debug(`SHA unchanged for ${sourceKey} rules, skipping re-fetch.`);
    return { ruleCount: 0, fetchedRuleNames: lockedRuleNames, updatedLock: lock };
  }

  const ruleFilter = (sourceEntry.rules ?? []).map(normalizeRuleFilterName);
  const isWildcard = ruleFilter.length === 1 && ruleFilter[0] === "*";
  const rulesPath = sourceEntry.rulesPath ?? "rules";
  let entries: GitHubFileEntry[];
  try {
    entries = await client.listDirectory(parsed.owner, parsed.repo, rulesPath, ref);
  } catch (error) {
    if (error instanceof GitHubClientError && error.statusCode === 404) {
      throw new Error(`No ${rulesPath}/ directory found in ${sourceKey}.`, { cause: error });
    }
    throw error;
  }
  const remoteRules = entries
    .filter((entry) => entry.type === "file" && entry.name.toLowerCase().endsWith(".md"))
    .map((entry) => ({ entry, name: normalizeRuleFilterName(entry.name) }))
    .filter(({ name }) => (isWildcard || ruleFilter.includes(name)) && isValidRuleName(name));
  const remoteRuleNames = remoteRules.map(({ name }) => name);
  assertMatchingRulesFound({ ruleNames: remoteRuleNames, source: sourceKey });
  const preparedRules: RemoteRuleFile[] = [];
  for (const { entry, name } of remoteRules) {
    if (entry.size > MAX_FILE_SIZE) {
      logger.warn(
        `Skipping rule "${entry.path}" (${(entry.size / 1024 / 1024).toFixed(2)}MB exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit).`,
      );
      continue;
    }
    if (
      shouldSkipRule({
        ruleName: name,
        sourceKey,
        localRuleNames,
        alreadyFetchedRuleNames,
        logger,
      })
    ) {
      continue;
    }
    const content = await client.getFileContent(parsed.owner, parsed.repo, entry.path, ref);
    preparedRules.push({ name, content });
  }
  const fetchedRules = await replaceCuratedRules({
    rules: preparedRules,
    curatedDir,
    locked,
    lockedRuleNames,
    resolvedRef: resolvedSha,
    sourceKey,
    localRuleNames,
    alreadyFetchedRuleNames,
    compareLockedIntegrity: !updateSources && !forceRefetch,
    logger,
  });
  const result = buildRuleLockUpdate({
    lock,
    sourceKey,
    fetchedRules,
    locked,
    requestedRef,
    resolvedRef: resolvedSha,
    ruleSelection: normalizeRuleSelection(sourceEntry.rules ?? []),
    rulesPath: normalizeRulesPath(sourceEntry.rulesPath),
    resolvedRuleNames: remoteRuleNames,
    logger,
  });
  return {
    ruleCount: result.fetchedNames.length,
    fetchedRuleNames: result.fetchedNames,
    updatedLock: result.updatedLock,
  };
}

async function fetchRulesViaGit(params: {
  sourceEntry: SourceEntry;
  projectRoot: string;
  lock: SourcesLock;
  localRuleNames: Set<string>;
  alreadyFetchedRuleNames: Set<string>;
  updateSources: boolean;
  forceRefetch: boolean;
  frozen: boolean;
  logger: Logger;
}): Promise<{ ruleCount: number; fetchedRuleNames: string[]; updatedLock: SourcesLock }> {
  const {
    sourceEntry,
    projectRoot,
    lock,
    localRuleNames,
    alreadyFetchedRuleNames,
    updateSources,
    forceRefetch,
    frozen,
    logger,
  } = params;
  const sourceKey = sourceEntry.source;
  const locked = getLockedSource(lock, sourceKey);
  const lockedRuleNames = locked ? getLockedRuleNames(locked) : [];
  let resolvedRef: string;
  let requestedRef: string | undefined;
  if (locked && !updateSources) {
    resolvedRef = locked.resolvedRef;
    requestedRef = locked.requestedRef;
    if (requestedRef) validateRef(requestedRef);
  } else if (sourceEntry.ref) {
    requestedRef = sourceEntry.ref;
    resolvedRef = await resolveRefToSha(sourceKey, requestedRef);
  } else {
    const defaultRef = await resolveDefaultRef(sourceKey);
    requestedRef = defaultRef.ref;
    resolvedRef = defaultRef.sha;
  }
  const curatedDir = join(projectRoot, RULESYNC_CURATED_RULES_RELATIVE_DIR_PATH);
  if (
    locked &&
    resolvedRef === locked.resolvedRef &&
    !updateSources &&
    !forceRefetch &&
    (await canReuseLockedRules({
      locked,
      sourceEntry,
      lockedRuleNames,
      localRuleNames,
      alreadyFetchedRuleNames,
      curatedDir,
    }))
  ) {
    return { ruleCount: 0, fetchedRuleNames: lockedRuleNames, updatedLock: lock };
  }
  if (!requestedRef) {
    if (frozen) {
      throw new Error(
        `Frozen install failed: lockfile entry for "${sourceKey}" is missing requestedRef. Run 'rulesync install' to update the lockfile.`,
      );
    }
    const defaultRef = await resolveDefaultRef(sourceKey);
    requestedRef = defaultRef.ref;
    resolvedRef = defaultRef.sha;
  }
  const files = await fetchSkillFiles({
    url: sourceKey,
    ref: requestedRef,
    resolvedRef,
    skillsPath: sourceEntry.rulesPath ?? "rules",
    logger,
  });
  const ruleFilter = (sourceEntry.rules ?? []).map(normalizeRuleFilterName);
  const isWildcard = ruleFilter.length === 1 && ruleFilter[0] === "*";
  const remoteRules = files
    .filter(
      (file) =>
        getFirstPathSeparatorIndex(file.relativePath) === -1 &&
        file.relativePath.toLowerCase().endsWith(".md"),
    )
    .map((file) => ({ name: normalizeRuleFilterName(file.relativePath), content: file.content }))
    .filter((rule) => (isWildcard || ruleFilter.includes(rule.name)) && isValidRuleName(rule.name));
  const remoteRuleNames = remoteRules.map((rule) => rule.name);
  assertMatchingRulesFound({ ruleNames: remoteRuleNames, source: sourceKey });
  const fetchedRules = await replaceCuratedRules({
    rules: remoteRules,
    curatedDir,
    locked,
    lockedRuleNames,
    resolvedRef,
    sourceKey,
    localRuleNames,
    alreadyFetchedRuleNames,
    compareLockedIntegrity: !updateSources && !forceRefetch,
    logger,
  });
  const result = buildRuleLockUpdate({
    lock,
    sourceKey,
    fetchedRules,
    locked,
    requestedRef,
    resolvedRef,
    ruleSelection: normalizeRuleSelection(sourceEntry.rules ?? []),
    rulesPath: normalizeRulesPath(sourceEntry.rulesPath),
    resolvedRuleNames: remoteRuleNames,
    logger,
  });
  return {
    ruleCount: result.fetchedNames.length,
    fetchedRuleNames: result.fetchedNames,
    updatedLock: result.updatedLock,
  };
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
      if (locked) {
        await cleanPreviousCuratedSkills({
          curatedDir,
          lockedSkillNames: Object.keys(locked.skills),
          logger,
        });
      }
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

  const parsedFromSource = parseSource(sourceEntry.source);
  const parsed: ParsedSource = {
    ...parsedFromSource,
    ref: sourceEntry.ref ?? parsedFromSource.ref,
    path: sourceEntry.path ?? parsedFromSource.path,
  };

  if (parsed.provider === "gitlab") {
    throw new Error(`GitLab sources are not yet supported: "${sourceEntry.source}".`);
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
    throw new Error(`No skills/ directory found in ${sourceKey}.`);
  }
  const { remoteSkillDirs, fallbackHandled, remoteSkillNames: fallbackSkillNames } = discovery;

  // Filter skills by name
  const filteredDirs = isWildcard
    ? remoteSkillDirs
    : remoteSkillDirs.filter((d) => skillFilter.includes(d.name));
  const remoteSkillNames = fallbackHandled ? fallbackSkillNames : filteredDirs.map((d) => d.name);
  assertMatchingSkillsFound({ skillNames: remoteSkillNames, source: sourceKey });

  if (locked && !fallbackHandled) {
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
    resolvedRef: resolvedSha,
    skillsPath: sourceEntry.path ?? "skills",
  });

  const skillFileMap = groupRemoteFilesBySkillRoot({ remoteFiles, skillFilter, isWildcard });

  const allNames = [...skillFileMap.keys()];
  const filteredNames = isWildcard ? allNames : allNames.filter((n) => skillFilter.includes(n));
  assertMatchingSkillsFound({ skillNames: filteredNames, source: url });

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
  mergedRules: Record<string, LockedRule>;
  resolvedRuleNames: string[];
}): NpmLockedSource {
  const {
    sourceEntry,
    requestedVersion,
    resolvedVersion,
    dist,
    mergedSkills,
    mergedRules,
    resolvedRuleNames,
  } = params;
  const integrity =
    dist.integrity ?? (dist.shasum !== undefined ? shasumToSri(dist.shasum) : undefined);
  return {
    ...(sourceEntry.registry !== undefined && { registry: sourceEntry.registry }),
    ...(requestedVersion !== undefined && { requestedVersion }),
    resolvedVersion,
    ...(integrity !== undefined && { integrity }),
    resolvedAt: new Date().toISOString(),
    skills: mergedSkills,
    ...(sourceEntry.rules !== undefined && {
      rules: mergedRules,
      ruleSelection: normalizeRuleSelection(sourceEntry.rules),
      rulesPath: normalizeRulesPath(sourceEntry.rulesPath),
      resolvedRuleNames,
    }),
  };
}

async function fetchNpmSkills(params: {
  allFiles: RemoteSkillFile[];
  sourceEntry: SourceEntry;
  packageName: string;
  locked: NpmLockedSource | undefined;
  lockedForIntegrityCheck: LockedSource | undefined;
  lockedSkillNames: string[];
  curatedSkillsDir: string;
  localSkillNames: Set<string>;
  alreadyFetchedSkillNames: Set<string>;
  resolvedVersion: string;
  logger: Logger;
}): Promise<{
  fetchedSkills: Record<string, LockedSkill>;
  remoteSkillNames: string[];
}> {
  if (params.sourceEntry.skills === undefined) {
    return { fetchedSkills: {}, remoteSkillNames: [] };
  }
  const {
    allFiles,
    sourceEntry,
    packageName,
    locked,
    lockedForIntegrityCheck,
    lockedSkillNames,
    curatedSkillsDir,
    localSkillNames,
    alreadyFetchedSkillNames,
    resolvedVersion,
    logger,
  } = params;
  const skillFilter = sourceEntry.skills ?? [];
  const declaredWildcard = skillFilter.length === 1 && skillFilter[0] === "*";
  const selectedFiles = selectNpmSkillFiles({
    allFiles,
    skillsPath: sourceEntry.path ?? "skills",
    skillFilter,
    isWildcard: declaredWildcard,
    packageName,
  });
  const skillFileMap = groupRemoteFilesBySkillRoot(selectedFiles);
  const allNames = [...skillFileMap.keys()];
  const remoteSkillNames = selectedFiles.isWildcard
    ? allNames
    : allNames.filter((name) => selectedFiles.skillFilter.includes(name));
  assertMatchingSkillsFound({ skillNames: remoteSkillNames, source: packageName });
  if (locked) {
    await cleanPreviousCuratedSkills({ curatedDir: curatedSkillsDir, lockedSkillNames, logger });
  }
  const fetchedSkills: Record<string, LockedSkill> = {};
  for (const skillName of remoteSkillNames) {
    if (
      shouldSkipSkill({
        skillName,
        sourceKey: packageName,
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
      curatedDir: curatedSkillsDir,
      locked: lockedForIntegrityCheck,
      resolvedSha: resolvedVersion,
      sourceKey: packageName,
      logger,
    });
    logger.debug(`Fetched skill "${skillName}" from ${packageName}`);
  }
  return { fetchedSkills, remoteSkillNames };
}

async function fetchNpmRules(params: {
  allFiles: RemoteSkillFile[];
  sourceEntry: SourceEntry;
  packageName: string;
  lockedForIntegrityCheck: LockedSource | undefined;
  lockedRuleNames: string[];
  curatedRulesDir: string;
  localRuleNames: Set<string>;
  alreadyFetchedRuleNames: Set<string>;
  resolvedVersion: string;
  updateSources: boolean;
  logger: Logger;
}): Promise<{ fetchedRules: Record<string, LockedRule>; resolvedRuleNames: string[] }> {
  if (params.sourceEntry.rules === undefined) {
    return { fetchedRules: {}, resolvedRuleNames: [] };
  }
  const {
    allFiles,
    sourceEntry,
    packageName,
    lockedForIntegrityCheck,
    lockedRuleNames,
    curatedRulesDir,
    localRuleNames,
    alreadyFetchedRuleNames,
    resolvedVersion,
    updateSources,
    logger,
  } = params;
  const normalizedRulesPath = normalizeRulesPath(sourceEntry.rulesPath);
  const rulePrefix = normalizedRulesPath === "." ? "" : `${normalizedRulesPath}/`;
  const ruleFilter = (sourceEntry.rules ?? []).map(normalizeRuleFilterName);
  const isWildcard = ruleFilter.length === 1 && ruleFilter[0] === "*";
  const remoteRules = allFiles
    .filter((file) => file.relativePath.startsWith(rulePrefix))
    .map((file) => ({
      relativePath: file.relativePath.substring(rulePrefix.length),
      content: file.content,
    }))
    .filter(
      (file) =>
        getFirstPathSeparatorIndex(file.relativePath) === -1 &&
        file.relativePath.toLowerCase().endsWith(".md"),
    )
    .map((file) => ({ name: normalizeRuleFilterName(file.relativePath), content: file.content }))
    .filter((rule) => (isWildcard || ruleFilter.includes(rule.name)) && isValidRuleName(rule.name));
  const resolvedRuleNames = remoteRules.map((rule) => rule.name);
  assertMatchingRulesFound({ ruleNames: resolvedRuleNames, source: packageName });
  const fetchedRules = await replaceCuratedRules({
    rules: remoteRules,
    curatedDir: curatedRulesDir,
    locked: lockedForIntegrityCheck,
    lockedRuleNames,
    resolvedRef: resolvedVersion,
    sourceKey: packageName,
    localRuleNames,
    alreadyFetchedRuleNames,
    compareLockedIntegrity: !updateSources,
    logger,
  });
  return { fetchedRules, resolvedRuleNames };
}

async function canReuseLockedNpmArtifacts(params: {
  locked: NpmLockedSource | undefined;
  sourceEntry: SourceEntry;
  filters: ReturnType<typeof getSourceFilters>;
  lockedSkillNames: string[];
  lockedRuleNames: string[];
  curatedSkillsDir: string;
  curatedRulesDir: string;
  localRuleNames: Set<string>;
  alreadyFetchedRuleNames: Set<string>;
}): Promise<boolean> {
  const {
    locked,
    sourceEntry,
    filters,
    lockedSkillNames,
    lockedRuleNames,
    curatedSkillsDir,
    curatedRulesDir,
    localRuleNames,
    alreadyFetchedRuleNames,
  } = params;
  if (locked === undefined) {
    return false;
  }
  const skillsExist =
    filters.skills === undefined ||
    (lockedSkillNames.length > 0 &&
      (await checkLockedSkillsExist(curatedSkillsDir, lockedSkillNames)));
  if (!skillsExist) {
    return false;
  }
  if (filters.rules === undefined) {
    return locked.rules === undefined;
  }
  return canReuseLockedRules({
    locked,
    sourceEntry: { ...sourceEntry, rules: filters.rules },
    lockedRuleNames,
    localRuleNames,
    alreadyFetchedRuleNames,
    curatedDir: curatedRulesDir,
  });
}

/**
 * Fetch rules and skills from a single npm-transport source (EXPERIMENTAL): resolve the
 * package version via the registry packument, download and verify the
 * tarball, extract it in-memory with the hardened tar reader, and install the
 * discovered skills into the curated directory.
 */
async function fetchSourceViaNpm(params: {
  sourceEntry: SourceEntry;
  projectRoot: string;
  npmLock: NpmSourcesLock;
  localSkillNames: Set<string>;
  localRuleNames: Set<string>;
  alreadyFetchedSkillNames: Set<string>;
  alreadyFetchedRuleNames: Set<string>;
  updateSources: boolean;
  logger: Logger;
}): Promise<{
  skillCount: number;
  ruleCount: number;
  fetchedSkillNames: string[];
  fetchedRuleNames: string[];
  updatedLock: NpmSourcesLock;
}> {
  const {
    sourceEntry,
    projectRoot,
    npmLock,
    localSkillNames,
    localRuleNames,
    alreadyFetchedSkillNames,
    alreadyFetchedRuleNames,
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
  const lockedRuleNames = locked ? getNpmLockedRuleNames(locked) : [];
  const curatedSkillsDir = join(projectRoot, RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH);
  const curatedRulesDir = join(projectRoot, RULESYNC_CURATED_RULES_RELATIVE_DIR_PATH);
  const filters = getSourceFilters(sourceEntry);

  const { lockedVersion, requestedVersion } = resolveNpmFetchVersion({
    sourceEntry,
    locked,
    updateSources,
  });

  // Skip re-fetch if the locked version's requested curated artifacts exist on disk.
  if (
    lockedVersion !== undefined &&
    (await canReuseLockedNpmArtifacts({
      locked,
      sourceEntry,
      filters,
      lockedSkillNames,
      lockedRuleNames,
      curatedSkillsDir,
      curatedRulesDir,
      localRuleNames,
      alreadyFetchedRuleNames,
    }))
  ) {
    logger.debug(`Version unchanged for ${sourceKey}, skipping re-fetch.`);
    return {
      skillCount: 0,
      ruleCount: 0,
      fetchedSkillNames: filters.skills === undefined ? [] : lockedSkillNames,
      fetchedRuleNames: filters.rules === undefined ? [] : lockedRuleNames,
      updatedLock: npmLock,
    };
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

  // Adapter so writeSkillAndComputeIntegrity can compare per-skill integrity
  // against the npm lock entry the same way it does for git sources.
  const lockedForIntegrityCheck: LockedSource | undefined = locked
    ? { resolvedRef: locked.resolvedVersion, skills: locked.skills, rules: locked.rules }
    : undefined;

  const { fetchedSkills, remoteSkillNames } = await fetchNpmSkills({
    allFiles,
    sourceEntry: { ...sourceEntry, skills: filters.skills },
    packageName,
    locked,
    lockedForIntegrityCheck,
    lockedSkillNames,
    curatedSkillsDir,
    localSkillNames,
    alreadyFetchedSkillNames,
    resolvedVersion,
    logger,
  });

  const { fetchedRules, resolvedRuleNames } = await fetchNpmRules({
    allFiles,
    sourceEntry: { ...sourceEntry, rules: filters.rules },
    packageName,
    lockedForIntegrityCheck,
    lockedRuleNames,
    curatedRulesDir,
    localRuleNames,
    alreadyFetchedRuleNames,
    resolvedVersion,
    updateSources,
    logger,
  });

  if (filters.rules === undefined && locked?.rules !== undefined) {
    await cleanPreviousCuratedRules({
      curatedDir: curatedRulesDir,
      lockedRuleNames,
      protectedRuleNames: alreadyFetchedRuleNames,
      logger,
    });
  }

  const fetchedSkillNames = Object.keys(fetchedSkills);
  const fetchedRuleNames = Object.keys(fetchedRules);
  const mergedSkills = mergeFetchedWithLockedSkills({
    fetchedSkills,
    lockedSkills: locked?.skills,
    remoteSkillNames:
      filters.skills === undefined ? Object.keys(locked?.skills ?? {}) : remoteSkillNames,
  });
  const mergedRules = filters.rules === undefined ? {} : fetchedRules;

  const updatedLock = setNpmLockedSource(
    npmLock,
    sourceKey,
    buildNpmLockEntry({
      sourceEntry,
      requestedVersion,
      resolvedVersion,
      dist,
      mergedSkills,
      mergedRules,
      resolvedRuleNames,
    }),
  );

  logger.info(
    `Fetched ${fetchedSkillNames.length} skill(s) and ${fetchedRuleNames.length} rule(s) from ${sourceKey}.`,
  );

  return {
    skillCount: fetchedSkillNames.length,
    ruleCount: fetchedRuleNames.length,
    fetchedSkillNames,
    fetchedRuleNames,
    updatedLock,
  };
}
