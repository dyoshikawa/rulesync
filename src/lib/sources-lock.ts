import { createHash } from "node:crypto";
import { join } from "node:path";

import { optional, z } from "zod/mini";

import { RULESYNC_SOURCES_LOCK_RELATIVE_FILE_PATH } from "../constants/rulesync-paths.js";
import { fileExists, readFileContent, writeFileContent } from "../utils/file.js";
import { logger } from "../utils/logger.js";

/** Current lockfile format version. Bump when the schema changes. */
export const LOCKFILE_VERSION = 1;

/**
 * Schema for a single locked skill entry with content integrity.
 */
export const LockedSkillSchema = z.object({
  integrity: z.string(),
});
export type LockedSkill = z.infer<typeof LockedSkillSchema>;

/**
 * Schema for a single locked source entry.
 */
export const LockedSourceSchema = z.object({
  requestedRef: optional(z.string()),
  resolvedRef: z.string(),
  resolvedAt: optional(z.string()),
  skills: z.record(z.string(), LockedSkillSchema),
});
export type LockedSource = z.infer<typeof LockedSourceSchema>;

/**
 * Schema for the full lockfile (current version).
 */
export const SourcesLockSchema = z.object({
  lockfileVersion: z.number(),
  sources: z.record(z.string(), LockedSourceSchema),
});
export type SourcesLock = z.infer<typeof SourcesLockSchema>;

/**
 * Schema for the legacy v0 lockfile format (skills as string array, no version field).
 */
const LegacyLockedSourceSchema = z.object({
  resolvedRef: z.string(),
  skills: z.array(z.string()),
});

const LegacySourcesLockSchema = z.object({
  sources: z.record(z.string(), LegacyLockedSourceSchema),
});

/**
 * Migrate a legacy lockfile (string[] skills, no version) to the current format.
 * Skills get empty integrity since we can't compute it retroactively.
 */
function migrateLegacyLock(legacy: z.infer<typeof LegacySourcesLockSchema>): SourcesLock {
  const sources: Record<string, LockedSource> = {};
  for (const [key, entry] of Object.entries(legacy.sources)) {
    const skills: Record<string, LockedSkill> = {};
    for (const name of entry.skills) {
      skills[name] = { integrity: "" };
    }
    sources[key] = {
      resolvedRef: entry.resolvedRef,
      skills,
    };
  }
  logger.info(
    "Migrated legacy sources lockfile to version 1. Run 'rulesync install --update' to populate integrity hashes.",
  );
  return { lockfileVersion: LOCKFILE_VERSION, sources };
}

/**
 * Create an empty lockfile structure.
 */
export function createEmptyLock(): SourcesLock {
  return { lockfileVersion: LOCKFILE_VERSION, sources: {} };
}

/**
 * Read the lockfile from disk.
 * @returns The parsed lockfile, or an empty lockfile if it doesn't exist or is invalid.
 */
export async function readLockFile(params: { baseDir: string }): Promise<SourcesLock> {
  const lockPath = join(params.baseDir, RULESYNC_SOURCES_LOCK_RELATIVE_FILE_PATH);

  if (!(await fileExists(lockPath))) {
    logger.debug("No sources lockfile found, starting fresh.");
    return createEmptyLock();
  }

  try {
    const content = await readFileContent(lockPath);
    const data = JSON.parse(content);

    // Try current schema first
    const result = SourcesLockSchema.safeParse(data);
    if (result.success) {
      return result.data;
    }

    // Try legacy schema (no lockfileVersion, skills as string[])
    const legacyResult = LegacySourcesLockSchema.safeParse(data);
    if (legacyResult.success) {
      return migrateLegacyLock(legacyResult.data);
    }

    logger.warn(
      `Invalid sources lockfile format (${RULESYNC_SOURCES_LOCK_RELATIVE_FILE_PATH}). Starting fresh.`,
    );
    return createEmptyLock();
  } catch {
    logger.warn(
      `Failed to read sources lockfile (${RULESYNC_SOURCES_LOCK_RELATIVE_FILE_PATH}). Starting fresh.`,
    );
    return createEmptyLock();
  }
}

/**
 * Write the lockfile to disk.
 */
export async function writeLockFile(params: { baseDir: string; lock: SourcesLock }): Promise<void> {
  const lockPath = join(params.baseDir, RULESYNC_SOURCES_LOCK_RELATIVE_FILE_PATH);
  const content = JSON.stringify(params.lock, null, 2) + "\n";
  await writeFileContent(lockPath, content);
  logger.debug(`Wrote sources lockfile to ${lockPath}`);
}

/**
 * Compute a SHA-256 integrity hash for a skill's contents.
 * Takes a sorted list of [relativePath, content] pairs to produce a deterministic hash.
 */
export function computeSkillIntegrity(files: Array<{ path: string; content: string }>): string {
  const hash = createHash("sha256");
  // Sort by path for deterministic ordering
  const sorted = files.toSorted((a, b) => a.path.localeCompare(b.path));
  for (const file of sorted) {
    hash.update(file.path);
    hash.update("\0");
    hash.update(file.content);
    hash.update("\0");
  }
  return `sha256-${hash.digest("hex")}`;
}

/**
 * Normalize a source key for consistent lockfile lookups.
 * Strips URL prefixes, provider prefixes, trailing slashes, .git suffix, and lowercases.
 */
export function normalizeSourceKey(source: string): string {
  let key = source;

  // Strip common URL prefixes
  for (const prefix of [
    "https://www.github.com/",
    "https://github.com/",
    "http://www.github.com/",
    "http://github.com/",
  ]) {
    if (key.toLowerCase().startsWith(prefix)) {
      key = key.substring(prefix.length);
      break;
    }
  }

  // Strip provider prefix
  if (key.startsWith("github:")) {
    key = key.substring("github:".length);
  }

  // Remove trailing slashes
  key = key.replace(/\/+$/, "");

  // Remove .git suffix from repo
  key = key.replace(/\.git$/, "");

  // Lowercase for case-insensitive matching
  key = key.toLowerCase();

  return key;
}

/**
 * Get the locked entry for a source key, if it exists.
 */
export function getLockedSource(lock: SourcesLock, sourceKey: string): LockedSource | undefined {
  const normalized = normalizeSourceKey(sourceKey);
  // Look up by normalized key
  for (const [key, value] of Object.entries(lock.sources)) {
    if (normalizeSourceKey(key) === normalized) {
      return value;
    }
  }
  return undefined;
}

/**
 * Set (or update) a locked entry for a source key.
 */
export function setLockedSource(
  lock: SourcesLock,
  sourceKey: string,
  entry: LockedSource,
): SourcesLock {
  const normalized = normalizeSourceKey(sourceKey);
  // Remove any existing entries with the same normalized key
  const filteredSources: Record<string, LockedSource> = {};
  for (const [key, value] of Object.entries(lock.sources)) {
    if (normalizeSourceKey(key) !== normalized) {
      filteredSources[key] = value;
    }
  }
  return {
    lockfileVersion: lock.lockfileVersion,
    sources: {
      ...filteredSources,
      [normalized]: entry,
    },
  };
}

/**
 * Get the skill names from a locked source entry.
 */
export function getLockedSkillNames(entry: LockedSource): string[] {
  return Object.keys(entry.skills);
}
