import { afterEach, describe, expect, it, vi } from "vitest";

import type { GitHubRelease } from "../types/fetch.js";
import { executeReleaseNotes } from "./release-notes.js";

const listReleases = vi.fn<() => Promise<GitHubRelease[]>>();
const getReleaseByTag = vi.fn<() => Promise<GitHubRelease>>();

vi.mock("../lib/github-client.js", async () => {
  const actual =
    await vi.importActual<typeof import("../lib/github-client.js")>("../lib/github-client.js");
  return {
    ...actual,
    GitHubClient: class MockGitHubClient {
      static resolveToken(): undefined {
        return undefined;
      }

      readonly listReleases = listReleases;
      readonly getReleaseByTag = getReleaseByTag;
    },
  };
});

function createRelease(tagName: string): GitHubRelease {
  return {
    tag_name: tagName,
    name: tagName,
    prerelease: false,
    draft: false,
    assets: [],
    published_at: "2026-01-01T00:00:00Z",
    body: `Notes for ${tagName}`,
    html_url: `https://github.com/owner/repo/releases/tag/${tagName}`,
  };
}

describe("executeReleaseNotes", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns the releases as data without writing to stdout", async () => {
    listReleases.mockResolvedValue([createRelease("v2.0.0"), createRelease("v1.0.0")]);
    const write = vi.spyOn(process.stdout, "write");

    try {
      const result = await executeReleaseNotes({ source: "owner/repo", latest: 1 });

      expect(result.success).toBe(true);
      expect(result.result?.repository).toBe("owner/repo");
      expect(result.result?.totalReleases).toBe(1);
      expect(result.result?.releases).toEqual([
        expect.objectContaining({ tagName: "v2.0.0", body: "Notes for v2.0.0" }),
      ]);
      expect(write).not.toHaveBeenCalled();
    } finally {
      write.mockRestore();
    }
  });

  it("returns a single release by tag", async () => {
    getReleaseByTag.mockResolvedValue(createRelease("v1.0.0"));

    const result = await executeReleaseNotes({ source: "owner/repo", tag: "v1.0.0" });

    expect(result.success).toBe(true);
    expect(result.result?.releases).toEqual([expect.objectContaining({ tagName: "v1.0.0" })]);
  });

  it("fails for an invalid repository", async () => {
    const result = await executeReleaseNotes({ source: "not a repo" });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});
