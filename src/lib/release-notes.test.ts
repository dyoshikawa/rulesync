import { describe, expect, it, vi } from "vitest";

import type { GitHubRelease } from "../types/fetch.js";
import {
  DEFAULT_LATEST_COUNT,
  fetchReleaseNotes,
  formatReleaseNotesMarkdown,
  parseRepository,
  resolveReleaseNotesFilter,
  toReleaseNote,
} from "./release-notes.js";

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

function createClient(releases: GitHubRelease[]) {
  return {
    listReleases: vi.fn(
      ({
        page = 1,
        perPage = 100,
      }: {
        page?: number;
        perPage?: number;
      }): Promise<GitHubRelease[]> =>
        Promise.resolve(releases.slice((page - 1) * perPage, page * perPage)),
    ),
    getReleaseByTag: vi.fn(({ tag }: { tag: string }): Promise<GitHubRelease> => {
      const release = releases.find((item) => item.tag_name === tag);
      if (!release) {
        return Promise.reject(new Error(`Not found: ${tag}`));
      }
      return Promise.resolve(release);
    }),
  };
}

describe("resolveReleaseNotesFilter", () => {
  it("defaults to the latest ten releases", () => {
    expect(resolveReleaseNotesFilter({})).toEqual({
      kind: "latest",
      count: DEFAULT_LATEST_COUNT,
    });
  });

  it("parses --latest as a positive integer", () => {
    expect(resolveReleaseNotesFilter({ latest: "3" })).toEqual({ kind: "latest", count: 3 });
  });

  it("rejects non-positive and non-integer --latest values", () => {
    expect(() => resolveReleaseNotesFilter({ latest: "0" })).toThrow(/positive integer/);
    expect(() => resolveReleaseNotesFilter({ latest: "-2" })).toThrow(/positive integer/);
    expect(() => resolveReleaseNotesFilter({ latest: "2.5" })).toThrow(/positive integer/);
    expect(() => resolveReleaseNotesFilter({ latest: "many" })).toThrow(/positive integer/);
  });

  it("accepts one-sided and two-sided date ranges", () => {
    expect(resolveReleaseNotesFilter({ since: "2026-01-01" })).toEqual({
      kind: "dateRange",
      since: "2026-01-01",
      until: undefined,
    });
    expect(resolveReleaseNotesFilter({ since: "2026-01-01", until: "2026-06-30" })).toEqual({
      kind: "dateRange",
      since: "2026-01-01",
      until: "2026-06-30",
    });
  });

  it("rejects unparsable dates", () => {
    expect(() => resolveReleaseNotesFilter({ since: "yesterday" })).toThrow(/Invalid --since/);
    expect(() => resolveReleaseNotesFilter({ until: "2026-13-45" })).toThrow(/Invalid --until/);
  });

  it.each(["2026-02-29", "2026-02-30", "2026-04-31", "1900-02-29"])(
    "rejects the nonexistent calendar date %s for either date boundary",
    (date) => {
      expect(() => resolveReleaseNotesFilter({ since: date })).toThrow(/Invalid --since/);
      expect(() => resolveReleaseNotesFilter({ until: date })).toThrow(/Invalid --until/);
    },
  );

  it.each([
    "2026-02-30T00:00:00Z",
    "2026-02-30t00:00:00z",
    "2026-04-31T12:00:00+09:00",
    "2026-02-29T23:00:00-05:00",
  ])("rejects the timestamp %s whose calendar date does not exist", (timestamp) => {
    expect(() => resolveReleaseNotesFilter({ since: timestamp })).toThrow(/Invalid --since/);
    expect(() => resolveReleaseNotesFilter({ until: timestamp })).toThrow(/Invalid --until/);
  });

  it.each(["2024-02-29T00:00:00Z", "2026-03-01T01:00:00+09:00", "2026-02-28T23:00:00-05:00"])(
    "accepts the timestamp %s on a valid calendar date regardless of its offset",
    (timestamp) => {
      expect(resolveReleaseNotesFilter({ since: timestamp, until: timestamp })).toEqual({
        kind: "dateRange",
        since: timestamp,
        until: timestamp,
      });
    },
  );

  it.each(["2024-02-29", "2000-02-29", "2026-04-30", "0099-01-31"])(
    "accepts the valid calendar date %s",
    (date) => {
      expect(resolveReleaseNotesFilter({ since: date, until: date })).toEqual({
        kind: "dateRange",
        since: date,
        until: date,
      });
    },
  );

  it("preserves valid timestamp offsets and whitespace around date-only inputs", () => {
    expect(
      resolveReleaseNotesFilter({ since: "2026-01-01T00:30:00+02:00", until: " 2026-01-31 " }),
    ).toEqual({
      kind: "dateRange",
      since: "2026-01-01T00:30:00+02:00",
      until: " 2026-01-31 ",
    });
  });

  it("requires both ends of a version range", () => {
    expect(() => resolveReleaseNotesFilter({ from: "v1.0.0" })).toThrow(
      /Both --from and --to are required/,
    );
    expect(resolveReleaseNotesFilter({ from: "v1.0.0", to: "v2.0.0" })).toEqual({
      kind: "tagRange",
      from: "v1.0.0",
      to: "v2.0.0",
    });
  });

  it("rejects combinations of filter modes", () => {
    expect(() => resolveReleaseNotesFilter({ latest: "3", tag: "v1.0.0" })).toThrow(
      /Conflicting filter options/,
    );
    expect(() => resolveReleaseNotesFilter({ since: "2026-01-01", from: "v1.0.0" })).toThrow(
      /Conflicting filter options/,
    );
  });
});

describe("parseRepository", () => {
  it("parses the owner/repo shorthand and full URLs", () => {
    expect(parseRepository("dyoshikawa/rulesync")).toEqual({
      owner: "dyoshikawa",
      repo: "rulesync",
    });
    expect(parseRepository("https://github.com/dyoshikawa/rulesync")).toEqual({
      owner: "dyoshikawa",
      repo: "rulesync",
    });
  });

  it("rejects non-GitHub providers", () => {
    expect(() => parseRepository("gitlab:owner/repo")).toThrow(/GitHub repositories only/);
  });

  it("rejects ref and path suffixes instead of ignoring them", () => {
    expect(() => parseRepository("owner/repo@v1.0.0")).toThrow(/without a ref/);
    expect(() => parseRepository("owner/repo:docs")).toThrow(/without a ref/);
  });
});

describe("fetchReleaseNotes", () => {
  it("returns the latest N releases, excluding drafts and prereleases", async () => {
    const client = createClient([
      createRelease({ tag_name: "v3.0.0", draft: true }),
      createRelease({ tag_name: "v2.1.0-beta.1", prerelease: true }),
      createRelease({ tag_name: "v2.0.0" }),
      createRelease({ tag_name: "v1.0.0" }),
    ]);

    const releases = await fetchReleaseNotes({
      client,
      owner: "owner",
      repo: "repo",
      filter: { kind: "latest", count: 10 },
    });

    expect(releases.map((release) => release.tagName)).toEqual(["v2.0.0", "v1.0.0"]);
  });

  it("includes prereleases when requested", async () => {
    const client = createClient([
      createRelease({ tag_name: "v2.1.0-beta.1", prerelease: true }),
      createRelease({ tag_name: "v2.0.0" }),
    ]);

    const releases = await fetchReleaseNotes({
      client,
      owner: "owner",
      repo: "repo",
      filter: { kind: "latest", count: 10 },
      includePrereleases: true,
    });

    expect(releases.map((release) => release.tagName)).toEqual(["v2.1.0-beta.1", "v2.0.0"]);
  });

  it("stops fetching once the requested count is collected", async () => {
    const client = createClient([
      createRelease({ tag_name: "v3.0.0" }),
      createRelease({ tag_name: "v2.0.0" }),
      createRelease({ tag_name: "v1.0.0" }),
    ]);

    const releases = await fetchReleaseNotes({
      client,
      owner: "owner",
      repo: "repo",
      filter: { kind: "latest", count: 2 },
    });

    expect(releases.map((release) => release.tagName)).toEqual(["v3.0.0", "v2.0.0"]);
    expect(client.listReleases).toHaveBeenCalledTimes(1);
  });

  it("selects releases published within a date range", async () => {
    const client = createClient([
      createRelease({ tag_name: "v3.0.0", published_at: "2026-07-01T00:00:00Z" }),
      createRelease({ tag_name: "v2.0.0", published_at: "2026-03-15T00:00:00Z" }),
      createRelease({ tag_name: "v1.0.0", published_at: "2025-12-31T00:00:00Z" }),
    ]);

    const releases = await fetchReleaseNotes({
      client,
      owner: "owner",
      repo: "repo",
      filter: { kind: "dateRange", since: "2026-01-01", until: "2026-06-30" },
    });

    expect(releases.map((release) => release.tagName)).toEqual(["v2.0.0"]);
  });

  it("includes releases published on the --until day itself", async () => {
    const client = createClient([
      createRelease({ tag_name: "v2.0.0", published_at: "2026-08-13T14:20:00Z" }),
      createRelease({ tag_name: "v1.0.0", published_at: "2026-08-13T02:05:00Z" }),
    ]);

    const releases = await fetchReleaseNotes({
      client,
      owner: "owner",
      repo: "repo",
      filter: { kind: "dateRange", since: "2026-08-13", until: "2026-08-13" },
    });

    expect(releases.map((release) => release.tagName)).toEqual(["v2.0.0", "v1.0.0"]);
  });

  it("keeps in-window releases that follow an older one in the listing order", async () => {
    // The API orders releases by creation date, so a hotfix published from a
    // long-lived branch can appear after older releases.
    const client = createClient([
      createRelease({ tag_name: "v3.0.0", published_at: "2026-06-01T00:00:00Z" }),
      createRelease({ tag_name: "v2.0.0", published_at: "2025-01-01T00:00:00Z" }),
      createRelease({ tag_name: "v1.0.1", published_at: "2026-05-01T00:00:00Z" }),
    ]);

    const releases = await fetchReleaseNotes({
      client,
      owner: "owner",
      repo: "repo",
      filter: { kind: "dateRange", since: "2026-01-01" },
    });

    expect(releases.map((release) => release.tagName)).toEqual(["v3.0.0", "v1.0.1"]);
  });

  it("fetches a single release by tag even when it is a prerelease", async () => {
    const client = createClient([
      createRelease({ tag_name: "v2.1.0-beta.1", prerelease: true }),
      createRelease({ tag_name: "v2.0.0" }),
    ]);

    const releases = await fetchReleaseNotes({
      client,
      owner: "owner",
      repo: "repo",
      filter: { kind: "singleTag", tag: "v2.1.0-beta.1" },
    });

    expect(releases.map((release) => release.tagName)).toEqual(["v2.1.0-beta.1"]);
    expect(client.listReleases).not.toHaveBeenCalled();
  });

  it("returns every release between two tags, inclusive, in either order", async () => {
    const client = createClient([
      createRelease({ tag_name: "release-4" }),
      createRelease({ tag_name: "release-3" }),
      createRelease({ tag_name: "release-2" }),
      createRelease({ tag_name: "release-1" }),
    ]);

    const ascending = await fetchReleaseNotes({
      client,
      owner: "owner",
      repo: "repo",
      filter: { kind: "tagRange", from: "release-1", to: "release-3" },
    });
    const descending = await fetchReleaseNotes({
      client,
      owner: "owner",
      repo: "repo",
      filter: { kind: "tagRange", from: "release-3", to: "release-1" },
    });

    const expected = ["release-3", "release-2", "release-1"];
    expect(ascending.map((release) => release.tagName)).toEqual(expected);
    expect(descending.map((release) => release.tagName)).toEqual(expected);
  });

  it("reports a tag range boundary that does not exist", async () => {
    const client = createClient([createRelease({ tag_name: "v1.0.0" })]);

    await expect(
      fetchReleaseNotes({
        client,
        owner: "owner",
        repo: "repo",
        filter: { kind: "tagRange", from: "v1.0.0", to: "v9.9.9" },
      }),
    ).rejects.toThrow(/Release tag "v9.9.9" was not found/);
  });

  it("returns an empty list for a repository without releases", async () => {
    const client = createClient([]);

    const releases = await fetchReleaseNotes({
      client,
      owner: "owner",
      repo: "repo",
      filter: { kind: "latest", count: 10 },
    });

    expect(releases).toEqual([]);
  });

  it("paginates until the requested count is reached", async () => {
    const many = Array.from({ length: 150 }, (_, index) =>
      createRelease({ tag_name: `v0.0.${150 - index}` }),
    );
    const client = createClient(many);

    const releases = await fetchReleaseNotes({
      client,
      owner: "owner",
      repo: "repo",
      filter: { kind: "latest", count: 120 },
    });

    expect(releases).toHaveLength(120);
    expect(client.listReleases).toHaveBeenCalledTimes(2);
  });
});

describe("formatReleaseNotesMarkdown", () => {
  it("renders tag, title, date, and body for each release", () => {
    const markdown = formatReleaseNotesMarkdown({
      owner: "owner",
      repo: "repo",
      releases: [
        toReleaseNote(
          createRelease({
            tag_name: "v2.0.0",
            name: "Second major",
            published_at: "2026-03-15T09:30:00Z",
            body: "- Added things",
          }),
        ),
        toReleaseNote(
          createRelease({
            tag_name: "v2.1.0-beta.1",
            prerelease: true,
            body: null,
          }),
        ),
      ],
    });

    expect(markdown).toContain("# Release notes for owner/repo");
    expect(markdown).toContain("## v2.0.0 — Second major");
    expect(markdown).toContain("Published: 2026-03-15");
    expect(markdown).toContain("- Added things");
    expect(markdown).toContain("Prerelease");
    expect(markdown).toContain("_No release notes._");
    expect(markdown.endsWith("\n")).toBe(true);
  });

  it("omits the title when it merely repeats the tag", () => {
    const markdown = formatReleaseNotesMarkdown({
      owner: "owner",
      repo: "repo",
      releases: [toReleaseNote(createRelease({ tag_name: "v1.0.0", name: "v1.0.0" }))],
    });

    expect(markdown).toContain("## v1.0.0\n");
    expect(markdown).not.toContain("v1.0.0 — v1.0.0");
  });

  it("strips terminal control sequences from remote tag names, names and bodies", () => {
    const markdown = formatReleaseNotesMarkdown({
      owner: "owner",
      repo: "repo",
      releases: [
        toReleaseNote(
          createRelease({
            tag_name: "v1.0.0\u001b[2K",
            name: "Title\u001b]0;pwned\u0007",
            body: "Line one\r\n\u001b]52;c;Y2xpcA==\u0007- item\n\tcode\u009b31m\u202e",
          }),
        ),
      ],
    });

    expect(markdown).toContain("## v1.0.0[2K — Title]0;pwned\n");
    expect(markdown).toContain("Line one\n]52;c;Y2xpcA==- item\n\tcode31m\n");
    // oxlint-disable-next-line no-control-regex
    expect(markdown).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202e]/);
  });
});
