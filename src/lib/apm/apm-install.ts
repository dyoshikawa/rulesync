import { createHash } from "node:crypto";
import { join, posix } from "node:path";

import { Semaphore } from "es-toolkit/promise";

import { FETCH_CONCURRENCY_LIMIT, MAX_FILE_SIZE } from "../../constants/rulesync-paths.js";
import type { GitHubFileEntry } from "../../types/fetch.js";
import { formatError } from "../../utils/error.js";
import { checkPathTraversal, removeFile, toPosixPath, writeFileContent } from "../../utils/file.js";
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
  failedDependencyCount: number;
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
    return { dependenciesProcessed: 0, deployedFileCount: 0, failedDependencyCount: 0 };
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
    // Detect manifest drift: when the user edited `ref` in apm.yml without
    // re-running install, the locked ref no longer matches the declared one.
    // In frozen mode we refuse rather than silently install the locked SHA.
    const drifted = manifest.dependencies.filter((dep) => {
      if (dep.ref === undefined) return false;
      const locked = findApmLockDependency(existingLock, canonicalRepoUrl(dep));
      return locked?.resolved_ref !== undefined && locked.resolved_ref !== dep.ref;
    });
    if (drifted.length > 0) {
      const names = drifted
        .map((d) => {
          const locked = findApmLockDependency(existingLock, canonicalRepoUrl(d));
          return `${d.gitUrl} (manifest=${d.ref}, lock=${locked?.resolved_ref})`;
        })
        .join(", ");
      throw new Error(
        `Frozen install failed: manifest ref does not match apm.lock.yaml for: ${names}. Run 'rulesync install --mode apm' to update the lockfile.`,
      );
    }
  }

  const token = GitHubClient.resolveToken(options.token);
  const client = new GitHubClient({ token });
  const semaphore = new Semaphore(FETCH_CONCURRENCY_LIMIT);

  const newLock: ApmLock = createEmptyApmLock({
    apmVersion: existingLock?.apm_version ?? RULESYNC_APM_COMPAT_VERSION,
  });

  // Dependencies are independent, so install them in parallel. The within-dep
  // tree walk is already rate-limited by the shared FETCH_CONCURRENCY_LIMIT
  // semaphore, so top-level parallelism is bounded naturally.
  //
  // Semantics:
  //   frozen=true  — any failure aborts the whole install (Promise.all
  //                   rejects on the first rejection).
  //   frozen=false — each dep's promise resolves to a result object so that
  //                   one failing dep does not abort the others.
  type DepResult =
    | { status: "ok"; lockEntry: ApmLockDependency; deployedCount: number }
    | { status: "failed" };

  const frozen = options.frozen ?? false;

  const runOne = async (dep: ApmDependency): Promise<DepResult> => {
    const installed = await installDependency({
      dep,
      client,
      semaphore,
      baseDir,
      existingLock,
      frozen,
      update: options.update ?? false,
      logger,
    });
    return {
      status: "ok",
      lockEntry: installed.lockEntry,
      deployedCount: installed.deployedFiles.length,
    };
  };

  const results: DepResult[] = frozen
    ? await Promise.all(manifest.dependencies.map(runOne))
    : await Promise.all(
        manifest.dependencies.map(async (dep): Promise<DepResult> => {
          try {
            return await runOne(dep);
          } catch (error) {
            logger.error(`Failed to install apm dependency "${dep.gitUrl}": ${formatError(error)}`);
            if (error instanceof GitHubClientError) {
              logGitHubAuthHints({ error, logger });
            }
            // Preserve the prior lock entry for failed deps so that a
            // transient network error does not destroy a previously pinned
            // commit SHA.
            const previous = existingLock
              ? findApmLockDependency(existingLock, canonicalRepoUrl(dep))
              : undefined;
            if (previous) {
              newLock.dependencies.push(previous);
            }
            return { status: "failed" };
          }
        }),
      );

  let totalDeployed = 0;
  let failedCount = 0;
  // Iterate in manifest order to keep the lockfile deterministic.
  for (const result of results) {
    if (result.status === "ok") {
      newLock.dependencies.push(result.lockEntry);
      totalDeployed += result.deployedCount;
    } else {
      failedCount += 1;
    }
  }

  // Remove files that were deployed by a previous install but are no longer
  // part of any current dependency's deployed_files. Without this, stale
  // artifacts would accumulate on disk forever as upstream content changes.
  if (existingLock) {
    const newDeployedFiles = new Set(newLock.dependencies.flatMap((d) => d.deployed_files));
    const toDelete: string[] = [];
    for (const prev of existingLock.dependencies) {
      for (const deployed of prev.deployed_files) {
        if (!newDeployedFiles.has(deployed)) {
          toDelete.push(deployed);
        }
      }
    }
    for (const relativePath of toDelete) {
      const absolute = join(baseDir, relativePath);
      // `removeFile` is best-effort and swallows ENOENT, so missing files are
      // a no-op. This keeps a corrupted partial-install from blowing up here.
      await removeFile(absolute);
      logger.debug(`Removed stale apm file: ${relativePath}`);
    }
  }

  // Always rewrite the lockfile (except under --frozen, which is a verify-only
  // mode). Even on a partially successful install we persist the union of
  // newly pinned entries and preserved previous entries so that first-ever
  // runs with mixed results still record the successful pins.
  if (!frozen) {
    newLock.generated_at = new Date().toISOString();
    await writeApmLock({ baseDir, lock: newLock });
    if (failedCount === 0) {
      logger.debug("apm.lock.yaml updated.");
    } else {
      logger.warn(
        `apm.lock.yaml written with partially successful installs (${failedCount} dep(s) failed).`,
      );
    }
  }

  return {
    dependenciesProcessed: manifest.dependencies.length,
    deployedFileCount: totalDeployed,
    failedDependencyCount: failedCount,
  };
}

async function installDependency(params: {
  dep: ApmDependency;
  client: GitHubClient;
  semaphore: Semaphore;
  baseDir: string;
  existingLock: ApmLock | null;
  frozen: boolean;
  update: boolean;
  logger: Logger;
}): Promise<{ lockEntry: ApmLockDependency; deployedFiles: string[] }> {
  const { dep, client, semaphore, baseDir, existingLock, frozen, update, logger } = params;
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

  // Collect (path, content) pairs before writing to disk. This lets us hash
  // them up-front and, under --frozen, refuse to overwrite good files with
  // tampered bytes. Under non-frozen we still write as we go for incremental
  // progress feedback on large dep trees.
  const deployed: Array<{ path: string; content: string }> = [];
  for (const primitive of APM_PRIMITIVES) {
    const remoteBase = dep.path
      ? toPosixPath(posix.join(dep.path, primitive.sourceDir))
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
      const relativeToBase = posix.relative(remoteBase, toPosixPath(file.path));
      if (!relativeToBase || relativeToBase.startsWith("..") || posix.isAbsolute(relativeToBase)) {
        logger.warn(
          `Skipping "${file.path}" from ${repoUrl}: resolved outside of "${remoteBase}".`,
        );
        continue;
      }
      const deployRelative = toPosixPath(join(primitive.deployDir, relativeToBase));
      checkPathTraversal({
        relativePath: deployRelative,
        intendedRootDir: baseDir,
      });
      const content = await withSemaphore(semaphore, () =>
        client.getFileContent(dep.owner, dep.repo, file.path, resolvedSha),
      );
      // The tree-listing size can lie (LFS pointers, filter-driver output),
      // so enforce the cap on the fetched bytes as well.
      const byteLength = Buffer.byteLength(content, "utf8");
      if (byteLength > MAX_FILE_SIZE) {
        logger.warn(
          `Skipping "${file.path}" from ${repoUrl}: fetched ${(byteLength / 1024 / 1024).toFixed(2)}MB exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit.`,
        );
        continue;
      }
      deployed.push({ path: deployRelative, content });
      if (!frozen) {
        await writeFileContent(join(baseDir, deployRelative), content);
      }
    }
  }

  deployed.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const deployedFiles = deployed.map((d) => d.path);
  const contentHash = computeContentHash(deployed);

  // Verify integrity against the lockfile when running frozen and the prior
  // lock recorded a hash. A mismatch means either the upstream content moved
  // under the same SHA (unlikely with git) or someone tampered with the
  // lockfile / deployed files. We do this *before* writing anything to disk
  // under --frozen so that tampered bytes never hit the filesystem.
  if (frozen && locked?.content_hash && locked.content_hash !== contentHash) {
    throw new Error(
      `content_hash mismatch for ${repoUrl}: lock=${locked.content_hash} computed=${contentHash}. Refuse to trust the deployment under --frozen.`,
    );
  }

  // Under --frozen we deferred all writes until after the hash check passed.
  if (frozen) {
    for (const { path: deployRelative, content } of deployed) {
      await writeFileContent(join(baseDir, deployRelative), content);
    }
  }

  const lockEntry: ApmLockDependency = {
    repo_url: repoUrl,
    resolved_commit: resolvedSha,
    resolved_ref: resolvedRef,
    depth: 1,
    package_type: "apm_package",
    content_hash: contentHash,
    deployed_files: deployedFiles,
  };
  if (dep.path) {
    lockEntry.virtual_path = dep.path;
  }

  logger.info(`Installed ${deployedFiles.length} file(s) from ${repoUrl}@${shortSha(resolvedSha)}`);

  return { lockEntry, deployedFiles };
}

/**
 * SHA-256 over a canonical, order-independent representation of the deployed
 * files. Written into `content_hash` so that `--frozen` installs can refuse
 * to trust tampered output.
 */
function computeContentHash(files: Array<{ path: string; content: string }>): string {
  const hash = createHash("sha256");
  for (const { path, content } of files) {
    hash.update(path);
    hash.update("\0");
    hash.update(content);
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
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
