import { Semaphore } from "es-toolkit/promise";

import type { GitHubFileEntry } from "../types/fetch.js";
import type { GitHubClient } from "./github-client.js";

/**
 * How many directory levels below the requested path the walk descends.
 * Exported so a consumer that walks the fetched tree locally can stop at the
 * same place, rather than below anything that could have been fetched.
 */
export const MAX_RECURSION_DEPTH = 15;

/**
 * Execute an async function with semaphore-controlled concurrency.
 * Ensures the semaphore permit is always released, even if the function throws.
 */
export async function withSemaphore<T>(semaphore: Semaphore, fn: () => Promise<T>): Promise<T> {
  await semaphore.acquire();
  try {
    return await fn();
  } finally {
    semaphore.release();
  }
}

/**
 * Recursively list all files in a GitHub directory.
 */
export async function listDirectoryRecursive(params: {
  client: GitHubClient;
  owner: string;
  repo: string;
  path: string;
  ref?: string;
  depth?: number;
  semaphore: Semaphore;
  /**
   * Called with the path of a directory whose listing is known to be missing
   * entries. A caller that only consumes the files it got back can ignore this;
   * a caller that treats the result as the remote directory's complete content
   * must not, because the missing entries are indistinguishable from entries
   * the remote never had.
   */
  onIncompleteDirectory?: (remoteDirPath: string) => void;
}): Promise<GitHubFileEntry[]> {
  const { client, owner, repo, path, ref, depth = 0, semaphore, onIncompleteDirectory } = params;

  if (depth > MAX_RECURSION_DEPTH) {
    throw new Error(
      `Maximum recursion depth (${MAX_RECURSION_DEPTH}) exceeded while listing directory: ${path}`,
    );
  }

  // Symlinks and submodules are the entry kinds this walk has no counterpart
  // for, so they are dropped rather than descended into. The client reports the
  // entries it dropped itself — a capped page, or an item that did not parse.
  let dropped = false;

  // Semaphore is released here before recursive Promise.all below to avoid deadlock
  const entries = await withSemaphore(semaphore, () =>
    client.listDirectory(owner, repo, path, ref, {
      onIncompleteListing: () => {
        dropped = true;
      },
    }),
  );

  const files: GitHubFileEntry[] = [];
  const directories: GitHubFileEntry[] = [];

  for (const entry of entries) {
    if (entry.type === "file") {
      files.push(entry);
    } else if (entry.type === "dir") {
      directories.push(entry);
    } else {
      dropped = true;
    }
  }

  if (dropped) {
    onIncompleteDirectory?.(path);
  }

  const subResults = await Promise.all(
    directories.map((dir) =>
      listDirectoryRecursive({
        client,
        owner,
        repo,
        path: dir.path,
        ref,
        depth: depth + 1,
        semaphore,
        onIncompleteDirectory,
      }),
    ),
  );

  return [...files, ...subResults.flat()];
}
