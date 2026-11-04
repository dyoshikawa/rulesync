import { join } from "node:path";

import type { SourceEntry } from "../config/config.js";
import { SKILL_FILE_NAME } from "../constants/general.js";
import {
  RULESYNC_CURATED_RULES_RELATIVE_DIR_PATH,
  formatMegabytes,
  MAX_FILE_SIZE,
  MAX_FILE_SIZE_MB,
  RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH,
} from "../constants/rulesync-paths.js";
import { isRootDirPath, normalizePosixDirPath } from "../utils/file.js";
import type { Logger } from "../utils/logger.js";
import {
  DEFAULT_NPM_REGISTRY_URL,
  fetchPackument,
  fetchTarball,
  getPackumentVersionDist,
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
  setNpmLockedSource,
} from "./npm-sources-lock.js";
import { extractPackageTarball } from "./npm-tar.js";
import {
  assertMatchingRulesFound,
  assertMatchingSkillsFound,
  canReuseLockedRules,
  checkLockedSkillsAreValid,
  cleanPreviousCuratedRules,
  cleanPreviousCuratedSkills,
  getFirstPathSeparatorIndex,
  getSourceFilters,
  groupRemoteFilesBySkillRoot,
  isWildcardSelection,
  lockedSkillConfigMatches,
  mergeFetchedWithLockedSkills,
  normalizeRuleSelection,
  normalizeSkillSelection,
  type RemoteSkillFile,
  replaceCuratedRules,
  resolveRulesPath,
  resolveSkillsPath,
  resolveSkillsSourcePath,
  selectDeclaredRules,
  shouldSkipSkill,
  shouldUseRootFallback,
  writeSkillAndComputeIntegrity,
} from "./sources-artifacts.js";
import type { LockedSkill, LockedRule, LockedSource } from "./sources-lock.js";

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

  const normalizedBase = normalizePosixDirPath(skillsPath);
  const isRootPath = isRootDirPath(normalizedBase);
  if (isRootPath) {
    return { remoteFiles: allFiles, skillFilter, isWildcard };
  }

  const prefix = `${normalizedBase}/`;
  const filesUnderBase = allFiles
    .filter((file) => file.relativePath.startsWith(prefix))
    .map((file) => ({
      ...file,
      relativePath: file.relativePath.substring(prefix.length),
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
export function resolveNpmFetchVersion(params: {
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
        `Skipping file "${entry.relativePath}" (${formatMegabytes(entry.content.length)}MB exceeds ${MAX_FILE_SIZE_MB}MB limit).`,
      );
      continue;
    }
    allFiles.push({
      relativePath: entry.relativePath,
      content: entry.content.toString("utf8"),
      executable: entry.executable,
    });
  }
  return allFiles;
}

/**
 * The skill selection and skills path to record for an npm source. A
 * rules-only source leaves the locked skills, and their selection and path,
 * as they were.
 */
function getNpmSkillLockState(params: {
  sourceEntry: SourceEntry;
  skills: string[] | undefined;
  locked: NpmLockedSource | undefined;
}): { skillSelection: string[] | undefined; skillsPath: string | undefined } {
  const { sourceEntry, skills, locked } = params;
  if (skills === undefined) {
    return { skillSelection: locked?.skillSelection, skillsPath: locked?.skillsPath };
  }
  return {
    skillSelection: normalizeSkillSelection(skills),
    skillsPath: resolveSkillsPath(sourceEntry),
  };
}

/** Build the npm lockfile entry for a fetched source. */
function buildNpmLockEntry(params: {
  sourceEntry: SourceEntry;
  requestedVersion: string | undefined;
  resolvedVersion: string;
  dist: { integrity?: string; shasum?: string };
  mergedSkills: Record<string, LockedSkill>;
  skillSelection: string[] | undefined;
  skillsPath: string | undefined;
  mergedRules: Record<string, LockedRule>;
  resolvedRuleNames: string[];
}): NpmLockedSource {
  const {
    sourceEntry,
    requestedVersion,
    resolvedVersion,
    dist,
    mergedSkills,
    skillSelection,
    skillsPath,
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
    ...(skillSelection !== undefined && { skillSelection }),
    ...(skillsPath !== undefined && { skillsPath }),
    ...(sourceEntry.rules !== undefined && {
      rules: mergedRules,
      ruleSelection: normalizeRuleSelection(sourceEntry.rules),
      rulesPath: resolveRulesPath(sourceEntry),
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
  frozen: boolean;
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
    frozen,
    logger,
  } = params;
  const skillFilter = sourceEntry.skills ?? [];
  const declaredWildcard = isWildcardSelection(skillFilter);
  const selectedFiles = selectNpmSkillFiles({
    allFiles,
    skillsPath: resolveSkillsSourcePath(sourceEntry),
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
    await cleanPreviousCuratedSkills({
      curatedDir: curatedSkillsDir,
      lockedSkillNames,
      protectedSkillNames: alreadyFetchedSkillNames,
      logger,
    });
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
      frozen,
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
  frozen: boolean;
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
    frozen,
    logger,
  } = params;
  const normalizedRulesPath = resolveRulesPath(sourceEntry);
  const rulePrefix = normalizedRulesPath === "." ? "" : `${normalizedRulesPath}/`;
  const remoteRules = selectDeclaredRules({
    sourceEntry,
    candidates: allFiles
      .filter((file) => file.relativePath.startsWith(rulePrefix))
      .map((file) => ({
        relativePath: file.relativePath.substring(rulePrefix.length),
        content: file.content,
      }))
      .filter((file) => getFirstPathSeparatorIndex(file.relativePath) === -1),
    getFileName: (file) => file.relativePath,
  }).map(({ candidate, name }) => ({ name, content: candidate.content }));
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
    frozen,
    logger,
  });
  return { fetchedRules, resolvedRuleNames };
}

async function canReuseLockedNpmArtifacts(params: {
  locked: NpmLockedSource | undefined;
  sourceEntry: SourceEntry;
  filters: ReturnType<typeof getSourceFilters>;
  frozen: boolean;
  lockedSkillNames: string[];
  lockedRuleNames: string[];
  curatedSkillsDir: string;
  curatedRulesDir: string;
  localRuleNames: Set<string>;
  alreadyFetchedSkillNames: Set<string>;
  alreadyFetchedRuleNames: Set<string>;
}): Promise<boolean> {
  const {
    locked,
    sourceEntry,
    filters,
    frozen,
    lockedSkillNames,
    lockedRuleNames,
    curatedSkillsDir,
    curatedRulesDir,
    localRuleNames,
    alreadyFetchedSkillNames,
    alreadyFetchedRuleNames,
  } = params;
  if (locked === undefined) {
    return false;
  }
  const skillsExist =
    filters.skills === undefined ||
    (lockedSkillNames.length > 0 &&
      lockedSkillConfigMatches({
        locked,
        sourceEntry: { ...sourceEntry, skills: filters.skills },
        acceptLegacy: frozen,
      }) &&
      (await checkLockedSkillsAreValid({
        curatedDir: curatedSkillsDir,
        skills: locked.skills,
        presenceOnlySkillNames: alreadyFetchedSkillNames,
      })));
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
export async function fetchSourceViaNpm(params: {
  sourceEntry: SourceEntry;
  projectRoot: string;
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
    frozen,
    logger,
  } = params;

  const packageName = sourceEntry.source;
  validateNpmPackageName(packageName);
  const registryUrl = sourceEntry.registry ?? DEFAULT_NPM_REGISTRY_URL;
  validateNpmRegistryUrl(registryUrl, { logger });
  const token = resolveNpmToken({ tokenEnv: sourceEntry.tokenEnv, registryUrl, logger });

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
      frozen,
      lockedSkillNames,
      lockedRuleNames,
      curatedSkillsDir,
      curatedRulesDir,
      localRuleNames,
      alreadyFetchedSkillNames,
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
    frozen,
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
    frozen,
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
      ...getNpmSkillLockState({ sourceEntry, skills: filters.skills, locked }),
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
