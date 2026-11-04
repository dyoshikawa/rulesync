import { join } from "node:path";

import { optional, z } from "zod/mini";

import {
  parseYamlLockfile,
  readYamlLockfile,
  ResolvedCommitShaSchema,
  serializeYamlLockfile,
  writeYamlLockfile,
} from "../yaml-lockfile.js";

/**
 * Filename of the rulesync-managed gh-skill-compatible lockfile. Distinct
 * from the rulesync sources lockfile (`rulesync.lock`) and from the
 * apm-mode lockfile (`rulesync-apm.lock.yaml`) so the three install modes
 * never fight over the same file.
 */
const GH_LOCKFILE_FILE_NAME = "rulesync-gh.lock.yaml";
export const GH_LOCKFILE_VERSION = "1" as const;

const ScopeSchema = z.enum(["project", "user"]);

/**
 * Single installation entry in `rulesync-gh.lock.yaml`. Each entry pins one
 * skill from one source under one (agent, scope) pair — matching the gh CLI
 * model where `gh skill install` deploys exactly one skill at a time.
 */
const GhLockInstallationSchema = z.looseObject({
  source: z.string(),
  owner: z.string(),
  repo: z.string(),
  agent: z.string(),
  scope: ScopeSchema,
  skill: z.string(),
  requested_ref: optional(z.string()),
  resolved_ref: z.string(),
  resolved_commit: ResolvedCommitShaSchema,
  install_dir: z.string(),
  deployed_files: z.array(z.string()),
  content_hash: optional(z.string()),
});
export type GhLockInstallation = z.infer<typeof GhLockInstallationSchema>;

const GhLockSchema = z.looseObject({
  lockfile_version: z.literal("1"),
  generated_at: z.string(),
  installations: z.array(GhLockInstallationSchema),
});
export type GhLock = z.infer<typeof GhLockSchema>;

export function getGhLockPath(projectRoot: string): string {
  return join(projectRoot, GH_LOCKFILE_FILE_NAME);
}

/**
 * Create an empty gh lockfile structure. When `existingLock` is provided,
 * top-level looseObject extras are carried forward so unknown fields (added
 * by future tools or other lockfile producers) round-trip cleanly.
 */
export function createEmptyGhLock(params?: { existingLock?: GhLock | null }): GhLock {
  const base = params?.existingLock ? { ...params.existingLock } : {};
  return {
    ...base,
    lockfile_version: GH_LOCKFILE_VERSION,
    generated_at: new Date().toISOString(),
    installations: [],
  };
}

/**
 * Parse `rulesync-gh.lock.yaml` content into a `GhLock`. Returns `null` for
 * empty / non-YAML-object content so callers can treat the lockfile as
 * missing. A *structurally* present lockfile that fails schema validation
 * throws, rather than silently dropping previously pinned entries.
 */
export function parseGhLock(content: string): GhLock | null {
  return parseYamlLockfile({ content, schema: GhLockSchema, fileName: GH_LOCKFILE_FILE_NAME });
}

export async function readGhLock(projectRoot: string): Promise<GhLock | null> {
  return readYamlLockfile({ path: getGhLockPath(projectRoot), parse: parseGhLock });
}

export async function writeGhLock(params: { projectRoot: string; lock: GhLock }): Promise<void> {
  await writeYamlLockfile({
    projectRoot: params.projectRoot,
    path: getGhLockPath(params.projectRoot),
    content: serializeGhLock(params.lock),
  });
}

export function serializeGhLock(lock: GhLock): string {
  return serializeYamlLockfile(lock);
}

/**
 * Find the locked installation for a given (source, agent, scope, skill)
 * tuple. Source is matched case-insensitively because GitHub routes
 * `owner/repo` paths case-insensitively.
 */
export function findGhLockInstallation(
  lock: GhLock,
  params: { source: string; agent: string; scope: "project" | "user"; skill: string },
): GhLockInstallation | undefined {
  const target = params.source.toLowerCase();
  return lock.installations.find(
    (i) =>
      i.source.toLowerCase() === target &&
      i.agent === params.agent &&
      i.scope === params.scope &&
      i.skill === params.skill,
  );
}
