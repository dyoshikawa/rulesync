import { join } from "node:path";

import { Semaphore } from "es-toolkit/promise";

import { FETCH_CONCURRENCY_LIMIT, MAX_FILE_SIZE } from "../../constants/rulesync-paths.js";
import type { GitHubFileEntry } from "../../types/fetch.js";
import { formatError } from "../../utils/error.js";
import { checkPathTraversal, toPosixPath, writeFileContent } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { GitHubClient, GitHubClientError, logGitHubAuthHints } from "../github-client.js";
import { listDirectoryRecursive, withSemaphore } from "../github-utils.js";
import {
  type ApmLock,
  type ApmLockDependency,
  createEmptyApmLock,
  findApmLockDependency,
  readApmLock,
  writeApmLock,
} from "./apm-lock.js";
import { type ApmDependency, readApmManifest } from "./apm-manifest.js";

/** APM compatibility marker written into `apm_version` when rulesync writes a lockfile. */
const RULESYNC_APM_COMPAT_VERSION = "rulesync-compat/0.1";

/**
 * Primitives the first iteration deploys. Ordered by scan priority.
 * Each entry maps a package-relative source directory (rooted at the
 * dependency's `path` if given, else the repo root) to the on-disk
 * deployment directory. This matches the default APM layout when the
 * github-copilot host is present.
 */
const APM_PRIMITIVES: Array<{ sourceDir: string; deployDir: string; packageType: string }> = [
  {
    sourceDir: ".apm/instructions",
    deployDir: ".github/instructions",
    packageType: "apm_package",
  },
  {
    sourceDir: ".apm/skills",
    deployDir: ".github/skills",
    packageType: "apm_package",
  },
];

export type ApmInstallOptions = {
  /** Force re-resolve all refs, ignoring the lockfile. */
  update?: boolean;
  /** Fail if the lockfile is missing or out of sync (for CI). */
  frozen?: boolean;
  /** GitHub token for private repositories. */
  token?: string;
};

export type ApmInstallResult = {
  dependenciesProcessed: number;
  deployedFileCount: number;
};

/**
 * Entry point for `rulesync install --mode apm`. Reads `apm.yml`, resolves
 * every declared APM dependency, fetches the subset of primitives rulesync
 * currently understands (Instructions and Skills), and updates `apm.lock.yaml`.
 */
export async function installApm(params: {
  baseDir: string;
  options?: ApmInstallOptions;
  logger: Logger;
}): Promise<ApmInstallResult> {
  const { baseDir, options = {}, logger } = params;

  const manifest = await readApmManifest(baseDir);
  if (manifest.dependencies.length === 0) {
    logger.warn("apm.yml has no dependencies.apm entries. Nothing to install.");
    return { dependenciesProcessed: 0, deployedFileCount: 0 };
  }

  const existingLock = await readApmLock(baseDir);
  if (options.frozen) {
    if (!existingLock) {
      throw new Error(
        "Frozen install failed: apm.lock.yaml is missing. Run 'rulesync install --mode apm' to create it.",
      );
    }
    const missing = manifest.dependencies.filter(
      (dep) => !findApmLockDependency(existingLock, canonicalRepoUrl(dep)),
    );
    if (missing.length > 0) {
      const names = missing.map((d) => d.gitUrl).join(", ");
      throw new Error(
        `Frozen install failed: apm.lock.yaml is missing entries for: ${names}. Run 'rulesync install --mode apm' to update the lockfile.`,
      );
    }
  }

  const token = GitHubClient.resolveToken(options.token);
  const client = new GitHubClient({ token });
  const semaphore = new Semaphore(FETCH_CONCURRENCY_LIMIT);

  const newLock: ApmLock = createEmptyApmLock({
    apmVersion: existingLock?.apm_version ?? RULESYNC_APM_COMPAT_VERSION,
  });

  let totalDeployed = 0;
  for (const dep of manifest.dependencies) {
    try {
      const deployed = await installDependency({
        dep,
        client,
        semaphore,
        baseDir,
        existingLock,
        update: options.update ?? false,
        logger,
      });
      newLock.dependencies.push(deployed.lockEntry);
      totalDeployed += deployed.deployedFiles.length;
    } catch (error) {
      logger.error(`Failed to install apm dependency "${dep.gitUrl}": ${formatError(error)}`);
      if (error instanceof GitHubClientError) {
        logGitHubAuthHints({ error, logger });
      }
    }
  }

  if (!options.frozen) {
    newLock.generated_at = new Date().toISOString();
    await writeApmLock({ baseDir, lock: newLock });
    logger.debug("apm.lock.yaml updated.");
  }

  return {
    dependenciesProcessed: manifest.dependencies.length,
    deployedFileCount: totalDeployed,
  };
}

async function installDependency(params: {
  dep: ApmDependency;
  client: GitHubClient;
  semaphore: Semaphore;
  baseDir: string;
  existingLock: ApmLock | null;
  update: boolean;
  logger: Logger;
}): Promise<{ lockEntry: ApmLockDependency; deployedFiles: string[] }> {
  const { dep, client, semaphore, baseDir, existingLock, update, logger } = params;
  const repoUrl = canonicalRepoUrl(dep);
  const locked = existingLock ? findApmLockDependency(existingLock, repoUrl) : undefined;

  let resolvedRef: string;
  let resolvedSha: string;
  if (locked && !update && locked.resolved_commit && locked.resolved_ref) {
    resolvedRef = locked.resolved_ref;
    resolvedSha = locked.resolved_commit;
    logger.debug(`Using locked commit for ${repoUrl}: ${resolvedSha}`);
  } else {
    resolvedRef = dep.ref ?? (await client.getDefaultBranch(dep.owner, dep.repo));
    resolvedSha = await client.resolveRefToSha(dep.owner, dep.repo, resolvedRef);
    logger.debug(`Resolved ${repoUrl} ref "${resolvedRef}" -> ${resolvedSha}`);
  }

  const deployedFiles: string[] = [];
  for (const primitive of APM_PRIMITIVES) {
    const remoteBase = dep.path
      ? toPosixPath(join(dep.path, primitive.sourceDir))
      : primitive.sourceDir;
    const files = await listPrimitiveFiles({
      client,
      semaphore,
      owner: dep.owner,
      repo: dep.repo,
      ref: resolvedSha,
      remoteBase,
      logger,
    });
    if (files.length === 0) continue;

    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        logger.warn(
          `Skipping "${file.path}" from ${repoUrl}: ${(file.size / 1024 / 1024).toFixed(2)}MB exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit.`,
        );
        continue;
      }
      const relativeToBase = file.path.substring(remoteBase.length + 1);
      const deployRelative = toPosixPath(join(primitive.deployDir, relativeToBase));
      checkPathTraversal({
        relativePath: deployRelative,
        intendedRootDir: baseDir,
      });
      const content = await withSemaphore(semaphore, () =>
        client.getFileContent(dep.owner, dep.repo, file.path, resolvedSha),
      );
      await writeFileContent(join(baseDir, deployRelative), content);
      deployedFiles.push(deployRelative);
    }
  }

  deployedFiles.sort();

  const lockEntry: ApmLockDependency = {
    repo_url: repoUrl,
    resolved_commit: resolvedSha,
    resolved_ref: resolvedRef,
    depth: 1,
    package_type: "apm_package",
    deployed_files: deployedFiles,
  };
  if (dep.path) {
    lockEntry.virtual_path = dep.path;
  }

  logger.info(`Installed ${deployedFiles.length} file(s) from ${repoUrl}@${shortSha(resolvedSha)}`);

  return { lockEntry, deployedFiles };
}

async function listPrimitiveFiles(params: {
  client: GitHubClient;
  semaphore: Semaphore;
  owner: string;
  repo: string;
  ref: string;
  remoteBase: string;
  logger: Logger;
}): Promise<GitHubFileEntry[]> {
  const { client, semaphore, owner, repo, ref, remoteBase, logger } = params;
  try {
    return await listDirectoryRecursive({
      client,
      owner,
      repo,
      path: remoteBase,
      ref,
      semaphore,
    });
  } catch (error) {
    if (error instanceof GitHubClientError && error.statusCode === 404) {
      logger.debug(`No ${remoteBase}/ in ${owner}/${repo}, skipping.`);
      return [];
    }
    throw error;
  }
}

/**
 * Canonical repo_url written into the lockfile. We always use the HTTPS form
 * without a trailing `.git` so that lock files round-trip deterministically
 * regardless of whether the manifest referenced the repo with or without
 * the suffix.
 */
function canonicalRepoUrl(dep: ApmDependency): string {
  return `https://github.com/${dep.owner}/${dep.repo}`;
}

function shortSha(sha: string): string {
  return sha.substring(0, 7);
}
