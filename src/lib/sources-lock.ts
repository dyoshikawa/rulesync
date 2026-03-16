import { createHash } from "node:crypto";
import { join } from "node:path";

import { optional, refine, z } from "zod/mini";

import { RULESYNC_SOURCES_LOCK_RELATIVE_FILE_PATH } from "../constants/rulesync-paths.js";
import { fileExists, readFileContent, writeFileContent } from "../utils/file.js";
import { logger } from "../utils/logger.js";

/** Current lockfile format version. Bump when the schema changes. */
export const LOCKFILE_VERSION = 2;

/**
 * Schema for a single locked file entry with content integrity.
 */
export const LockedFileSchema = z.object({
  integrity: z.string(),
});
export type LockedFile = z.infer<typeof LockedFileSchema>;

/**
 * Schema for a single locked source entry (v2: per-file integrity).
 * Keys in `files` are relative paths within the source cache
 * (e.g. "skills/my-skill/SKILL.md", "rules/coding.md", "mcp.json").
 */
export const LockedSourceSchema = z.object({
  requestedRef: optional(z.string()),
  resolvedRef: z
    .string()
    .check(refine((v) => /^[0-9a-f]{40}$/.test(v), "resolvedRef must be a 40-character hex SHA")),
  resolvedAt: optional(z.string()),
  files: z.record(z.string(), LockedFileSchema),
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

// ---------------------------------------------------------------------------
// Legacy schemas for migration
// ---------------------------------------------------------------------------

/** v0 lockfile: skills as string array, no version field. */
const V0LockedSourceSchema = z.object({
  resolvedRef: z.string(),
  skills: z.array(z.string()),
});
const V0SourcesLockSchema = z.object({
  sources: z.record(z.string(), V0LockedSourceSchema),
});

/** v1 lockfile: skills as Record<string, { integrity }>, lockfileVersion present. */
const V1LockedSourceSchema = z.object({
  requestedRef: optional(z.string()),
  resolvedRef: z.string(),
  resolvedAt: optional(z.string()),
  skills: z.record(z.string(), LockedFileSchema),
});
const V1SourcesLockSchema = z.object({
  lockfileVersion: z.number(),
  sources: z.record(z.string(), V1LockedSourceSchema),
});

/**
 * Migrate v0 lockfile (string[] skills, no version) to v2.
 * Skill names mapped to files["skills/{name}"] with empty integrity.
 */
function migrateV0Lock(legacy: z.infer<typeof V0SourcesLockSchema>): SourcesLock {
  const sources: Record<string, LockedSource> = {};
  for (const [key, entry] of Object.entries(legacy.sources)) {
    const files: Record<string, LockedFile> = {};
    for (const name of entry.skills) {
      files[`skills/${name}`] = { integrity: "" };
    }
    sources[key] = { resolvedRef: entry.resolvedRef, files };
  }
  logger.info(
    "Migrated v0 sources lockfile to version 2. Run 'rulesync install --update' to populate integrity hashes.",
  );
  return { lockfileVersion: LOCKFILE_VERSION, sources };
}

/**
 * Migrate v1 lockfile (skills record with integrity) to v2 (files record).
 * Skill names mapped to files["skills/{name}"] preserving integrity.
 */
function migrateV1Lock(v1: z.infer<typeof V1SourcesLockSchema>): SourcesLock {
  const sources: Record<string, LockedSource> = {};
  for (const [key, entry] of Object.entries(v1.sources)) {
    const files: Record<string, LockedFile> = {};
    for (const [name, skill] of Object.entries(entry.skills)) {
      files[`skills/${name}`] = { integrity: skill.integrity };
    }
    sources[key] = {
      resolvedRef: entry.resolvedRef,
      requestedRef: entry.requestedRef,
      resolvedAt: entry.resolvedAt,
      files,
    };
  }
  logger.info("Migrated v1 sources lockfile to version 2.");
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

    // Try current v2 schema first
    const result = SourcesLockSchema.safeParse(data);
    if (result.success && result.data.lockfileVersion === 2) {
      return result.data;
    }

    // Try v1 schema (skills record with integrity, lockfileVersion present)
    const v1Result = V1SourcesLockSchema.safeParse(data);
    if (v1Result.success && v1Result.data.lockfileVersion === 1) {
      return migrateV1Lock(v1Result.data);
    }

    // Try v0 schema (no lockfileVersion, skills as string[])
    const v0Result = V0SourcesLockSchema.safeParse(data);
    if (v0Result.success) {
      return migrateV0Lock(v0Result.data);
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
 * Compute a SHA-256 integrity hash for a skill directory's contents.
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
 * Compute a SHA-256 integrity hash for a single file's content.
 */
export function computeFileIntegrity(content: string): string {
  const hash = createHash("sha256");
  hash.update(content);
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
    "https://www.gitlab.com/",
    "https://gitlab.com/",
    "http://www.gitlab.com/",
    "http://gitlab.com/",
  ]) {
    if (key.toLowerCase().startsWith(prefix)) {
      key = key.substring(prefix.length);
      break;
    }
  }

  // Normalize Azure DevOps URLs to org/project/repo
  // Matches: https://[user@]dev.azure.com/org/project/_git/repo
  const adoMatch = key.match(
    /^https?:\/\/(?:[^@]+@)?dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/]+?)(?:\.git)?(?:\/.*)?$/i,
  );
  if (adoMatch) {
    key = `${adoMatch[1]}/${adoMatch[2]}/${adoMatch[3]}`;
  }

  // Strip provider prefix
  for (const provider of ["github:", "gitlab:"]) {
    if (key.startsWith(provider)) {
      key = key.substring(provider.length);
      break;
    }
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
 * Extracts skill directory names from files keyed as "skills/{name}" or "skills/{name}/...".
 */
export function getLockedSkillNames(entry: LockedSource): string[] {
  const names = new Set<string>();
  for (const filePath of Object.keys(entry.files)) {
    if (filePath.startsWith("skills/")) {
      const rest = filePath.substring("skills/".length);
      const name = rest.split("/")[0];
      if (name) {
        names.add(name);
      }
    }
  }
  return [...names];
}

/**
 * Get all locked file paths for a source entry.
 */
export function getLockedFiles(entry: LockedSource): Record<string, LockedFile> {
  return entry.files;
}
