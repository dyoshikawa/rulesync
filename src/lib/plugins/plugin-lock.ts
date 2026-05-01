import { createHash } from "node:crypto";
import { join } from "node:path";

import { dump, load } from "js-yaml";
import { optional, refine, z } from "zod/mini";

import { RULESYNC_PLUGINS_LOCK_FILE_NAME } from "../../constants/rulesync-paths.js";
import { fileExists, readFileContent, writeFileContent } from "../../utils/file.js";

export const PLUGIN_LOCKFILE_VERSION = "1" as const;
export const PLUGIN_CONTENT_HASH_REGEX = /^sha256:[0-9a-f]{64}$/;

export const PluginLockInstallationSchema = z.looseObject({
  source: optional(z.string()),
  plugin: z.string(),
  requested_ref: optional(z.string()),
  resolved_commit: z
    .string()
    .check(refine((v) => /^[0-9a-f]{40}$/.test(v), "resolved_commit must be a 40-char hex SHA")),
  target: z.string(),
  scope: z.enum(["user"]),
  install_strategy: z.string(),
  install_dir: z.string(),
  deployed_files: z.array(z.string()),
  content_hash: z.string(),
  installed_at: z.string(),
});

export type PluginLockInstallation = z.infer<typeof PluginLockInstallationSchema>;

export const PluginLockSchema = z.looseObject({
  lockfile_version: z.literal("1"),
  generated_at: z.string(),
  installations: z.array(PluginLockInstallationSchema),
});

export type PluginLock = z.infer<typeof PluginLockSchema>;

export function getPluginLockPath(projectRoot: string): string {
  return join(projectRoot, RULESYNC_PLUGINS_LOCK_FILE_NAME);
}

export function createEmptyPluginLock(params?: { existingLock?: PluginLock | null }): PluginLock {
  const base = params?.existingLock ? { ...params.existingLock } : {};
  return {
    ...base,
    lockfile_version: PLUGIN_LOCKFILE_VERSION,
    generated_at: new Date().toISOString(),
    installations: [],
  };
}

export function parsePluginLock(content: string): PluginLock | null {
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
  const parsed = PluginLockSchema.safeParse(loaded);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "<root>"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid ${RULESYNC_PLUGINS_LOCK_FILE_NAME}:\n${issues}`);
  }
  return parsed.data;
}

export async function readPluginLock(projectRoot: string): Promise<PluginLock | null> {
  const path = getPluginLockPath(projectRoot);
  if (!(await fileExists(path))) {
    return null;
  }
  return parsePluginLock(await readFileContent(path));
}

export async function writePluginLock(params: {
  projectRoot: string;
  lock: PluginLock;
}): Promise<void> {
  await writeFileContent(getPluginLockPath(params.projectRoot), serializePluginLock(params.lock));
}

export function serializePluginLock(lock: PluginLock): string {
  return dump(lock, { noRefs: true, lineWidth: -1, sortKeys: false });
}

export function findPluginInstallation(
  lock: PluginLock,
  params: { plugin: string; target: string; scope: "user" },
): PluginLockInstallation | undefined {
  return lock.installations.find(
    (entry) =>
      entry.plugin === params.plugin &&
      entry.target === params.target &&
      entry.scope === params.scope,
  );
}

export function computePluginContentHash(files: Array<{ path: string; content: string }>): string {
  const hash = createHash("sha256");
  const sorted = files.toSorted((a, b) => a.path.localeCompare(b.path));
  for (const file of sorted) {
    hash.update(file.path);
    hash.update("\0");
    hash.update(file.content);
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}
