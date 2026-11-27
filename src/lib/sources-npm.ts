import { join } from "node:path";

import type { SourceEntry } from "../config/config.js";
import { SKILL_FILE_NAME } from "../constants/general.js";
import {
  formatMegabytes,
  MAX_FILE_SIZE,
  MAX_FILE_SIZE_MB,
  RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH,
} from "../constants/rulesync-paths.js";
import { quoteForLog, stripControlCharacters } from "../utils/control-characters.js";
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
  getNpmLockedSkillNames,
  getNpmLockedSource,
  type NpmLockedSource,
  type NpmSourcesLock,
  setNpmLockedSource,
} from "./npm-sources-lock.js";
import { extractPackageTarball } from "./npm-tar.js";
import {
  assertMatchingFilesFound,
  assertMatchingSkillsFound,
  canReuseLockedFiles,
  checkLockedSkillsAreValid,
  cleanPreviousCuratedFiles,
  cleanPreviousCuratedSkills,
  getCuratedFileFeatureRelativeDirPath,
  getFileFeatureNoun,
  getFirstPathSeparatorIndex,
  getSourceFilters,
  groupRemoteFilesBySkillRoot,
  isWildcardSelection,
  lockedSkillConfigMatches,
  mergeFetchedWithLockedSkills,
  normalizeRuleSelection,
  normalizeSkillSelection,
  type RemoteSkillFile,
  replaceCuratedFiles,
  resolveFileFeaturePath,
  resolveSkillsPath,
  resolveSkillsSourcePath,
  selectDeclaredFiles,
  shouldSkipSkill,
  shouldUseRootFallback,
  writeSkillAndComputeIntegrity,
} from "./sources-artifacts.js";
import {
  type FileFeatureLockFields,
  type LockedSkill,
  type LockedRule,
  type LockedSource,
  type SourceFileFeature,
  SOURCE_FILE_FEATURES,
  getLockedFileFeatureState,
  getLockedFileNames,
  mapFileFeatures,
  toFileFeatureLockFields,
} from "./sources-lock.js";

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
function extractNpmRemoteFiles(params: {
  tarball: Buffer;
  packageLabel: string;
  logger: Logger;
}): RemoteSkillFile[] {
  const { tarball, packageLabel, logger } = params;
  const extracted = extractPackageTarball({
    tarball,
    packageLabel,
    onSkippedEntry: (message) => logger.warn(message),
  });
  const allFiles: RemoteSkillFile[] = [];
  for (const entry of extracted) {
    if (entry.content.length > MAX_FILE_SIZE) {
      logger.warn(
        `Skipping file ${quoteForLog(entry.relativePath)} (${formatMegabytes(entry.content.length)}MB exceeds ${MAX_FILE_SIZE_MB}MB limit).`,
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
  fetchedFiles: Record<SourceFileFeature, NpmFetchedFiles>;
}): NpmLockedSource {
  const {
    sourceEntry,
    requestedVersion,
    resolvedVersion,
    dist,
    mergedSkills,
    skillSelection,
    skillsPath,
    fetchedFiles,
  } = params;
  // Only the features the source declares are recorded; a feature it no
  // longer declares drops out of the entry, and its curated files have been
  // removed already.
  const fileFields: FileFeatureLockFields = Object.assign(
    {},
    ...SOURCE_FILE_FEATURES.flatMap((feature) => {
      const selection = sourceEntry[feature];
      if (selection === undefined) {
        return [];
      }
      return [
        toFileFeatureLockFields(feature, {
          items: fetchedFiles[feature].fetched,
          selection: normalizeRuleSelection(selection),
          path: resolveFileFeaturePath(sourceEntry, feature),
          resolvedNames: fetchedFiles[feature].resolvedNames,
        }),
      ];
    }),
  );
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
    ...fileFields,
  };
}

/** What one per-file feature of an npm source fetched, and every name it resolved. */
type NpmFetchedFiles = { fetched: Record<string, LockedRule>; resolvedNames: string[] };

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
    logger.debug(`Fetched skill ${quoteForLog(skillName)} from ${packageName}`);
  }
  return { fetchedSkills, remoteSkillNames };
}

async function fetchNpmFiles(params: {
  feature: SourceFileFeature;
  allFiles: RemoteSkillFile[];
  sourceEntry: SourceEntry;
  packageName: string;
  lockedForIntegrityCheck: LockedSource | undefined;
  lockedNames: string[];
  curatedDir: string;
  localNames: Set<string>;
  alreadyFetchedNames: Set<string>;
  resolvedVersion: string;
  updateSources: boolean;
  frozen: boolean;
  logger: Logger;
}): Promise<NpmFetchedFiles> {
  const {
    feature,
    allFiles,
    sourceEntry,
    packageName,
    lockedForIntegrityCheck,
    lockedNames,
    curatedDir,
    localNames,
    alreadyFetchedNames,
    resolvedVersion,
    updateSources,
    frozen,
    logger,
  } = params;
  if (sourceEntry[feature] === undefined) {
    return { fetched: {}, resolvedNames: [] };
  }
  const normalizedPath = resolveFileFeaturePath(sourceEntry, feature);
  const prefix = normalizedPath === "." ? "" : `${normalizedPath}/`;
  const remoteFiles = selectDeclaredFiles({
    feature,
    sourceEntry,
    candidates: allFiles
      .filter((file) => file.relativePath.startsWith(prefix))
      .map((file) => ({
        relativePath: file.relativePath.substring(prefix.length),
        content: file.content,
      }))
      .filter((file) => getFirstPathSeparatorIndex(file.relativePath) === -1),
    getFileName: (file) => file.relativePath,
  }).map(({ candidate, name }) => ({ name, content: candidate.content }));
  const resolvedNames = remoteFiles.map((file) => file.name);
  assertMatchingFilesFound({ feature, names: resolvedNames, source: packageName });
  const fetched = await replaceCuratedFiles({
    feature,
    files: remoteFiles,
    curatedDir,
    locked: lockedForIntegrityCheck,
    lockedNames,
    resolvedRef: resolvedVersion,
    sourceKey: packageName,
    localNames,
    alreadyFetchedNames,
    compareLockedIntegrity: !updateSources,
    frozen,
    logger,
  });
  return { fetched, resolvedNames };
}

async function canReuseLockedNpmArtifacts(params: {
  locked: NpmLockedSource | undefined;
  sourceEntry: SourceEntry;
  filters: ReturnType<typeof getSourceFilters>;
  frozen: boolean;
  lockedSkillNames: string[];
  curatedSkillsDir: string;
  projectRoot: string;
  localFileNames: Record<SourceFileFeature, Set<string>>;
  alreadyFetchedSkillNames: Set<string>;
  alreadyFetchedFileNames: Record<SourceFileFeature, Set<string>>;
}): Promise<boolean> {
  const {
    locked,
    sourceEntry,
    filters,
    frozen,
    lockedSkillNames,
    curatedSkillsDir,
    projectRoot,
    localFileNames,
    alreadyFetchedSkillNames,
    alreadyFetchedFileNames,
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
  for (const feature of SOURCE_FILE_FEATURES) {
    const selection = filters[feature];
    if (selection === undefined) {
      // A feature the entry still records but the source no longer declares
      // must be fetched again, so its curated files are removed.
      if (getLockedFileFeatureState(locked, feature).items !== undefined) {
        return false;
      }
      continue;
    }
    if (
      !(await canReuseLockedFiles({
        feature,
        locked,
        sourceEntry: { ...sourceEntry, [feature]: selection },
        lockedNames: getLockedFileNames(locked, feature),
        localNames: localFileNames[feature],
        alreadyFetchedNames: alreadyFetchedFileNames[feature],
        curatedDir: join(projectRoot, getCuratedFileFeatureRelativeDirPath(feature)),
      }))
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Fetch skills, rules, commands and subagents from a single npm-transport
 * source (EXPERIMENTAL): resolve the package version via the registry
 * packument, download and verify the tarball, extract it in-memory with the
 * hardened tar reader, and install the selected artifacts into their curated
 * directories.
 */
export async function fetchSourceViaNpm(params: {
  sourceEntry: SourceEntry;
  projectRoot: string;
  npmLock: NpmSourcesLock;
  localSkillNames: Set<string>;
  localFileNames: Record<SourceFileFeature, Set<string>>;
  alreadyFetchedSkillNames: Set<string>;
  alreadyFetchedFileNames: Record<SourceFileFeature, Set<string>>;
  updateSources: boolean;
  frozen: boolean;
  logger: Logger;
}): Promise<{
  skillCount: number;
  fetchedSkillNames: string[];
  fileCounts: Record<SourceFileFeature, number>;
  fetchedFileNames: Record<SourceFileFeature, string[]>;
  updatedLock: NpmSourcesLock;
}> {
  const {
    sourceEntry,
    projectRoot,
    npmLock,
    localSkillNames,
    localFileNames,
    alreadyFetchedSkillNames,
    alreadyFetchedFileNames,
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
  const curatedSkillsDir = join(projectRoot, RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH);
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
      curatedSkillsDir,
      projectRoot,
      localFileNames,
      alreadyFetchedSkillNames,
      alreadyFetchedFileNames,
    }))
  ) {
    logger.debug(`Version unchanged for ${sourceKey}, skipping re-fetch.`);
    return {
      skillCount: 0,
      fetchedSkillNames: filters.skills === undefined ? [] : lockedSkillNames,
      fileCounts: { rules: 0, commands: 0, subagents: 0 },
      fetchedFileNames: mapFileFeatures((feature) =>
        filters[feature] === undefined || locked === undefined
          ? []
          : getLockedFileNames(locked, feature),
      ),
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

  const allFiles = extractNpmRemoteFiles({
    tarball,
    // The version can come from registry metadata (a dist-tag), so keep it to one printable line.
    packageLabel: stripControlCharacters(`${packageName}@${resolvedVersion}`),
    logger,
  });

  // Adapter so the integrity checks can compare against the npm lock entry the
  // same way they do for git sources.
  const lockedForIntegrityCheck: LockedSource | undefined = locked
    ? {
        resolvedRef: locked.resolvedVersion,
        skills: locked.skills,
        rules: locked.rules,
        commands: locked.commands,
        subagents: locked.subagents,
      }
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

  const fetchedFiles = {} as Record<SourceFileFeature, NpmFetchedFiles>;
  for (const feature of SOURCE_FILE_FEATURES) {
    const curatedDir = join(projectRoot, getCuratedFileFeatureRelativeDirPath(feature));
    const lockedNames = locked ? getLockedFileNames(locked, feature) : [];
    fetchedFiles[feature] = await fetchNpmFiles({
      feature,
      allFiles,
      sourceEntry: { ...sourceEntry, [feature]: filters[feature] },
      packageName,
      lockedForIntegrityCheck,
      lockedNames,
      curatedDir,
      localNames: localFileNames[feature],
      alreadyFetchedNames: alreadyFetchedFileNames[feature],
      resolvedVersion,
      updateSources,
      frozen,
      logger,
    });
    if (filters[feature] === undefined && lockedNames.length > 0) {
      await cleanPreviousCuratedFiles({
        curatedDir,
        lockedNames,
        protectedNames: alreadyFetchedFileNames[feature],
        logger,
      });
    }
  }

  const fetchedSkillNames = Object.keys(fetchedSkills);
  const fetchedFileNames = mapFileFeatures((feature) => Object.keys(fetchedFiles[feature].fetched));
  const mergedSkills = mergeFetchedWithLockedSkills({
    fetchedSkills,
    lockedSkills: locked?.skills,
    remoteSkillNames:
      filters.skills === undefined ? Object.keys(locked?.skills ?? {}) : remoteSkillNames,
  });

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
      fetchedFiles,
    }),
  );

  logger.info(
    `Fetched ${fetchedSkillNames.length} skill(s) and ${fetchedFileNames.rules.length} rule(s)${SOURCE_FILE_FEATURES.filter(
      (feature) => feature !== "rules" && filters[feature] !== undefined,
    )
      .map((feature) => `, ${fetchedFileNames[feature].length} ${getFileFeatureNoun(feature)}(s)`)
      .join("")} from ${sourceKey}.`,
  );

  return {
    skillCount: fetchedSkillNames.length,
    fetchedSkillNames,
    fileCounts: mapFileFeatures((feature) => fetchedFileNames[feature].length),
    fetchedFileNames,
    updatedLock,
  };
}
