import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GitHubClientError } from "../../lib/github-client.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import type { GitHubRelease } from "../../types/fetch.js";
import { CLIError } from "../../types/json-output.js";
import { releaseNotesCommand } from "./release-notes.js";

const listReleases = vi.fn<() => Promise<GitHubRelease[]>>();
const getReleaseByTag = vi.fn<() => Promise<GitHubRelease>>();

vi.mock("../../lib/github-client.js", async () => {
  const actual = await vi.importActual<typeof import("../../lib/github-client.js")>(
    "../../lib/github-client.js",
  );
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

function createRelease(overrides: Partial<GitHubRelease> & { tag_name: string }): GitHubRelease {
  return {
    name: overrides.tag_name,
    prerelease: false,
    draft: false,
    assets: [],
    published_at: "2026-01-01T00:00:00Z",
    body: "Body",
    html_url: `https://github.com/owner/repo/releases/tag/${overrides.tag_name}`,
    ...overrides,
  };
}

let stdout: string[] = [];

beforeEach(() => {
  stdout = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    stdout.push(String(chunk));
    return true;
  });
  listReleases.mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("releaseNotesCommand", () => {
  it("prints the latest releases as Markdown", async () => {
    listReleases.mockResolvedValueOnce([
      createRelease({ tag_name: "v2.0.0", name: "Second major", body: "- Added things" }),
      createRelease({ tag_name: "v1.0.0" }),
    ]);

    await releaseNotesCommand(createMockLogger(), { source: "owner/repo" });

    const output = stdout.join("");
    expect(output).toContain("# Release notes for owner/repo");
    expect(output).toContain("## v2.0.0 — Second major");
    expect(output).toContain("- Added things");
    expect(output).toContain("## v1.0.0");
  });

  it("fetches a single release by tag with --tag", async () => {
    getReleaseByTag.mockResolvedValueOnce(createRelease({ tag_name: "v1.2.3" }));

    await releaseNotesCommand(createMockLogger(), { source: "owner/repo", tag: "v1.2.3" });

    expect(getReleaseByTag).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      tag: "v1.2.3",
    });
    expect(stdout.join("")).toContain("## v1.2.3");
  });

  it("captures structured data and prints nothing raw in JSON mode", async () => {
    listReleases.mockResolvedValueOnce([createRelease({ tag_name: "v1.0.0" })]);
    const logger = { ...createMockLogger(), jsonMode: true };

    await releaseNotesCommand(logger, { source: "owner/repo" });

    expect(stdout).toEqual([]);
    expect(logger.captureData).toHaveBeenCalledWith("repository", "owner/repo");
    expect(logger.captureData).toHaveBeenCalledWith("totalReleases", 1);
    expect(logger.captureData).toHaveBeenCalledWith(
      "releases",
      expect.arrayContaining([expect.objectContaining({ tagName: "v1.0.0" })]),
    );
  });

  it("warns instead of failing when a repository has no releases", async () => {
    const logger = createMockLogger();

    await releaseNotesCommand(logger, { source: "owner/repo" });

    expect(logger.warn).toHaveBeenCalledWith("No releases found for owner/repo.");
    expect(stdout).toEqual([]);
  });

  it("rejects conflicting filter options before calling the API", async () => {
    await expect(
      releaseNotesCommand(createMockLogger(), {
        source: "owner/repo",
        latest: "3",
        tag: "v1.0.0",
      }),
    ).rejects.toThrow(/Conflicting filter options/);
    expect(listReleases).not.toHaveBeenCalled();
  });

  it("wraps GitHub API errors in a CLIError with an auth hint", async () => {
    listReleases.mockRejectedValueOnce(new GitHubClientError("Not found: repo", 404));

    await expect(
      releaseNotesCommand(createMockLogger(), { source: "owner/repo" }),
    ).rejects.toMatchObject({
      code: "RELEASE_NOTES_FAILED",
    });

    listReleases.mockRejectedValueOnce(
      new GitHubClientError("GitHub API rate limit exceeded.", 403),
    );
    const error = await releaseNotesCommand(createMockLogger(), { source: "owner/repo" }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(CLIError);
    expect((error as CLIError).message).toContain("GITHUB_TOKEN");
  });
});
