import type { GitHubRelease } from "../types/fetch.js";
import { parseSource } from "./source-parser.js";

/** Number of releases printed when no filter option is given. */
export const DEFAULT_LATEST_COUNT = 10;

/** Releases requested per API page. */
const RELEASES_PER_PAGE = 100;

/**
 * Upper bound on API pages walked for range queries, so a repository with a
 * very long release history cannot make the command loop unbounded.
 */
export const MAX_RELEASE_PAGES = 10;

export type ReleaseNotesFilter =
  | { kind: "latest"; count: number }
  | { kind: "dateRange"; since?: string; until?: string }
  | { kind: "singleTag"; tag: string }
  | { kind: "tagRange"; from: string; to: string };

export type ReleaseNotesOptions = {
  latest?: string;
  since?: string;
  until?: string;
  tag?: string;
  from?: string;
  to?: string;
  includePrereleases?: boolean;
};

/** A release reduced to the fields the command reports. */
export type ReleaseNote = {
  tagName: string;
  name: string | null;
  publishedAt: string | null;
  prerelease: boolean;
  url: string | null;
  body: string | null;
};

/**
 * Parse a `YYYY-MM-DD` or full ISO 8601 date into a timestamp, or return null
 * when the input is not a valid date.
 */
function parseDate(value: string): number | null {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

/** A bare `YYYY-MM-DD` with no time part. */
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse the inclusive end of a date range. A bare `YYYY-MM-DD` parses as
 * midnight UTC, which would drop every release published later that same day,
 * so a date-only `--until` is stretched to the end of that day.
 */
function parseUntilDate(value: string): number | null {
  if (DATE_ONLY_PATTERN.test(value.trim())) {
    return parseDate(`${value.trim()}T23:59:59.999Z`);
  }
  return parseDate(value);
}

function parseLatestCount(raw: string): number {
  if (!/^\d+$/.test(raw.trim())) {
    throw new Error(`Invalid --latest value "${raw}". Expected a positive integer.`);
  }
  const count = Number.parseInt(raw, 10);
  if (count < 1) {
    throw new Error(`Invalid --latest value "${raw}". Expected a positive integer.`);
  }
  return count;
}

/**
 * Decide which filtering mode the given options describe. The four modes are
 * mutually exclusive; combining them is an error.
 */
export function resolveReleaseNotesFilter(options: ReleaseNotesOptions): ReleaseNotesFilter {
  const usedModes: string[] = [];
  if (options.latest !== undefined) usedModes.push("--latest");
  if (options.since !== undefined || options.until !== undefined) usedModes.push("--since/--until");
  if (options.tag !== undefined) usedModes.push("--tag");
  if (options.from !== undefined || options.to !== undefined) usedModes.push("--from/--to");

  if (usedModes.length > 1) {
    throw new Error(
      `Conflicting filter options: ${usedModes.join(", ")}. Use only one of --latest, --since/--until, --tag, or --from/--to.`,
    );
  }

  if (options.latest !== undefined) {
    return { kind: "latest", count: parseLatestCount(options.latest) };
  }

  if (options.since !== undefined || options.until !== undefined) {
    for (const [flag, value] of [
      ["--since", options.since],
      ["--until", options.until],
    ] as const) {
      if (value !== undefined && parseDate(value) === null) {
        throw new Error(`Invalid ${flag} value "${value}". Expected a date such as 2026-01-31.`);
      }
    }
    return { kind: "dateRange", since: options.since, until: options.until };
  }

  if (options.tag !== undefined) {
    return { kind: "singleTag", tag: options.tag };
  }

  if (options.from !== undefined || options.to !== undefined) {
    if (options.from === undefined || options.to === undefined) {
      throw new Error("Both --from and --to are required to select a version range.");
    }
    return { kind: "tagRange", from: options.from, to: options.to };
  }

  return { kind: "latest", count: DEFAULT_LATEST_COUNT };
}

/**
 * Split `owner/repo` (or any source form the fetch command accepts) into its
 * GitHub coordinates. Non-GitHub providers have no Releases API equivalent.
 */
export function parseRepository(source: string): { owner: string; repo: string } {
  const parsed = parseSource(source);
  if (parsed.provider !== "github") {
    throw new Error(
      `The release-notes command supports GitHub repositories only, but "${source}" resolves to ${parsed.provider}.`,
    );
  }
  if (parsed.ref !== undefined || parsed.path !== undefined) {
    throw new Error(
      `Invalid repository "${source}". Expected owner/repo without a ref ("@") or path (":") suffix; use --tag to select a single release.`,
    );
  }
  return { owner: parsed.owner, repo: parsed.repo };
}

export function toReleaseNote(release: GitHubRelease): ReleaseNote {
  return {
    tagName: release.tag_name,
    name: release.name ?? null,
    publishedAt: release.published_at ?? null,
    prerelease: release.prerelease,
    url: release.html_url ?? null,
    body: release.body ?? null,
  };
}

/**
 * Drafts are never reported: they are unpublished and only visible to users
 * with write access. Prereleases are excluded unless explicitly requested,
 * matching how GitHub itself resolves the "latest" release.
 */
function isReportable(release: GitHubRelease, includePrereleases: boolean): boolean {
  if (release.draft) {
    return false;
  }
  return includePrereleases || !release.prerelease;
}

type ReleaseLister = {
  listReleases(params: {
    owner: string;
    repo: string;
    perPage?: number;
    page?: number;
  }): Promise<GitHubRelease[]>;
  getReleaseByTag(params: { owner: string; repo: string; tag: string }): Promise<GitHubRelease>;
};

/**
 * Walk the releases API page by page, feeding every release to `visit`. The
 * walk stops when `visit` returns false, when a short page signals the end of
 * the history, or when the page cap is reached.
 */
async function walkReleases(params: {
  client: ReleaseLister;
  owner: string;
  repo: string;
  visit: (release: GitHubRelease) => boolean;
}): Promise<void> {
  const { client, owner, repo, visit } = params;
  for (let page = 1; page <= MAX_RELEASE_PAGES; page++) {
    const releases = await client.listReleases({
      owner,
      repo,
      perPage: RELEASES_PER_PAGE,
      page,
    });
    for (const release of releases) {
      if (!visit(release)) {
        return;
      }
    }
    if (releases.length < RELEASES_PER_PAGE) {
      return;
    }
  }
}

async function collectLatest(params: {
  client: ReleaseLister;
  owner: string;
  repo: string;
  count: number;
  includePrereleases: boolean;
}): Promise<GitHubRelease[]> {
  const { client, owner, repo, count, includePrereleases } = params;
  const collected: GitHubRelease[] = [];
  await walkReleases({
    client,
    owner,
    repo,
    visit: (release) => {
      if (isReportable(release, includePrereleases)) {
        collected.push(release);
      }
      return collected.length < count;
    },
  });
  return collected;
}

async function collectDateRange(params: {
  client: ReleaseLister;
  owner: string;
  repo: string;
  since?: string;
  until?: string;
  includePrereleases: boolean;
}): Promise<GitHubRelease[]> {
  const { client, owner, repo, since, until, includePrereleases } = params;
  const sinceTime = since === undefined ? undefined : parseDate(since);
  const untilTime = until === undefined ? undefined : parseUntilDate(until);
  const collected: GitHubRelease[] = [];

  await walkReleases({
    client,
    owner,
    repo,
    visit: (release) => {
      if (!isReportable(release, includePrereleases)) {
        return true;
      }
      const publishedAt = release.published_at ?? null;
      if (publishedAt === null) {
        return true;
      }
      const publishedTime = parseDate(publishedAt);
      if (publishedTime === null) {
        return true;
      }
      if (untilTime !== undefined && untilTime !== null && publishedTime > untilTime) {
        return true;
      }
      if (sinceTime !== undefined && sinceTime !== null && publishedTime < sinceTime) {
        // The API orders releases by creation date, not publication date, so an
        // older-looking release can still be followed by one inside the window
        // (a hotfix published from a long-lived branch). The walk therefore runs
        // to the end of the history, bounded by the page cap.
        return true;
      }
      collected.push(release);
      return true;
    },
  });

  return collected;
}

async function collectTagRange(params: {
  client: ReleaseLister;
  owner: string;
  repo: string;
  from: string;
  to: string;
  includePrereleases: boolean;
}): Promise<GitHubRelease[]> {
  const { client, owner, repo, from, to, includePrereleases } = params;
  const history: GitHubRelease[] = [];
  const boundaries = new Set([from, to]);
  const seenBoundaries = new Set<string>();

  await walkReleases({
    client,
    owner,
    repo,
    visit: (release) => {
      history.push(release);
      if (boundaries.has(release.tag_name)) {
        seenBoundaries.add(release.tag_name);
      }
      // Both ends found: the slice between them is fully loaded.
      return seenBoundaries.size < boundaries.size;
    },
  });

  for (const tag of boundaries) {
    if (!seenBoundaries.has(tag)) {
      throw new Error(
        `Release tag "${tag}" was not found in ${owner}/${repo} within the most recent ${MAX_RELEASE_PAGES * RELEASES_PER_PAGE} releases.`,
      );
    }
  }

  // Tags are compared by their position in the release history rather than by
  // semver, so non-semver tag names work and --from/--to order does not matter.
  const firstIndex = history.findIndex((release) => release.tag_name === from);
  const secondIndex = history.findIndex((release) => release.tag_name === to);
  const start = Math.min(firstIndex, secondIndex);
  const end = Math.max(firstIndex, secondIndex);

  return history
    .slice(start, end + 1)
    .filter((release) => isReportable(release, includePrereleases));
}

/**
 * Fetch the releases selected by `filter`, newest first.
 */
export async function fetchReleaseNotes(params: {
  client: ReleaseLister;
  owner: string;
  repo: string;
  filter: ReleaseNotesFilter;
  includePrereleases?: boolean;
}): Promise<ReleaseNote[]> {
  const { client, owner, repo, filter, includePrereleases = false } = params;

  switch (filter.kind) {
    case "latest": {
      const releases = await collectLatest({
        client,
        owner,
        repo,
        count: filter.count,
        includePrereleases,
      });
      return releases.map(toReleaseNote);
    }
    case "dateRange": {
      const releases = await collectDateRange({
        client,
        owner,
        repo,
        since: filter.since,
        until: filter.until,
        includePrereleases,
      });
      return releases.map(toReleaseNote);
    }
    case "singleTag": {
      // An explicitly named tag is returned regardless of prerelease status.
      const release = await client.getReleaseByTag({ owner, repo, tag: filter.tag });
      return release.draft ? [] : [toReleaseNote(release)];
    }
    case "tagRange": {
      const releases = await collectTagRange({
        client,
        owner,
        repo,
        from: filter.from,
        to: filter.to,
        includePrereleases,
      });
      return releases.map(toReleaseNote);
    }
  }
}

/** Render the date part of an ISO timestamp, e.g. `2026-08-13`. */
function formatPublishedDate(publishedAt: string | null): string {
  if (publishedAt === null) {
    return "unpublished";
  }
  return publishedAt.split("T")[0] ?? publishedAt;
}

/**
 * Render releases as Markdown: one `##` heading per release with its metadata
 * line, followed by the release body verbatim.
 */
export function formatReleaseNotesMarkdown(params: {
  owner: string;
  repo: string;
  releases: ReleaseNote[];
}): string {
  const { owner, repo, releases } = params;
  const lines: string[] = [`# Release notes for ${owner}/${repo}`, ""];

  for (const release of releases) {
    const title = release.name && release.name !== release.tagName ? release.name : null;
    lines.push(`## ${release.tagName}${title === null ? "" : ` — ${title}`}`);
    lines.push("");
    const metadata = [`Published: ${formatPublishedDate(release.publishedAt)}`];
    if (release.prerelease) {
      metadata.push("Prerelease");
    }
    if (release.url !== null) {
      metadata.push(release.url);
    }
    lines.push(metadata.join(" | "));
    lines.push("");
    const body = release.body?.trim() ?? "";
    lines.push(body === "" ? "_No release notes._" : body);
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}
