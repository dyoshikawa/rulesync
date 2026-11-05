import { join } from "node:path";

import { nonnegative, optional, z } from "zod/mini";

import {
  parseYamlLockfile,
  readYamlLockfile,
  ResolvedCommitShaSchema,
  serializeYamlLockfile,
  writeYamlLockfile,
} from "../yaml-lockfile.js";

/**
 * Filename of the rulesync-managed apm-compatible lockfile. Rulesync uses a
 * lockfile name distinct from the upstream `apm` CLI's `apm.lock.yaml` so the
 * two tools do not fight over the same file: the schema is still the apm v1
 * lockfile format, but rulesync only reads/writes its own file.
 */
const APM_LOCKFILE_FILE_NAME = "rulesync-apm.lock.yaml";
export const APM_LOCKFILE_VERSION = "1" as const;

/**
 * Single dependency entry in `rulesync-apm.lock.yaml`. Mirrors the subset of the
 * APM v1 lockfile schema that rulesync currently populates. Extra fields
 * from the spec (content_hash, is_dev, virtual_path, ...) are preserved
 * verbatim so that rulesync does not strip them out when re-writing a
 * lockfile produced by `apm` itself.
 */
const ApmLockDependencySchema = z.looseObject({
  repo_url: z.string(),
  resolved_commit: optional(ResolvedCommitShaSchema),
  resolved_ref: optional(z.string()),
  version: optional(z.string()),
  depth: z.int().check(nonnegative()),
  resolved_by: optional(z.string()),
  package_type: z.string(),
  // Intentionally loose: the upstream `apm` CLI may write content_hash values
  // that do not match the strict rulesync format. We accept any string on read
  // so that a lockfile produced by `apm` round-trips through rulesync without
  // throwing. Rulesync itself always writes values matching
  // `RULESYNC_CONTENT_HASH_REGEX`, and `--frozen` integrity checks only
  // enforce the comparison when the recorded hash matches that shape.
  content_hash: optional(z.string()),
  is_dev: optional(z.boolean()),
  deployed_files: z.array(z.string()),
  source: optional(z.string()),
  local_path: optional(z.string()),
  virtual_path: optional(z.string()),
  is_virtual: optional(z.boolean()),
});
export type ApmLockDependency = z.infer<typeof ApmLockDependencySchema>;

const ApmLockSchema = z.looseObject({
  lockfile_version: z.literal("1"),
  generated_at: z.string(),
  apm_version: z.string(),
  dependencies: z.array(ApmLockDependencySchema),
  mcp_servers: optional(z.array(z.string())),
});
export type ApmLock = z.infer<typeof ApmLockSchema>;

export function getApmLockPath(projectRoot: string): string {
  return join(projectRoot, APM_LOCKFILE_FILE_NAME);
}

/**
 * Create an empty lockfile structure. `apm_version` is set to the rulesync
 * compatibility-marker string so downstream tooling can tell this lockfile
 * was produced by rulesync rather than the upstream `apm` CLI.
 *
 * When `existingLock` is provided, all top-level fields from that lock (e.g.
 * `mcp_servers` and any looseObject extras written by the upstream `apm`
 * CLI) are carried forward. `dependencies` is always reset to an empty array
 * and `generated_at` is refreshed; `apm_version` is overwritten by the value
 * passed in `params.apmVersion`.
 */
export function createEmptyApmLock(params: {
  apmVersion: string;
  existingLock?: ApmLock | null;
}): ApmLock {
  const base = params.existingLock ? { ...params.existingLock } : {};
  return {
    ...base,
    lockfile_version: APM_LOCKFILE_VERSION,
    generated_at: new Date().toISOString(),
    apm_version: params.apmVersion,
    dependencies: [],
  };
}

/**
 * Parse `rulesync-apm.lock.yaml` content into an `ApmLock`. Returns `null` when the
 * content is absent / empty / non-YAML-object so callers can treat the lock
 * as missing. A *structurally* present lockfile that fails schema validation
 * throws a descriptive error rather than being silently dropped — silently
 * discarding a corrupt lockfile would erase previously pinned commits.
 */
export function parseApmLock(content: string): ApmLock | null {
  return parseYamlLockfile({ content, schema: ApmLockSchema, fileName: APM_LOCKFILE_FILE_NAME });
}

export async function readApmLock(projectRoot: string): Promise<ApmLock | null> {
  return readYamlLockfile({ path: getApmLockPath(projectRoot), parse: parseApmLock });
}

export async function writeApmLock(params: { projectRoot: string; lock: ApmLock }): Promise<void> {
  await writeYamlLockfile({
    projectRoot: params.projectRoot,
    path: getApmLockPath(params.projectRoot),
    content: serializeApmLock(params.lock),
  });
}

export function serializeApmLock(lock: ApmLock): string {
  return serializeYamlLockfile(lock);
}

/**
 * Find the locked entry for a repo_url. GitHub routes `owner/repo` path
 * components case-insensitively, so the comparison here is case-insensitive
 * to match `apm-manifest.ts` canonicalization and avoid frozen-mode false
 * positives when users re-case their manifest.
 */
export function findApmLockDependency(
  lock: ApmLock,
  repoUrl: string,
): ApmLockDependency | undefined {
  const target = repoUrl.toLowerCase();
  return lock.dependencies.find((d) => d.repo_url.toLowerCase() === target);
}
