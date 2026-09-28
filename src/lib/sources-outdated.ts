import type { SourceEntry } from "../config/config.js";
import type { ParsedSource } from "../types/fetch.js";
import { formatError } from "../utils/error.js";
import type { Logger } from "../utils/logger.js";
import { GitHubClient } from "./github-client.js";
import {
  DEFAULT_NPM_REGISTRY_URL,
  fetchPackument,
  resolveNpmToken,
  resolvePackumentVersion,
  validateNpmPackageName,
  validateNpmRegistryUrl,
} from "./npm-client.js";
import { getNpmLockedSource, readNpmLockFile } from "./npm-sources-lock.js";
import { parseSource } from "./source-parser.js";
import { getLockedSource, readLockFile } from "./sources-lock.js";
import { resolveGitSourceRef, resolveGithubFetchRef, resolveNpmFetchVersion } from "./sources.js";

export type OutdatedSourceStatus = "up-to-date" | "outdated" | "not-locked" | "failed";

export type OutdatedSourceReport = {
  source: string;
  transport: "github" | "git" | "npm";
  status: OutdatedSourceStatus;
  /** Ref or version the source is resolved from (declared ref, default branch, or `latest`). */
  requestedRef?: string;
  /** Commit SHA (git/github) or package version (npm) recorded in the lockfile. */
  lockedRef?: string;
  /** Commit SHA (git/github) or package version (npm) the source resolves to now. */
  latestRef?: string;
  /** Resolution error message when `status` is `failed`. */
  error?: string;
};

/**
 * Report, without writing anything, whether each declared source's lockfile
 * entry is behind what `rulesync install --update` would resolve it to now.
 * Resolution mirrors `--update`: the declared `ref` (or the default branch /
 * npm `latest` dist-tag when none is declared) is re-resolved against the
 * remote and compared with the locked commit SHA or package version.
 */
export async function checkOutdatedSources(params: {
  sources: SourceEntry[];
  projectRoot: string;
  token?: string;
  logger: Logger;
}): Promise<OutdatedSourceReport[]> {
  const { sources, projectRoot, logger } = params;
  const lock = await readLockFile({ projectRoot, logger });
  const npmLock = await readNpmLockFile({ projectRoot, logger });
  const client = new GitHubClient({ token: GitHubClient.resolveToken(params.token) });

  const reports: OutdatedSourceReport[] = [];
  for (const sourceEntry of sources) {
    const transport = sourceEntry.transport ?? "github";
    const lockedRef =
      transport === "npm"
        ? getNpmLockedSource(npmLock, sourceEntry.source)?.resolvedVersion
        : getLockedSource(lock, sourceEntry.source)?.resolvedRef;
    try {
      const { requestedRef, latestRef } = await resolveLatestRef({ sourceEntry, client, logger });
      reports.push({
        source: sourceEntry.source,
        transport,
        status:
          lockedRef === undefined
            ? "not-locked"
            : lockedRef === latestRef
              ? "up-to-date"
              : "outdated",
        requestedRef,
        ...(lockedRef !== undefined && { lockedRef }),
        latestRef,
      });
    } catch (error) {
      reports.push({
        source: sourceEntry.source,
        transport,
        status: "failed",
        ...(lockedRef !== undefined && { lockedRef }),
        error: formatError(error),
      });
    }
  }
  return reports;
}

async function resolveLatestRef(params: {
  sourceEntry: SourceEntry;
  client: GitHubClient;
  logger: Logger;
}): Promise<{ requestedRef: string; latestRef: string }> {
  const { sourceEntry, client, logger } = params;
  const transport = sourceEntry.transport ?? "github";

  if (transport === "npm") {
    const packageName = sourceEntry.source;
    validateNpmPackageName(packageName);
    const registryUrl = sourceEntry.registry ?? DEFAULT_NPM_REGISTRY_URL;
    validateNpmRegistryUrl(registryUrl, { logger });
    const token = resolveNpmToken({ tokenEnv: sourceEntry.tokenEnv });
    const requestedRef =
      resolveNpmFetchVersion({ sourceEntry, locked: undefined, updateSources: true })
        .requestedVersion ?? "latest";
    const packument = await fetchPackument({ registryUrl, packageName, token });
    const latestRef = resolvePackumentVersion({ packument, packageName, requested: requestedRef });
    return { requestedRef, latestRef };
  }

  if (transport === "git") {
    const { requestedRef, resolvedSha } = await resolveGitSourceRef(sourceEntry);
    return { requestedRef, latestRef: resolvedSha };
  }

  const parsedFromSource = parseSource(sourceEntry.source);
  const parsed: ParsedSource = {
    ...parsedFromSource,
    ref: sourceEntry.ref ?? parsedFromSource.ref,
  };
  if (parsed.provider === "gitlab") {
    throw new Error(`GitLab sources are not yet supported: "${sourceEntry.source}".`);
  }
  const { resolvedSha, requestedRef } = await resolveGithubFetchRef({
    parsed,
    locked: undefined,
    updateSources: true,
    sourceKey: sourceEntry.source,
    client,
    logger,
  });
  // With `locked: undefined`, `resolveGithubFetchRef` always resolves a requested ref.
  return { requestedRef: requestedRef ?? resolvedSha, latestRef: resolvedSha };
}
