import { join, resolve, sep } from "node:path";

import { getSourceTransport, type SourceEntry } from "../config/config.js";
import { SKILL_FILE_NAME } from "../constants/general.js";
import {
  RULESYNC_CURATED_COMMANDS_RELATIVE_DIR_PATH,
  RULESYNC_CURATED_RULES_RELATIVE_DIR_PATH,
  RULESYNC_CURATED_SUBAGENTS_RELATIVE_DIR_PATH,
} from "../constants/rulesync-paths.js";
import { quoteForLog, stripControlCharacters } from "../utils/control-characters.js";
import {
  applyFileMode,
  checkPathTraversal,
  directoryExists,
  fileExists,
  listFilePathsRecursively,
  normalizePosixDirPath,
  readFileContent,
  removeFileStrict,
  removeDirectoryStrict,
  toPosixPath,
  writeFileContent,
} from "../utils/file.js";
import type { Logger } from "../utils/logger.js";
import { classifyRemoteName } from "../utils/remote-name.js";
import type { NpmLockedSource } from "./npm-sources-lock.js";
import { parseSource } from "./source-parser.js";
import {
  type FileFeatureLockFields,
  type LockedSkill,
  type LockedRule,
  type LockedSource,
  type SourceFileFeature,
  type SourcesLock,
  SOURCE_FILE_FEATURES,
  computeRuleIntegrity,
  computeSkillIntegrity,
  getLockedFileFeatureState,
  setLockedSource,
  toFileFeatureLockFields,
} from "./sources-lock.js";

export type RemoteSkillFile = {
  relativePath: string;
  content: string;
  /**
   * Whether the source records the file as executable (git mode `100755`, a
   * checked-out file with an execute bit, or a tar entry with one). A skill's
   * `scripts/run.sh` keeps its bit in `.curated/`, so the skill generated from
   * it stays runnable.
   */
  executable?: boolean;
};

/** One Markdown file of a per-file feature (a rule, command or subagent). */
export type RemoteFeatureFile = {
  name: string;
  content: string;
};

/**
 * How a source installs one per-file feature: the singular noun used in
 * messages, the source entry field naming the directory in the source, its
 * default, and where the fetched copies are kept in the project.
 */
type FileFeatureSpec = {
  noun: string;
  pathField: "rulesPath" | "commandsPath" | "subagentsPath";
  defaultPath: string;
  curatedRelativeDirPath: string;
};

const FILE_FEATURE_SPECS: Record<SourceFileFeature, FileFeatureSpec> = {
  rules: {
    noun: "rule",
    pathField: "rulesPath",
    defaultPath: "rules",
    curatedRelativeDirPath: RULESYNC_CURATED_RULES_RELATIVE_DIR_PATH,
  },
  commands: {
    noun: "command",
    pathField: "commandsPath",
    defaultPath: "commands",
    curatedRelativeDirPath: RULESYNC_CURATED_COMMANDS_RELATIVE_DIR_PATH,
  },
  subagents: {
    noun: "subagent",
    pathField: "subagentsPath",
    defaultPath: "subagents",
    curatedRelativeDirPath: RULESYNC_CURATED_SUBAGENTS_RELATIVE_DIR_PATH,
  },
};

/** The singular noun of a per-file feature, for messages (`rule`, `command`, `subagent`). */
export function getFileFeatureNoun(feature: SourceFileFeature): string {
  return FILE_FEATURE_SPECS[feature].noun;
}

/** Where a per-file feature's fetched copies live, relative to the project root. */
export function getCuratedFileFeatureRelativeDirPath(feature: SourceFileFeature): string {
  return FILE_FEATURE_SPECS[feature].curatedRelativeDirPath;
}

/** Every selection field a source entry may declare. */
export const SOURCE_SELECTION_FIELDS = ["skills", ...SOURCE_FILE_FEATURES] as const;
export type SourceSelectionField = (typeof SOURCE_SELECTION_FIELDS)[number];

export function getSourceFilters(
  sourceEntry: SourceEntry,
): Record<SourceSelectionField, string[] | undefined> {
  const hasExplicitFeature = SOURCE_SELECTION_FIELDS.some(
    (field) => sourceEntry[field] !== undefined,
  );
  return {
    skills: sourceEntry.skills ?? (hasExplicitFeature ? undefined : ["*"]),
    rules: sourceEntry.rules,
    commands: sourceEntry.commands,
    subagents: sourceEntry.subagents,
  };
}

/** The selection fields a source entry declares as an empty list. */
export function getEmptySelectionFields(sourceEntry: SourceEntry): SourceSelectionField[] {
  return SOURCE_SELECTION_FIELDS.filter((field) => sourceEntry[field]?.length === 0);
}

export function hasEmptySelection(sourceEntry: SourceEntry): boolean {
  return getEmptySelectionFields(sourceEntry).length > 0;
}

/**
 * Whether a lock entry was written for the ref the manifest declares now. A
 * declared ref that differs from the locked `requestedRef` is resolved afresh
 * (and fails `--frozen`), so editing the ref in the manifest cannot keep
 * installing the commit resolved for the old one.
 *
 * An entry that records no `requestedRef` (a migrated legacy lock, or a
 * hand-written one) still matches: it says nothing that contradicts the
 * declared ref, and refusing it would gain nothing, since whoever can edit the
 * lock can also write any `requestedRef`. The declared ref is recorded on it
 * the next time the entry is written.
 *
 * A source that declares no ref also matches: its locked `requestedRef` is the
 * default branch it resolved to, which cannot be told apart from a ref that
 * was dropped from the manifest without asking the remote.
 */
export function lockedRefMatchesDeclared(params: {
  locked: LockedSource;
  declaredRef: string | undefined;
}): boolean {
  const { locked, declaredRef } = params;
  return (
    declaredRef === undefined ||
    locked.requestedRef === undefined ||
    locked.requestedRef === declaredRef
  );
}

/**
 * Check that every locked skill is on disk in the curated directory with the
 * content the lockfile records: its files hash to the locked integrity, so a
 * skill edited, extended or trimmed in place is fetched again, as a rule is.
 *
 * The locked hash keys each file by the path the transport reported. The
 * GitHub API and npm report POSIX paths, while the git transport reports
 * platform paths, so on Windows both spellings are accepted.
 *
 * Only presence is checked for a skill whose content this entry cannot vouch
 * for: one an earlier source already installed under the same name (the
 * curated directory then holds that source's copy, which wins), and one locked
 * with an empty integrity by the migration from the legacy lockfile format.
 */
export async function checkLockedSkillsAreValid(params: {
  curatedDir: string;
  skills: Record<string, { integrity: string }>;
  presenceOnlySkillNames?: Pick<Set<string>, "has">;
}): Promise<boolean> {
  const { curatedDir, skills, presenceOnlySkillNames = new Set() } = params;
  for (const [name, entry] of Object.entries(skills)) {
    const skillDir = join(curatedDir, name);
    if (!(await directoryExists(skillDir))) {
      return false;
    }
    if (entry.integrity === "" || presenceOnlySkillNames.has(name)) {
      continue;
    }
    const files = await Promise.all(
      (await listFilePathsRecursively(skillDir, { includeHidden: true })).map(
        async (relativePath) => ({
          relativePath,
          content: await readFileContent(join(skillDir, relativePath)),
        }),
      ),
    );
    const spellings: Array<(relativePath: string) => string> =
      sep === "/"
        ? [(relativePath) => relativePath]
        : [toPosixPath, (relativePath) => relativePath];
    const matches = spellings.some(
      (spell) =>
        computeSkillIntegrity(
          files.map((file) => ({ path: spell(file.relativePath), content: file.content })),
        ) === entry.integrity,
    );
    if (!matches) {
      return false;
    }
  }
  return true;
}

/**
 * Check that every item one per-file feature of a lock entry locks is on disk
 * in its curated directory with the locked content. A locked name that is not
 * a valid file name (a hand-edited lockfile) never counts as installed, so it
 * is fetched again rather than read from outside the curated directory.
 */
export async function checkLockedFilesAreValid(params: {
  feature: SourceFileFeature;
  curatedDir: string;
  locked: FileFeatureLockFields;
}): Promise<boolean> {
  const { items } = getLockedFileFeatureState(params.locked, params.feature);
  for (const [name, entry] of Object.entries(items ?? {})) {
    if (!isValidRuleName(name)) {
      return false;
    }
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

export async function canReuseLockedFiles(params: {
  feature: SourceFileFeature;
  locked: LockedSource | NpmLockedSource;
  sourceEntry: SourceEntry;
  lockedNames: string[];
  localNames: Set<string>;
  alreadyFetchedNames: Set<string>;
  curatedDir: string;
}): Promise<boolean> {
  const { feature, locked, sourceEntry, lockedNames, localNames, alreadyFetchedNames, curatedDir } =
    params;
  if (!lockedFileConfigMatches({ feature, locked, sourceEntry })) {
    return false;
  }
  const { resolvedNames } = getLockedFileFeatureState(locked, feature);
  if (resolvedNames === undefined) {
    return false;
  }
  const availableNames = new Set([...lockedNames, ...localNames, ...alreadyFetchedNames]);
  if (resolvedNames.some((name) => !availableNames.has(name))) {
    return false;
  }
  if (lockedNames.some((name) => localNames.has(name) || alreadyFetchedNames.has(name))) {
    return false;
  }
  return checkLockedFilesAreValid({ feature, curatedDir, locked });
}

// ---------------------------------------------------------------------------
// Shared helpers for fetchSource and fetchSourceViaGit
// ---------------------------------------------------------------------------

/**
 * Remove previously curated skill directories for a source before re-fetching.
 * Validates that each path resolves within the curated directory to prevent traversal.
 */
export async function cleanPreviousCuratedSkills(params: {
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
        `Skipping removal of ${quoteForLog(prevSkill)}: resolved path is outside the curated directory.`,
      );
      continue;
    }
    if (await directoryExists(prevDir)) {
      await removeDirectoryStrict(prevDir);
    }
  }
}

/**
 * Whether `<name>.md` resolves to a file directly inside `curatedDir`. Locked
 * names come from the lockfile, which can be edited by hand, so they are
 * checked before anything is read, removed or written under them.
 */
function isCuratedFileInside(params: { curatedDir: string; name: string }): boolean {
  const resolvedCuratedDir = resolve(params.curatedDir);
  return resolve(join(params.curatedDir, `${params.name}.md`)).startsWith(resolvedCuratedDir + sep);
}

/**
 * Remove a source's previously curated files (rules, commands or subagents)
 * before re-fetching. Validates that each path resolves within the curated
 * directory to prevent traversal.
 */
export async function cleanPreviousCuratedFiles(params: {
  curatedDir: string;
  lockedNames: string[];
  protectedNames: Set<string>;
  logger: Logger;
}): Promise<void> {
  const { curatedDir, lockedNames, protectedNames, logger } = params;
  for (const prevName of lockedNames) {
    if (protectedNames.has(prevName)) {
      continue;
    }
    if (!isCuratedFileInside({ curatedDir, name: prevName })) {
      logger.warn(
        `Skipping removal of ${quoteForLog(prevName)}: resolved path is outside the curated directory.`,
      );
      continue;
    }
    const prevFile = join(curatedDir, `${prevName}.md`);
    if (await fileExists(prevFile)) {
      await removeFileStrict(prevFile);
    }
  }
}

export async function replaceCuratedFiles(params: {
  feature: SourceFileFeature;
  files: RemoteFeatureFile[];
  curatedDir: string;
  locked: LockedSource | undefined;
  lockedNames: string[];
  resolvedRef: string;
  sourceKey: string;
  localNames: Set<string>;
  alreadyFetchedNames: Set<string>;
  compareLockedIntegrity: boolean;
  frozen: boolean;
  logger: Logger;
}): Promise<Record<string, LockedRule>> {
  const {
    feature,
    files,
    curatedDir,
    locked,
    lockedNames,
    resolvedRef,
    sourceKey,
    localNames,
    alreadyFetchedNames,
    compareLockedIntegrity,
    frozen,
    logger,
  } = params;
  const protectedNames = alreadyFetchedNames;
  const installableFiles = files.filter(
    (file) =>
      !shouldSkipFile({
        feature,
        name: file.name,
        sourceKey,
        localNames,
        alreadyFetchedNames,
        logger,
      }),
  );
  const previousContents = new Map<string, string>();
  for (const name of lockedNames) {
    if (protectedNames.has(name) || !isCuratedFileInside({ curatedDir, name })) {
      continue;
    }
    const path = join(curatedDir, `${name}.md`);
    if (await fileExists(path)) {
      previousContents.set(name, await readFileContent(path));
    }
  }

  try {
    await cleanPreviousCuratedFiles({ curatedDir, lockedNames, protectedNames, logger });
    const fetchedFiles: Record<string, LockedRule> = {};
    for (const file of installableFiles) {
      fetchedFiles[file.name] = await writeFeatureFileAndComputeIntegrity({
        feature,
        file,
        curatedDir,
        locked,
        resolvedRef,
        sourceKey,
        compareLockedIntegrity,
        frozen,
        logger,
      });
    }
    return fetchedFiles;
  } catch (error) {
    for (const file of installableFiles) {
      await removeFileStrict(join(curatedDir, `${file.name}.md`));
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
export function shouldSkipSkill(params: {
  skillName: string;
  sourceKey: string;
  localSkillNames: Set<string>;
  alreadyFetchedSkillNames: Set<string>;
  logger: Logger;
}): boolean {
  const { skillName, sourceKey, localSkillNames, alreadyFetchedSkillNames, logger } = params;
  if (skillName.includes("..") || skillName.includes("/") || skillName.includes("\\")) {
    logger.warn(
      `Skipping skill with invalid name ${quoteForLog(skillName)} from ${sourceKey}: contains path traversal characters.`,
    );
    return true;
  }
  const unsafe = describeUnsafeRemoteName(skillName);
  if (unsafe !== undefined) {
    logger.warn(`Skipping skill with unsafe name ${unsafe} from ${sourceKey}.`);
    return true;
  }
  if (localSkillNames.has(skillName)) {
    logger.debug(
      `Skipping remote skill ${quoteForLog(skillName)} from ${sourceKey}: local skill takes precedence.`,
    );
    return true;
  }
  if (alreadyFetchedSkillNames.has(skillName)) {
    logger.warn(
      `Skipping duplicate skill ${quoteForLog(skillName)} from ${sourceKey}: already fetched from another source.`,
    );
    return true;
  }
  return false;
}

/**
 * Check whether a remote rule, command or subagent should be skipped: its
 * name could escape the curated directory or is unsafe to print, a local file
 * of the same name takes precedence, or an earlier source already took it.
 */
export function shouldSkipFile(params: {
  feature: SourceFileFeature;
  name: string;
  sourceKey: string;
  localNames: Set<string>;
  alreadyFetchedNames: Set<string>;
  logger: Logger;
}): boolean {
  const { feature, name, sourceKey, localNames, alreadyFetchedNames, logger } = params;
  const noun = getFileFeatureNoun(feature);
  if (!isValidRuleName(name)) {
    logger.warn(`Skipping ${noun} with invalid name ${quoteForLog(name)} from ${sourceKey}.`);
    return true;
  }
  const unsafe = describeUnsafeRemoteName(name);
  if (unsafe !== undefined) {
    logger.warn(`Skipping ${noun} with unsafe name ${unsafe} from ${sourceKey}.`);
    return true;
  }
  if (localNames.has(name)) {
    logger.debug(
      `Skipping remote ${noun} ${quoteForLog(name)} from ${sourceKey}: local ${noun} takes precedence.`,
    );
    return true;
  }
  if (alreadyFetchedNames.has(name)) {
    logger.warn(
      `Skipping duplicate ${noun} ${quoteForLog(name)} from ${sourceKey}: already fetched from another source.`,
    );
    return true;
  }
  return false;
}

/**
 * Why a remote skill or rule name must not be installed, already quoted for a
 * log line, or `undefined` when it is safe. It applies the same gate as
 * `rulesync fetch`: a name hiding control or deceptive zero-width characters
 * could rewrite the terminal when printed, or pass for another name, and a
 * name Windows folds lands on a different entry than it reads as.
 */
function describeUnsafeRemoteName(name: string): string | undefined {
  const verdict = classifyRemoteName(name);
  if (verdict.kind === "safe") {
    return undefined;
  }
  return verdict.reason === "hidden"
    ? `${quoteForLog(verdict.display)} (it contains hidden or control characters)`
    : `${quoteForLog(name)} (Windows resolves it to a different name)`;
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

/**
 * A fetched artifact whose content no longer matches the integrity recorded
 * for the same resolved ref. Under `--frozen` that is fatal — the lockfile is
 * the contract, and the gh transport refuses the same case — otherwise it is
 * reported and the new content is taken.
 */
function reportIntegrityMismatch(params: {
  message: string;
  frozen: boolean;
  logger: Logger;
}): void {
  const { message, frozen, logger } = params;
  if (frozen) {
    throw new Error(`${message} Refusing to install it under --frozen.`);
  }
  logger.warn(message);
}

async function writeFeatureFileAndComputeIntegrity(params: {
  feature: SourceFileFeature;
  file: RemoteFeatureFile;
  curatedDir: string;
  locked: LockedSource | undefined;
  resolvedRef: string;
  sourceKey: string;
  compareLockedIntegrity?: boolean;
  frozen: boolean;
  logger: Logger;
}): Promise<LockedRule> {
  const {
    feature,
    file,
    curatedDir,
    locked,
    resolvedRef,
    sourceKey,
    compareLockedIntegrity = true,
    frozen,
    logger,
  } = params;
  const relativePath = `${file.name}.md`;
  checkPathTraversal({ relativePath, intendedRootDir: curatedDir });
  const integrity = computeRuleIntegrity(file.content);
  const lockedEntry = locked
    ? getLockedFileFeatureState(locked, feature).items?.[file.name]
    : undefined;
  if (
    compareLockedIntegrity &&
    lockedEntry?.integrity &&
    lockedEntry.integrity !== integrity &&
    resolvedRef === locked?.resolvedRef
  ) {
    reportIntegrityMismatch({
      message: `Integrity mismatch for ${getFileFeatureNoun(feature)} ${quoteForLog(file.name)} from ${sourceKey}: expected "${lockedEntry.integrity}", got "${integrity}". Content may have been tampered with.`,
      frozen,
      logger,
    });
  }
  await writeFileContent(join(curatedDir, relativePath), file.content);
  return { integrity };
}

/**
 * Write skill files to disk, compute integrity, and check against the lockfile.
 * Returns the computed LockedSkill entry.
 */
export async function writeSkillAndComputeIntegrity(params: {
  skillName: string;
  files: RemoteSkillFile[];
  curatedDir: string;
  locked: LockedSource | undefined;
  resolvedSha: string;
  sourceKey: string;
  frozen: boolean;
  logger: Logger;
}): Promise<LockedSkill> {
  const { skillName, files, curatedDir, locked, resolvedSha, sourceKey, frozen, logger } = params;
  for (const file of files) {
    checkPathTraversal({
      relativePath: file.relativePath,
      intendedRootDir: join(curatedDir, skillName),
    });
  }

  // Compare before writing, so a mismatch under --frozen writes none of this
  // skill's files. It does not leave the curated directory as it was:
  // cleanPreviousCuratedSkills has already removed the source's locked skills,
  // and skills processed earlier in the same source have already been
  // written. Unlike rules, skills are not rolled back.
  const integrity = computeSkillIntegrity(
    files.map((file) => ({ path: file.relativePath, content: file.content })),
  );
  const lockedSkillEntry = locked?.skills[skillName];
  if (
    lockedSkillEntry?.integrity &&
    lockedSkillEntry.integrity !== integrity &&
    resolvedSha === locked?.resolvedRef
  ) {
    reportIntegrityMismatch({
      message: `Integrity mismatch for skill ${quoteForLog(skillName)} from ${sourceKey}: expected "${lockedSkillEntry.integrity}", got "${integrity}". Content may have been tampered with.`,
      frozen,
      logger,
    });
  }

  for (const file of files) {
    const filePath = join(curatedDir, skillName, file.relativePath);
    await writeFileContent(filePath, file.content);
    if (file.executable === true) {
      await applyFileMode(filePath, 0o755);
    }
  }

  return { integrity };
}

/**
 * Merge back locked skills that still exist in the remote but were skipped
 * during fetching (due to local precedence, already-fetched, etc.). Skills no
 * longer present in the remote (e.g. renamed or deleted upstream) are
 * intentionally dropped. Shared by the git/github and npm lock updates.
 */
export function mergeFetchedWithLockedSkills(params: {
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

export function assertMatchingSkillsFound({
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
export function buildLockUpdate(params: {
  lock: SourcesLock;
  lockKey: string;
  sourceKey: string;
  fetchedSkills: Record<string, LockedSkill>;
  locked: LockedSource | undefined;
  requestedRef: string | undefined;
  resolvedSha: string;
  skillSelection: string[];
  skillsPath: string;
  remoteSkillNames: string[];
  logger: Logger;
}): { updatedLock: SourcesLock; fetchedNames: string[] } {
  const {
    lock,
    lockKey,
    sourceKey,
    fetchedSkills,
    locked,
    requestedRef,
    resolvedSha,
    skillSelection,
    skillsPath,
    remoteSkillNames,
    logger,
  } = params;
  const fetchedNames = Object.keys(fetchedSkills);

  const mergedSkills = mergeFetchedWithLockedSkills({
    fetchedSkills,
    lockedSkills: locked?.skills,
    remoteSkillNames,
  });

  const updatedLock = setLockedSource(lock, lockKey, {
    requestedRef,
    resolvedRef: resolvedSha,
    resolvedAt: new Date().toISOString(),
    skills: mergedSkills,
    skillSelection,
    skillsPath,
    rules: locked?.rules ?? {},
    ruleSelection: locked?.ruleSelection,
    rulesPath: locked?.rulesPath,
    resolvedRuleNames: locked?.resolvedRuleNames,
    ...pickFileFeatureLockFields({ locked, features: ["commands", "subagents"] }),
  });

  logger.info(
    `Fetched ${fetchedNames.length} skill(s) from ${sourceKey}: ${fetchedNames.map(stripControlCharacters).join(", ") || "(none)"}`,
  );

  return { updatedLock, fetchedNames };
}

/**
 * The lock fields of the given per-file features, copied from a lock entry
 * (empty when there is none), so that writing one feature's fields keeps the
 * others as they were.
 */
export function pickFileFeatureLockFields(params: {
  locked: FileFeatureLockFields | undefined;
  features: readonly SourceFileFeature[];
}): FileFeatureLockFields {
  const { locked, features } = params;
  if (locked === undefined) {
    return {};
  }
  return Object.assign(
    {},
    ...features.map((feature) =>
      toFileFeatureLockFields(feature, getLockedFileFeatureState(locked, feature)),
    ),
  );
}

export function buildFileLockUpdate(params: {
  feature: SourceFileFeature;
  lock: SourcesLock;
  lockKey: string;
  sourceKey: string;
  fetchedFiles: Record<string, LockedRule>;
  locked: LockedSource | undefined;
  requestedRef: string | undefined;
  resolvedRef: string;
  selection: string[];
  path: string;
  resolvedNames: string[];
  logger: Logger;
}): { updatedLock: SourcesLock; fetchedNames: string[] } {
  const {
    feature,
    lock,
    lockKey,
    sourceKey,
    fetchedFiles,
    locked,
    requestedRef,
    resolvedRef,
    selection,
    path,
    resolvedNames,
    logger,
  } = params;
  const fetchedNames = Object.keys(fetchedFiles);
  const updatedLock = setLockedSource(lock, lockKey, {
    requestedRef,
    resolvedRef,
    resolvedAt: new Date().toISOString(),
    skills: locked?.skills ?? {},
    skillSelection: locked?.skillSelection,
    skillsPath: locked?.skillsPath,
    ...pickFileFeatureLockFields({ locked, features: SOURCE_FILE_FEATURES }),
    ...toFileFeatureLockFields(feature, {
      items: fetchedFiles,
      selection,
      path,
      resolvedNames,
    }),
  });
  logger.info(
    `Fetched ${fetchedNames.length} ${getFileFeatureNoun(feature)}(s) from ${sourceKey}: ${fetchedNames.map(stripControlCharacters).join(", ") || "(none)"}`,
  );
  return { updatedLock, fetchedNames };
}

export function getFirstPathSeparatorIndex(path: string): number {
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
export function shouldUseRootFallback(params: {
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

export function groupRemoteFilesBySkillRoot(params: {
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
    groupedFiles.push({ ...file, relativePath: innerPath });
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

export function normalizeRuleFilterName(name: string): string {
  return name.replace(/\.md$/i, "");
}

/** Whether a declared skill or rule selection is the `["*"]` wildcard. */
export function isWildcardSelection(selection: readonly string[]): boolean {
  return selection.length === 1 && selection[0] === "*";
}

/**
 * Pick the remote files a source entry declares for one per-file feature:
 * Markdown files whose normalized name is selected by the feature's field
 * (`sourceEntry.rules`, `.commands` or `.subagents`, or the wildcard) and is a
 * valid file name. Candidate order is preserved.
 */
export function selectDeclaredFiles<T>(params: {
  feature: SourceFileFeature;
  sourceEntry: SourceEntry;
  candidates: readonly T[];
  getFileName: (candidate: T) => string;
}): Array<{ candidate: T; name: string }> {
  const { feature, sourceEntry, candidates, getFileName } = params;
  const ruleFilter = (sourceEntry[feature] ?? []).map(normalizeRuleFilterName);
  const isWildcard = isWildcardSelection(ruleFilter);
  return candidates
    .filter((candidate) => getFileName(candidate).toLowerCase().endsWith(".md"))
    .map((candidate) => ({ candidate, name: normalizeRuleFilterName(getFileName(candidate)) }))
    .filter(({ name }) => (isWildcard || ruleFilter.includes(name)) && isValidRuleName(name));
}

export function normalizeRuleSelection(rules: string[]): string[] {
  return [...new Set(rules.map(normalizeRuleFilterName))].toSorted();
}

export function normalizeSkillSelection(skills: string[]): string[] {
  return [...new Set(skills)].toSorted();
}

/**
 * Whether the locked entry was written for the `skills` selection and skills
 * path the manifest declares now. Without it, widening the selection or moving
 * the path after an install is a silent no-op: the ref is unchanged and every
 * locked skill is on disk, so nothing is fetched and `--frozen` never notices.
 *
 * Lockfiles written before the path was recorded carry no `skillsPath`. Such
 * an entry is handled like one without `skillSelection`: fetched again at its
 * locked ref to record the path, and accepted as-is under `acceptLegacy`.
 *
 * Lockfiles written before the selection was recorded carry no
 * `skillSelection`. An install that may write the lockfile fetches such an
 * entry again at its locked ref so the selection gets recorded once; the checks that
 * cannot write it (`--frozen`, adding a source) pass `acceptLegacy` and fall
 * back to the locked skill names instead, so a wildcard is taken at face value
 * and an explicit list is covered only when every name it selects is locked.
 * An entry that locks no skills at all (a rules-only install) covers nothing:
 * it was never written for a skill selection.
 */
export function lockedSkillConfigMatches(params: {
  locked: {
    skills: Record<string, unknown>;
    skillSelection?: string[] | undefined;
    skillsPath?: string | undefined;
  };
  sourceEntry: SourceEntry;
  acceptLegacy: boolean;
}): boolean {
  const skills = getSourceFilters(params.sourceEntry).skills;
  if (skills === undefined) {
    return false;
  }
  const lockedPath = params.locked.skillsPath;
  if (
    lockedPath === undefined
      ? !params.acceptLegacy
      : lockedPath !== resolveSkillsPath(params.sourceEntry)
  ) {
    return false;
  }
  const selection = normalizeSkillSelection(skills);
  const lockedSelection = params.locked.skillSelection;
  if (lockedSelection === undefined) {
    const lockedSkillNames = new Set(Object.keys(params.locked.skills));
    if (!params.acceptLegacy || lockedSkillNames.size === 0) {
      return false;
    }
    if (isWildcardSelection(selection)) {
      return true;
    }
    return selection.every((skillName) => lockedSkillNames.has(skillName));
  }
  return (
    selection.length === lockedSelection.length &&
    selection.every((skillName, index) => skillName === lockedSelection[index])
  );
}

/**
 * Skip the re-fetch when the SHA and the skill selection match the lockfile and
 * every curated skill the entry locks is still on disk, unmodified.
 */
export async function canReuseLockedSkills(params: {
  locked: LockedSource | undefined;
  resolvedSha: string;
  updateSources: boolean;
  frozen: boolean;
  sourceEntry: SourceEntry;
  curatedDir: string;
  /**
   * The names earlier sources took. A thunk, so a caller that has to wait for
   * them waits only when the cheaper checks already allow the reuse.
   */
  getAlreadyFetchedSkillNames: () => Promise<Pick<Set<string>, "has">>;
}): Promise<boolean> {
  const {
    locked,
    resolvedSha,
    updateSources,
    frozen,
    sourceEntry,
    curatedDir,
    getAlreadyFetchedSkillNames,
  } = params;
  return (
    locked !== undefined &&
    resolvedSha === locked.resolvedRef &&
    !updateSources &&
    lockedSkillConfigMatches({ locked, sourceEntry, acceptLegacy: frozen }) &&
    (await checkLockedSkillsAreValid({
      curatedDir,
      skills: locked.skills,
      presenceOnlySkillNames: await getAlreadyFetchedSkillNames(),
    }))
  );
}

/**
 * The path the skills of a source are read from, as declared: the source's
 * `path`, else (for the github transport) the path embedded in the source
 * spec, else `skills`. Every transport fetches from this path, and the
 * lockfile records its normalized form ({@link resolveSkillsPath}), so the
 * fetch and the lock comparison cannot pick different paths.
 */
export function resolveSkillsSourcePath(sourceEntry: SourceEntry): string {
  const embeddedPath =
    getSourceTransport(sourceEntry) === "github" ? parseSource(sourceEntry.source).path : undefined;
  return sourceEntry.path ?? embeddedPath ?? "skills";
}

/** The skills path of a source in the form the lockfile records and compares. */
export function resolveSkillsPath(sourceEntry: SourceEntry): string {
  return normalizeSourceDirPath(resolveSkillsSourcePath(sourceEntry));
}

/**
 * The path one per-file feature of a source is read from, as declared: the
 * source's `rulesPath` / `commandsPath` / `subagentsPath`, else `rules` /
 * `commands` / `subagents`. The counterpart of {@link resolveSkillsSourcePath}.
 */
export function resolveFileFeatureSourcePath(
  sourceEntry: SourceEntry,
  feature: SourceFileFeature,
): string {
  const spec = FILE_FEATURE_SPECS[feature];
  return sourceEntry[spec.pathField] ?? spec.defaultPath;
}

/** A per-file feature's path in the form the lockfile records and compares. */
export function resolveFileFeaturePath(
  sourceEntry: SourceEntry,
  feature: SourceFileFeature,
): string {
  return normalizeSourceDirPath(resolveFileFeatureSourcePath(sourceEntry, feature));
}

/**
 * The form a source directory path is recorded in the lockfile and compared
 * in: posix separators, normalized, with no trailing slash.
 */
function normalizeSourceDirPath(dirPath: string): string {
  return normalizePosixDirPath(dirPath);
}

/**
 * Whether a lock entry was written for the selection and path one per-file
 * feature of the source declares now.
 */
export function lockedFileConfigMatches(params: {
  feature: SourceFileFeature;
  locked: FileFeatureLockFields;
  sourceEntry: SourceEntry;
}): boolean {
  const { feature, locked, sourceEntry } = params;
  const declared = getSourceFilters(sourceEntry)[feature];
  const { selection: lockedSelection, path: lockedPath } = getLockedFileFeatureState(
    locked,
    feature,
  );
  if (declared === undefined || lockedSelection === undefined) {
    return false;
  }
  const selection = normalizeRuleSelection(declared);
  return (
    selection.length === lockedSelection.length &&
    selection.every((name, index) => name === lockedSelection[index]) &&
    resolveFileFeaturePath(sourceEntry, feature) === lockedPath
  );
}

export function assertMatchingFilesFound(params: {
  feature: SourceFileFeature;
  names: string[];
  source: string;
}): void {
  if (params.names.length === 0) {
    throw new Error(`No matching ${params.feature} found in ${params.source}.`);
  }
}

/**
 * "N skill(s) and M rule(s)", followed by the command and subagent counts when
 * any were installed, for the summary lines of `add` and `install`.
 */
export function formatInstalledCounts(result: {
  fetchedSkillCount: number;
  fetchedRuleCount: number;
  fetchedCommandCount: number;
  fetchedSubagentCount: number;
}): string {
  const extras = [
    result.fetchedCommandCount > 0 ? `${result.fetchedCommandCount} command(s)` : undefined,
    result.fetchedSubagentCount > 0 ? `${result.fetchedSubagentCount} subagent(s)` : undefined,
  ].filter((part) => part !== undefined);
  const parts = [
    `${result.fetchedSkillCount} skill(s)`,
    `${result.fetchedRuleCount} rule(s)`,
    ...extras,
  ];
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}
