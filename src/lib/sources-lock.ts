import { join } from "node:path";
import { z } from "zod/mini";

import { RULESYNC_SOURCES_LOCK_RELATIVE_FILE_PATH } from "../constants/rulesync-paths.js";
import { fileExists, readFileContent, writeFileContent } from "../utils/file.js";
import { logger } from "../utils/logger.js";

/**
 * Schema for a single locked source entry.
 */
export const LockedSourceSchema = z.object({
  resolvedRef: z.string(),
  skills: z.array(z.string()),
});
export type LockedSource = z.infer<typeof LockedSourceSchema>;

/**
 * Schema for the full lockfile.
 */
export const SourcesLockSchema = z.object({
  sources: z.record(z.string(), LockedSourceSchema),
});
export type SourcesLock = z.infer<typeof SourcesLockSchema>;

/**
 * Create an empty lockfile structure.
 */
export function createEmptyLock(): SourcesLock {
  return { sources: {} };
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
    const result = SourcesLockSchema.safeParse(data);
    if (!result.success) {
      logger.warn("Invalid sources lockfile format. Starting fresh.");
      return createEmptyLock();
    }
    return result.data;
  } catch {
    logger.warn("Failed to read sources lockfile. Starting fresh.");
    return createEmptyLock();
  }
}

/**
 * Write the lockfile to disk.
 */
export async function writeLockFile(params: {
  baseDir: string;
  lock: SourcesLock;
}): Promise<void> {
  const lockPath = join(params.baseDir, RULESYNC_SOURCES_LOCK_RELATIVE_FILE_PATH);
  const content = JSON.stringify(params.lock, null, 2) + "\n";
  await writeFileContent(lockPath, content);
  logger.debug(`Wrote sources lockfile to ${lockPath}`);
}

/**
 * Get the locked entry for a source key, if it exists.
 */
export function getLockedSource(lock: SourcesLock, sourceKey: string): LockedSource | undefined {
  return lock.sources[sourceKey];
}

/**
 * Set (or update) a locked entry for a source key.
 */
export function setLockedSource(
  lock: SourcesLock,
  sourceKey: string,
  entry: LockedSource,
): SourcesLock {
  return {
    sources: {
      ...lock.sources,
      [sourceKey]: entry,
    },
  };
}
