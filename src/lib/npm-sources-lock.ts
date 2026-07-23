import { join } from "node:path";

import { optional, z } from "zod/mini";

import { RULESYNC_NPM_SOURCES_LOCK_RELATIVE_FILE_PATH } from "../constants/rulesync-paths.js";
import { fileExists, readFileContent, writeFileContent } from "../utils/file.js";
import type { Logger } from "../utils/logger.js";

/**
 * Lockfile for npm-transport sources (EXPERIMENTAL), written to
 * `rulesync-npm.lock.json` at the project root. Kept separate from the main
 * `rulesync.lock` because that lockfile pins git commit SHAs, while npm
 * sources pin a resolved package version plus the registry tarball integrity.
 * Mirrors the conventions of the gh (`rulesync-gh.lock.yaml`) and apm
 * (`rulesync-apm.lock.yaml`) lockfiles, which are also mode/transport-specific.
 */

/** Current npm lockfile format version. Bump when the schema changes. */
export const NPM_LOCKFILE_VERSION = 1;

const NpmLockedSkillSchema = z.object({
  integrity: z.string(),
});

/**
 * Schema for a single locked npm source entry.
 */
const NpmLockedSourceSchema = z.object({
  registry: optional(z.string()),
  requestedVersion: optional(z.string()),
  resolvedVersion: z.string(),
  /** SRI integrity of the package tarball as reported by the registry. */
  integrity: optional(z.string()),
  resolvedAt: optional(z.string()),
  skills: z.record(z.string(), NpmLockedSkillSchema),
  rules: optional(z.record(z.string(), NpmLockedSkillSchema)),
});
export type NpmLockedSource = z.infer<typeof NpmLockedSourceSchema>;

const NpmSourcesLockSchema = z.object({
  lockfileVersion: z.number(),
  sources: z.record(z.string(), NpmLockedSourceSchema),
});
export type NpmSourcesLock = z.infer<typeof NpmSourcesLockSchema>;

/**
 * Create an empty npm lockfile structure.
 */
export function createEmptyNpmLock(): NpmSourcesLock {
  return { lockfileVersion: NPM_LOCKFILE_VERSION, sources: {} };
}

/**
 * Read the npm lockfile from disk.
 * @returns The parsed lockfile, or an empty lockfile if it doesn't exist or is invalid.
 */
export async function readNpmLockFile(params: {
  projectRoot: string;
  logger: Logger;
}): Promise<NpmSourcesLock> {
  const { logger } = params;
  const lockPath = join(params.projectRoot, RULESYNC_NPM_SOURCES_LOCK_RELATIVE_FILE_PATH);

  if (!(await fileExists(lockPath))) {
    logger.debug("No npm sources lockfile found, starting fresh.");
    return createEmptyNpmLock();
  }

  try {
    const content = await readFileContent(lockPath);
    const result = NpmSourcesLockSchema.safeParse(JSON.parse(content));
    if (result.success) {
      return result.data;
    }
    logger.warn(
      `Invalid npm sources lockfile format (${RULESYNC_NPM_SOURCES_LOCK_RELATIVE_FILE_PATH}). Starting fresh.`,
    );
    return createEmptyNpmLock();
  } catch {
    logger.warn(
      `Failed to read npm sources lockfile (${RULESYNC_NPM_SOURCES_LOCK_RELATIVE_FILE_PATH}). Starting fresh.`,
    );
    return createEmptyNpmLock();
  }
}

/**
 * Write the npm lockfile to disk.
 */
export async function writeNpmLockFile(params: {
  projectRoot: string;
  lock: NpmSourcesLock;
  logger: Logger;
}): Promise<void> {
  const { logger } = params;
  const lockPath = join(params.projectRoot, RULESYNC_NPM_SOURCES_LOCK_RELATIVE_FILE_PATH);
  const content = JSON.stringify(params.lock, null, 2) + "\n";
  await writeFileContent(lockPath, content);
  logger.debug(`Wrote npm sources lockfile to ${lockPath}`);
}

/**
 * Normalize an npm source key (package name) for lockfile lookups.
 */
export function normalizeNpmSourceKey(source: string): string {
  return source.trim();
}

/**
 * Get the locked entry for an npm source key, if it exists.
 */
export function getNpmLockedSource(
  lock: NpmSourcesLock,
  sourceKey: string,
): NpmLockedSource | undefined {
  const normalized = normalizeNpmSourceKey(sourceKey);
  return Object.prototype.hasOwnProperty.call(lock.sources, normalized)
    ? lock.sources[normalized]
    : undefined;
}

/**
 * Set (or update) a locked entry for an npm source key (immutable).
 */
export function setNpmLockedSource(
  lock: NpmSourcesLock,
  sourceKey: string,
  entry: NpmLockedSource,
): NpmSourcesLock {
  return {
    lockfileVersion: lock.lockfileVersion,
    sources: {
      ...lock.sources,
      [normalizeNpmSourceKey(sourceKey)]: entry,
    },
  };
}

/**
 * Get the skill names from a locked npm source entry.
 */
export function getNpmLockedSkillNames(entry: NpmLockedSource): string[] {
  return Object.keys(entry.skills);
}

/** Get the rule names from a locked npm source entry. */
export function getNpmLockedRuleNames(entry: NpmLockedSource): string[] {
  return Object.keys(entry.rules ?? {});
}
