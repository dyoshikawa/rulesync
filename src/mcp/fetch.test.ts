import { symlink } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchFiles } from "../lib/fetch.js";
import { GitHubClientError } from "../lib/github-client.js";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { executeFetch } from "./fetch.js";

vi.mock("../lib/fetch.js", async () => {
  const actual = await vi.importActual<typeof import("../lib/fetch.js")>("../lib/fetch.js");
  return { ...actual, fetchFiles: vi.fn() };
});

describe("executeFetch", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
    vi.mocked(fetchFiles).mockReset();
  });

  it("fetches with the given options and reports the files", async () => {
    vi.mocked(fetchFiles).mockResolvedValue({
      source: "owner/repo",
      ref: "main",
      files: [
        { relativePath: "skills/a/SKILL.md", status: "created" },
        { relativePath: "skills/b/SKILL.md", status: "skipped" },
      ],
      created: 1,
      overwritten: 0,
      skipped: 1,
      deleted: 0,
    });

    const result = await executeFetch({
      source: "owner/repo",
      target: "claudecode",
      features: ["skills"],
      output: ".rulesync",
      conflict: "skip",
      prune: false,
      skills: ["a"],
    });

    expect(result.success).toBe(true);
    expect(result.result?.created).toEqual(["skills/a/SKILL.md"]);
    expect(result.result?.skipped).toEqual(["skills/b/SKILL.md"]);
    expect(result.result?.totalFetched).toBe(2);
    const call = vi.mocked(fetchFiles).mock.calls[0]?.[0];
    expect(call?.source).toBe("owner/repo");
    expect(call?.options).toEqual(
      expect.objectContaining({
        target: "claudecode",
        features: ["skills"],
        output: ".rulesync",
        conflict: "skip",
        prune: false,
        skills: ["a"],
      }),
    );
    expect(call?.options?.interactive).toBeUndefined();
    expect(call?.options?.token).toBeUndefined();
  });

  it("rejects an output directory outside the project", async () => {
    const result = await executeFetch({ source: "owner/repo", output: "../outside" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("output must stay inside the project directory");
    expect(fetchFiles).not.toHaveBeenCalled();
  });

  it("rejects an unknown target", async () => {
    const result = await executeFetch({ source: "owner/repo", target: "not-a-tool" });

    expect(result.success).toBe(false);
    expect(fetchFiles).not.toHaveBeenCalled();
  });

  it("points authentication failures at the environment token", async () => {
    vi.mocked(fetchFiles).mockRejectedValue(new GitHubClientError("Bad credentials", 401));

    const result = await executeFetch({ source: "owner/repo" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("GITHUB_TOKEN");
  });

  it("rejects an output directory reached through a symbolic link outside the project", async () => {
    const outside = await setupTestDirectory();
    try {
      await symlink(outside.testDir, join(testDir, "escape"));

      const result = await executeFetch({ source: "owner/repo", output: "escape" });

      expect(result.success).toBe(false);
      expect(result.error).toContain("output must stay inside the project directory");
      expect(fetchFiles).not.toHaveBeenCalled();
    } finally {
      await outside.cleanup();
    }
  });

  it("requires a source", async () => {
    const result = await executeFetch({ source: "" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("source is required");
  });
});
