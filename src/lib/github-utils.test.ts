import { Semaphore } from "es-toolkit/promise";
import { describe, expect, it, vi } from "vitest";

import type { GitHubFileEntry } from "../types/fetch.js";
import type { GitHubClient } from "./github-client.js";
import { listDirectoryRecursive, MAX_RECURSION_DEPTH, withSemaphore } from "./github-utils.js";

function fileEntry(path: string): GitHubFileEntry {
  return {
    name: path.split("/").at(-1) ?? path,
    path,
    sha: "sha",
    size: 10,
    type: "file",
    download_url: `https://example.com/${path}`,
  };
}

function dirEntry(path: string): GitHubFileEntry {
  return {
    name: path.split("/").at(-1) ?? path,
    path,
    sha: "sha",
    size: 0,
    type: "dir",
    download_url: null,
  };
}

/**
 * A client backed by a fixed directory tree. `incomplete` names the directories
 * whose listing the client reports as missing entries, the way the real one
 * does for a capped page or an item that did not parse.
 */
function createClient(params: {
  tree: Record<string, GitHubFileEntry[]>;
  incomplete?: string[];
}): GitHubClient {
  const { tree, incomplete = [] } = params;
  return {
    listDirectory: vi.fn(
      (
        _owner: string,
        _repo: string,
        path: string,
        _ref?: string,
        options?: { onIncompleteListing?: () => void },
      ) => {
        const entries = tree[path];
        if (entries === undefined) {
          return Promise.reject(new Error(`Unexpected path: ${path}`));
        }
        if (incomplete.includes(path)) {
          options?.onIncompleteListing?.();
        }
        return Promise.resolve(entries);
      },
    ),
  } as unknown as GitHubClient;
}

describe("withSemaphore", () => {
  it("should release the permit when the function throws", async () => {
    const semaphore = new Semaphore(1);

    await expect(withSemaphore(semaphore, () => Promise.reject(new Error("boom")))).rejects.toThrow(
      "boom",
    );

    // A permit that was never released would leave this waiting forever.
    await expect(withSemaphore(semaphore, () => Promise.resolve("ok"))).resolves.toBe("ok");
  });
});

describe("listDirectoryRecursive", () => {
  it("should collect files from every level", async () => {
    const client = createClient({
      tree: {
        skills: [fileEntry("skills/README.md"), dirEntry("skills/a")],
        "skills/a": [fileEntry("skills/a/SKILL.md"), dirEntry("skills/a/scripts")],
        "skills/a/scripts": [fileEntry("skills/a/scripts/run.py")],
      },
    });

    const files = await listDirectoryRecursive({
      client,
      owner: "owner",
      repo: "repo",
      path: "skills",
      semaphore: new Semaphore(4),
    });

    expect(files.map((file) => file.path).toSorted()).toEqual([
      "skills/README.md",
      "skills/a/SKILL.md",
      "skills/a/scripts/run.py",
    ]);
  });

  it("should not report a directory the client listed in full", async () => {
    const client = createClient({ tree: { skills: [fileEntry("skills/SKILL.md")] } });
    const onIncompleteDirectory = vi.fn();

    await listDirectoryRecursive({
      client,
      owner: "owner",
      repo: "repo",
      path: "skills",
      semaphore: new Semaphore(4),
      onIncompleteDirectory,
    });

    expect(onIncompleteDirectory).not.toHaveBeenCalled();
  });

  it("should report a directory whose listing the client cut short", async () => {
    const client = createClient({
      tree: {
        skills: [dirEntry("skills/a")],
        "skills/a": [fileEntry("skills/a/SKILL.md")],
      },
      incomplete: ["skills/a"],
    });
    const onIncompleteDirectory = vi.fn();

    const files = await listDirectoryRecursive({
      client,
      owner: "owner",
      repo: "repo",
      path: "skills",
      semaphore: new Semaphore(4),
      onIncompleteDirectory,
    });

    // The files that were listed are still returned; only the caller's view of
    // the directory as complete is withdrawn.
    expect(files.map((file) => file.path)).toEqual(["skills/a/SKILL.md"]);
    expect(onIncompleteDirectory).toHaveBeenCalledExactlyOnceWith("skills/a");
  });

  it("should report a directory holding an entry kind it cannot walk", async () => {
    const client = createClient({
      tree: {
        skills: [
          fileEntry("skills/SKILL.md"),
          { ...dirEntry("skills/vendor"), type: "submodule" as GitHubFileEntry["type"] },
        ],
      },
    });
    const onIncompleteDirectory = vi.fn();

    const files = await listDirectoryRecursive({
      client,
      owner: "owner",
      repo: "repo",
      path: "skills",
      semaphore: new Semaphore(4),
      onIncompleteDirectory,
    });

    expect(files.map((file) => file.path)).toEqual(["skills/SKILL.md"]);
    expect(onIncompleteDirectory).toHaveBeenCalledExactlyOnceWith("skills");
  });

  it("should throw once the tree is deeper than it walks", async () => {
    const tree: Record<string, GitHubFileEntry[]> = {};
    let path = "skills";
    for (let level = 0; level <= MAX_RECURSION_DEPTH + 1; level++) {
      const child = `${path}/d${level}`;
      tree[path] = [dirEntry(child)];
      path = child;
    }
    tree[path] = [fileEntry(`${path}/SKILL.md`)];

    await expect(
      listDirectoryRecursive({
        client: createClient({ tree }),
        owner: "owner",
        repo: "repo",
        path: "skills",
        semaphore: new Semaphore(4),
      }),
    ).rejects.toThrow(/Maximum recursion depth/);
  });
});
