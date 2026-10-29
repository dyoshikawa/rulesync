import { createHash } from "node:crypto";
import { join, posix } from "node:path";

import { optional, refine, z } from "zod/mini";

import { getSourceTransport, type SourceEntry } from "../config/config.js";
import { RULESYNC_SOURCES_LOCK_RELATIVE_FILE_PATH } from "../constants/rulesync-paths.js";
import { fileExists, readFileContent, writeFileContent } from "../utils/file.js";
import type { Logger } from "../utils/logger.js";

/** Current lockfile format version. Bump when the schema changes. */
export const LOCKFILE_VERSION = 1;

/**
 * Schema for a single locked skill entry with content integrity.
 */
const LockedSkillSchema = z.object({
  integrity: z.string(),
});
export type LockedSkill = z.infer<typeof LockedSkillSchema>;

/** Schema for a single locked rule entry with content integrity. */
const LockedRuleSchema = z.object({
  integrity: z.string(),
});
export type LockedRule = z.infer<typeof LockedRuleSchema>;

/**
 * Schema for a single locked source entry.
 */
const LockedSourceSchema = z.object({
  requestedRef: optional(z.string()),
  resolvedRef: z
    .string()
    .check(refine((v) => /^[0-9a-f]{40}$/.test(v), "resolvedRef must be a 40-character hex SHA")),
  resolvedAt: optional(z.string()),
  skills: z.record(z.string(), LockedSkillSchema),
  /**
   * The normalized `skills` selection the entry was written for. Absent from
   * lockfiles written before the selection was recorded.
   */
  skillSelection: optional(z.array(z.string())),
  /**
   * The normalized path the skills were read from in the source. Absent from
   * lockfiles written before the path was recorded.
   */
  skillsPath: optional(z.string()),
  rules: optional(z.record(z.string(), LockedRuleSchema)),
  ruleSelection: optional(z.array(z.string())),
  rulesPath: optional(z.string()),
  resolvedRuleNames: optional(z.array(z.string())),
});
export type LockedSource = z.infer<typeof LockedSourceSchema>;

/**
 * Schema for the full lockfile (current version).
 */
const SourcesLockSchema = z.object({
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
function migrateLegacyLock(params: {
  legacy: z.infer<typeof LegacySourcesLockSchema>;
  logger: Logger;
}): SourcesLock {
  const { legacy, logger } = params;
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
export async function readLockFile(params: {
  projectRoot: string;
  logger: Logger;
}): Promise<SourcesLock> {
  const { logger } = params;
  const lockPath = join(params.projectRoot, RULESYNC_SOURCES_LOCK_RELATIVE_FILE_PATH);

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
      return migrateLegacyLock({ legacy: legacyResult.data, logger });
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
export async function writeLockFile(params: {
  projectRoot: string;
  lock: SourcesLock;
  logger: Logger;
}): Promise<void> {
  const { logger } = params;
  const lockPath = join(params.projectRoot, RULESYNC_SOURCES_LOCK_RELATIVE_FILE_PATH);
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

/** Compute a SHA-256 integrity hash for one rule file. */
export function computeRuleIntegrity(content: string): string {
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
 * Separates the repository part of a lock key from the qualifier that tells
 * apart several declared entries of the same repository.
 */
const LOCK_KEY_QUALIFIER_SEPARATOR = "#";

/**
 * Normalize a lock key for comparison. The repository part is normalized with
 * {@link normalizeSourceKey}; a qualifier (see {@link resolveSourceLockKeys})
 * is kept verbatim, since paths and refs are case-sensitive. A key without a
 * qualifier normalizes exactly as before qualifiers existed.
 */
export function normalizeLockKey(key: string): string {
  const separatorIndex = key.indexOf(LOCK_KEY_QUALIFIER_SEPARATOR);
  if (separatorIndex === -1) {
    return normalizeSourceKey(key);
  }
  return normalizeSourceKey(key.slice(0, separatorIndex)) + key.slice(separatorIndex);
}

/** The normalized repository part of a lock key, without its qualifier. */
export function getLockKeyRepository(key: string): string {
  const separatorIndex = key.indexOf(LOCK_KEY_QUALIFIER_SEPARATOR);
  return normalizeSourceKey(separatorIndex === -1 ? key : key.slice(0, separatorIndex));
}

function encodeLockKeyQualifierValue(value: string): string {
  return encodeURIComponent(value).replace(/%2F/gi, "/");
}

function normalizeLockKeyDirPath(dirPath: string): string {
  return posix.normalize(dirPath.replace(/\\/g, "/")).replace(/\/+$/, "");
}

/**
 * The location fields of a declared entry that tell it apart from other
 * entries of the same repository, as a lock key qualifier (empty when the
 * entry declares none of them).
 */
function buildLockKeyQualifier(sourceEntry: SourceEntry): string {
  const parts: string[] = [];
  if (sourceEntry.path !== undefined) {
    parts.push(`path=${encodeLockKeyQualifierValue(normalizeLockKeyDirPath(sourceEntry.path))}`);
  }
  if (sourceEntry.rulesPath !== undefined) {
    parts.push(
      `rulesPath=${encodeLockKeyQualifierValue(normalizeLockKeyDirPath(sourceEntry.rulesPath))}`,
    );
  }
  if (sourceEntry.ref !== undefined) {
    parts.push(`ref=${encodeLockKeyQualifierValue(sourceEntry.ref)}`);
  }
  return parts.join("&");
}

/**
 * The key each declared source's lock entry is stored under, index-aligned
 * with `sources`.
 *
 * A repository declared once keeps the bare {@link normalizeSourceKey} key,
 * so lockfiles written before multiple entries per repository were supported
 * stay valid unchanged. Only when several git/GitHub entries normalize to the
 * same repository does each of them get a qualified key
 * (`owner/repo#path=plugins/team-a/skills&ref=main`) built from its `path`,
 * `rulesPath` and `ref`, so each entry keeps its own lock entry, its own
 * curated-artifact cleanup and its own `--frozen` check. An entry declaring
 * none of those fields keeps the bare key, and entries declaring the same
 * location are told apart by their order (`entry=2`, `entry=3`, ...).
 *
 * npm-transport sources are locked in a separate lockfile by package name;
 * their key here is unused and left bare.
 */
export function resolveSourceLockKeys(sources: SourceEntry[]): string[] {
  const bareKeys = sources.map((sourceEntry) => normalizeSourceKey(sourceEntry.source));
  const repositoryCounts = new Map<string, number>();
  sources.forEach((sourceEntry, index) => {
    if (getSourceTransport(sourceEntry) === "npm") return;
    const bareKey = bareKeys[index] ?? "";
    repositoryCounts.set(bareKey, (repositoryCounts.get(bareKey) ?? 0) + 1);
  });
  const qualifierCounts = new Map<string, number>();
  return sources.map((sourceEntry, index) => {
    const bareKey = bareKeys[index] ?? "";
    if (getSourceTransport(sourceEntry) === "npm" || (repositoryCounts.get(bareKey) ?? 0) < 2) {
      return bareKey;
    }
    const qualifier = buildLockKeyQualifier(sourceEntry);
    const base =
      qualifier === "" ? bareKey : `${bareKey}${LOCK_KEY_QUALIFIER_SEPARATOR}${qualifier}`;
    const occurrence = (qualifierCounts.get(base) ?? 0) + 1;
    qualifierCounts.set(base, occurrence);
    if (occurrence === 1) {
      return base;
    }
    const joiner = qualifier === "" ? LOCK_KEY_QUALIFIER_SEPARATOR : "&";
    return `${base}${joiner}entry=${occurrence}`;
  });
}

/**
 * Move a lock entry to another key, keeping its position-independent content
 * unchanged (immutable — returns a fresh lock object).
 */
export function renameLockedSource(params: {
  lock: SourcesLock;
  fromKey: string;
  toKey: string;
}): SourcesLock {
  const { lock, fromKey, toKey } = params;
  const entry = getLockedSource(lock, fromKey);
  if (entry === undefined) {
    return lock;
  }
  const normalizedFrom = normalizeLockKey(fromKey);
  const remaining: Record<string, LockedSource> = {};
  for (const [key, value] of Object.entries(lock.sources)) {
    if (normalizeLockKey(key) !== normalizedFrom) {
      remaining[key] = value;
    }
  }
  return setLockedSource(
    { lockfileVersion: lock.lockfileVersion, sources: remaining },
    toKey,
    entry,
  );
}

/**
 * Get the locked entry for a lock key (see {@link resolveSourceLockKeys}),
 * if it exists.
 */
export function getLockedSource(lock: SourcesLock, lockKey: string): LockedSource | undefined {
  const normalized = normalizeLockKey(lockKey);
  // Look up by normalized key
  for (const [key, value] of Object.entries(lock.sources)) {
    if (normalizeLockKey(key) === normalized) {
      return value;
    }
  }
  return undefined;
}

/**
 * Set (or update) a locked entry for a lock key.
 */
export function setLockedSource(
  lock: SourcesLock,
  lockKey: string,
  entry: LockedSource,
): SourcesLock {
  const normalized = normalizeLockKey(lockKey);
  // Remove any existing entries with the same normalized key
  const filteredSources: Record<string, LockedSource> = {};
  for (const [key, value] of Object.entries(lock.sources)) {
    if (normalizeLockKey(key) !== normalized) {
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

/** Get the rule names from a locked source entry. */
export function getLockedRuleNames(entry: LockedSource): string[] {
  return Object.keys(entry.rules ?? {});
}
