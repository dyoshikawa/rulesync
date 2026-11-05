import { basename, join, sep } from "node:path";

import { getSourceTransport, type SourceEntry } from "../config/config.js";
import {
  CURATED_RULES_FEATURE_SUBDIR,
  RULESYNC_CURATED_RULES_RELATIVE_DIR_PATH,
  RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH,
  RULESYNC_NPM_SOURCES_LOCK_RELATIVE_FILE_PATH,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
  RULESYNC_SOURCES_LOCK_RELATIVE_FILE_PATH,
} from "../constants/rulesync-paths.js";
import { getLocalSkillDirNames } from "../features/skills/skills-utils.js";
import { formatError } from "../utils/error.js";
import {
  assertDirectoryIfExists,
  assertTreeContainsNoSymlinks,
  assertWritablePathInsideRoot,
  directoryExists,
  listFilePathsRecursively,
  runWithDirectoryRollback,
} from "../utils/file.js";
import type { Logger } from "../utils/logger.js";
import { GitClientError } from "./git-client.js";
import { GitHubClient, GitHubClientError, logGitHubAuthHints } from "./github-client.js";
import { MemoizingGitHubClient } from "./memoizing-github-client.js";
import { logNpmAuthHints, NpmClientError } from "./npm-client.js";
import {
  getNpmLockedSource,
  type NpmLockedSource,
  type NpmSourcesLock,
  normalizeNpmSourceKey,
  readNpmLockFile,
  writeNpmLockFile,
} from "./npm-sources-lock.js";
import { parseSource } from "./source-parser.js";
import {
  checkLockedRulesAreValid,
  checkLockedSkillsAreValid,
  cleanPreviousCuratedRules,
  cleanPreviousCuratedSkills,
  getEmptySelections,
  getSourceFilters,
  hasEmptySelection,
  lockedRefMatchesDeclared,
  lockedRuleConfigMatches,
  lockedSkillConfigMatches,
  resolveRulesPath,
  resolveSkillsPath,
} from "./sources-artifacts.js";
import { fetchRulesViaGit, fetchSourceViaGit } from "./sources-git.js";
import { fetchRulesViaGithub, fetchSource, prefetchGithubSources } from "./sources-github.js";
import {
  type LockedSource,
  type SourcesLock,
  getLockedRuleNames,
  getLockKeyRepository,
  getLockedSource,
  normalizeLockKey,
  readLockFile,
  renameLockedSource,
  resolveSourceLockKeys,
  setLockedSource,
  writeLockFile,
} from "./sources-lock.js";
import { fetchSourceViaNpm } from "./sources-npm.js";

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
  // Several entries may declare the same repository (e.g. different `path`s);
  // each gets its own lock entry under the key resolved here.
  const lockKeys = resolveSourceLockKeys(sources);
  lock = migrateSourceLockKeys({ lock, sources, lockKeys, logger });

  // Frozen mode: validate lockfiles cover all declared sources.
  // Missing curated skills are fetched using locked refs.
  if (frozen) {
    assertFrozenLockCoversSources({ lock, npmLock, sources });
  }

  const originalLockJson = JSON.stringify(lock);
  const originalNpmLockJson = JSON.stringify(npmLock);

  // Resolve GitHub token. The client holds every answer for this run, so the
  // serial pass below reads what the concurrent prefetch already downloaded.
  const token = GitHubClient.resolveToken(options.token);
  const client = new MemoizingGitHubClient({ token });

  // Determine local skills (in .rulesync/skills/ but not in .curated/)
  const localSkillNames = await getLocalSkillDirNames(projectRoot);
  const localRuleNames = await getLocalRuleNames(projectRoot);

  if (!preserveUnlistedLockEntries && !frozen) {
    await cleanUnlistedSourceArtifacts({ projectRoot, lock, npmLock, sources, lockKeys, logger });
    lock = pruneStaleLockEntries({ lock, sources, lockKeys, logger });
    npmLock = pruneStaleNpmLockEntries({ npmLock, sources, logger });
  }

  let totalSkillCount = 0;
  let totalRuleCount = 0;
  let failedSourceCount = 0;
  const allFetchedSkillNames = new Set(reservedSkillNames);
  const allFetchedRuleNames = new Set(reservedRuleNames);

  // Download the GitHub sources concurrently first. Writes, name-collision
  // resolution and lockfile updates stay in the serial loop below, in declared
  // order, so the result is the same as a fully serial run.
  await prefetchGithubSources({
    sources,
    lockKeys,
    client,
    projectRoot,
    lock,
    localSkillNames,
    localRuleNames,
    reservedSkillNames: allFetchedSkillNames,
    reservedRuleNames: allFetchedRuleNames,
    updateSources,
    frozen,
    logger,
  });

  for (const [index, sourceEntry] of sources.entries()) {
    try {
      const result = await runWithDirectoryRollback({
        directoryPaths: [
          join(projectRoot, RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH),
          join(projectRoot, RULESYNC_CURATED_RULES_RELATIVE_DIR_PATH),
        ],
        action: () =>
          fetchSingleSource({
            sourceEntry,
            lockKey: lockKeys[index] ?? normalizeLockKey(sourceEntry.source),
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

// ---------------------------------------------------------------------------
// Concurrent prefetch of GitHub sources
// ---------------------------------------------------------------------------

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

/**
 * The name, within the rules tree, of the subdirectory holding the fetched copy
 * of remote rules. Taken as the last segment of the feature subdirectory rather
 * than by subtracting one path from another, so no separator spelling is
 * involved on either side.
 *
 * Split on the native separator, the one the constant was joined with and the one
 * the path it is compared against is split on. The posix reading would leave the
 * whole `rules\\.curated` on Windows, where it matches no segment at all.
 */
const CURATED_RULES_SUBDIR_NAME = basename(CURATED_RULES_FEATURE_SUBDIR);

/**
 * The names of the rules the project holds itself, which take precedence over
 * the rules a source offers under the same name.
 *
 * Walked rather than globbed: globby reads a backslash as a path separator and
 * rewrites it in the paths it returns, so a rule file named `back\\slash.md`
 * would be recorded as the rule `back/slash`, a name no rule on disk has. No
 * remote rule can be named that either — `isValidRuleName` rejects a separator
 * — so nothing is skipped over it today; the set simply has to say what the
 * project holds, since that is the whole question it answers.
 *
 * The `.md` test is case-sensitive to match the glob that loads the rules, so a
 * name can only land in this set if a rule of that name really loads. A
 * `NOTES.MD` counted here but not loaded there would shadow the remote `NOTES`
 * and leave the project with neither. The walk is de-duplicated by file
 * identity for the same reason: it reports every name it passes, while the
 * loader's glob keeps one name per file, so a rule shared inside the tree
 * through a symbolic link would otherwise be counted under an alias the loader
 * never uses -- shadowing the remote rule of that name while loading nothing
 * under it.
 *
 * The curated subtree is named rather than left to the walk's hidden-entry
 * rule, which happens to cover it today only because the name starts with a
 * dot. Reading a fetched rule as a local one is not a small mistake: it would
 * take precedence over its own source and never be refreshed again. Its own
 * first segment is compared, not a prefix of the path, so a rule really named
 * `.curated-notes/x.md` is left alone. The split is on the native separator
 * alone: the walk joins with it, and a backslash inside a name -- the very
 * thing the walk exists to preserve -- must not divide a segment in two.
 */
async function getLocalRuleNames(projectRoot: string): Promise<Set<string>> {
  const rulesDir = join(projectRoot, RULESYNC_RULES_RELATIVE_DIR_PATH);
  const relativePaths = await listFilePathsRecursively(rulesDir, {
    nameFilter: (name) => name.endsWith(".md"),
    deduplicateByFileIdentity: true,
  });
  return new Set(
    relativePaths
      .filter((relativePath) => relativePath.split(sep)[0] !== CURATED_RULES_SUBDIR_NAME)
      .map((relativePath) => relativePath.replace(/\.md$/, "")),
  );
}

/**
 * Read both lockfiles (npm first) and migrate the git lockfile's keys to the
 * ones the declared sources resolve to.
 */
export async function loadSourceLocks(params: {
  sources: SourceEntry[];
  projectRoot: string;
  logger: Logger;
}): Promise<{ lock: SourcesLock; npmLock: NpmSourcesLock; lockKeys: string[] }> {
  const { sources, projectRoot, logger } = params;
  const npmLock = await readNpmLockFile({ projectRoot, logger });
  const lockKeys = resolveSourceLockKeys(sources);
  const lock = migrateSourceLockKeys({
    lock: await readLockFile({ projectRoot, logger }),
    sources,
    lockKeys,
    logger,
  });
  return { lock, npmLock, lockKeys };
}

/**
 * The lock entry of the declared source at `index`, looked up in the lockfile
 * of its transport.
 */
function getDeclaredLockedSource(params: {
  source: SourceEntry;
  index: number;
  lock: SourcesLock;
  npmLock: NpmSourcesLock;
  lockKeys: string[];
}): LockedSource | NpmLockedSource | undefined {
  const { source, index, lock, npmLock, lockKeys } = params;
  return getSourceTransport(source) === "npm"
    ? getNpmLockedSource(npmLock, source.source)
    : getLockedSource(lock, lockKeys[index] ?? source.source);
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
  const { lock, npmLock, lockKeys } = await loadSourceLocks({ sources, projectRoot, logger });
  const curatedDir = join(projectRoot, RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH);
  const skillNames = new Set<string>();
  for (const [index, source] of sources.entries()) {
    const entry = getDeclaredLockedSource({ source, index, lock, npmLock, lockKeys });
    const lockedSkillNames = entry ? Object.keys(entry.skills) : [];
    if (
      entry === undefined ||
      (getSourceFilters(source).skills !== undefined &&
        !lockedSkillConfigMatches({ locked: entry, sourceEntry: source, acceptLegacy: true })) ||
      !(await checkLockedSkillsAreValid({
        curatedDir,
        skills: entry.skills,
        presenceOnlySkillNames: skillNames,
      }))
    ) {
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
  const { lock, npmLock, lockKeys } = await loadSourceLocks({ sources, projectRoot, logger });
  const curatedDir = join(projectRoot, RULESYNC_CURATED_RULES_RELATIVE_DIR_PATH);
  const ruleNames = new Set<string>();
  for (const [index, source] of sources.entries()) {
    if (getSourceFilters(source).rules === undefined) {
      continue;
    }
    const entry = getDeclaredLockedSource({ source, index, lock, npmLock, lockKeys });
    const lockedRuleNames = entry ? Object.keys(entry.rules ?? {}) : [];
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
 * Carry lock entries over to the keys {@link resolveSourceLockKeys} gives the
 * declared sources now (immutable — returns a fresh lock object).
 *
 * A source's key changes without its location changing when a second entry
 * for its repository is declared (bare key to qualified key), when all but
 * one are removed (qualified to bare), or when entries are reordered. Without
 * this, the entry under the old key would be pruned and its artifacts removed,
 * and the source would be resolved afresh, moving it to a newer commit without
 * `--update` and failing `--frozen`.
 *
 * A source whose key has no entry takes over an entry of the same repository
 * that no declared source's key claims, when that entry was recorded for this
 * source's location (see {@link lockedLocationMatches}): it locked the same
 * kinds of artifacts from the same `skillsPath` / `rulesPath`, and its
 * `requestedRef` matches the declared ref.
 * The entry moves as a whole, so its commit and integrity hashes are reused
 * exactly as they would have been under the old key.
 */
function migrateSourceLockKeys(params: {
  lock: SourcesLock;
  sources: SourceEntry[];
  lockKeys: string[];
  logger: Logger;
}): SourcesLock {
  const { sources, lockKeys, logger } = params;
  let lock = params.lock;
  const claimedKeys = new Set(
    sources.flatMap((source, index) =>
      getSourceTransport(source) === "npm"
        ? []
        : [normalizeLockKey(lockKeys[index] ?? source.source)],
    ),
  );
  for (const [index, source] of sources.entries()) {
    const lockKey = lockKeys[index];
    if (
      lockKey === undefined ||
      getSourceTransport(source) === "npm" ||
      hasEmptySelection(source) ||
      getLockedSource(lock, lockKey) !== undefined
    ) {
      continue;
    }
    const repository = getLockKeyRepository(lockKey);
    const candidate = Object.entries(lock.sources).find(
      ([key, entry]) =>
        !claimedKeys.has(normalizeLockKey(key)) &&
        getLockKeyRepository(key) === repository &&
        lockedLocationMatches({ locked: entry, sourceEntry: source }),
    );
    if (candidate === undefined) {
      continue;
    }
    const [fromKey] = candidate;
    logger.debug(`Moved lockfile entry "${fromKey}" to "${lockKey}".`);
    lock = renameLockedSource({ lock, fromKey, toKey: lockKey });
  }
  return lock;
}

/**
 * Whether a lock entry was recorded for the location a source declares: it
 * locked the same kinds of artifacts the source takes (skills, rules or
 * both), each from the path the source declares, for the declared ref. An
 * entry locking both kinds is never taken over by a source taking only one of
 * them, so a source declared earlier cannot claim another source's entry
 * merely because one of their paths agrees.
 */
function lockedLocationMatches(params: {
  locked: LockedSource;
  sourceEntry: SourceEntry;
}): boolean {
  const { locked, sourceEntry } = params;
  const filters = getSourceFilters(sourceEntry);
  const skillsMatch =
    filters.skills === undefined
      ? locked.skillsPath === undefined
      : locked.skillsPath === resolveSkillsPath(sourceEntry);
  const rulesMatch =
    filters.rules === undefined
      ? locked.rulesPath === undefined
      : locked.rulesPath === resolveRulesPath(sourceEntry);
  return (
    skillsMatch &&
    rulesMatch &&
    lockedRefMatchesDeclared({ locked, declaredRef: getDeclaredSourceRef(sourceEntry) })
  );
}

/**
 * Reject an empty `skills` or `rules` list up front. An empty list is most
 * likely meant as "take none of this feature", which is spelled by omitting
 * the field, so point at that form instead of reporting a selection that
 * matched nothing.
 */
function assertNonEmptySelections(sourceEntry: SourceEntry): void {
  const { source } = sourceEntry;
  const { skillsEmpty, rulesEmpty } = getEmptySelections(sourceEntry);
  if (skillsEmpty && rulesEmpty) {
    throw new Error(
      `\`skills\` and \`rules\` are both empty lists for ${source}. To take nothing from this source, remove it from \`sources\`.`,
    );
  }
  if (skillsEmpty) {
    throw new Error(
      `\`skills\` is an empty list for ${source}. To take no skills from this source, omit \`skills\` and list only \`rules\`.`,
    );
  }
  if (rulesEmpty) {
    // Omitting both fields falls back to every skill, so the hint must keep
    // `skills` declared rather than suggest dropping `rules` alone.
    throw new Error(
      `\`rules\` is an empty list for ${source}. To take no rules from this source, omit \`rules\` and list the skills you want in \`skills\`.`,
    );
  }
}

/**
 * Dispatch a single source to the npm fetcher or the git/github fetcher,
 * returning the (possibly) updated lock objects for both lockfiles.
 */
async function fetchSingleSource(params: {
  sourceEntry: SourceEntry;
  lockKey: string;
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
  const { sourceEntry, lockKey, lock, npmLock } = params;
  assertNonEmptySelections(sourceEntry);
  if (getSourceTransport(sourceEntry) === "npm") {
    const result = await fetchSourceViaNpm({
      sourceEntry,
      projectRoot: params.projectRoot,
      npmLock,
      localSkillNames: params.localSkillNames,
      localRuleNames: params.localRuleNames,
      alreadyFetchedSkillNames: params.alreadyFetchedSkillNames,
      alreadyFetchedRuleNames: params.alreadyFetchedRuleNames,
      updateSources: params.updateSources,
      frozen: params.frozen,
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
      lockKey,
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
      lockKey,
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
      lockKey,
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
  lockKey: string;
  projectRoot: string;
  alreadyFetchedRuleNames: Set<string>;
  logger: Logger;
}): Promise<SourcesLock> {
  const { lock, lockKey, projectRoot, alreadyFetchedRuleNames, logger } = params;
  const locked = getLockedSource(lock, lockKey);
  if (locked?.rules === undefined) {
    return lock;
  }
  await cleanPreviousCuratedRules({
    curatedDir: join(projectRoot, RULESYNC_CURATED_RULES_RELATIVE_DIR_PATH),
    lockedRuleNames: getLockedRuleNames(locked),
    protectedRuleNames: alreadyFetchedRuleNames,
    logger,
  });
  return setLockedSource(lock, lockKey, {
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
 * The ref a git or GitHub source declares in the manifest: its `ref` field,
 * else (GitHub transport) a ref written into the source string itself.
 * `undefined` when it declares none and installs the default branch.
 */
function getDeclaredSourceRef(sourceEntry: SourceEntry): string | undefined {
  if (sourceEntry.ref !== undefined || sourceEntry.transport === "git") {
    return sourceEntry.ref;
  }
  return parseSource(sourceEntry.source).ref;
}

/** The git and GitHub sources whose declared ref differs from the locked one. */
function describeDriftedSourceRefs(params: {
  lock: SourcesLock;
  sources: SourceEntry[];
}): string[] {
  const { lock, sources } = params;
  const lockKeys = resolveSourceLockKeys(sources);
  const drifted: string[] = [];
  for (const [index, source] of sources.entries()) {
    if (source.transport === "npm" || hasEmptySelection(source)) continue;
    const locked = getLockedSource(lock, lockKeys[index] ?? source.source);
    const declaredRef = getDeclaredSourceRef(source);
    if (locked && !lockedRefMatchesDeclared({ locked, declaredRef })) {
      drifted.push(
        `${source.source} (declared=${declaredRef}, lock=${locked.requestedRef ?? "(none)"})`,
      );
    }
  }
  return drifted;
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
  const lockKeys = resolveSourceLockKeys(sources);
  const missingKeys: string[] = [];

  for (const [index, source] of sources.entries()) {
    // An empty `skills` / `rules` list is rejected per source by
    // `assertNonEmptySelections` with a hint on how to fix it. Leave it to
    // that check rather than reporting a less helpful lockfile mismatch.
    if (hasEmptySelection(source)) {
      continue;
    }
    const locked = getDeclaredLockedSource({ source, index, lock, npmLock, lockKeys });
    const filters = getSourceFilters(source);
    const skillsCovered =
      filters.skills === undefined ||
      (locked !== undefined &&
        lockedSkillConfigMatches({ locked, sourceEntry: source, acceptLegacy: true }));
    const rulesCovered =
      filters.rules === undefined ||
      (locked !== undefined && lockedRuleConfigMatches({ locked, sourceEntry: source }));
    if (!locked || !skillsCovered || !rulesCovered) {
      missingKeys.push(source.source);
    }
  }
  if (missingKeys.length > 0) {
    throw new Error(
      `Frozen install failed: lockfile is missing entries or does not cover the declared selection for: ${missingKeys.join(", ")}. Run 'rulesync install' to update the lockfile.`,
    );
  }
  const driftedRefs = describeDriftedSourceRefs({ lock, sources });
  if (driftedRefs.length > 0) {
    throw new Error(
      `Frozen install failed: declared ref does not match the lockfile for: ${driftedRefs.join(", ")}. Run 'rulesync install' to update the lockfile.`,
    );
  }
}

/**
 * Dispatch a single source to the transport-specific fetcher (git CLI vs.
 * GitHub REST API), preserving the original default of "github".
 */
async function fetchSourceByTransport(params: {
  sourceEntry: SourceEntry;
  lockKey: string;
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
    lockKey,
    client,
    projectRoot,
    lock,
    localSkillNames,
    alreadyFetchedSkillNames,
    updateSources,
    frozen,
    logger,
  } = params;
  const transport = getSourceTransport(sourceEntry);
  if (transport === "git") {
    return fetchSourceViaGit({
      sourceEntry,
      lockKey,
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
    lockKey,
    client,
    projectRoot,
    lock,
    localSkillNames,
    alreadyFetchedSkillNames,
    updateSources,
    frozen,
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
  lockKeys: string[];
  logger: Logger;
}): SourcesLock {
  const { lock, sources, lockKeys, logger } = params;
  const sourceKeys = getActiveGitLockKeys({ sources, lockKeys });
  const prunedSources: typeof lock.sources = {};
  for (const [key, value] of Object.entries(lock.sources)) {
    if (sourceKeys.has(normalizeLockKey(key))) {
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
      .filter((s) => getSourceTransport(s) === "npm")
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

/** The normalized lock keys of the declared git and GitHub sources. */
function getActiveGitLockKeys(params: { sources: SourceEntry[]; lockKeys: string[] }): Set<string> {
  const { sources, lockKeys } = params;
  return new Set(
    sources.flatMap((source, index) =>
      getSourceTransport(source) === "npm"
        ? []
        : [normalizeLockKey(lockKeys[index] ?? source.source)],
    ),
  );
}

async function cleanUnlistedSourceArtifacts(params: {
  projectRoot: string;
  lock: SourcesLock;
  npmLock: NpmSourcesLock;
  sources: SourceEntry[];
  lockKeys: string[];
  logger: Logger;
}): Promise<void> {
  const { projectRoot, lock, npmLock, sources, lockKeys, logger } = params;
  const activeGitKeys = getActiveGitLockKeys({ sources, lockKeys });
  const activeNpmKeys = new Set(
    sources
      .filter((source) => getSourceTransport(source) === "npm")
      .map((source) => normalizeNpmSourceKey(source.source)),
  );
  const activeEntries = [
    ...Object.entries(lock.sources)
      .filter(([key]) => activeGitKeys.has(normalizeLockKey(key)))
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
      .filter(([key]) => !activeGitKeys.has(normalizeLockKey(key)))
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

async function fetchRulesByTransport(params: {
  sourceEntry: SourceEntry;
  lockKey: string;
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
  if (getSourceTransport(params.sourceEntry) === "git") {
    return fetchRulesViaGit(params);
  }
  return fetchRulesViaGithub(params);
}
