import { afterEach, describe, expect, it, vi } from "vitest";

import { GitHubClient, GitHubClientError } from "./github-client.js";
import { MemoizingGitHubClient } from "./memoizing-github-client.js";

describe("MemoizingGitHubClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends one request for repeated and concurrent reads of the same file", async () => {
    const getFileContent = vi
      .spyOn(GitHubClient.prototype, "getFileContent")
      .mockResolvedValue("content");
    const client = new MemoizingGitHubClient();

    const answers = await Promise.all([
      client.getFileContent("org", "repo", "a.md", "sha"),
      client.getFileContent("org", "repo", "a.md", "sha"),
    ]);
    const later = await client.getFileContent("org", "repo", "a.md", "sha");

    expect(answers).toEqual(["content", "content"]);
    expect(later).toBe("content");
    expect(getFileContent).toHaveBeenCalledTimes(1);
  });

  it("keeps distinct requests apart", async () => {
    const getFileContent = vi
      .spyOn(GitHubClient.prototype, "getFileContent")
      .mockImplementation(async (_owner, repo, path, ref) => `${repo}:${path}@${ref}`);
    const client = new MemoizingGitHubClient();

    await client.getFileContent("org", "repo", "a.md", "sha-1");
    await client.getFileContent("org", "repo", "a.md", "sha-2");
    await client.getFileContent("org", "other", "a.md", "sha-1");

    expect(getFileContent).toHaveBeenCalledTimes(3);
  });

  it("holds a rejected request instead of retrying it", async () => {
    const error = new GitHubClientError("Not Found", 404);
    const listDirectory = vi
      .spyOn(GitHubClient.prototype, "listDirectory")
      .mockRejectedValue(error);
    const client = new MemoizingGitHubClient();

    await expect(client.listDirectory("org", "repo", "skills", "sha")).rejects.toBe(error);
    await expect(client.listDirectory("org", "repo", "skills", "sha")).rejects.toBe(error);
    expect(listDirectory).toHaveBeenCalledTimes(1);
  });

  it("replays an incomplete listing to every caller that asks about it", async () => {
    const listDirectory = vi
      .spyOn(GitHubClient.prototype, "listDirectory")
      .mockImplementation(async (_owner, _repo, _path, _ref, options) => {
        options?.onIncompleteListing?.();
        return [];
      });
    const client = new MemoizingGitHubClient();
    const first = vi.fn();
    const second = vi.fn();

    await client.listDirectory("org", "repo", "skills", "sha", { onIncompleteListing: first });
    await client.listDirectory("org", "repo", "skills", "sha", { onIncompleteListing: second });

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(listDirectory).toHaveBeenCalledTimes(1);
  });

  it("forwards a listing request without options unchanged", async () => {
    const listDirectory = vi.spyOn(GitHubClient.prototype, "listDirectory").mockResolvedValue([]);
    const client = new MemoizingGitHubClient();

    await client.listDirectory("org", "repo", "skills", "sha");
    await client.listDirectory("org", "repo", "skills", "sha");

    expect(listDirectory).toHaveBeenCalledTimes(1);
    expect(listDirectory).toHaveBeenCalledWith("org", "repo", "skills", "sha");
  });

  it("holds ref resolution and executable-path answers", async () => {
    const getDefaultBranch = vi
      .spyOn(GitHubClient.prototype, "getDefaultBranch")
      .mockResolvedValue("main");
    const resolveRefToSha = vi
      .spyOn(GitHubClient.prototype, "resolveRefToSha")
      .mockResolvedValue("sha");
    const listExecutablePaths = vi
      .spyOn(GitHubClient.prototype, "listExecutablePaths")
      .mockResolvedValue({ paths: new Set(["run.sh"]), truncated: false });
    const client = new MemoizingGitHubClient();

    for (let round = 0; round < 2; round += 1) {
      expect(await client.getDefaultBranch("org", "repo")).toBe("main");
      expect(await client.resolveRefToSha("org", "repo", "main")).toBe("sha");
      expect((await client.listExecutablePaths("org", "repo", "sha")).paths).toEqual(
        new Set(["run.sh"]),
      );
    }

    expect(getDefaultBranch).toHaveBeenCalledTimes(1);
    expect(resolveRefToSha).toHaveBeenCalledTimes(1);
    expect(listExecutablePaths).toHaveBeenCalledTimes(1);
  });
});
