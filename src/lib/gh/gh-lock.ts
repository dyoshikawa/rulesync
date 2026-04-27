import { join } from "node:path";

import { dump, load } from "js-yaml";
import { optional, refine, z } from "zod/mini";

import { fileExists, readFileContent, writeFileContent } from "../../utils/file.js";

/**
 * Filename of the rulesync-managed gh-skill-compatible lockfile. Distinct
 * from the rulesync sources lockfile (`rulesync.lock`) and from the
 * apm-mode lockfile (`rulesync-apm.lock.yaml`) so the three install modes
 * never fight over the same file.
 */
export const GH_LOCKFILE_FILE_NAME = "rulesync-gh.lock.yaml";
export const GH_LOCKFILE_VERSION = "1" as const;

/**
 * Shape of content_hash values that rulesync writes for gh installs. Same
 * format as the apm-mode hash so callers can reuse the integrity check
 * conventions; under `--frozen` only values matching this regex are
 * considered comparable.
 */
export const RULESYNC_CONTENT_HASH_REGEX = /^sha256:[0-9a-f]{64}$/;

const ScopeSchema = z.enum(["project", "user"]);

/**
 * Single installation entry in `rulesync-gh.lock.yaml`. Each entry pins one
 * skill from one source under one (agent, scope) pair — matching the gh CLI
 * model where `gh skill install` deploys exactly one skill at a time.
 */
export const GhLockInstallationSchema = z.looseObject({
  source: z.string(),
  owner: z.string(),
  repo: z.string(),
  agent: z.string(),
  scope: ScopeSchema,
  skill: z.string(),
  requested_ref: optional(z.string()),
  resolved_ref: z.string(),
  resolved_commit: z
    .string()
    .check(refine((v) => /^[0-9a-f]{40}$/.test(v), "resolved_commit must be a 40-char hex SHA")),
  install_dir: z.string(),
  deployed_files: z.array(z.string()),
  content_hash: optional(z.string()),
});
export type GhLockInstallation = z.infer<typeof GhLockInstallationSchema>;

export const GhLockSchema = z.looseObject({
  lockfile_version: z.literal("1"),
  generated_at: z.string(),
  installations: z.array(GhLockInstallationSchema),
});
export type GhLock = z.infer<typeof GhLockSchema>;

export function getGhLockPath(projectRoot: string): string {
  return join(projectRoot, GH_LOCKFILE_FILE_NAME);
}

export async function ghLockExists(projectRoot: string): Promise<boolean> {
  return fileExists(getGhLockPath(projectRoot));
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
  const parsed = GhLockSchema.safeParse(loaded);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "<root>"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid ${GH_LOCKFILE_FILE_NAME}:\n${issues}`);
  }
  return parsed.data;
}

export async function readGhLock(projectRoot: string): Promise<GhLock | null> {
  const path = getGhLockPath(projectRoot);
  if (!(await fileExists(path))) {
    return null;
  }
  const content = await readFileContent(path);
  return parseGhLock(content);
}

export async function writeGhLock(params: { projectRoot: string; lock: GhLock }): Promise<void> {
  const path = getGhLockPath(params.projectRoot);
  const content = serializeGhLock(params.lock);
  await writeFileContent(path, content);
}

export function serializeGhLock(lock: GhLock): string {
  // `noRefs: true` avoids YAML anchors/aliases; `lineWidth: -1` keeps long
  // URLs and sha values on a single line so the file stays diff-friendly.
  return dump(lock, { noRefs: true, lineWidth: -1, sortKeys: false });
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
