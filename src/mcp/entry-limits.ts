const MAX_ENTRY_SIZE_BYTES = 1024 * 1024; // 1MB
const MAX_ENTRY_COUNT = 1000;

/**
 * Rejects a put whose estimated size is over the per-entry limit shared by the
 * rule, command, subagent, check and skill MCP tools.
 *
 * @param label - How the entry is named at the start of the error (e.g. `Rule`).
 */
export function assertEntrySizeWithinLimit({
  label,
  estimatedSize,
  path,
}: {
  label: string;
  estimatedSize: number;
  path: string;
}): void {
  if (estimatedSize > MAX_ENTRY_SIZE_BYTES) {
    throw new Error(
      `${label} size ${estimatedSize} bytes exceeds maximum ${MAX_ENTRY_SIZE_BYTES} bytes (1MB) for ${path}`,
    );
  }
}

/**
 * Rejects a put that would create a new entry once the directory already holds
 * the maximum number of entries. Updating an existing entry is always allowed.
 *
 * @param plural - How the entries are named in the error (e.g. `rules`).
 */
export function assertEntryCountWithinLimit({
  plural,
  dirPath,
  existingCount,
  isUpdate,
}: {
  plural: string;
  dirPath: string;
  existingCount: number;
  isUpdate: boolean;
}): void {
  if (!isUpdate && existingCount >= MAX_ENTRY_COUNT) {
    throw new Error(`Maximum number of ${plural} (${MAX_ENTRY_COUNT}) reached in ${dirPath}`);
  }
}
