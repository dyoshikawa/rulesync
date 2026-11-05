import { join, resolve, sep } from "node:path";

import { getSourceTransport, type SourceEntry } from "../config/config.js";
import { SKILL_FILE_NAME } from "../constants/general.js";
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
import type { NpmLockedSource } from "./npm-sources-lock.js";
import { parseSource } from "./source-parser.js";
import {
  type LockedSkill,
  type LockedRule,
  type LockedSource,
  type SourcesLock,
  computeRuleIntegrity,
  computeSkillIntegrity,
  setLockedSource,
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

export type RemoteRuleFile = {
  name: string;
  content: string;
};

export function getSourceFilters(sourceEntry: SourceEntry): {
  skills: string[] | undefined;
  rules: string[] | undefined;
} {
  const hasExplicitFeature = sourceEntry.skills !== undefined || sourceEntry.rules !== undefined;
  return {
    skills: sourceEntry.skills ?? (hasExplicitFeature ? undefined : ["*"]),
    rules: sourceEntry.rules,
  };
}

export function getEmptySelections(sourceEntry: SourceEntry): {
  skillsEmpty: boolean;
  rulesEmpty: boolean;
} {
  return {
    skillsEmpty: sourceEntry.skills?.length === 0,
    rulesEmpty: sourceEntry.rules?.length === 0,
  };
}

export function hasEmptySelection(sourceEntry: SourceEntry): boolean {
  const { skillsEmpty, rulesEmpty } = getEmptySelections(sourceEntry);
  return skillsEmpty || rulesEmpty;
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

export async function checkLockedRulesAreValid(params: {
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

export async function canReuseLockedRules(params: {
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
        `Skipping removal of "${prevSkill}": resolved path is outside the curated directory.`,
      );
      continue;
    }
    if (await directoryExists(prevDir)) {
      await removeDirectoryStrict(prevDir);
    }
  }
}

export async function cleanPreviousCuratedRules(params: {
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

export async function replaceCuratedRules(params: {
  rules: RemoteRuleFile[];
  curatedDir: string;
  locked: LockedSource | undefined;
  lockedRuleNames: string[];
  resolvedRef: string;
  sourceKey: string;
  localRuleNames: Set<string>;
  alreadyFetchedRuleNames: Set<string>;
  compareLockedIntegrity: boolean;
  frozen: boolean;
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
    frozen,
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
        frozen,
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

export function shouldSkipRule(params: {
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

async function writeRuleAndComputeIntegrity(params: {
  rule: RemoteRuleFile;
  curatedDir: string;
  locked: LockedSource | undefined;
  resolvedRef: string;
  sourceKey: string;
  compareLockedIntegrity?: boolean;
  frozen: boolean;
  logger: Logger;
}): Promise<LockedRule> {
  const {
    rule,
    curatedDir,
    locked,
    resolvedRef,
    sourceKey,
    compareLockedIntegrity = true,
    frozen,
    logger,
  } = params;
  const relativePath = `${rule.name}.md`;
  checkPathTraversal({ relativePath, intendedRootDir: curatedDir });
  const integrity = computeRuleIntegrity(rule.content);
  const lockedRuleEntry = locked?.rules?.[rule.name];
  if (
    compareLockedIntegrity &&
    lockedRuleEntry?.integrity &&
    lockedRuleEntry.integrity !== integrity &&
    resolvedRef === locked?.resolvedRef
  ) {
    reportIntegrityMismatch({
      message: `Integrity mismatch for rule "${rule.name}" from ${sourceKey}: expected "${lockedRuleEntry.integrity}", got "${integrity}". Content may have been tampered with.`,
      frozen,
      logger,
    });
  }
  await writeFileContent(join(curatedDir, relativePath), rule.content);
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
      message: `Integrity mismatch for skill "${skillName}" from ${sourceKey}: expected "${lockedSkillEntry.integrity}", got "${integrity}". Content may have been tampered with.`,
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
  });

  logger.info(
    `Fetched ${fetchedNames.length} skill(s) from ${sourceKey}: ${fetchedNames.join(", ") || "(none)"}`,
  );

  return { updatedLock, fetchedNames };
}

export function buildRuleLockUpdate(params: {
  lock: SourcesLock;
  lockKey: string;
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
    lockKey,
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
  const updatedLock = setLockedSource(lock, lockKey, {
    requestedRef,
    resolvedRef,
    resolvedAt: new Date().toISOString(),
    skills: locked?.skills ?? {},
    skillSelection: locked?.skillSelection,
    skillsPath: locked?.skillsPath,
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
 * Pick the remote rule files a source entry declares: Markdown files whose
 * normalized name is selected by `sourceEntry.rules` (or the wildcard) and is
 * a valid rule name. Candidate order is preserved.
 */
export function selectDeclaredRules<T>(params: {
  sourceEntry: SourceEntry;
  candidates: readonly T[];
  getFileName: (candidate: T) => string;
}): Array<{ candidate: T; name: string }> {
  const { sourceEntry, candidates, getFileName } = params;
  const ruleFilter = (sourceEntry.rules ?? []).map(normalizeRuleFilterName);
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
 * The path the rules of a source are read from, as declared: the source's
 * `rulesPath`, else `rules`. The rules counterpart of
 * {@link resolveSkillsSourcePath}.
 */
export function resolveRulesSourcePath(sourceEntry: SourceEntry): string {
  return sourceEntry.rulesPath ?? "rules";
}

/** The rules path of a source in the form the lockfile records and compares. */
export function resolveRulesPath(sourceEntry: SourceEntry): string {
  return normalizeSourceDirPath(resolveRulesSourcePath(sourceEntry));
}

/**
 * The form a source directory path is recorded in the lockfile and compared
 * in: posix separators, normalized, with no trailing slash.
 */
function normalizeSourceDirPath(dirPath: string): string {
  return normalizePosixDirPath(dirPath);
}

export function lockedRuleConfigMatches(params: {
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
    resolveRulesPath(params.sourceEntry) === params.locked.rulesPath
  );
}

export function assertMatchingRulesFound(params: { ruleNames: string[]; source: string }): void {
  if (params.ruleNames.length === 0) {
    throw new Error(`No matching rules found in ${params.source}.`);
  }
}
