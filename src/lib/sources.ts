import { basename, join, sep } from "node:path";

import { getSourceTransport, type SourceEntry } from "../config/config.js";
import {
  CURATED_RULES_FEATURE_SUBDIR,
  RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
  RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH,
  RULESYNC_NPM_SOURCES_LOCK_RELATIVE_FILE_PATH,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
  RULESYNC_SOURCES_LOCK_RELATIVE_FILE_PATH,
  RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
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
  checkLockedFilesAreValid,
  checkLockedSkillsAreValid,
  cleanPreviousCuratedFiles,
  cleanPreviousCuratedSkills,
  getCuratedFileFeatureRelativeDirPath,
  getEmptySelectionFields,
  getSourceFilters,
  hasEmptySelection,
  lockedFileConfigMatches,
  lockedRefMatchesDeclared,
  lockedSkillConfigMatches,
  resolveFileFeaturePath,
  resolveSkillsPath,
  type SourceSelectionField,
} from "./sources-artifacts.js";
import { fetchFilesViaGit, fetchSourceViaGit } from "./sources-git.js";
import { fetchFilesViaGithub, fetchSource, prefetchGithubSources } from "./sources-github.js";
import {
  type LockedSource,
  type SourceFileFeature,
  type SourcesLock,
  SOURCE_FILE_FEATURES,
  getLockedFileFeatureState,
  getLockedFileNames,
  getLockKeyRepository,
  getLockedSource,
  normalizeLockKey,
  readLockFile,
  renameLockedSource,
  resolveSourceLockKeys,
  setLockedSource,
  toFileFeatureLockFields,
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
  /** Treat a source resolving to no installed or locked commands as a failure. */
  requireResolvedCommands?: boolean;
  /** Treat a source resolving to no installed or locked subagents as a failure. */
  requireResolvedSubagents?: boolean;
  /** Command names owned by earlier sources and unavailable to this invocation. */
  reservedCommandNames?: string[];
  /** Subagent names owned by earlier sources and unavailable to this invocation. */
  reservedSubagentNames?: string[];
};

export type ResolveAndFetchSourcesResult = {
  fetchedSkillCount: number;
  fetchedRuleCount: number;
  fetchedCommandCount: number;
  fetchedSubagentCount: number;
  sourcesProcessed: number;
  failedSourceCount: number;
};

/** A value per per-file feature (rules, commands and subagents). */
type PerFileFeature<T> = Record<SourceFileFeature, T>;

function mapFileFeatures<T>(map: (feature: SourceFileFeature) => T): PerFileFeature<T> {
  return { rules: map("rules"), commands: map("commands"), subagents: map("subagents") };
}

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
    fetchedCommandCount: 0,
    fetchedSubagentCount: 0,
    sourcesProcessed: 0,
    failedSourceCount: 0,
  };
}

/** The options of {@link resolveAndFetchSources} with their defaults, per-file features grouped. */
function resolveFetchOptions(options: ResolveAndFetchSourcesOptions) {
  return {
    updateSources: options.updateSources ?? false,
    skipSources: options.skipSources ?? false,
    frozen: options.frozen ?? false,
    preserveUnlistedLockEntries: options.preserveUnlistedLockEntries ?? false,
    requireResolvedSkills: options.requireResolvedSkills ?? false,
    reservedSkillNames: options.reservedSkillNames ?? [],
    requireResolvedFiles: {
      rules: options.requireResolvedRules ?? false,
      commands: options.requireResolvedCommands ?? false,
      subagents: options.requireResolvedSubagents ?? false,
    } satisfies PerFileFeature<boolean>,
    reservedFileNames: {
      rules: options.reservedRuleNames ?? [],
      commands: options.reservedCommandNames ?? [],
      subagents: options.reservedSubagentNames ?? [],
    } satisfies PerFileFeature<string[]>,
  };
}

/**
 * Resolve declared sources, fetch remote skills, rules, commands and subagents
 * into their curated directories, and update the lockfile.
 */
export async function resolveAndFetchSources(params: {
  sources: SourceEntry[];
  projectRoot: string;
  options?: ResolveAndFetchSourcesOptions;
  logger: Logger;
}): Promise<ResolveAndFetchSourcesResult> {
  const { sources, projectRoot, options = {}, logger } = params;
  const {
    updateSources,
    skipSources,
    frozen,
    preserveUnlistedLockEntries,
    requireResolvedSkills,
    reservedSkillNames,
    requireResolvedFiles,
    reservedFileNames,
  } = resolveFetchOptions(options);
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
  const localFileNames: PerFileFeature<Set<string>> = {
    rules: await getLocalFileNames({ projectRoot, feature: "rules" }),
    commands: await getLocalFileNames({ projectRoot, feature: "commands" }),
    subagents: await getLocalFileNames({ projectRoot, feature: "subagents" }),
  };

  if (!preserveUnlistedLockEntries && !frozen) {
    await cleanUnlistedSourceArtifacts({ projectRoot, lock, npmLock, sources, lockKeys, logger });
    lock = pruneStaleLockEntries({ lock, sources, lockKeys, logger });
    npmLock = pruneStaleNpmLockEntries({ npmLock, sources, logger });
  }

  let totalSkillCount = 0;
  const totalFileCounts: PerFileFeature<number> = { rules: 0, commands: 0, subagents: 0 };
  let failedSourceCount = 0;
  const allFetchedSkillNames = new Set(reservedSkillNames);
  const allFetchedFileNames = mapFileFeatures((feature) => new Set(reservedFileNames[feature]));

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
    localFileNames,
    reservedSkillNames: allFetchedSkillNames,
    reservedFileNames: allFetchedFileNames,
    updateSources,
    frozen,
    logger,
  });

  for (const [index, sourceEntry] of sources.entries()) {
    try {
      const result = await runWithDirectoryRollback({
        directoryPaths: [
          join(projectRoot, RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH),
          ...SOURCE_FILE_FEATURES.map((feature) =>
            join(projectRoot, getCuratedFileFeatureRelativeDirPath(feature)),
          ),
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
            localFileNames,
            alreadyFetchedSkillNames: allFetchedSkillNames,
            alreadyFetchedFileNames: allFetchedFileNames,
            updateSources,
            frozen,
            logger,
          }),
      });

      lock = result.lock;
      npmLock = result.npmLock;
      failedSourceCount += resolvedSourceFailureCount({
        requireSkills: requireResolvedSkills,
        requireFiles: requireResolvedFiles,
        resolvedSkillNames: result.fetchedSkillNames,
        resolvedFileNames: result.fetchedFileNames,
      });
      totalSkillCount += result.skillCount;
      addNamesToSet({ names: result.fetchedSkillNames, target: allFetchedSkillNames });
      for (const feature of SOURCE_FILE_FEATURES) {
        totalFileCounts[feature] += result.fileCounts[feature];
        addNamesToSet({
          names: result.fetchedFileNames[feature],
          target: allFetchedFileNames[feature],
        });
      }
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
    fetchedRuleCount: totalFileCounts.rules,
    fetchedCommandCount: totalFileCounts.commands,
    fetchedSubagentCount: totalFileCounts.subagents,
    sourcesProcessed: sources.length,
    failedSourceCount,
  };
}

// ---------------------------------------------------------------------------
// Concurrent prefetch of GitHub sources
// ---------------------------------------------------------------------------

/**
 * Every directory a source install writes fetched files into, as paths under
 * the project root.
 */
function getCuratedSourceDirPaths(projectRoot: string): string[] {
  return [
    join(projectRoot, RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH),
    ...SOURCE_FILE_FEATURES.map((feature) =>
      join(projectRoot, getCuratedFileFeatureRelativeDirPath(feature)),
    ),
  ];
}

/**
 * Refuse to install when a curated directory or a lockfile would be written
 * outside the project root (through a symbolic link on the way there), is not
 * a directory, or holds a symbolic link, so fetched content can never be
 * written outside `.rulesync/`.
 */
async function assertSourceOutputPathsAreSafe(projectRoot: string): Promise<void> {
  const curatedPaths = getCuratedSourceDirPaths(projectRoot);
  const sourcesLockPath = join(projectRoot, RULESYNC_SOURCES_LOCK_RELATIVE_FILE_PATH);
  const npmSourcesLockPath = join(projectRoot, RULESYNC_NPM_SOURCES_LOCK_RELATIVE_FILE_PATH);
  await Promise.all([
    ...curatedPaths.map((targetPath) =>
      assertWritablePathInsideRoot({ rootPath: projectRoot, targetPath }),
    ),
    assertWritablePathInsideRoot({ rootPath: projectRoot, targetPath: sourcesLockPath }),
    assertWritablePathInsideRoot({ rootPath: projectRoot, targetPath: npmSourcesLockPath }),
    ...curatedPaths.map((curatedPath) => assertDirectoryIfExists(curatedPath)),
  ]);
  for (const curatedPath of curatedPaths) {
    if (await directoryExists(curatedPath)) {
      await assertTreeContainsNoSymlinks(curatedPath);
    }
  }
}

function addNamesToSet(params: { names: string[]; target: Set<string> }): void {
  params.names.forEach((name) => params.target.add(name));
}

function resolvedSourceFailureCount({
  requireSkills,
  requireFiles,
  resolvedSkillNames,
  resolvedFileNames,
}: {
  requireSkills: boolean;
  requireFiles: PerFileFeature<boolean>;
  resolvedSkillNames: string[];
  resolvedFileNames: PerFileFeature<string[]>;
}): number {
  return (requireSkills && resolvedSkillNames.length === 0) ||
    SOURCE_FILE_FEATURES.some(
      (feature) => requireFiles[feature] && resolvedFileNames[feature].length === 0,
    )
    ? 1
    : 0;
}

/**
 * The name, within a feature's tree (`rules/`, `commands/`, `subagents/`), of
 * the subdirectory holding the fetched copy of remote files. Taken as the last segment of the feature subdirectory rather
 * than by subtracting one path from another, so no separator spelling is
 * involved on either side.
 *
 * Split on the native separator, the one the constant was joined with and the one
 * the path it is compared against is split on. The posix reading would leave the
 * whole `rules\\.curated` on Windows, where it matches no segment at all.
 */
const CURATED_SUBDIR_NAME = basename(CURATED_RULES_FEATURE_SUBDIR);

const LOCAL_FILE_FEATURE_RELATIVE_DIR_PATHS: PerFileFeature<string> = {
  rules: RULESYNC_RULES_RELATIVE_DIR_PATH,
  commands: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
  subagents: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
};

/**
 * The names of the rules (or commands, or subagents) the project holds
 * itself, which take precedence over those a source offers under the same
 * name. Written for rules; commands and subagents are loaded the same way
 * (`**\/*.md` with the curated subtree read separately), so the same walk
 * answers for them.
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
async function getLocalFileNames(params: {
  projectRoot: string;
  feature: SourceFileFeature;
}): Promise<Set<string>> {
  const featureDir = join(
    params.projectRoot,
    LOCAL_FILE_FEATURE_RELATIVE_DIR_PATHS[params.feature],
  );
  const relativePaths = await listFilePathsRecursively(featureDir, {
    nameFilter: (name) => name.endsWith(".md"),
    deduplicateByFileIdentity: true,
  });
  return new Set(
    relativePaths
      .filter((relativePath) => relativePath.split(sep)[0] !== CURATED_SUBDIR_NAME)
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

/**
 * The names of one per-file feature (rules, commands or subagents) the
 * declared sources have installed, so a source added next cannot take them.
 * Throws when a declared source taking that feature is not fully installed.
 */
export async function getInstalledSourceFileNames({
  sources,
  projectRoot,
  feature,
  logger,
}: {
  sources: SourceEntry[];
  projectRoot: string;
  feature: SourceFileFeature;
  logger: Logger;
}): Promise<string[]> {
  const { lock, npmLock, lockKeys } = await loadSourceLocks({ sources, projectRoot, logger });
  const curatedDir = join(projectRoot, getCuratedFileFeatureRelativeDirPath(feature));
  const names = new Set<string>();
  for (const [index, source] of sources.entries()) {
    if (getSourceFilters(source)[feature] === undefined) {
      continue;
    }
    const entry = getDeclaredLockedSource({ source, index, lock, npmLock, lockKeys });
    if (
      entry === undefined ||
      getLockedFileFeatureState(entry, feature).items === undefined ||
      !lockedFileConfigMatches({ feature, locked: entry, sourceEntry: source }) ||
      !(await checkLockedFilesAreValid({ feature, curatedDir, locked: entry }))
    ) {
      throw new Error(
        `Existing source "${source.source}" is not fully installed. Run 'rulesync install' before adding another source.`,
      );
    }
    getLockedFileNames(entry, feature).forEach((name) => names.add(name));
  }
  return [...names];
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
 * locked the same kinds of artifacts the source takes (skills, rules,
 * commands, subagents, or any combination), each from the path the source declares, for the declared ref. An
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
  const filesMatch = SOURCE_FILE_FEATURES.every((feature) => {
    const lockedPath = getLockedFileFeatureState(locked, feature).path;
    return filters[feature] === undefined
      ? lockedPath === undefined
      : lockedPath === resolveFileFeaturePath(sourceEntry, feature);
  });
  return (
    skillsMatch &&
    filesMatch &&
    lockedRefMatchesDeclared({ locked, declaredRef: getDeclaredSourceRef(sourceEntry) })
  );
}

/**
 * Reject an empty `skills`, `rules`, `commands` or `subagents` list up front.
 * An empty list is most likely meant as "take none of this feature", which is
 * spelled by omitting the field, so point at that form instead of reporting a
 * selection that matched nothing.
 */
function assertNonEmptySelections(sourceEntry: SourceEntry): void {
  const { source } = sourceEntry;
  const emptyFields = getEmptySelectionFields(sourceEntry);
  const [firstEmpty] = emptyFields;
  if (firstEmpty === undefined) {
    return;
  }
  const declaredFields = getDeclaredSelectionFields(sourceEntry);
  if (emptyFields.length > 1 && emptyFields.length === declaredFields.length) {
    throw new Error(
      `${formatFieldList(emptyFields)} are ${emptyFields.length === 2 ? "both" : "all"} empty lists for ${source}. To take nothing from this source, remove it from \`sources\`.`,
    );
  }
  if (firstEmpty === "skills") {
    const others = declaredFields.filter((field) => field !== "skills");
    throw new Error(
      `\`skills\` is an empty list for ${source}. To take no skills from this source, omit \`skills\` and list only ${others.length === 0 ? "`rules`" : formatFieldList(others)}.`,
    );
  }
  // Omitting every field falls back to every skill, so unless another field
  // stays declared the hint must keep `skills` declared rather than suggest
  // dropping this field alone. The rules hint keeps its original wording.
  const othersDeclared =
    firstEmpty !== "rules" &&
    declaredFields.some((field) => field !== firstEmpty && !emptyFields.includes(field));
  throw new Error(
    `\`${firstEmpty}\` is an empty list for ${source}. To take no ${firstEmpty} from this source, omit \`${firstEmpty}\`${othersDeclared ? "" : " and list the skills you want in `skills`"}.`,
  );
}

function getDeclaredSelectionFields(sourceEntry: SourceEntry): SourceSelectionField[] {
  return (["skills", ...SOURCE_FILE_FEATURES] as const).filter(
    (field) => sourceEntry[field] !== undefined,
  );
}

function formatFieldList(fields: readonly string[]): string {
  const quoted = fields.map((field) => `\`${field}\``);
  if (quoted.length <= 2) {
    return quoted.join(" and ");
  }
  return `${quoted.slice(0, -1).join(", ")} and ${quoted.at(-1)}`;
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
  localFileNames: PerFileFeature<Set<string>>;
  alreadyFetchedSkillNames: Set<string>;
  alreadyFetchedFileNames: PerFileFeature<Set<string>>;
  updateSources: boolean;
  frozen: boolean;
  logger: Logger;
}): Promise<{
  skillCount: number;
  fetchedSkillNames: string[];
  fileCounts: PerFileFeature<number>;
  fetchedFileNames: PerFileFeature<string[]>;
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
      localFileNames: params.localFileNames,
      alreadyFetchedSkillNames: params.alreadyFetchedSkillNames,
      alreadyFetchedFileNames: params.alreadyFetchedFileNames,
      updateSources: params.updateSources,
      frozen: params.frozen,
      logger: params.logger,
    });
    return {
      skillCount: result.skillCount,
      fetchedSkillNames: result.fetchedSkillNames,
      fileCounts: result.fileCounts,
      fetchedFileNames: result.fetchedFileNames,
      lock,
      npmLock: result.updatedLock,
    };
  }
  const filters = getSourceFilters(sourceEntry);
  let updatedLock = lock;
  let skillCount = 0;
  let fetchedSkillNames: string[] = [];
  // Whether an earlier feature of this source has already resolved and locked
  // its ref. Later features reuse that exact ref, so one source cannot mix
  // artifacts from two SHAs, and re-fetch on `--update` at it.
  let refResolved = false;
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
    refResolved = true;
  }

  const fileCounts: PerFileFeature<number> = { rules: 0, commands: 0, subagents: 0 };
  const fetchedFileNames: PerFileFeature<string[]> = { rules: [], commands: [], subagents: [] };
  for (const feature of SOURCE_FILE_FEATURES) {
    const selection = filters[feature];
    if (selection === undefined) {
      updatedLock = await clearUndeclaredFiles({
        feature,
        lock: updatedLock,
        lockKey,
        projectRoot: params.projectRoot,
        alreadyFetchedNames: params.alreadyFetchedFileNames[feature],
        logger: params.logger,
      });
      continue;
    }
    const result = await fetchFilesByTransport({
      feature,
      sourceEntry: { ...sourceEntry, [feature]: selection },
      lockKey,
      client: params.client,
      projectRoot: params.projectRoot,
      lock: updatedLock,
      localNames: params.localFileNames[feature],
      alreadyFetchedNames: params.alreadyFetchedFileNames[feature],
      updateSources: refResolved ? false : params.updateSources,
      forceRefetch: refResolved && params.updateSources,
      frozen: params.frozen,
      logger: params.logger,
    });
    updatedLock = result.updatedLock;
    fileCounts[feature] = result.count;
    fetchedFileNames[feature] = result.fetchedNames;
    refResolved = true;
  }
  return {
    skillCount,
    fetchedSkillNames,
    fileCounts,
    fetchedFileNames,
    lock: updatedLock,
    npmLock,
  };
}

/**
 * Remove the curated files of a per-file feature the source no longer
 * declares, and drop that feature's fields from its lock entry.
 */
async function clearUndeclaredFiles(params: {
  feature: SourceFileFeature;
  lock: SourcesLock;
  lockKey: string;
  projectRoot: string;
  alreadyFetchedNames: Set<string>;
  logger: Logger;
}): Promise<SourcesLock> {
  const { feature, lock, lockKey, projectRoot, alreadyFetchedNames, logger } = params;
  const locked = getLockedSource(lock, lockKey);
  if (locked === undefined || getLockedFileFeatureState(locked, feature).items === undefined) {
    return lock;
  }
  await cleanPreviousCuratedFiles({
    curatedDir: join(projectRoot, getCuratedFileFeatureRelativeDirPath(feature)),
    lockedNames: getLockedFileNames(locked, feature),
    protectedNames: alreadyFetchedNames,
    logger,
  });
  return setLockedSource(lock, lockKey, {
    ...locked,
    ...toFileFeatureLockFields(feature, {
      items: undefined,
      selection: undefined,
      path: undefined,
      resolvedNames: undefined,
    }),
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
    // An empty selection list is rejected per source by
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
    const filesCovered = SOURCE_FILE_FEATURES.every(
      (feature) =>
        filters[feature] === undefined ||
        (locked !== undefined && lockedFileConfigMatches({ feature, locked, sourceEntry: source })),
    );
    if (!locked || !skillsCovered || !filesCovered) {
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
  const protectedFileNames = mapFileFeatures(
    (feature) => new Set(activeEntries.flatMap((entry) => getLockedFileNames(entry, feature))),
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
  for (const entry of staleEntries) {
    await cleanPreviousCuratedSkills({
      curatedDir: curatedSkillsDir,
      lockedSkillNames: Object.keys(entry.skills),
      protectedSkillNames,
      logger,
    });
    for (const feature of SOURCE_FILE_FEATURES) {
      await cleanPreviousCuratedFiles({
        curatedDir: join(projectRoot, getCuratedFileFeatureRelativeDirPath(feature)),
        lockedNames: getLockedFileNames(entry, feature),
        protectedNames: protectedFileNames[feature],
        logger,
      });
    }
  }
}

async function fetchFilesByTransport(params: {
  feature: SourceFileFeature;
  sourceEntry: SourceEntry;
  lockKey: string;
  client: GitHubClient;
  projectRoot: string;
  lock: SourcesLock;
  localNames: Set<string>;
  alreadyFetchedNames: Set<string>;
  updateSources: boolean;
  forceRefetch: boolean;
  frozen: boolean;
  logger: Logger;
}): Promise<{ count: number; fetchedNames: string[]; updatedLock: SourcesLock }> {
  if (getSourceTransport(params.sourceEntry) === "git") {
    return fetchFilesViaGit(params);
  }
  return fetchFilesViaGithub(params);
}
