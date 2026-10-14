import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockExecFileAsync } = vi.hoisted(() => ({ mockExecFileAsync: vi.fn() }));

vi.mock("node:child_process", () => ({ execFile: vi.fn() }));
vi.mock("node:util", () => ({ promisify: () => mockExecFileAsync }));
// Keep the real helpers (ensureDir, removeDirectory, ...) available so the
// real-repository tests below can restore actual behavior per test.
vi.mock("../utils/file.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/file.js")>()),
  createTempDirectory: vi.fn(),
  removeTempDirectory: vi.fn(),
  directoryExists: vi.fn(),
  isSymlink: vi.fn(),
  listDirectoryEntryNames: vi.fn(),
  getFileSize: vi.fn(),
  hasExecutableBit: vi.fn().mockResolvedValue(false),
  readFileContent: vi.fn(),
  resolvedPathEscapesRoot: vi.fn(),
}));
import { createMockLogger } from "../test-utils/mock-logger.js";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import {
  createTempDirectory,
  directoryExists,
  getFileSize,
  hasExecutableBit,
  isSymlink,
  listDirectoryEntryNames,
  readFileContent,
  removeTempDirectory,
  resolvedPathEscapesRoot,
} from "../utils/file.js";
import {
  GitClientError,
  checkGitAvailable,
  fetchSkillFiles,
  resetGitCheck,
  resolveDefaultRef,
  resolveGitExcludePath,
  resolveRefToSha,
  validateGitUrl,
  validateRef,
} from "./git-client.js";

const logger = createMockLogger();

const SHA = "a".repeat(40);

describe("git-client", () => {
  beforeEach(() => {
    vi.mocked(isSymlink).mockResolvedValue(false);
    vi.mocked(resolvedPathEscapesRoot).mockResolvedValue(false);
  });

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

  describe("resolveGitExcludePath", () => {
    it("resolves a relative --git-path against cwd", async () => {
      mockExecFileAsync.mockImplementation(async (_file: string, args: string[]) => ({
        stdout: args[0] === "--version" ? "git version 2.40.0" : "\n.git/info/exclude\n",
      }));

      await expect(resolveGitExcludePath({ cwd: "/repo" })).resolves.toEqual({
        excludePath: join("/repo", ".git/info/exclude"),
        prefix: "",
      });
      expect(mockExecFileAsync).toHaveBeenCalledWith(
        "git",
        ["rev-parse", "--show-prefix", "--git-path", "info/exclude"],
        expect.objectContaining({ cwd: "/repo" }),
      );
    });

    it("keeps an absolute path from a linked worktree and reports the prefix", async () => {
      mockExecFileAsync.mockImplementation(async (_file: string, args: string[]) => ({
        stdout:
          args[0] === "--version"
            ? "git version 2.40.0"
            : "packages/app/\n/main/.git/info/exclude\n",
      }));

      await expect(resolveGitExcludePath({ cwd: "/wt/packages/app" })).resolves.toEqual({
        excludePath: "/main/.git/info/exclude",
        prefix: "packages/app/",
      });
    });

    it("throws a GitClientError outside a Git repository", async () => {
      mockExecFileAsync.mockImplementation(async (_file: string, args: string[]) => {
        if (args[0] === "--version") return { stdout: "git version 2.40.0" };
        throw new Error("fatal: not a git repository");
      });

      await expect(resolveGitExcludePath({ cwd: "/not-a-repo" })).rejects.toThrow(
        /Failed to resolve the Git exclude file/,
      );
    });

    it("throws when git returns no path", async () => {
      mockExecFileAsync.mockImplementation(async (_file: string, args: string[]) => ({
        stdout: args[0] === "--version" ? "git version 2.40.0" : "\n",
      }));

      await expect(resolveGitExcludePath({ cwd: "/repo" })).rejects.toThrow(GitClientError);
    });
  });

  describe("fetchSkillFiles", () => {
    it("fetches and checks out the exact locked commit", async () => {
      mockExecFileAsync.mockImplementation(async (_file: string, args: string[]) => ({
        stdout: args.includes("rev-parse") ? `${SHA}\n` : "",
        stderr: "",
      }));
      vi.mocked(createTempDirectory).mockResolvedValue("/tmp/test");
      vi.mocked(removeTempDirectory).mockResolvedValue(undefined);
      vi.mocked(directoryExists).mockResolvedValue(false);

      await fetchSkillFiles({
        url: "https://example.com/repo.git",
        ref: "main",
        resolvedRef: SHA,
        skillsPath: "skills",
      });

      expect(mockExecFileAsync).toHaveBeenCalledWith(
        "git",
        ["-C", "/tmp/test", "fetch", "--depth", "1", "origin", SHA],
        expect.any(Object),
      );
      expect(mockExecFileAsync).toHaveBeenCalledWith(
        "git",
        ["-C", "/tmp/test", "checkout", "--detach", SHA],
        expect.any(Object),
      );
      expect(mockExecFileAsync).toHaveBeenCalledWith(
        "git",
        ["-C", "/tmp/test", "rev-parse", "HEAD"],
        expect.any(Object),
      );
    });

    it("rejects a checkout that does not match the locked commit", async () => {
      mockExecFileAsync.mockImplementation(async (_file: string, args: string[]) => ({
        stdout: args.includes("rev-parse") ? `${"b".repeat(40)}\n` : "",
        stderr: "",
      }));
      vi.mocked(createTempDirectory).mockResolvedValue("/tmp/test");
      vi.mocked(removeTempDirectory).mockResolvedValue(undefined);

      await expect(
        fetchSkillFiles({
          url: "https://example.com/repo.git",
          ref: "main",
          resolvedRef: SHA,
          skillsPath: "skills",
        }),
      ).rejects.toThrow("expected locked commit");
      expect(removeTempDirectory).toHaveBeenCalledWith("/tmp/test");
    });

    it("clones, walks, and returns files", async () => {
      mockExecFileAsync.mockResolvedValue({ stdout: "", stderr: "" });
      vi.mocked(createTempDirectory).mockResolvedValue("/tmp/test");
      vi.mocked(removeTempDirectory).mockResolvedValue(undefined);
      vi.mocked(directoryExists).mockImplementation(
        async (p: string) => p.endsWith("skills") || p.endsWith("skill-a"),
      );
      vi.mocked(listDirectoryEntryNames).mockImplementation(async (d: string) => {
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
      expect(files).toEqual([
        { relativePath: "skill-a/file.md", content: "# Content", size: 100, executable: false },
      ]);
      expect(removeTempDirectory).toHaveBeenCalledWith("/tmp/test");
    });

    it("reports the execute bit of each checked-out file", async () => {
      mockExecFileAsync.mockResolvedValue({ stdout: "", stderr: "" });
      vi.mocked(createTempDirectory).mockResolvedValue("/tmp/test");
      vi.mocked(removeTempDirectory).mockResolvedValue(undefined);
      vi.mocked(directoryExists).mockImplementation(
        async (p: string) => p.endsWith("skills") || p.endsWith("skill-a"),
      );
      vi.mocked(listDirectoryEntryNames).mockImplementation(async (d: string) => {
        if (d.endsWith("skills")) return ["skill-a"];
        if (d.endsWith("skill-a")) return ["SKILL.md", "run.sh"];
        return [];
      });
      vi.mocked(getFileSize).mockResolvedValue(10);
      vi.mocked(readFileContent).mockResolvedValue("content");
      vi.mocked(hasExecutableBit).mockImplementation(async (p: string) => p.endsWith("run.sh"));

      const files = await fetchSkillFiles({
        url: "https://example.com/repo.git",
        ref: "main",
        skillsPath: "skills",
      });

      expect(files.map(({ relativePath, executable }) => ({ relativePath, executable }))).toEqual([
        { relativePath: join("skill-a", "SKILL.md"), executable: false },
        { relativePath: join("skill-a", "run.sh"), executable: true },
      ]);
      vi.mocked(hasExecutableBit).mockResolvedValue(false);
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
      vi.mocked(listDirectoryEntryNames).mockResolvedValue([".git", "file.md"]);
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
      vi.mocked(listDirectoryEntryNames).mockResolvedValue(["link", "file.md"]);
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

    it("returns no files and warns when skillsPath resolves outside the clone through a symlink", async () => {
      mockExecFileAsync.mockResolvedValue({ stdout: "", stderr: "" });
      vi.mocked(createTempDirectory).mockResolvedValue("/tmp/test");
      vi.mocked(removeTempDirectory).mockResolvedValue(undefined);
      vi.mocked(directoryExists).mockImplementation(async (p: string) => p.endsWith("rules"));
      vi.mocked(resolvedPathEscapesRoot).mockResolvedValueOnce(true);
      vi.mocked(listDirectoryEntryNames).mockResolvedValue(["secret.md"]);
      vi.mocked(getFileSize).mockResolvedValue(10);
      vi.mocked(readFileContent).mockResolvedValue("content");

      const files = await fetchSkillFiles({
        url: "https://example.com/repo.git",
        ref: "main",
        skillsPath: "rules",
        logger,
      });

      expect(files).toEqual([]);
      expect(vi.mocked(resolvedPathEscapesRoot)).toHaveBeenCalledWith({
        rootPath: "/tmp/test",
        targetPath: join("/tmp/test", "rules"),
      });
      expect(vi.mocked(listDirectoryEntryNames)).not.toHaveBeenCalled();
      expect(vi.mocked(readFileContent)).not.toHaveBeenCalled();
      expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
        expect.stringContaining("resolves outside the repository"),
      );
      expect(vi.mocked(removeTempDirectory)).toHaveBeenCalledWith("/tmp/test");
    });

    it("walks skillsPath when it resolves inside the clone", async () => {
      mockExecFileAsync.mockResolvedValue({ stdout: "", stderr: "" });
      vi.mocked(createTempDirectory).mockResolvedValue("/tmp/test");
      vi.mocked(removeTempDirectory).mockResolvedValue(undefined);
      vi.mocked(directoryExists).mockImplementation(async (p: string) => p.endsWith("rules"));
      vi.mocked(listDirectoryEntryNames).mockResolvedValue(["a.md"]);
      vi.mocked(getFileSize).mockResolvedValue(10);
      vi.mocked(readFileContent).mockResolvedValue("content");

      const files = await fetchSkillFiles({
        url: "https://example.com/repo.git",
        ref: "main",
        skillsPath: "rules",
      });

      expect(vi.mocked(resolvedPathEscapesRoot)).toHaveBeenCalledWith({
        rootPath: "/tmp/test",
        targetPath: join("/tmp/test", "rules"),
      });
      expect(files).toEqual([
        { relativePath: "a.md", content: "content", size: 10, executable: false },
      ]);
    });

    it.each(["", ".", "./", "./.", ".//", ".\\"])(
      "disables sparse-checkout when skillsPath is %j (repo root)",
      async (skillsPath) => {
        mockExecFileAsync.mockResolvedValue({ stdout: "", stderr: "" });
        vi.mocked(createTempDirectory).mockResolvedValue("/tmp/test");
        vi.mocked(removeTempDirectory).mockResolvedValue(undefined);
        vi.mocked(directoryExists).mockResolvedValue(true);
        vi.mocked(listDirectoryEntryNames).mockResolvedValue([]);

        await fetchSkillFiles({
          url: "https://example.com/repo.git",
          ref: "main",
          skillsPath,
        });

        // Must call `sparse-checkout disable`, not `sparse-checkout set ...`.
        const calls = mockExecFileAsync.mock.calls.map((c: any[]) => c[1] as string[]);
        const disableCall = calls.find(
          (args) => args?.includes("sparse-checkout") && args.includes("disable"),
        );
        const setCall = calls.find(
          (args) => args?.includes("sparse-checkout") && args.includes("set"),
        );
        expect(disableCall).toBeDefined();
        expect(setCall).toBeUndefined();
      },
    );

    it("uses the clone directory itself as the skills root when skillsPath is the repo root", async () => {
      mockExecFileAsync.mockResolvedValue({ stdout: "", stderr: "" });
      vi.mocked(createTempDirectory).mockResolvedValue("/tmp/test");
      vi.mocked(removeTempDirectory).mockResolvedValue(undefined);
      const seenDirs: string[] = [];
      vi.mocked(directoryExists).mockImplementation(async (p: string) => {
        seenDirs.push(p);
        // Only treat the clone root as a directory; descended children are
        // files so the walk terminates quickly.
        return p === "/tmp/test";
      });
      vi.mocked(listDirectoryEntryNames).mockResolvedValue(["root-file.md"]);
      vi.mocked(getFileSize).mockResolvedValue(10);
      vi.mocked(readFileContent).mockResolvedValue("content");

      const files = await fetchSkillFiles({
        url: "https://example.com/repo.git",
        ref: "main",
        skillsPath: ".",
      });

      expect(files).toHaveLength(1);
      // The clone root must be walked directly: a relative path computed against
      // `<tmpDir>/.` would yield "./root-file.md" instead of "root-file.md".
      expect(files[0]?.relativePath).toBe("root-file.md");
      expect(seenDirs).toContain("/tmp/test");
      // The skills root must be `tmpDir` itself, never a naive `<tmpDir>/.`
      // (which a string-concatenated `join(tmpDir, ".")` would produce).
      expect(seenDirs).not.toContain("/tmp/test/.");
    });

    it("throws GitClientError at max directory depth", async () => {
      mockExecFileAsync.mockResolvedValue({ stdout: "", stderr: "" });
      vi.mocked(createTempDirectory).mockResolvedValue("/tmp/test");
      vi.mocked(removeTempDirectory).mockResolvedValue(undefined);
      // Every entry is a directory, creating infinite depth
      vi.mocked(directoryExists).mockResolvedValue(true);
      vi.mocked(listDirectoryEntryNames).mockResolvedValue(["nested"]);

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
  describe.skipIf(process.platform === "win32")("fetchSkillFiles against a real repository", () => {
    let testDir: string;
    let cleanup: () => Promise<void>;

    beforeEach(async () => {
      const actualFile =
        await vi.importActual<typeof import("../utils/file.js")>("../utils/file.js");
      const { execFile: realExecFile } =
        await vi.importActual<typeof import("node:child_process")>("node:child_process");
      const { promisify: realPromisify } =
        await vi.importActual<typeof import("node:util")>("node:util");
      mockExecFileAsync.mockImplementation(realPromisify(realExecFile));
      vi.mocked(createTempDirectory).mockImplementation(actualFile.createTempDirectory);
      vi.mocked(removeTempDirectory).mockImplementation(actualFile.removeTempDirectory);
      vi.mocked(directoryExists).mockImplementation(actualFile.directoryExists);
      vi.mocked(isSymlink).mockImplementation(actualFile.isSymlink);
      vi.mocked(listDirectoryEntryNames).mockImplementation(actualFile.listDirectoryEntryNames);
      vi.mocked(getFileSize).mockImplementation(actualFile.getFileSize);
      vi.mocked(readFileContent).mockImplementation(actualFile.readFileContent);
      vi.mocked(resolvedPathEscapesRoot).mockImplementation(actualFile.resolvedPathEscapesRoot);
      ({ testDir, cleanup } = await setupTestDirectory());
    });

    afterEach(async () => {
      await cleanup();
    });

    const git = (cwd: string, args: string[]) =>
      mockExecFileAsync("git", [
        "-C",
        cwd,
        "-c",
        "user.name=test",
        "-c",
        "user.email=t@example.com",
        ...args,
      ]);

    /** Creates a repository at `<testDir>/src` with `setup` applied, committed on `main`. */
    const createRepo = async (setup: (repoDir: string) => Promise<void>): Promise<string> => {
      const repoDir = join(testDir, "src");
      await mkdir(repoDir, { recursive: true });
      await git(repoDir, ["init", "-q", "-b", "main"]);
      await setup(repoDir);
      await git(repoDir, ["add", "-A"]);
      await git(repoDir, ["commit", "-q", "-m", "init"]);
      return `file://${repoDir}`;
    };

    const writeOutsideRule = async (dir: string) => {
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "secret.md"), "outside content\n");
    };

    it("returns no files when the fetched directory is a symlink pointing outside the clone", async () => {
      const outsideDir = join(testDir, "outside-rules");
      await writeOutsideRule(outsideDir);
      const url = await createRepo(async (repoDir) => {
        await symlink(outsideDir, join(repoDir, "rules"));
        await mkdir(join(repoDir, "skills", "my-skill"), { recursive: true });
        await writeFile(join(repoDir, "skills", "my-skill", "SKILL.md"), "skill\n");
      });

      const rules = await fetchSkillFiles({ url, ref: "main", skillsPath: "rules", logger });
      expect(rules).toEqual([]);
      expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
        expect.stringContaining("resolves outside the repository"),
      );

      const skills = await fetchSkillFiles({ url, ref: "main", skillsPath: "skills", logger });
      expect(skills.map((f) => f.relativePath)).toEqual([join("my-skill", "SKILL.md")]);
    });

    it("returns no files when a parent of the fetched path is a symlink pointing outside the clone", async () => {
      const outsideParent = join(testDir, "outside-parent");
      await writeOutsideRule(join(outsideParent, "rules"));
      const url = await createRepo(async (repoDir) => {
        await symlink(outsideParent, join(repoDir, "a"));
      });

      const files = await fetchSkillFiles({ url, ref: "main", skillsPath: "a/rules", logger });
      expect(files).toEqual([]);
      expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
        expect.stringContaining("resolves outside the repository"),
      );
    });
  });
});
