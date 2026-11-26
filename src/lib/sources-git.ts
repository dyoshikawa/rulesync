import { join } from "node:path";

import type { SourceEntry } from "../config/config.js";
import { RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH } from "../constants/rulesync-paths.js";
import type { Logger } from "../utils/logger.js";
import { fetchSkillFiles, resolveDefaultRef, resolveRefToSha, validateRef } from "./git-client.js";
import {
  assertMatchingFilesFound,
  assertMatchingSkillsFound,
  buildFileLockUpdate,
  buildLockUpdate,
  canReuseLockedFiles,
  canReuseLockedSkills,
  cleanPreviousCuratedSkills,
  getCuratedFileFeatureRelativeDirPath,
  getFirstPathSeparatorIndex,
  groupRemoteFilesBySkillRoot,
  isWildcardSelection,
  lockedRefMatchesDeclared,
  normalizeRuleSelection,
  normalizeSkillSelection,
  replaceCuratedFiles,
  resolveFileFeaturePath,
  resolveFileFeatureSourcePath,
  resolveSkillsPath,
  resolveSkillsSourcePath,
  selectDeclaredFiles,
  shouldSkipSkill,
  writeSkillAndComputeIntegrity,
} from "./sources-artifacts.js";
import {
  type LockedSkill,
  type LockedSource,
  type SourceFileFeature,
  type SourcesLock,
  getLockedFileNames,
  getLockedSkillNames,
  getLockedSource,
} from "./sources-lock.js";

/**
 * Resolve a git-transport source to the commit it points at now: the declared
 * `ref`, or the remote's default branch when none is declared. Used by
 * `install --update` (and unlocked installs) and by `install --outdated`.
 */
export async function resolveGitSourceRef(
  sourceEntry: SourceEntry,
): Promise<{ requestedRef: string; resolvedSha: string }> {
  if (sourceEntry.ref) {
    return {
      requestedRef: sourceEntry.ref,
      resolvedSha: await resolveRefToSha(sourceEntry.source, sourceEntry.ref),
    };
  }
  const defaultRef = await resolveDefaultRef(sourceEntry.source);
  return { requestedRef: defaultRef.ref, resolvedSha: defaultRef.sha };
}

/**
 * Resolve a git-transport source's ref to a commit SHA, preferring the locked
 * SHA for deterministic fetches. The locked path may leave `requestedRef`
 * unset (a legacy entry without it); {@link ensureGitRequestedRef} fills it in
 * lazily so a reusable lock entry needs no network call.
 */
async function resolveGitFetchRef(params: {
  sourceEntry: SourceEntry;
  locked: LockedSource | undefined;
  updateSources: boolean;
}): Promise<{ requestedRef: string | undefined; resolvedSha: string }> {
  const { sourceEntry, locked, updateSources } = params;
  if (
    locked &&
    !updateSources &&
    lockedRefMatchesDeclared({ locked, declaredRef: sourceEntry.ref })
  ) {
    const requestedRef = locked.requestedRef ?? sourceEntry.ref;
    // Validate locked ref before passing to git commands
    if (requestedRef) {
      validateRef(requestedRef);
    }
    return { requestedRef, resolvedSha: locked.resolvedRef };
  }
  return resolveGitSourceRef(sourceEntry);
}

/**
 * Resolve `requestedRef` lazily (deferred from the locked path to avoid
 * unnecessary network calls) by falling back to the default branch, which a
 * frozen install refuses.
 */
async function ensureGitRequestedRef(params: {
  url: string;
  requestedRef: string | undefined;
  resolvedSha: string;
  frozen: boolean;
}): Promise<{ requestedRef: string; resolvedSha: string }> {
  const { url, requestedRef, resolvedSha, frozen } = params;
  if (requestedRef) {
    return { requestedRef, resolvedSha };
  }
  if (frozen) {
    throw new Error(
      `Frozen install failed: lockfile entry for "${url}" is missing requestedRef. Run 'rulesync install' to update the lockfile.`,
    );
  }
  const defaultRef = await resolveDefaultRef(url);
  return { requestedRef: defaultRef.ref, resolvedSha: defaultRef.sha };
}

/**
 * Fetch one per-file feature (rules, commands or subagents) of a git source:
 * the Markdown files directly inside the feature's path, as selected, into the
 * feature's curated directory.
 */
export async function fetchFilesViaGit(params: {
  feature: SourceFileFeature;
  sourceEntry: SourceEntry;
  lockKey: string;
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
    projectRoot,
    lock,
    localNames,
    alreadyFetchedNames,
    updateSources,
    forceRefetch,
    frozen,
    logger,
  } = params;
  const sourceKey = sourceEntry.source;
  const locked = getLockedSource(lock, lockKey);
  const lockedNames = locked ? getLockedFileNames(locked, feature) : [];
  const lockedOrResolved = await resolveGitFetchRef({ sourceEntry, locked, updateSources });
  const curatedDir = join(projectRoot, getCuratedFileFeatureRelativeDirPath(feature));
  if (
    locked &&
    lockedOrResolved.resolvedSha === locked.resolvedRef &&
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
    return { count: 0, fetchedNames: lockedNames, updatedLock: lock };
  }
  const { requestedRef, resolvedSha: resolvedRef } = await ensureGitRequestedRef({
    url: sourceKey,
    ...lockedOrResolved,
    frozen,
  });
  const files = await fetchSkillFiles({
    url: sourceKey,
    ref: requestedRef,
    resolvedRef,
    skillsPath: resolveFileFeatureSourcePath(sourceEntry, feature),
    logger,
  });
  const remoteFiles = selectDeclaredFiles({
    feature,
    sourceEntry,
    candidates: files.filter((file) => getFirstPathSeparatorIndex(file.relativePath) === -1),
    getFileName: (file) => file.relativePath,
  }).map(({ candidate, name }) => ({ name, content: candidate.content }));
  const remoteNames = remoteFiles.map((file) => file.name);
  assertMatchingFilesFound({ feature, names: remoteNames, source: sourceKey });
  const fetchedFiles = await replaceCuratedFiles({
    feature,
    files: remoteFiles,
    curatedDir,
    locked,
    lockedNames,
    resolvedRef,
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
    resolvedRef,
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

/**
 * Fetch skills from a single source using git CLI (works with any git remote).
 */
export async function fetchSourceViaGit(params: {
  sourceEntry: SourceEntry;
  lockKey: string;
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
    projectRoot,
    localSkillNames,
    alreadyFetchedSkillNames,
    updateSources,
    frozen,
    logger,
  } = params;
  const { lock } = params;
  const url = sourceEntry.source;
  const locked = getLockedSource(lock, lockKey);
  const lockedSkillNames = locked ? getLockedSkillNames(locked) : [];

  const lockedOrResolved = await resolveGitFetchRef({ sourceEntry, locked, updateSources });

  const curatedDir = join(projectRoot, RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH);
  if (
    await canReuseLockedSkills({
      locked,
      resolvedSha: lockedOrResolved.resolvedSha,
      updateSources,
      frozen,
      sourceEntry,
      curatedDir,
      getAlreadyFetchedSkillNames: async () => alreadyFetchedSkillNames,
    })
  ) {
    return { skillCount: 0, fetchedSkillNames: lockedSkillNames, updatedLock: lock };
  }

  const { requestedRef, resolvedSha } = await ensureGitRequestedRef({
    url,
    ...lockedOrResolved,
    frozen,
  });

  const skillFilter = sourceEntry.skills ?? ["*"];
  const isWildcard = isWildcardSelection(skillFilter);
  const remoteFiles = await fetchSkillFiles({
    url,
    ref: requestedRef,
    resolvedRef: resolvedSha,
    skillsPath: resolveSkillsSourcePath(sourceEntry),
    logger,
  });

  const skillFileMap = groupRemoteFilesBySkillRoot({ remoteFiles, skillFilter, isWildcard });

  const allNames = [...skillFileMap.keys()];
  const filteredNames = isWildcard ? allNames : allNames.filter((n) => skillFilter.includes(n));
  assertMatchingSkillsFound({ skillNames: filteredNames, source: url });

  if (locked) {
    await cleanPreviousCuratedSkills({
      curatedDir,
      lockedSkillNames,
      protectedSkillNames: alreadyFetchedSkillNames,
      logger,
    });
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
      frozen,
      logger,
    });
  }

  const result = buildLockUpdate({
    lock,
    lockKey,
    sourceKey: url,
    fetchedSkills,
    locked,
    requestedRef,
    resolvedSha,
    skillSelection: normalizeSkillSelection(skillFilter),
    skillsPath: resolveSkillsPath(sourceEntry),
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
