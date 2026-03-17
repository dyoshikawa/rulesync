import { afterEach, describe, expect, it, vi } from "vitest";

const { mockExecFileAsync } = vi.hoisted(() => ({ mockExecFileAsync: vi.fn() }));

vi.mock("node:child_process", () => ({ execFile: vi.fn() }));
vi.mock("node:util", () => ({ promisify: () => mockExecFileAsync }));
vi.mock("../utils/file.js", () => ({
  createTempDirectory: vi.fn(),
  removeTempDirectory: vi.fn(),
  directoryExists: vi.fn(),
  isSymlink: vi.fn().mockResolvedValue(false),
  listDirectoryFiles: vi.fn(),
  getFileSize: vi.fn(),
  readFileContent: vi.fn(),
}));
vi.mock("../utils/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  createTempDirectory,
  directoryExists,
  getFileSize,
  isSymlink,
  listDirectoryFiles,
  readFileContent,
  removeTempDirectory,
} from "../utils/file.js";
import { logger } from "../utils/logger.js";
import {
  GitClientError,
  checkGitAvailable,
  fetchSkillFiles,
  resetGitCheck,
  resolveDefaultRef,
  resolveRefToSha,
  validateGitUrl,
  validateRef,
} from "./git-client.js";

const SHA = "a".repeat(40);

describe("git-client", () => {
  afterEach(() => {
    vi.clearAllMocks();
    resetGitCheck();
  });

  describe("validateGitUrl", () => {
    it.each([
      ["https://github.com/owner/repo.git"],
      ["http://example.com/repo.git"],
      ["ssh://git@github.com/owner/repo.git"],
      ["git://example.com/repo.git"],
      ["file:///path/to/repo"],
      ["git@github.com:owner/repo.git"],
      ["user@host.example.com:path/to/repo.git"],
    ])("accepts valid URL: %s", (url) => {
      expect(() => validateGitUrl(url)).not.toThrow();
    });

    it.each([
      ["relative/path"],
      ["/absolute/path"],
      [""],
      ["javascript:alert(1)"],
      ["data:text/plain,hello"],
      ["@bare-at"],
    ])("rejects invalid URL: %s", (url) => {
      expect(() => validateGitUrl(url)).toThrow(GitClientError);
    });

    it("warns on insecure git:// protocol", () => {
      validateGitUrl("git://example.com/repo.git", { logger });
      expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
        expect.stringContaining("unencrypted protocol"),
      );
    });

    it("warns on insecure http:// protocol", () => {
      validateGitUrl("http://example.com/repo.git", { logger });
      expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
        expect.stringContaining("unencrypted protocol"),
      );
    });

    it("does not warn on https:// protocol", () => {
      validateGitUrl("https://example.com/repo.git", { logger });
      expect(vi.mocked(logger.warn)).not.toHaveBeenCalled();
    });

    it("rejects URLs with control characters", () => {
      expect(() => validateGitUrl("https://example.com/repo\x00.git")).toThrow(GitClientError);
      expect(() => validateGitUrl("https://example.com/repo\x00.git")).toThrow(
        "control character 0x00 at position 24",
      );
    });
  });

  describe("validateRef", () => {
    it("accepts valid refs", () => {
      expect(() => validateRef("main")).not.toThrow();
      expect(() => validateRef("v1.0.0")).not.toThrow();
      expect(() => validateRef("feature/branch")).not.toThrow();
    });

    it("rejects refs starting with dash", () => {
      expect(() => validateRef("-malicious")).toThrow(GitClientError);
    });

    it("rejects refs with control characters", () => {
      expect(() => validateRef("main\x00")).toThrow(GitClientError);
      expect(() => validateRef("main\n")).toThrow("control character 0x0a at position 4");
    });
  });

  describe("checkGitAvailable", () => {
    it("succeeds when git is available", async () => {
      mockExecFileAsync.mockResolvedValue({ stdout: "git version 2.40.0" });
      await expect(checkGitAvailable()).resolves.toBeUndefined();
    });

    it("throws when git is not found", async () => {
      mockExecFileAsync.mockRejectedValue(new Error("ENOENT"));
      await expect(checkGitAvailable()).rejects.toThrow(GitClientError);
      await expect(checkGitAvailable()).rejects.toThrow("not installed");
    });

    it("caches the result after first success", async () => {
      mockExecFileAsync.mockResolvedValue({ stdout: "git version 2.40.0" });
      await checkGitAvailable();
      await checkGitAvailable();
      // git --version should only be called once
      const versionCalls = mockExecFileAsync.mock.calls.filter(
        (c: any[]) => c[0] === "git" && c[1]?.[0] === "--version",
      );
      expect(versionCalls).toHaveLength(1);
    });
  });

  describe("resolveDefaultRef", () => {
    it("parses symref and SHA", async () => {
      mockExecFileAsync.mockResolvedValue({
        stdout: `ref: refs/heads/main\tHEAD\n${SHA}\tHEAD\n`,
      });
      expect(await resolveDefaultRef("https://example.com/repo.git")).toEqual({
        ref: "main",
        sha: SHA,
      });
    });

    it("wraps errors in GitClientError", async () => {
      mockExecFileAsync.mockRejectedValueOnce({ stdout: "git version 2.40.0" });
      mockExecFileAsync.mockRejectedValue(new Error("fail"));
      await expect(resolveDefaultRef("https://example.com/repo.git")).rejects.toThrow(
        GitClientError,
      );
    });
  });

  describe("resolveRefToSha", () => {
    it("returns SHA", async () => {
      mockExecFileAsync.mockResolvedValue({ stdout: `${SHA}\trefs/heads/main\n` });
      expect(await resolveRefToSha("https://example.com/repo.git", "main")).toBe(SHA);
    });

    it("throws when ref not found", async () => {
      mockExecFileAsync.mockResolvedValue({ stdout: "" });
      await expect(resolveRefToSha("https://example.com/repo.git", "x")).rejects.toThrow(
        GitClientError,
      );
    });
  });

  describe("fetchSkillFiles", () => {
    it("clones, walks, and returns files", async () => {
      mockExecFileAsync.mockResolvedValue({ stdout: "", stderr: "" });
      vi.mocked(createTempDirectory).mockResolvedValue("/tmp/test");
      vi.mocked(removeTempDirectory).mockResolvedValue(undefined);
      vi.mocked(directoryExists).mockImplementation(
        async (p: string) => p.endsWith("skills") || p.endsWith("skill-a"),
      );
      vi.mocked(listDirectoryFiles).mockImplementation(async (d: string) => {
        if (d.endsWith("skills")) return ["skill-a"];
        if (d.endsWith("skill-a")) return ["file.md"];
        return [];
      });
      vi.mocked(getFileSize).mockResolvedValue(100);
      vi.mocked(readFileContent).mockResolvedValue("# Content");

      const files = await fetchSkillFiles({
        url: "https://example.com/repo.git",
        ref: "main",
        skillsPath: "skills",
      });
      expect(files).toEqual([{ relativePath: "skill-a/file.md", content: "# Content", size: 100 }]);
      expect(removeTempDirectory).toHaveBeenCalledWith("/tmp/test");
    });

    it("rejects skillsPath with path traversal", async () => {
      await expect(
        fetchSkillFiles({ url: "https://example.com/repo.git", ref: "main", skillsPath: "../etc" }),
      ).rejects.toThrow(GitClientError);
      await expect(
        fetchSkillFiles({ url: "https://example.com/repo.git", ref: "main", skillsPath: "../etc" }),
      ).rejects.toThrow("must be a relative path");
    });

    it("rejects absolute skillsPath", async () => {
      await expect(
        fetchSkillFiles({
          url: "https://example.com/repo.git",
          ref: "main",
          skillsPath: "/etc/passwd",
        }),
      ).rejects.toThrow(GitClientError);
    });

    it("rejects skillsPath with control characters", async () => {
      await expect(
        fetchSkillFiles({
          url: "https://example.com/repo.git",
          ref: "main",
          skillsPath: "skills\x00",
        }),
      ).rejects.toThrow("control character");
    });

    it("returns empty when skills dir missing", async () => {
      mockExecFileAsync.mockResolvedValue({ stdout: "" });
      vi.mocked(createTempDirectory).mockResolvedValue("/tmp/test");
      vi.mocked(removeTempDirectory).mockResolvedValue(undefined);
      vi.mocked(directoryExists).mockResolvedValue(false);

      expect(
        await fetchSkillFiles({
          url: "https://example.com/repo.git",
          ref: "main",
          skillsPath: "skills",
        }),
      ).toEqual([]);
    });

    it("passes -- separator before skillsPath in sparse-checkout", async () => {
      mockExecFileAsync.mockResolvedValue({ stdout: "", stderr: "" });
      vi.mocked(createTempDirectory).mockResolvedValue("/tmp/test");
      vi.mocked(removeTempDirectory).mockResolvedValue(undefined);
      vi.mocked(directoryExists).mockResolvedValue(false);

      await fetchSkillFiles({
        url: "https://example.com/repo.git",
        ref: "main",
        skillsPath: "skills",
      });

      const sparseCall = mockExecFileAsync.mock.calls.find((c: any[]) =>
        c[1]?.includes("sparse-checkout"),
      );
      expect(sparseCall?.[1]).toContain("--");
    });

    it("wraps non-GitClientError in GitClientError", async () => {
      mockExecFileAsync.mockResolvedValueOnce({ stdout: "git version 2.40.0" });
      vi.mocked(createTempDirectory).mockResolvedValue("/tmp/test");
      vi.mocked(removeTempDirectory).mockResolvedValue(undefined);
      mockExecFileAsync.mockRejectedValue(new Error("clone failed"));

      await expect(
        fetchSkillFiles({
          url: "https://example.com/repo.git",
          ref: "main",
          skillsPath: "skills",
        }),
      ).rejects.toThrow(GitClientError);
      expect(removeTempDirectory).toHaveBeenCalledWith("/tmp/test");
    });

    it("skips .git directories", async () => {
      mockExecFileAsync.mockResolvedValue({ stdout: "", stderr: "" });
      vi.mocked(createTempDirectory).mockResolvedValue("/tmp/test");
      vi.mocked(removeTempDirectory).mockResolvedValue(undefined);
      vi.mocked(directoryExists).mockImplementation(async (p: string) => p.endsWith("skills"));
      vi.mocked(listDirectoryFiles).mockResolvedValue([".git", "file.md"]);
      vi.mocked(getFileSize).mockResolvedValue(10);
      vi.mocked(readFileContent).mockResolvedValue("content");

      const files = await fetchSkillFiles({
        url: "https://example.com/repo.git",
        ref: "main",
        skillsPath: "skills",
      });
      expect(files).toHaveLength(1);
      expect(files[0]?.relativePath).toBe("file.md");
    });

    it("skips symlinks and warns", async () => {
      mockExecFileAsync.mockResolvedValue({ stdout: "", stderr: "" });
      vi.mocked(createTempDirectory).mockResolvedValue("/tmp/test");
      vi.mocked(removeTempDirectory).mockResolvedValue(undefined);
      vi.mocked(directoryExists).mockImplementation(async (p: string) => p.endsWith("skills"));
      vi.mocked(listDirectoryFiles).mockResolvedValue(["link", "file.md"]);
      vi.mocked(isSymlink).mockImplementation(async (p: string) => p.endsWith("link"));
      vi.mocked(getFileSize).mockResolvedValue(10);
      vi.mocked(readFileContent).mockResolvedValue("content");

      const files = await fetchSkillFiles({
        url: "https://example.com/repo.git",
        ref: "main",
        skillsPath: "skills",
        logger,
      });
      expect(files).toHaveLength(1);
      expect(files[0]?.relativePath).toBe("file.md");
      expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(expect.stringContaining("symlink"));
    });

    it("throws GitClientError at max directory depth", async () => {
      mockExecFileAsync.mockResolvedValue({ stdout: "", stderr: "" });
      vi.mocked(createTempDirectory).mockResolvedValue("/tmp/test");
      vi.mocked(removeTempDirectory).mockResolvedValue(undefined);
      // Every entry is a directory, creating infinite depth
      vi.mocked(directoryExists).mockResolvedValue(true);
      vi.mocked(listDirectoryFiles).mockResolvedValue(["nested"]);

      await expect(
        fetchSkillFiles({
          url: "https://example.com/repo.git",
          ref: "main",
          skillsPath: "skills",
        }),
      ).rejects.toThrow(GitClientError);
      await expect(
        fetchSkillFiles({
          url: "https://example.com/repo.git",
          ref: "main",
          skillsPath: "skills",
        }),
      ).rejects.toThrow("max depth");
    });
  });
});
