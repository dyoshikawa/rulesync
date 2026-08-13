import { afterEach, describe, expect, it, vi } from "vitest";

import { createProgram } from "../cli/program.js";

type MockRelease = {
  tag_name: string;
  name: string | null;
  prerelease: boolean;
  draft: boolean;
  assets: [];
  published_at: string;
  body: string;
  html_url: string;
};

function createRelease(params: {
  tag: string;
  publishedAt: string;
  prerelease?: boolean;
  draft?: boolean;
}): MockRelease {
  const { tag, publishedAt, prerelease = false, draft = false } = params;
  return {
    tag_name: tag,
    name: `Release ${tag}`,
    prerelease,
    draft,
    assets: [],
    published_at: publishedAt,
    body: `Changes in ${tag}`,
    html_url: `https://github.com/owner/repo/releases/tag/${tag}`,
  };
}

const RELEASES: MockRelease[] = [
  createRelease({ tag: "v3.0.0-rc.1", publishedAt: "2026-07-01T00:00:00Z", prerelease: true }),
  createRelease({ tag: "v2.1.0", publishedAt: "2026-06-01T00:00:00Z" }),
  createRelease({ tag: "v2.0.0", publishedAt: "2026-03-01T00:00:00Z" }),
  createRelease({ tag: "v1.0.0", publishedAt: "2025-12-01T00:00:00Z" }),
];

vi.mock("../lib/github-client.js", () => ({
  GitHubClientError: class GitHubClientError extends Error {},
  GitHubClient: class MockGitHubClient {
    static resolveToken(): undefined {
      return undefined;
    }

    listReleases(): Promise<MockRelease[]> {
      return Promise.resolve(RELEASES);
    }

    getReleaseByTag({ tag }: { tag: string }): Promise<MockRelease> {
      const release = RELEASES.find((item) => item.tag_name === tag);
      if (!release) {
        return Promise.reject(new Error(`Not found: ${tag}`));
      }
      return Promise.resolve(release);
    }
  },
}));

async function runCli(args: string[]): Promise<string> {
  const chunks: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    chunks.push(String(chunk));
    return true;
  });

  await createProgram().parseAsync(["node", "rulesync", ...args]);

  return chunks.join("");
}

function runReleaseNotes(args: string[]): Promise<string> {
  return runCli(["release-notes", ...args]);
}

describe("E2E: release-notes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should print the latest releases as Markdown, excluding prereleases", async () => {
    const output = await runReleaseNotes(["owner/repo"]);

    expect(output).toContain("# Release notes for owner/repo");
    expect(output).toContain("## v2.1.0 — Release v2.1.0");
    expect(output).toContain("Published: 2026-06-01");
    expect(output).toContain("Changes in v2.1.0");
    expect(output).not.toContain("v3.0.0-rc.1");
  });

  it("should limit the output with --latest", async () => {
    const output = await runReleaseNotes(["owner/repo", "--latest", "1"]);

    expect(output).toContain("## v2.1.0");
    expect(output).not.toContain("## v2.0.0");
  });

  it("should include prereleases with --include-prereleases", async () => {
    const output = await runReleaseNotes(["owner/repo", "--include-prereleases"]);

    expect(output).toContain("## v3.0.0-rc.1");
    expect(output).toContain("Prerelease");
  });

  it("should filter by publication date range", async () => {
    const output = await runReleaseNotes([
      "owner/repo",
      "--since",
      "2026-01-01",
      "--until",
      "2026-05-01",
    ]);

    expect(output).toContain("## v2.0.0");
    expect(output).not.toContain("## v2.1.0");
    expect(output).not.toContain("## v1.0.0");
  });

  it("should print a single release with --tag", async () => {
    const output = await runReleaseNotes(["owner/repo", "--tag", "v1.0.0"]);

    expect(output).toContain("## v1.0.0");
    expect(output).not.toContain("## v2.0.0");
  });

  it("should print every release in a tag range with --from and --to", async () => {
    const output = await runReleaseNotes(["owner/repo", "--from", "v1.0.0", "--to", "v2.1.0"]);

    expect(output).toContain("## v2.1.0");
    expect(output).toContain("## v2.0.0");
    expect(output).toContain("## v1.0.0");
  });

  it("should emit a JSON envelope with --json", async () => {
    // The JSON envelope is emitted through console.log, not the raw stdout
    // stream the Markdown output uses.
    const logged: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });

    await runCli(["--json", "release-notes", "owner/repo", "--latest", "1"]);

    const parsed = JSON.parse(logged.join("\n")) as {
      success: boolean;
      command: string;
      data: { repository: string; totalReleases: number; releases: Array<{ tagName: string }> };
    };

    expect(parsed.success).toBe(true);
    expect(parsed.command).toBe("release-notes");
    expect(parsed.data.repository).toBe("owner/repo");
    expect(parsed.data.totalReleases).toBe(1);
    expect(parsed.data.releases[0]?.tagName).toBe("v2.1.0");
  });
});
