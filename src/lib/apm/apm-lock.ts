import { join } from "node:path";

import { dump, load } from "js-yaml";
import { optional, refine, z } from "zod/mini";

import { fileExists, readFileContent, writeFileContent } from "../../utils/file.js";

export const APM_LOCKFILE_FILE_NAME = "apm.lock.yaml";
export const APM_LOCKFILE_VERSION = "1";

/**
 * Single dependency entry in `apm.lock.yaml`. Mirrors the subset of the
 * APM v1 lockfile schema that rulesync currently populates. Extra fields
 * from the spec (content_hash, is_dev, virtual_path, ...) are preserved
 * verbatim so that rulesync does not strip them out when re-writing a
 * lockfile produced by `apm` itself.
 */
export const ApmLockDependencySchema = z.looseObject({
  repo_url: z.string(),
  resolved_commit: optional(
    z
      .string()
      .check(refine((v) => /^[0-9a-f]{40}$/.test(v), "resolved_commit must be a 40-char hex SHA")),
  ),
  resolved_ref: optional(z.string()),
  version: optional(z.string()),
  depth: z.number(),
  resolved_by: optional(z.string()),
  package_type: z.string(),
  content_hash: optional(z.string()),
  is_dev: optional(z.boolean()),
  deployed_files: z.array(z.string()),
  source: optional(z.string()),
  local_path: optional(z.string()),
  virtual_path: optional(z.string()),
  is_virtual: optional(z.boolean()),
});
export type ApmLockDependency = z.infer<typeof ApmLockDependencySchema>;

export const ApmLockSchema = z.looseObject({
  lockfile_version: z.string(),
  generated_at: z.string(),
  apm_version: z.string(),
  dependencies: z.array(ApmLockDependencySchema),
  mcp_servers: optional(z.array(z.string())),
});
export type ApmLock = z.infer<typeof ApmLockSchema>;

export function getApmLockPath(baseDir: string): string {
  return join(baseDir, APM_LOCKFILE_FILE_NAME);
}

export async function apmLockExists(baseDir: string): Promise<boolean> {
  return fileExists(getApmLockPath(baseDir));
}

/**
 * Create an empty lockfile structure. `apm_version` is set to the rulesync
 * compatibility-marker string so downstream tooling can tell this lockfile
 * was produced by rulesync rather than the upstream `apm` CLI.
 */
export function createEmptyApmLock(params: { apmVersion: string }): ApmLock {
  return {
    lockfile_version: APM_LOCKFILE_VERSION,
    generated_at: new Date().toISOString(),
    apm_version: params.apmVersion,
    dependencies: [],
  };
}

/**
 * Parse `apm.lock.yaml` content into an `ApmLock`. Returns `null` if the
 * content is empty or invalid so callers can fall back to an empty lock.
 */
export function parseApmLock(content: string): ApmLock | null {
  if (!content.trim()) {
    return null;
  }
  let loaded: unknown;
  try {
    loaded = load(content);
  } catch {
    return null;
  }
  if (!loaded || typeof loaded !== "object") {
    return null;
  }
  const parsed = ApmLockSchema.safeParse(loaded);
  if (!parsed.success) {
    return null;
  }
  return parsed.data;
}

export async function readApmLock(baseDir: string): Promise<ApmLock | null> {
  const path = getApmLockPath(baseDir);
  if (!(await fileExists(path))) {
    return null;
  }
  const content = await readFileContent(path);
  return parseApmLock(content);
}

export async function writeApmLock(params: { baseDir: string; lock: ApmLock }): Promise<void> {
  const path = getApmLockPath(params.baseDir);
  const content = serializeApmLock(params.lock);
  await writeFileContent(path, content);
}

export function serializeApmLock(lock: ApmLock): string {
  // `noRefs: true` avoids YAML anchors/aliases; `lineWidth: -1` keeps long
  // URLs on a single line so the file stays diff-friendly.
  return dump(lock, { noRefs: true, lineWidth: -1, sortKeys: false });
}

/**
 * Find the locked entry for a repo_url (case-sensitive), if any.
 */
export function findApmLockDependency(
  lock: ApmLock,
  repoUrl: string,
): ApmLockDependency | undefined {
  return lock.dependencies.find((d) => d.repo_url === repoUrl);
}
