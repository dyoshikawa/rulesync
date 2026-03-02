import { join, resolve, sep } from "node:path";

import { Semaphore } from "es-toolkit/promise";

import type { SourceEntry } from "../config/config.js";
import {
  FETCH_CONCURRENCY_LIMIT,
  MAX_FILE_SIZE,
  RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH,
} from "../constants/rulesync-paths.js";
import { getLocalSkillDirNames } from "../features/skills/skills-utils.js";
import { formatError } from "../utils/error.js";
import {
  checkPathTraversal,
  directoryExists,
  removeDirectory,
  writeFileContent,
} from "../utils/file.js";
import { logger } from "../utils/logger.js";
import { fetchSkillFiles, resolveDefaultRef, resolveRefToSha } from "./git-client.js";
import { GitHubClient, GitHubClientError, logGitHubAuthHints } from "./github-client.js";
import { listDirectoryRecursive, withSemaphore } from "./github-utils.js";
import { parseSource } from "./source-parser.js";
import {
  type LockedSkill,
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

/**
 * Resolve declared sources, fetch remote skills into .rulesync/skills/.curated/,
 * and update the lockfile.
 */
export async function resolveAndFetchSources(params: {
  sources: SourceEntry[];
  baseDir: string;
  options?: ResolveAndFetchSourcesOptions;
}): Promise<ResolveAndFetchSourcesResult> {
  const { sources, baseDir, options = {} } = params;

  if (sources.length === 0) {
    return { fetchedSkillCount: 0, sourcesProcessed: 0 };
  }

  if (options.skipSources) {
    logger.info("Skipping source fetching.");
    return { fetchedSkillCount: 0, sourcesProcessed: 0 };
  }

  // Read existing lockfile
  let lock: SourcesLock = options.updateSources
    ? createEmptyLock()
    : await readLockFile({ baseDir });

  // Frozen mode: validate lockfile covers all declared sources.
  // Missing curated skills are fetched using locked refs.
  if (options.frozen) {
    const missingKeys: string[] = [];

    for (const source of sources) {
      const locked = getLockedSource(lock, source.source);
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

  const originalLockJson = JSON.stringify(lock);

  // Resolve GitHub token
  const token = GitHubClient.resolveToken(options.token);
  const client = new GitHubClient({ token });

  // Determine local skills (in .rulesync/skills/ but not in .curated/)
  const localSkillNames = await getLocalSkillDirNames(baseDir);

  let totalSkillCount = 0;
  const allFetchedSkillNames = new Set<string>();

  for (const sourceEntry of sources) {
    try {
      const transport = sourceEntry.transport ?? "github";
      let result: { skillCount: number; fetchedSkillNames: string[]; updatedLock: SourcesLock };
      if (transport === "git") {
        result = await fetchSourceViaGit({
          sourceEntry,
          baseDir,
          lock,
          localSkillNames,
          alreadyFetchedSkillNames: allFetchedSkillNames,
          updateSources: options.updateSources ?? false,
        });
      } else {
        result = await fetchSource({
          sourceEntry,
          client,
          baseDir,
          lock,
          localSkillNames,
          alreadyFetchedSkillNames: allFetchedSkillNames,
          updateSources: options.updateSources ?? false,
        });
      }
      const { skillCount, fetchedSkillNames, updatedLock } = result;

      lock = updatedLock;
      totalSkillCount += skillCount;
      for (const name of fetchedSkillNames) {
        allFetchedSkillNames.add(name);
      }
    } catch (error) {
      if (error instanceof GitHubClientError) {
        logGitHubAuthHints(error);
      }
      logger.error(`Failed to fetch source "${sourceEntry.source}": ${formatError(error)}`);
    }
  }

  // Prune stale lockfile entries whose keys are not in the current sources (immutable)
  const sourceKeys = new Set(sources.map((s) => normalizeSourceKey(s.source)));
  const prunedSources: typeof lock.sources = {};
  for (const [key, value] of Object.entries(lock.sources)) {
    if (sourceKeys.has(normalizeSourceKey(key))) {
      prunedSources[key] = value;
    } else {
      logger.debug(`Pruned stale lockfile entry: ${key}`);
    }
  }
  lock = { lockfileVersion: lock.lockfileVersion, sources: prunedSources };

  // Only write lockfile if it has changed (and not in frozen mode)
  if (!options.frozen && JSON.stringify(lock) !== originalLockJson) {
    await writeLockFile({ baseDir, lock });
  } else {
    logger.debug("Lockfile unchanged, skipping write.");
  }

  return { fetchedSkillCount: totalSkillCount, sourcesProcessed: sources.length };
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

/**
 * Fetch skills from a single source entry.
 */
async function fetchSource(params: {
  sourceEntry: SourceEntry;
  client: GitHubClient;
  baseDir: string;
  lock: SourcesLock;
  localSkillNames: Set<string>;
  alreadyFetchedSkillNames: Set<string>;
  updateSources: boolean;
}): Promise<{
  skillCount: number;
  fetchedSkillNames: string[];
  updatedLock: SourcesLock;
}> {
  const { sourceEntry, client, baseDir, localSkillNames, alreadyFetchedSkillNames, updateSources } =
    params;
  let { lock } = params;

  const parsed = parseSource(sourceEntry.source);

  if (parsed.provider === "gitlab") {
    logger.warn(`GitLab sources are not yet supported. Skipping "${sourceEntry.source}".`);
    return { skillCount: 0, fetchedSkillNames: [], updatedLock: lock };
  }

  const sourceKey = sourceEntry.source;
  const locked = getLockedSource(lock, sourceKey);
  const lockedSkillNames = locked ? getLockedSkillNames(locked) : [];

  // Resolve the ref to a commit SHA
  let ref: string;
  let resolvedSha: string;
  let requestedRef: string | undefined;

  if (locked && !updateSources) {
    // Use the locked SHA for deterministic fetching
    ref = locked.resolvedRef;
    resolvedSha = locked.resolvedRef;
    requestedRef = locked.requestedRef;
    logger.debug(`Using locked ref for ${sourceKey}: ${resolvedSha}`);
  } else {
    // Resolve the ref (or default branch) to a SHA
    requestedRef = parsed.ref ?? (await client.getDefaultBranch(parsed.owner, parsed.repo));
    resolvedSha = await client.resolveRefToSha(parsed.owner, parsed.repo, requestedRef);
    ref = resolvedSha;
    logger.debug(`Resolved ${sourceKey} ref "${requestedRef}" to SHA: ${resolvedSha}`);
  }

  const curatedDir = join(baseDir, RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH);

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

  // List the skills/ directory in the remote repo.
  // If a path is given in the source URL, it points directly to the skills directory.
  // Otherwise, look for "skills/" at the repo root.
  const skillsBasePath = parsed.path ?? "skills";
  let remoteSkillDirs: Array<{ name: string; path: string }>;

  try {
    const entries = await client.listDirectory(parsed.owner, parsed.repo, skillsBasePath, ref);
    remoteSkillDirs = entries
      .filter((e) => e.type === "dir")
      .map((e) => ({ name: e.name, path: e.path }));
  } catch (error) {
    if (error instanceof GitHubClientError && error.statusCode === 404) {
      logger.warn(`No skills/ directory found in ${sourceKey}. Skipping.`);
      return { skillCount: 0, fetchedSkillNames: [], updatedLock: lock };
    }
    throw error;
  }

  // Filter skills by name
  const filteredDirs = isWildcard
    ? remoteSkillDirs
    : remoteSkillDirs.filter((d) => skillFilter.includes(d.name));

  const semaphore = new Semaphore(FETCH_CONCURRENCY_LIMIT);
  const fetchedSkills: Record<string, LockedSkill> = {};

  // Clean previously curated skills for this source before re-fetching
  if (locked) {
    const resolvedCuratedDir = resolve(curatedDir);
    for (const prevSkill of lockedSkillNames) {
      const prevDir = join(curatedDir, prevSkill);
      // Verify the resolved path is within the curated directory to prevent traversal
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

  for (const skillDir of filteredDirs) {
    // Validate skill directory name to prevent path traversal
    if (
      skillDir.name.includes("..") ||
      skillDir.name.includes("/") ||
      skillDir.name.includes("\\")
    ) {
      logger.warn(
        `Skipping skill with invalid name "${skillDir.name}" from ${sourceKey}: contains path traversal characters.`,
      );
      continue;
    }

    // Skip skills that exist locally (local takes precedence)
    if (localSkillNames.has(skillDir.name)) {
      logger.debug(
        `Skipping remote skill "${skillDir.name}" from ${sourceKey}: local skill takes precedence.`,
      );
      continue;
    }

    // Skip skills already fetched from an earlier source (first-declared wins)
    if (alreadyFetchedSkillNames.has(skillDir.name)) {
      logger.warn(
        `Skipping duplicate skill "${skillDir.name}" from ${sourceKey}: already fetched from another source.`,
      );
      continue;
    }

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

    // Fetch all file contents and compute integrity hash
    const skillFiles: Array<{ path: string; content: string }> = [];

    for (const file of files) {
      // Calculate relative path within the skill directory
      const relativeToSkill = file.path.substring(skillDir.path.length + 1);
      const localFilePath = join(curatedDir, skillDir.name, relativeToSkill);

      // Validate path to prevent traversal attacks
      checkPathTraversal({
        relativePath: relativeToSkill,
        intendedRootDir: join(curatedDir, skillDir.name),
      });

      const content = await withSemaphore(semaphore, () =>
        client.getFileContent(parsed.owner, parsed.repo, file.path, ref),
      );
      await writeFileContent(localFilePath, content);
      skillFiles.push({ path: relativeToSkill, content });
    }

    const integrity = computeSkillIntegrity(skillFiles);

    // Verify integrity against lockfile hash when available
    const lockedSkillEntry = locked?.skills[skillDir.name];
    if (
      lockedSkillEntry &&
      lockedSkillEntry.integrity &&
      lockedSkillEntry.integrity !== integrity &&
      resolvedSha === locked?.resolvedRef
    ) {
      logger.warn(
        `Integrity mismatch for skill "${skillDir.name}" from ${sourceKey}: expected "${lockedSkillEntry.integrity}", got "${integrity}". Content may have been tampered with.`,
      );
    }

    fetchedSkills[skillDir.name] = { integrity };
    logger.debug(`Fetched skill "${skillDir.name}" from ${sourceKey}`);
  }

  const fetchedNames = Object.keys(fetchedSkills);

  // Merge newly fetched skills with existing locked skills that were skipped
  // (due to local precedence, already-fetched, etc.) to prevent overwriting their entries
  const mergedSkills: Record<string, LockedSkill> = { ...fetchedSkills };
  if (locked) {
    for (const [skillName, skillEntry] of Object.entries(locked.skills)) {
      if (!(skillName in mergedSkills)) {
        mergedSkills[skillName] = skillEntry;
      }
    }
  }

  // Update lockfile entry
  lock = setLockedSource(lock, sourceKey, {
    requestedRef,
    resolvedRef: resolvedSha,
    resolvedAt: new Date().toISOString(),
    skills: mergedSkills,
  });

  logger.info(
    `Fetched ${fetchedNames.length} skill(s) from ${sourceKey}: ${fetchedNames.join(", ") || "(none)"}`,
  );

  return {
    skillCount: fetchedNames.length,
    fetchedSkillNames: fetchedNames,
    updatedLock: lock,
  };
}

/**
 * Fetch skills from a single source using git CLI (works with any git remote).
 */
async function fetchSourceViaGit(params: {
  sourceEntry: SourceEntry;
  baseDir: string;
  lock: SourcesLock;
  localSkillNames: Set<string>;
  alreadyFetchedSkillNames: Set<string>;
  updateSources: boolean;
}): Promise<{ skillCount: number; fetchedSkillNames: string[]; updatedLock: SourcesLock }> {
  const { sourceEntry, baseDir, localSkillNames, alreadyFetchedSkillNames, updateSources } = params;
  let { lock } = params;
  const url = sourceEntry.source;
  const locked = getLockedSource(lock, url);
  const lockedSkillNames = locked ? getLockedSkillNames(locked) : [];

  let resolvedSha: string;
  let requestedRef: string | undefined;
  if (locked && !updateSources) {
    resolvedSha = locked.resolvedRef;
    requestedRef = locked.requestedRef;
  } else if (sourceEntry.ref) {
    requestedRef = sourceEntry.ref;
    resolvedSha = await resolveRefToSha(url, requestedRef);
  } else {
    const def = await resolveDefaultRef(url);
    requestedRef = def.ref;
    resolvedSha = def.sha;
  }

  const curatedDir = join(baseDir, RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH);
  if (locked && resolvedSha === locked.resolvedRef && !updateSources) {
    if (await checkLockedSkillsExist(curatedDir, lockedSkillNames)) {
      return { skillCount: 0, fetchedSkillNames: lockedSkillNames, updatedLock: lock };
    }
  }

  // Resolve requestedRef lazily (deferred from locked path to avoid unnecessary network calls)
  if (!requestedRef) {
    requestedRef = (await resolveDefaultRef(url)).ref;
  }

  const skillFilter = sourceEntry.skills ?? ["*"];
  const isWildcard = skillFilter.length === 1 && skillFilter[0] === "*";
  const remoteFiles = await fetchSkillFiles({
    url,
    ref: requestedRef,
    skillsPath: sourceEntry.path ?? "skills",
  });

  // Group files by skill directory (first path component)
  const skillFileMap = new Map<string, Array<{ relativePath: string; content: string }>>();
  for (const file of remoteFiles) {
    const idx = file.relativePath.indexOf("/");
    if (idx === -1) continue;
    const name = file.relativePath.substring(0, idx);
    const inner = file.relativePath.substring(idx + 1);
    const arr = skillFileMap.get(name) ?? [];
    arr.push({ relativePath: inner, content: file.content });
    skillFileMap.set(name, arr);
  }

  const allNames = [...skillFileMap.keys()];
  const filteredNames = isWildcard ? allNames : allNames.filter((n) => skillFilter.includes(n));

  if (locked) {
    const base = resolve(curatedDir);
    for (const prev of lockedSkillNames) {
      const dir = join(curatedDir, prev);
      if (resolve(dir).startsWith(base + sep) && (await directoryExists(dir))) {
        await removeDirectory(dir);
      }
    }
  }

  const fetchedSkills: Record<string, LockedSkill> = {};
  for (const skillName of filteredNames) {
    if (skillName.includes("..") || skillName.includes("/") || skillName.includes("\\")) continue;
    if (localSkillNames.has(skillName) || alreadyFetchedSkillNames.has(skillName)) continue;

    const files = skillFileMap.get(skillName) ?? [];
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
      logger.warn(`Integrity mismatch for skill "${skillName}" from ${url}.`);
    }
    fetchedSkills[skillName] = { integrity };
  }

  const fetchedNames = Object.keys(fetchedSkills);
  const mergedSkills: Record<string, LockedSkill> = { ...fetchedSkills };
  if (locked) {
    for (const [k, v] of Object.entries(locked.skills)) {
      if (!(k in mergedSkills)) mergedSkills[k] = v;
    }
  }

  lock = setLockedSource(lock, url, {
    requestedRef,
    resolvedRef: resolvedSha,
    resolvedAt: new Date().toISOString(),
    skills: mergedSkills,
  });

  logger.info(
    `Fetched ${fetchedNames.length} skill(s) from ${url}: ${fetchedNames.join(", ") || "(none)"}`,
  );
  return { skillCount: fetchedNames.length, fetchedSkillNames: fetchedNames, updatedLock: lock };
}
