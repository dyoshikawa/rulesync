import { Semaphore } from "es-toolkit/promise";
import { basename, join } from "node:path";

import type { SourceEntry } from "../config/config.js";

import {
  RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH,
  RULESYNC_SKILLS_RELATIVE_DIR_PATH,
} from "../constants/rulesync-paths.js";
import { directoryExists, findFilesByGlobs, removeDirectory, writeFileContent } from "../utils/file.js";
import { logger } from "../utils/logger.js";
import { parseSource } from "./fetch.js";
import { GitHubClient, GitHubClientError, logGitHubAuthHints } from "./github-client.js";
import {
  type SourcesLock,
  createEmptyLock,
  getLockedSource,
  readLockFile,
  setLockedSource,
  writeLockFile,
} from "./sources-lock.js";

const FETCH_CONCURRENCY_LIMIT = 10;
const MAX_RECURSION_DEPTH = 15;

export type ResolveAndFetchSourcesOptions = {
  /** Force re-resolve all refs, ignoring the lockfile. */
  updateSources?: boolean;
  /** Skip fetching entirely (use what's already on disk). */
  skipSources?: boolean;
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
    logger.info("Skipping source fetching (--skip-sources).");
    return { fetchedSkillCount: 0, sourcesProcessed: 0 };
  }

  // Read existing lockfile
  let lock: SourcesLock = options.updateSources
    ? createEmptyLock()
    : await readLockFile({ baseDir });

  // Resolve GitHub token
  const token = GitHubClient.resolveToken(options.token);
  const client = new GitHubClient({ token });

  // Determine local skills (in .rulesync/skills/ but not in .curated/)
  const localSkillNames = await getLocalSkillNames(baseDir);

  // Clean the curated directory before fetching
  const curatedDirPath = join(baseDir, RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH);
  if (await directoryExists(curatedDirPath)) {
    await removeDirectory(curatedDirPath);
  }

  let totalSkillCount = 0;
  const allFetchedSkillNames = new Set<string>();

  for (const sourceEntry of sources) {
    try {
      const { skillCount, fetchedSkillNames, updatedLock } = await fetchSource({
        sourceEntry,
        client,
        baseDir,
        lock,
        localSkillNames,
        alreadyFetchedSkillNames: allFetchedSkillNames,
        updateSources: options.updateSources ?? false,
      });

      lock = updatedLock;
      totalSkillCount += skillCount;
      for (const name of fetchedSkillNames) {
        allFetchedSkillNames.add(name);
      }
    } catch (error) {
      if (error instanceof GitHubClientError) {
        logGitHubAuthHints(error);
      } else {
        logger.error(`Failed to fetch source "${sourceEntry.source}": ${String(error)}`);
      }
    }
  }

  // Write updated lockfile
  await writeLockFile({ baseDir, lock });

  return { fetchedSkillCount: totalSkillCount, sourcesProcessed: sources.length };
}

/**
 * Get the names of locally defined skills (not in .curated/).
 */
async function getLocalSkillNames(baseDir: string): Promise<Set<string>> {
  const skillsDir = join(baseDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH);
  const names = new Set<string>();

  if (!(await directoryExists(skillsDir))) {
    return names;
  }

  const dirPaths = await findFilesByGlobs(join(skillsDir, "*"), { type: "dir" });
  for (const dirPath of dirPaths) {
    const name = basename(dirPath);
    // Skip the .curated directory itself
    if (name === ".curated") continue;
    names.add(name);
  }

  return names;
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
  const {
    sourceEntry,
    client,
    baseDir,
    localSkillNames,
    alreadyFetchedSkillNames,
    updateSources,
  } = params;
  let { lock } = params;

  const parsed = parseSource(sourceEntry.source);

  if (parsed.provider === "gitlab") {
    throw new Error("GitLab sources are not yet supported.");
  }

  const sourceKey = sourceEntry.source;
  const locked = getLockedSource(lock, sourceKey);

  // Resolve the ref to a commit SHA
  let ref: string;
  let resolvedSha: string;

  if (locked && !updateSources) {
    // Use the locked SHA for deterministic fetching
    ref = locked.resolvedRef;
    resolvedSha = locked.resolvedRef;
    logger.debug(`Using locked ref for ${sourceKey}: ${resolvedSha}`);
  } else {
    // Resolve the ref (or default branch) to a SHA
    const requestedRef =
      parsed.ref ?? (await client.getDefaultBranch(parsed.owner, parsed.repo));
    resolvedSha = await client.resolveRefToSha(parsed.owner, parsed.repo, requestedRef);
    ref = resolvedSha;
    logger.debug(`Resolved ${sourceKey} ref "${requestedRef}" to SHA: ${resolvedSha}`);
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
  const fetchedNames: string[] = [];
  const curatedDir = join(baseDir, RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH);

  for (const skillDir of filteredDirs) {
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
    const files = await listRemoteDirectoryRecursive({
      client,
      owner: parsed.owner,
      repo: parsed.repo,
      path: skillDir.path,
      ref,
      semaphore,
    });

    for (const file of files) {
      // Calculate relative path within the skill directory
      const relativeToSkill = file.path.substring(skillDir.path.length + 1);
      const localFilePath = join(curatedDir, skillDir.name, relativeToSkill);

      await semaphore.acquire();
      try {
        const content = await client.getFileContent(
          parsed.owner,
          parsed.repo,
          file.path,
          ref,
        );
        await writeFileContent(localFilePath, content);
      } finally {
        semaphore.release();
      }
    }

    fetchedNames.push(skillDir.name);
    logger.debug(`Fetched skill "${skillDir.name}" from ${sourceKey}`);
  }

  // Update lockfile entry
  lock = setLockedSource(lock, sourceKey, {
    resolvedRef: resolvedSha,
    skills: fetchedNames,
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
 * Recursively list all files in a remote directory.
 */
async function listRemoteDirectoryRecursive(params: {
  client: GitHubClient;
  owner: string;
  repo: string;
  path: string;
  ref: string;
  semaphore: Semaphore;
  depth?: number;
}): Promise<Array<{ path: string; size: number }>> {
  const { client, owner, repo, path, ref, semaphore, depth = 0 } = params;

  if (depth > MAX_RECURSION_DEPTH) {
    throw new Error(
      `Maximum recursion depth (${MAX_RECURSION_DEPTH}) exceeded while listing: ${path}`,
    );
  }

  await semaphore.acquire();
  let entries;
  try {
    entries = await client.listDirectory(owner, repo, path, ref);
  } finally {
    semaphore.release();
  }

  const files: Array<{ path: string; size: number }> = [];
  const subdirs: Array<{ path: string }> = [];

  for (const entry of entries) {
    if (entry.type === "file") {
      files.push({ path: entry.path, size: entry.size });
    } else if (entry.type === "dir") {
      subdirs.push({ path: entry.path });
    }
  }

  const subResults = await Promise.all(
    subdirs.map((dir) =>
      listRemoteDirectoryRecursive({
        client,
        owner,
        repo,
        path: dir.path,
        ref,
        semaphore,
        depth: depth + 1,
      }),
    ),
  );

  return [...files, ...subResults.flat()];
}
