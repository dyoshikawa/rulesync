import { join, posix } from "node:path";

import { Semaphore } from "es-toolkit/promise";

import { getSourceTransport, type SourceEntry } from "../config/config.js";
import { SKILL_FILE_NAME } from "../constants/general.js";
import {
  FETCH_CONCURRENCY_LIMIT,
  formatMegabytes,
  MAX_FILE_SIZE,
  MAX_FILE_SIZE_MB,
  RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH,
  SOURCE_PREFETCH_CONCURRENCY_LIMIT,
} from "../constants/rulesync-paths.js";
import type { GitHubFileEntry, ParsedSource } from "../types/fetch.js";
import { mapWithConcurrency } from "../utils/concurrency.js";
import { quoteForLog } from "../utils/control-characters.js";
import { formatError } from "../utils/error.js";
import type { Logger } from "../utils/logger.js";
import { GitHubClient, GitHubClientError } from "./github-client.js";
import { listDirectoryRecursive, resolveExecutablePaths, withSemaphore } from "./github-utils.js";
import { parseSource } from "./source-parser.js";
import {
  assertMatchingFilesFound,
  assertMatchingSkillsFound,
  buildFileLockUpdate,
  buildLockUpdate,
  canReuseLockedFiles,
  canReuseLockedSkills,
  cleanPreviousCuratedSkills,
  getCuratedFileFeatureRelativeDirPath,
  getFileFeatureNoun,
  getSourceFilters,
  groupRemoteFilesBySkillRoot,
  hasEmptySelection,
  isWildcardSelection,
  lockedRefMatchesDeclared,
  normalizeRuleFilterName,
  normalizeRuleSelection,
  normalizeSkillSelection,
  type RemoteFeatureFile,
  type RemoteSkillFile,
  replaceCuratedFiles,
  resolveFileFeaturePath,
  resolveFileFeatureSourcePath,
  resolveSkillsPath,
  resolveSkillsSourcePath,
  selectDeclaredFiles,
  shouldSkipFile,
  shouldSkipSkill,
  shouldUseRootFallback,
  writeSkillAndComputeIntegrity,
} from "./sources-artifacts.js";
import {
  type LockedSkill,
  type LockedSource,
  type SourceFileFeature,
  type SourcesLock,
  SOURCE_FILE_FEATURES,
  getLockedFileNames,
  getLockedSkillNames,
  getLockedSource,
  normalizeLockKey,
} from "./sources-lock.js";

type GithubPrefetchContext = {
  client: GitHubClient;
  projectRoot: string;
  localSkillNames: Set<string>;
  localFileNames: Record<SourceFileFeature, Set<string>>;
  reservedSkillNames: Set<string>;
  reservedFileNames: Record<SourceFileFeature, Set<string>>;
  updateSources: boolean;
  frozen: boolean;
  semaphore: Semaphore;
};

type GithubPrefetchTarget = {
  sourceEntry: SourceEntry;
  parsed: ParsedSource;
  ref: string;
  locked: LockedSource | undefined;
};

/**
 * The names one source is expected to take, settled once that source has
 * listed what it offers. Later sources wait on the claims of every earlier one
 * before choosing what to download, so a name an earlier source takes is not
 * downloaded again for a later source whose copy the serial pass discards.
 */
type NameClaim = {
  names: Promise<ClaimedNames>;
  settle: (names: ClaimedNames) => void;
};

/**
 * The claim of a source the prefetch does not list -- a git or npm transport
 * source -- whose selection is a wildcard: it may take any
 * name, so later sources download nothing a name decides.
 */
const ANY_NAME = Symbol("any name");

type ClaimedNames = string[] | typeof ANY_NAME;

/** The names earlier sources are expected to take, `names` being those known by name. */
type EarlierClaims = {
  names: Set<string>;
  has: (name: string) => boolean;
};

/** One feature's side of a source's claim: what earlier sources took, and its own. */
type ClaimSlot = {
  earlier: () => Promise<EarlierClaims>;
  settle: (names: string[]) => void;
};

function createNameClaim(): NameClaim {
  let settle: (names: ClaimedNames) => void = () => {};
  const names = new Promise<ClaimedNames>((resolveNames) => {
    settle = resolveNames;
  });
  return { names, settle: (claimed) => settle(claimed) };
}

function createClaimSlot(params: {
  reserved: Set<string>;
  earlier: NameClaim[];
  own: NameClaim;
}): ClaimSlot {
  const { reserved, earlier, own } = params;
  return {
    earlier: async () => {
      const claimed = await Promise.all(earlier.map((claim) => claim.names));
      const mayTakeAny = claimed.includes(ANY_NAME);
      const names = new Set([
        ...reserved,
        ...claimed.flatMap((claim) => (claim === ANY_NAME ? [] : claim)),
      ]);
      return { names, has: (name) => mayTakeAny || names.has(name) };
    },
    settle: own.settle,
  };
}

/**
 * Download the GitHub-transport sources concurrently, at most
 * `SOURCE_PREFETCH_CONCURRENCY_LIMIT` sources at a time with every request
 * sharing one `FETCH_CONCURRENCY_LIMIT` budget, so the serial pass that follows
 * finds its refs, listings and files already answered by the memoizing client.
 *
 * Nothing here writes to disk or touches the lock: the prefetch only warms the
 * client. It mirrors the requests the serial pass makes, including skipping a
 * name an earlier declared source takes, and a request it did not foresee is
 * simply made by the serial pass itself, so a prefetch that guesses wrong costs
 * time, never correctness. A source's prefetch returns only once all of its
 * requests have settled, so the bounds hold even when one of them fails.
 * Errors are left for the serial pass to report with its usual hints.
 */
export async function prefetchGithubSources(params: {
  sources: SourceEntry[];
  lockKeys: string[];
  client: GitHubClient;
  projectRoot: string;
  lock: SourcesLock;
  localSkillNames: Set<string>;
  localFileNames: Record<SourceFileFeature, Set<string>>;
  reservedSkillNames: Set<string>;
  reservedFileNames: Record<SourceFileFeature, Set<string>>;
  updateSources: boolean;
  frozen: boolean;
  logger: Logger;
}): Promise<void> {
  const { sources, lockKeys, lock, logger, ...rest } = params;
  const context: GithubPrefetchContext = {
    ...rest,
    semaphore: new Semaphore(FETCH_CONCURRENCY_LIMIT),
  };
  // Every source that takes names is in the claim order, but only the ones
  // listed through the GitHub API are prefetched; the others claim up front
  // whatever their selection may take.
  const items = sources
    .map((sourceEntry, index) => ({
      sourceEntry,
      lockKey: lockKeys[index] ?? normalizeLockKey(sourceEntry.source),
    }))
    .filter(({ sourceEntry }) => !hasEmptySelection(sourceEntry))
    .map(({ sourceEntry, lockKey }) => ({
      sourceEntry,
      lockKey,
      listedThroughApi: isListedThroughGithubApi(sourceEntry),
      skills: createNameClaim(),
      files: createFileClaims(),
    }));
  for (const item of items.filter((candidate) => !candidate.listedThroughApi)) {
    if (isGitlabSource(item.sourceEntry)) {
      // The serial pass rejects GitLab sources, so they take no name.
      item.skills.settle([]);
      settleFileClaims(item.files);
      continue;
    }
    const filters = getSourceFilters(item.sourceEntry);
    item.skills.settle(getSelectionClaim({ selection: filters.skills, normalize: (name) => name }));
    for (const feature of SOURCE_FILE_FEATURES) {
      item.files[feature].settle(
        getSelectionClaim({ selection: filters[feature], normalize: normalizeRuleFilterName }),
      );
    }
  }
  await mapWithConcurrency({
    items: items.filter((item) => item.listedThroughApi),
    limit: SOURCE_PREFETCH_CONCURRENCY_LIMIT,
    mapper: async (item) => {
      const earlier = items.slice(0, items.indexOf(item));
      try {
        await prefetchGithubSource({
          sourceEntry: item.sourceEntry,
          lockKey: item.lockKey,
          lock,
          context,
          skillClaim: createClaimSlot({
            reserved: context.reservedSkillNames,
            earlier: earlier.map((other) => other.skills),
            own: item.skills,
          }),
          fileClaims: Object.fromEntries(
            SOURCE_FILE_FEATURES.map((feature) => [
              feature,
              createClaimSlot({
                reserved: context.reservedFileNames[feature],
                earlier: earlier.map((other) => other.files[feature]),
                own: item.files[feature],
              }),
            ]),
          ) as Record<SourceFileFeature, ClaimSlot>,
        });
      } catch (error) {
        logger.debug(
          `Prefetch of "${item.sourceEntry.source}" stopped early: ${formatError(error)}`,
        );
      } finally {
        // A source that claimed nothing (or failed before it could) must not
        // keep later sources waiting. Settling twice keeps the first claim.
        item.skills.settle([]);
        settleFileClaims(item.files);
      }
    },
  });
}

function createFileClaims(): Record<SourceFileFeature, NameClaim> {
  return {
    rules: createNameClaim(),
    commands: createNameClaim(),
    subagents: createNameClaim(),
  };
}

/** Settle every per-file feature claim with no names (a no-op for those already settled). */
function settleFileClaims(claims: Record<SourceFileFeature, NameClaim>): void {
  for (const feature of SOURCE_FILE_FEATURES) {
    claims[feature].settle([]);
  }
}

/** Whether the prefetch lists and downloads this source through the GitHub API. */
function isListedThroughGithubApi(sourceEntry: SourceEntry): boolean {
  if (getSourceTransport(sourceEntry) !== "github") {
    return false;
  }
  try {
    return parseSource(sourceEntry.source).provider !== "gitlab";
  } catch {
    // The serial pass reports the source and takes nothing from it; the
    // prefetch fails the same way and claims nothing.
    return true;
  }
}

/** Whether this is a GitLab source, which the serial pass does not support yet. */
function isGitlabSource(sourceEntry: SourceEntry): boolean {
  if (getSourceTransport(sourceEntry) !== "github") {
    return false;
  }
  try {
    return parseSource(sourceEntry.source).provider === "gitlab";
  } catch {
    return false;
  }
}

/** What a source the prefetch does not list may take, judged by its selection alone. */
function getSelectionClaim(params: {
  selection: string[] | undefined;
  normalize: (name: string) => string;
}): ClaimedNames {
  const { selection, normalize } = params;
  if (selection === undefined) {
    return [];
  }
  return selection.includes("*") ? ANY_NAME : selection.map(normalize);
}

async function prefetchGithubSource(params: {
  sourceEntry: SourceEntry;
  lockKey: string;
  lock: SourcesLock;
  context: GithubPrefetchContext;
  skillClaim: ClaimSlot;
  fileClaims: Record<SourceFileFeature, ClaimSlot>;
}): Promise<void> {
  const { sourceEntry, lockKey, lock, context, skillClaim, fileClaims } = params;
  const parsedFromSource = parseSource(sourceEntry.source);
  const parsed: ParsedSource = {
    ...parsedFromSource,
    ref: sourceEntry.ref ?? parsedFromSource.ref,
  };
  const locked = getLockedSource(lock, lockKey);
  const ref = await resolvePrefetchRef({ parsed, locked, context });
  const filters = getSourceFilters(sourceEntry);
  // Settled rather than all: a failure on one side must not return while the
  // other side's requests are still running outside the concurrency bound.
  await Promise.allSettled([
    filters.skills === undefined
      ? undefined
      : prefetchGithubSkills({
          target: { sourceEntry: { ...sourceEntry, skills: filters.skills }, parsed, ref, locked },
          claim: skillClaim,
          context,
        }),
    ...SOURCE_FILE_FEATURES.map((feature, index) =>
      filters[feature] === undefined
        ? undefined
        : prefetchGithubFiles({
            feature,
            target: {
              sourceEntry: { ...sourceEntry, [feature]: filters[feature] },
              parsed,
              ref,
              locked,
            },
            // Mirrors `fetchSingleSource`: a feature fetched after another one
            // of the same source re-fetches on `--update` at the ref the
            // earlier feature resolved.
            forceRefetch:
              context.updateSources &&
              (filters.skills !== undefined ||
                SOURCE_FILE_FEATURES.slice(0, index).some(
                  (earlier) => filters[earlier] !== undefined,
                )),
            claim: fileClaims[feature],
            context,
          }),
    ),
  ]);
}

/** The commit `resolveGithubFetchRef` settles on, asked through the same client. */
async function resolvePrefetchRef(params: {
  parsed: ParsedSource;
  locked: LockedSource | undefined;
  context: GithubPrefetchContext;
}): Promise<string> {
  const { parsed, locked, context } = params;
  if (
    locked &&
    !context.updateSources &&
    lockedRefMatchesDeclared({ locked, declaredRef: parsed.ref })
  ) {
    return locked.resolvedRef;
  }
  const { client, semaphore } = context;
  const requestedRef =
    parsed.ref ??
    (await withSemaphore(semaphore, () => client.getDefaultBranch(parsed.owner, parsed.repo)));
  return withSemaphore(semaphore, () =>
    client.resolveRefToSha(parsed.owner, parsed.repo, requestedRef),
  );
}

async function prefetchGithubSkills(params: {
  target: GithubPrefetchTarget;
  claim: ClaimSlot;
  context: GithubPrefetchContext;
}): Promise<void> {
  const { target, claim, context } = params;
  const { sourceEntry, parsed, ref, locked } = target;
  const { client, semaphore } = context;
  const lockedSkillNames = locked ? getLockedSkillNames(locked) : [];
  if (
    await canReuseLockedSkills({
      locked,
      resolvedSha: ref,
      updateSources: context.updateSources,
      frozen: context.frozen,
      sourceEntry,
      curatedDir: join(context.projectRoot, RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH),
      // A name an earlier source takes holds that source's copy, as in the serial pass.
      // Waited on only when the lock could be reused, so the listing of a source
      // that must be fetched anyway does not queue behind earlier ones.
      getAlreadyFetchedSkillNames: claim.earlier,
    })
  ) {
    claim.settle(lockedSkillNames);
    return;
  }
  const skillFilter = sourceEntry.skills ?? ["*"];
  const isWildcard = isWildcardSelection(skillFilter);
  const entries = await withSemaphore(semaphore, () =>
    client.listDirectory(parsed.owner, parsed.repo, resolveSkillsSourcePath(sourceEntry), ref),
  );
  const skillDirs = entries.filter(
    (entry) => entry.type === "dir" && (isWildcard || skillFilter.includes(entry.name)),
  );
  const useRootFallback = shouldUseRootFallback({
    skillFilter,
    isWildcard,
    hasRootSkillFile: entries.some(
      (entry) => entry.type === "file" && entry.name === SKILL_FILE_NAME,
    ),
    hasRequestedSkillDir: skillDirs.length > 0,
  });
  const claimed = await claim.earlier();
  const isWanted = (name: string) =>
    shouldPrefetchSkill({ name, localSkillNames: context.localSkillNames, claimed });
  if (useRootFallback) {
    // The serial pass downloads the root files before it checks the name.
    claim.settle(skillFilter.filter(isWanted));
    await prefetchSkillFileContents({
      files: entries.filter((entry) => entry.type === "file"),
      target,
      context,
    });
    return;
  }
  const wantedDirs = skillDirs.filter((dir) => isWanted(dir.name));
  claim.settle(wantedDirs.map((dir) => dir.name));
  await prefetchSkillFileContents({
    files: await listPrefetchSkillFiles({ skillDirs: wantedDirs, target, context }),
    target,
    context,
  });
}

async function prefetchSkillFileContents(params: {
  files: GitHubFileEntry[];
  target: GithubPrefetchTarget;
  context: GithubPrefetchContext;
}): Promise<void> {
  const { files, target, context } = params;
  await prefetchFileContents({ files, target, context });
  if (files.some((file) => posix.basename(file.path) !== SKILL_FILE_NAME)) {
    await withSemaphore(context.semaphore, () =>
      context.client.listExecutablePaths(target.parsed.owner, target.parsed.repo, target.ref),
    );
  }
}

/** Whether the serial pass is expected to download this skill at all. */
function shouldPrefetchSkill(params: {
  name: string;
  localSkillNames: Set<string>;
  claimed: EarlierClaims;
}): boolean {
  const { name, localSkillNames, claimed } = params;
  return (
    !name.includes("..") &&
    !name.includes("/") &&
    !name.includes("\\") &&
    !localSkillNames.has(name) &&
    !claimed.has(name)
  );
}

async function listPrefetchSkillFiles(params: {
  skillDirs: GitHubFileEntry[];
  target: GithubPrefetchTarget;
  context: GithubPrefetchContext;
}): Promise<GitHubFileEntry[]> {
  const { skillDirs, target, context } = params;
  // Settled rather than all, so one failed listing does not return while the
  // others are still in flight; the serial pass reports the failure.
  const listings = await Promise.allSettled(
    skillDirs.map((dir) =>
      listDirectoryRecursive({
        client: context.client,
        owner: target.parsed.owner,
        repo: target.parsed.repo,
        path: dir.path,
        ref: target.ref,
        semaphore: context.semaphore,
      }),
    ),
  );
  return listings.flatMap((listing) => (listing.status === "fulfilled" ? listing.value : []));
}

async function prefetchGithubFiles(params: {
  feature: SourceFileFeature;
  target: GithubPrefetchTarget;
  forceRefetch: boolean;
  claim: ClaimSlot;
  context: GithubPrefetchContext;
}): Promise<void> {
  const { feature, target, forceRefetch, claim, context } = params;
  const { sourceEntry, parsed, ref, locked } = target;
  const localNames = context.localFileNames[feature];
  const claimed = await claim.earlier();
  if (
    locked &&
    !context.updateSources &&
    !forceRefetch &&
    (await canReuseLockedFiles({
      feature,
      locked,
      sourceEntry,
      lockedNames: getLockedFileNames(locked, feature),
      localNames,
      alreadyFetchedNames: claimed.names,
      curatedDir: join(context.projectRoot, getCuratedFileFeatureRelativeDirPath(feature)),
    }))
  ) {
    claim.settle(getLockedFileNames(locked, feature));
    return;
  }
  const entries = await withSemaphore(context.semaphore, () =>
    context.client.listDirectory(
      parsed.owner,
      parsed.repo,
      resolveFileFeatureSourcePath(sourceEntry, feature),
      ref,
    ),
  );
  const selected = selectDeclaredFiles({
    feature,
    sourceEntry,
    candidates: entries.filter((entry) => entry.type === "file"),
    getFileName: (entry) => entry.name,
  }).filter(({ name }) => !localNames.has(name) && !claimed.has(name));
  claim.settle(selected.map(({ name }) => name));
  await prefetchFileContents({
    files: selected.map(({ candidate }) => candidate),
    target,
    context,
  });
}

async function prefetchFileContents(params: {
  files: GitHubFileEntry[];
  target: GithubPrefetchTarget;
  context: GithubPrefetchContext;
}): Promise<void> {
  const { files, target, context } = params;
  // Settled rather than all, so one failed download does not return while the
  // others are still queued; the serial pass reports the failure.
  await Promise.allSettled(
    files
      .filter((file) => file.size <= MAX_FILE_SIZE)
      .map((file) =>
        withSemaphore(context.semaphore, () =>
          context.client.getFileContent(
            target.parsed.owner,
            target.parsed.repo,
            file.path,
            target.ref,
          ),
        ),
      ),
  );
}

/**
 * Resolve a GitHub source's ref to a commit SHA, preferring the locked SHA for
 * deterministic fetches and otherwise resolving the declared ref or default
 * branch. Returns the on-disk `ref` (SHA when freshly resolved, else locked
 * ref), the resolved SHA, and the requested ref.
 */
export async function resolveGithubFetchRef(params: {
  parsed: ParsedSource;
  locked: LockedSource | undefined;
  updateSources: boolean;
  sourceKey: string;
  client: GitHubClient;
  logger: Logger;
}): Promise<{ ref: string; resolvedSha: string; requestedRef: string | undefined }> {
  const { parsed, locked, updateSources, sourceKey, client, logger } = params;
  if (locked && !updateSources && lockedRefMatchesDeclared({ locked, declaredRef: parsed.ref })) {
    // Use the locked SHA for deterministic fetching
    logger.debug(`Using locked ref for ${sourceKey}: ${locked.resolvedRef}`);
    return {
      ref: locked.resolvedRef,
      resolvedSha: locked.resolvedRef,
      requestedRef: locked.requestedRef ?? parsed.ref,
    };
  }
  // Resolve the ref (or default branch) to a SHA
  const requestedRef = parsed.ref ?? (await client.getDefaultBranch(parsed.owner, parsed.repo));
  const resolvedSha = await client.resolveRefToSha(parsed.owner, parsed.repo, requestedRef);
  logger.debug(`Resolved ${sourceKey} ref "${requestedRef}" to SHA: ${resolvedSha}`);
  return { ref: resolvedSha, resolvedSha, requestedRef };
}

/**
 * Fetch one per-file feature (rules, commands or subagents) of a GitHub
 * source: the Markdown files directly inside the feature's path, as selected,
 * into the feature's curated directory.
 */
export async function fetchFilesViaGithub(params: {
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
  const {
    feature,
    sourceEntry,
    lockKey,
    client,
    projectRoot,
    lock,
    localNames,
    alreadyFetchedNames,
    updateSources,
    forceRefetch,
    frozen,
    logger,
  } = params;
  const noun = getFileFeatureNoun(feature);
  const parsedFromSource = parseSource(sourceEntry.source);
  const parsed: ParsedSource = {
    ...parsedFromSource,
    ref: sourceEntry.ref ?? parsedFromSource.ref,
  };
  if (parsed.provider === "gitlab") {
    throw new Error(`GitLab sources are not yet supported: "${sourceEntry.source}".`);
  }
  const sourceKey = sourceEntry.source;
  const locked = getLockedSource(lock, lockKey);
  const lockedNames = locked ? getLockedFileNames(locked, feature) : [];
  const { ref, resolvedSha, requestedRef } = await resolveGithubFetchRef({
    parsed,
    locked,
    updateSources,
    sourceKey,
    client,
    logger,
  });
  const curatedDir = join(projectRoot, getCuratedFileFeatureRelativeDirPath(feature));
  if (
    locked &&
    resolvedSha === locked.resolvedRef &&
    !updateSources &&
    !forceRefetch &&
    (await canReuseLockedFiles({
      feature,
      locked,
      sourceEntry,
      lockedNames,
      localNames,
      alreadyFetchedNames,
      curatedDir,
    }))
  ) {
    logger.debug(`SHA unchanged for ${sourceKey} ${feature}, skipping re-fetch.`);
    return { count: 0, fetchedNames: lockedNames, updatedLock: lock };
  }

  const featurePath = resolveFileFeatureSourcePath(sourceEntry, feature);
  let entries: GitHubFileEntry[];
  try {
    entries = await client.listDirectory(parsed.owner, parsed.repo, featurePath, ref);
  } catch (error) {
    if (error instanceof GitHubClientError && error.statusCode === 404) {
      throw new Error(`No ${featurePath}/ directory found in ${sourceKey}.`, { cause: error });
    }
    throw error;
  }
  const remoteFiles = selectDeclaredFiles({
    feature,
    sourceEntry,
    candidates: entries.filter((entry) => entry.type === "file"),
    getFileName: (entry) => entry.name,
  }).map(({ candidate, name }) => ({ entry: candidate, name }));
  const remoteNames = remoteFiles.map(({ name }) => name);
  assertMatchingFilesFound({ feature, names: remoteNames, source: sourceKey });
  const preparedFiles: RemoteFeatureFile[] = [];
  for (const { entry, name } of remoteFiles) {
    if (entry.size > MAX_FILE_SIZE) {
      logger.warn(
        `Skipping ${noun} ${quoteForLog(entry.path)} (${formatMegabytes(entry.size)}MB exceeds ${MAX_FILE_SIZE_MB}MB limit).`,
      );
      continue;
    }
    if (
      shouldSkipFile({
        feature,
        name,
        sourceKey,
        localNames,
        alreadyFetchedNames,
        logger,
      })
    ) {
      continue;
    }
    const content = await client.getFileContent(parsed.owner, parsed.repo, entry.path, ref);
    preparedFiles.push({ name, content });
  }
  const fetchedFiles = await replaceCuratedFiles({
    feature,
    files: preparedFiles,
    curatedDir,
    locked,
    lockedNames,
    resolvedRef: resolvedSha,
    sourceKey,
    localNames,
    alreadyFetchedNames,
    compareLockedIntegrity: !updateSources && !forceRefetch,
    frozen,
    logger,
  });
  const result = buildFileLockUpdate({
    feature,
    lock,
    lockKey,
    sourceKey,
    fetchedFiles,
    locked,
    requestedRef,
    resolvedRef: resolvedSha,
    selection: normalizeRuleSelection(sourceEntry[feature] ?? []),
    path: resolveFileFeaturePath(sourceEntry, feature),
    resolvedNames: remoteNames,
    logger,
  });
  return {
    count: result.fetchedNames.length,
    fetchedNames: result.fetchedNames,
    updatedLock: result.updatedLock,
  };
}

/** Lists the paths a GitHub source records as executable, at most once per source. */
type ExecutablePathsLoader = () => Promise<Set<string>>;

/**
 * The tree listing behind the executable bits of a GitHub source's skill
 * files. It is requested lazily and shared by every skill of the source, so a
 * source whose skills are only `SKILL.md` files sends no extra request.
 */
function createExecutablePathsLoader(params: {
  client: GitHubClient;
  owner: string;
  repo: string;
  ref: string;
  logger: Logger;
}): ExecutablePathsLoader {
  let pending: Promise<Set<string>> | undefined;
  return () => {
    pending ??= resolveExecutablePaths(params);
    return pending;
  };
}

/**
 * Mark the fetched files git records as executable (mode `100755`). The
 * contents API carries no mode, so the tree listing supplies it; `SKILL.md`
 * itself is never run, so a skill made of nothing else needs no lookup.
 */
async function markExecutableRemoteFiles(params: {
  files: Array<{ remotePath: string; file: RemoteSkillFile }>;
  getExecutablePaths: ExecutablePathsLoader;
}): Promise<RemoteSkillFile[]> {
  const { files, getExecutablePaths } = params;
  const hasSupportingFile = files.some(
    ({ file }) => posix.basename(file.relativePath) !== SKILL_FILE_NAME,
  );
  if (!hasSupportingFile) {
    return files.map(({ file }) => file);
  }
  const executablePaths = await getExecutablePaths();
  return files.map(({ remotePath, file }) =>
    executablePaths.has(remotePath) ? { ...file, executable: true } : file,
  );
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
  getExecutablePaths: ExecutablePathsLoader;
  fetchedSkills: Record<string, LockedSkill>;
  frozen: boolean;
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
    getExecutablePaths,
    fetchedSkills,
    frozen,
    logger,
  } = params;

  const rootFiles = entries.filter((entry) => entry.type === "file");
  const fetchedRootFiles: Array<{ remotePath: string; file: RemoteSkillFile }> = [];

  for (const file of rootFiles) {
    if (file.size > MAX_FILE_SIZE) {
      logger.warn(
        `Skipping file ${quoteForLog(file.path)} (${formatMegabytes(file.size)}MB exceeds ${MAX_FILE_SIZE_MB}MB limit).`,
      );
      continue;
    }
    const content = await withSemaphore(semaphore, () =>
      client.getFileContent(parsed.owner, parsed.repo, file.path, ref),
    );
    fetchedRootFiles.push({ remotePath: file.path, file: { relativePath: file.name, content } });
  }
  const rootSkillFiles = await markExecutableRemoteFiles({
    files: fetchedRootFiles,
    getExecutablePaths,
  });

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
      frozen,
      logger,
    });
    logger.debug(`Fetched skill ${quoteForLog(fallbackSkillName)} from ${sourceKey}`);
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
  getExecutablePaths: ExecutablePathsLoader;
  frozen: boolean;
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
    getExecutablePaths,
    frozen,
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
        `Skipping file ${quoteForLog(file.path)} (${formatMegabytes(file.size)}MB exceeds ${MAX_FILE_SIZE_MB}MB limit).`,
      );
      return false;
    }
    return true;
  });

  // Fetch all file contents
  const fetchedFiles: Array<{ remotePath: string; file: RemoteSkillFile }> = [];
  for (const file of files) {
    const relativeToSkill = file.path.substring(skillDir.path.length + 1);
    const content = await withSemaphore(semaphore, () =>
      client.getFileContent(parsed.owner, parsed.repo, file.path, ref),
    );
    fetchedFiles.push({ remotePath: file.path, file: { relativePath: relativeToSkill, content } });
  }

  return writeSkillAndComputeIntegrity({
    skillName: skillDir.name,
    files: await markExecutableRemoteFiles({ files: fetchedFiles, getExecutablePaths }),
    curatedDir,
    locked,
    resolvedSha,
    sourceKey,
    frozen,
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
  skillsBasePath: string;
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
  getExecutablePaths: ExecutablePathsLoader;
  fetchedSkills: Record<string, LockedSkill>;
  frozen: boolean;
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
    skillsBasePath,
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
    getExecutablePaths,
    fetchedSkills,
    frozen,
    logger,
  } = params;

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
          protectedSkillNames: alreadyFetchedSkillNames,
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
        getExecutablePaths,
        fetchedSkills,
        frozen,
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
export async function fetchSource(params: {
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
}): Promise<{
  skillCount: number;
  fetchedSkillNames: string[];
  updatedLock: SourcesLock;
}> {
  const {
    sourceEntry,
    lockKey,
    client,
    projectRoot,
    localSkillNames,
    alreadyFetchedSkillNames,
    updateSources,
    frozen,
    logger,
  } = params;
  const { lock } = params;

  const parsedFromSource = parseSource(sourceEntry.source);
  const parsed: ParsedSource = {
    ...parsedFromSource,
    ref: sourceEntry.ref ?? parsedFromSource.ref,
  };

  if (parsed.provider === "gitlab") {
    throw new Error(`GitLab sources are not yet supported: "${sourceEntry.source}".`);
  }

  const sourceKey = sourceEntry.source;
  const locked = getLockedSource(lock, lockKey);
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

  if (
    await canReuseLockedSkills({
      locked,
      resolvedSha,
      updateSources,
      frozen,
      sourceEntry,
      curatedDir,
      getAlreadyFetchedSkillNames: async () => alreadyFetchedSkillNames,
    })
  ) {
    logger.debug(`SHA unchanged for ${sourceKey}, skipping re-fetch.`);
    return {
      skillCount: 0,
      fetchedSkillNames: lockedSkillNames,
      updatedLock: lock,
    };
  }

  // Determine which skills to fetch
  const skillFilter = sourceEntry.skills ?? ["*"];
  const isWildcard = isWildcardSelection(skillFilter);
  const semaphore = new Semaphore(FETCH_CONCURRENCY_LIMIT);
  const getExecutablePaths = createExecutablePathsLoader({
    client,
    owner: parsed.owner,
    repo: parsed.repo,
    ref,
    logger,
  });
  const fetchedSkills: Record<string, LockedSkill> = {};

  // List the skills/ directory in the remote repo.
  // If a path is given in the source URL, it points directly to the skills directory.
  // Otherwise, look for "skills/" at the repo root.
  const discovery = await discoverGithubSkillDirs({
    parsed,
    skillsBasePath: resolveSkillsSourcePath(sourceEntry),
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
    getExecutablePaths,
    fetchedSkills,
    frozen,
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
    await cleanPreviousCuratedSkills({
      curatedDir,
      lockedSkillNames,
      protectedSkillNames: alreadyFetchedSkillNames,
      logger,
    });
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
      getExecutablePaths,
      frozen,
      logger,
    });
    logger.debug(`Fetched skill ${quoteForLog(skillDir.name)} from ${sourceKey}`);
  }

  const result = buildLockUpdate({
    lock,
    lockKey,
    sourceKey,
    fetchedSkills,
    locked,
    requestedRef,
    resolvedSha,
    skillSelection: normalizeSkillSelection(skillFilter),
    skillsPath: resolveSkillsPath(sourceEntry),
    remoteSkillNames,
    logger,
  });

  return {
    skillCount: result.fetchedNames.length,
    fetchedSkillNames: result.fetchedNames,
    updatedLock: result.updatedLock,
  };
}
