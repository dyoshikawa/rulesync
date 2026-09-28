import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockLogger } from "../test-utils/mock-logger.js";
import { resolveDefaultRef, resolveRefToSha } from "./git-client.js";
import { fetchPackument } from "./npm-client.js";
import { readNpmLockFile, writeNpmLockFile } from "./npm-sources-lock.js";
import { readLockFile, writeLockFile } from "./sources-lock.js";
import { checkOutdatedSources } from "./sources-outdated.js";

const mockClient = {
  getDefaultBranch: vi.fn(),
  resolveRefToSha: vi.fn(),
};

vi.mock("./github-client.js", () => ({
  GitHubClient: class MockGitHubClient {
    static resolveToken = vi.fn().mockReturnValue(undefined);
    getDefaultBranch(...args: unknown[]) {
      return mockClient.getDefaultBranch(...args);
    }
    resolveRefToSha(...args: unknown[]) {
      return mockClient.resolveRefToSha(...args);
    }
  },
  GitHubClientError: class GitHubClientError extends Error {},
  logGitHubAuthHints: vi.fn(),
}));

vi.mock("./git-client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./git-client.js")>()),
  resolveDefaultRef: vi.fn(),
  resolveRefToSha: vi.fn(),
}));

vi.mock("./npm-client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./npm-client.js")>()),
  fetchPackument: vi.fn(),
}));

vi.mock("./sources-lock.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./sources-lock.js")>()),
  readLockFile: vi.fn(),
  writeLockFile: vi.fn(),
}));

vi.mock("./npm-sources-lock.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./npm-sources-lock.js")>()),
  readNpmLockFile: vi.fn(),
  writeNpmLockFile: vi.fn(),
}));

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

describe("checkOutdatedSources", () => {
  const logger = createMockLogger();

  beforeEach(() => {
    vi.mocked(readLockFile).mockResolvedValue({
      lockfileVersion: 1,
      sources: {
        "owner/current": { resolvedRef: SHA_A, requestedRef: "main", skills: {} },
        "owner/behind": { resolvedRef: SHA_A, requestedRef: "main", skills: {} },
        "https://git.example.com/repo.git": { resolvedRef: SHA_A, skills: {} },
      },
    });
    vi.mocked(readNpmLockFile).mockResolvedValue({
      lockfileVersion: 1,
      sources: {
        "@scope/pkg": {
          requestedVersion: "latest",
          resolvedVersion: "1.0.0",
          tarballIntegrity: "sha512-x",
          skills: {},
        },
      },
    } as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("compares each source's re-resolved ref with its locked ref without writing lockfiles", async () => {
    mockClient.getDefaultBranch.mockResolvedValue("main");
    mockClient.resolveRefToSha.mockImplementation(async (owner: string, repo: string) =>
      `${owner}/${repo}` === "owner/current" ? SHA_A : SHA_B,
    );
    vi.mocked(resolveDefaultRef).mockResolvedValue({ ref: "trunk", sha: SHA_B });
    vi.mocked(fetchPackument).mockResolvedValue({
      name: "@scope/pkg",
      "dist-tags": { latest: "1.1.0" },
      versions: { "1.0.0": {}, "1.1.0": {} },
    } as never);

    const reports = await checkOutdatedSources({
      sources: [
        { source: "owner/current" },
        { source: "owner/behind" },
        { source: "owner/new" },
        { source: "https://git.example.com/repo.git", transport: "git" },
        { source: "@scope/pkg", transport: "npm" },
      ],
      projectRoot: "/project",
      logger,
    });

    expect(reports).toEqual([
      {
        source: "owner/current",
        transport: "github",
        status: "up-to-date",
        requestedRef: "main",
        lockedRef: SHA_A,
        latestRef: SHA_A,
      },
      {
        source: "owner/behind",
        transport: "github",
        status: "outdated",
        requestedRef: "main",
        lockedRef: SHA_A,
        latestRef: SHA_B,
      },
      {
        source: "owner/new",
        transport: "github",
        status: "not-locked",
        requestedRef: "main",
        latestRef: SHA_B,
      },
      {
        source: "https://git.example.com/repo.git",
        transport: "git",
        status: "outdated",
        requestedRef: "trunk",
        lockedRef: SHA_A,
        latestRef: SHA_B,
      },
      {
        source: "@scope/pkg",
        transport: "npm",
        status: "outdated",
        requestedRef: "latest",
        lockedRef: "1.0.0",
        latestRef: "1.1.0",
      },
    ]);
    expect(writeLockFile).not.toHaveBeenCalled();
    expect(writeNpmLockFile).not.toHaveBeenCalled();
  });

  it("re-resolves a declared ref instead of the default branch", async () => {
    vi.mocked(resolveRefToSha).mockResolvedValue(SHA_A);
    mockClient.resolveRefToSha.mockResolvedValue(SHA_A);

    const reports = await checkOutdatedSources({
      sources: [
        { source: "owner/current", ref: "v1" },
        { source: "https://git.example.com/repo.git", transport: "git", ref: "release" },
      ],
      projectRoot: "/project",
      logger,
    });

    expect(mockClient.getDefaultBranch).not.toHaveBeenCalled();
    expect(mockClient.resolveRefToSha).toHaveBeenCalledWith("owner", "current", "v1");
    expect(resolveRefToSha).toHaveBeenCalledWith("https://git.example.com/repo.git", "release");
    expect(reports.map((report) => report.status)).toEqual(["up-to-date", "up-to-date"]);
  });

  it("uses a ref embedded in the source string and matches normalized lockfile keys", async () => {
    mockClient.resolveRefToSha.mockResolvedValue(SHA_A);

    const reports = await checkOutdatedSources({
      sources: [{ source: "owner/current@v2" }, { source: "https://github.com/owner/behind" }],
      projectRoot: "/project",
      logger,
    });

    expect(mockClient.getDefaultBranch).toHaveBeenCalledTimes(1);
    expect(mockClient.resolveRefToSha).toHaveBeenCalledWith("owner", "current", "v2");
    expect(reports[1]).toMatchObject({ status: "up-to-date", lockedRef: SHA_A });
  });

  it("reports a source that cannot be resolved as failed and keeps checking the rest", async () => {
    mockClient.getDefaultBranch.mockRejectedValueOnce(new Error("network unreachable"));
    mockClient.getDefaultBranch.mockResolvedValue("main");
    mockClient.resolveRefToSha.mockResolvedValue(SHA_A);

    const reports = await checkOutdatedSources({
      sources: [{ source: "owner/behind" }, { source: "owner/current" }],
      projectRoot: "/project",
      logger,
    });

    expect(reports[0]).toEqual({
      source: "owner/behind",
      transport: "github",
      status: "failed",
      lockedRef: SHA_A,
      error: "Error: network unreachable",
    });
    expect(reports[1]?.status).toBe("up-to-date");
  });
});
