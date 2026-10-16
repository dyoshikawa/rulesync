import type { GitHubFileEntry } from "../types/fetch.js";
import { GitHubClient } from "./github-client.js";

type ListDirectoryOptions = { onIncompleteListing?: () => void };

type ListedDirectory = { entries: GitHubFileEntry[]; incomplete: boolean };

/** Hand back the held answer for `key`, or start `request` and hold its promise. */
function memoize<T>(params: {
  answers: Map<string, Promise<T>>;
  key: Array<string | null>;
  request: () => Promise<T>;
}): Promise<T> {
  const { answers, key, request } = params;
  const cacheKey = JSON.stringify(key);
  const held = answers.get(cacheKey);
  if (held !== undefined) {
    return held;
  }
  const pending = request();
  answers.set(cacheKey, pending);
  return pending;
}

/**
 * A GitHub client that answers each distinct read request once per instance.
 *
 * `rulesync install` downloads the sources concurrently ahead of the serial
 * pass that writes them, and the serial pass then asks for the same refs,
 * listings and files again. Holding the first answer -- the promise, so a
 * request still in flight is shared rather than duplicated -- lets the serial
 * pass keep its order-sensitive logic unchanged while its network calls are
 * already settled. A rejected request is held too: the serial pass then reports
 * the same error once, instead of retrying a request that was just refused.
 *
 * The answers live only as long as the instance, which is one install run.
 */
export class MemoizingGitHubClient extends GitHubClient {
  private readonly defaultBranches = new Map<string, Promise<string>>();
  private readonly resolvedShas = new Map<string, Promise<string>>();
  private readonly fileContents = new Map<string, Promise<string>>();
  private readonly executablePaths = new Map<
    string,
    Promise<{ paths: Set<string>; truncated: boolean }>
  >();
  private readonly directories = new Map<string, Promise<ListedDirectory>>();

  override getDefaultBranch(owner: string, repo: string): Promise<string> {
    return memoize({
      answers: this.defaultBranches,
      key: [owner, repo],
      request: () => super.getDefaultBranch(owner, repo),
    });
  }

  override resolveRefToSha(owner: string, repo: string, ref: string): Promise<string> {
    return memoize({
      answers: this.resolvedShas,
      key: [owner, repo, ref],
      request: () => super.resolveRefToSha(owner, repo, ref),
    });
  }

  override getFileContent(
    owner: string,
    repo: string,
    path: string,
    ref?: string,
  ): Promise<string> {
    return memoize({
      answers: this.fileContents,
      key: [owner, repo, path, ref ?? null],
      request: () => super.getFileContent(owner, repo, path, ref),
    });
  }

  override listExecutablePaths(
    owner: string,
    repo: string,
    ref: string,
  ): Promise<{ paths: Set<string>; truncated: boolean }> {
    return memoize({
      answers: this.executablePaths,
      key: [owner, repo, ref],
      request: () => super.listExecutablePaths(owner, repo, ref),
    });
  }

  /**
   * A caller that asks to hear about an incomplete listing is answered from its
   * own entry, recorded with that report, and replayed to every later caller
   * that asks the same; a caller that does not ask gets the request it would
   * have made on the plain client.
   */
  override async listDirectory(
    owner: string,
    repo: string,
    path: string,
    ref?: string,
    options?: ListDirectoryOptions,
  ): Promise<GitHubFileEntry[]> {
    if (options === undefined) {
      const listed = await memoize({
        answers: this.directories,
        key: [owner, repo, path, ref ?? null, "plain"],
        request: async () => ({
          entries: await super.listDirectory(owner, repo, path, ref),
          incomplete: false,
        }),
      });
      return listed.entries;
    }
    const listed = await memoize({
      answers: this.directories,
      key: [owner, repo, path, ref ?? null, "tracked"],
      request: async () => {
        let incomplete = false;
        const entries = await super.listDirectory(owner, repo, path, ref, {
          onIncompleteListing: () => {
            incomplete = true;
          },
        });
        return { entries, incomplete };
      },
    });
    if (listed.incomplete) {
      options.onIncompleteListing?.();
    }
    return listed.entries;
  }
}
