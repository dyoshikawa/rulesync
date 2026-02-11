import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_SOURCES_LOCK_RELATIVE_FILE_PATH } from "../constants/rulesync-paths.js";
import { fileExists, readFileContent, writeFileContent } from "../utils/file.js";
import {
  LOCKFILE_VERSION,
  computeSkillIntegrity,
  createEmptyLock,
  getLockedSkillNames,
  getLockedSource,
  normalizeSourceKey,
  readLockFile,
  setLockedSource,
  writeLockFile,
} from "./sources-lock.js";

vi.mock("../utils/file.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/file.js")>();
  return {
    ...actual,
    fileExists: vi.fn(),
    readFileContent: vi.fn(),
    writeFileContent: vi.fn(),
  };
});

vi.mock("../utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const { logger } = await vi.importMock<typeof import("../utils/logger.js")>("../utils/logger.js");

describe("sources-lock", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("createEmptyLock", () => {
    it("should return an empty lock structure", () => {
      const lock = createEmptyLock();
      expect(lock).toEqual({ lockfileVersion: 1, sources: {} });
    });
  });

  describe("readLockFile", () => {
    it("should return empty lock when file does not exist", async () => {
      vi.mocked(fileExists).mockResolvedValue(false);

      const lock = await readLockFile({ baseDir: "/project" });

      expect(lock).toEqual({ lockfileVersion: 1, sources: {} });
      expect(fileExists).toHaveBeenCalledWith(
        join("/project", RULESYNC_SOURCES_LOCK_RELATIVE_FILE_PATH),
      );
    });

    it("should parse a valid lockfile", async () => {
      const lockContent = JSON.stringify({
        lockfileVersion: 1,
        sources: {
          "https://github.com/org/repo": {
            resolvedRef: "abc123",
            skills: {
              "skill-a": { integrity: "sha256-abc" },
              "skill-b": { integrity: "sha256-def" },
            },
          },
        },
      });

      vi.mocked(fileExists).mockResolvedValue(true);
      vi.mocked(readFileContent).mockResolvedValue(lockContent);

      const lock = await readLockFile({ baseDir: "/project" });

      expect(lock.sources["https://github.com/org/repo"]).toEqual({
        resolvedRef: "abc123",
        skills: {
          "skill-a": { integrity: "sha256-abc" },
          "skill-b": { integrity: "sha256-def" },
        },
      });
    });

    it("should return empty lock for invalid JSON", async () => {
      vi.mocked(fileExists).mockResolvedValue(true);
      vi.mocked(readFileContent).mockResolvedValue("not-json");

      const lock = await readLockFile({ baseDir: "/project" });

      expect(lock).toEqual({ lockfileVersion: 1, sources: {} });
    });

    it("should return empty lock for invalid schema", async () => {
      vi.mocked(fileExists).mockResolvedValue(true);
      vi.mocked(readFileContent).mockResolvedValue(JSON.stringify({ wrong: "shape" }));

      const lock = await readLockFile({ baseDir: "/project" });

      expect(lock).toEqual({ lockfileVersion: 1, sources: {} });
    });

    it("should return empty lock when read throws", async () => {
      vi.mocked(fileExists).mockResolvedValue(true);
      vi.mocked(readFileContent).mockRejectedValue(new Error("read error"));

      const lock = await readLockFile({ baseDir: "/project" });

      expect(lock).toEqual({ lockfileVersion: 1, sources: {} });
    });

    it("should migrate legacy lockfile format", async () => {
      const legacyContent = JSON.stringify({
        sources: {
          "org/repo": {
            resolvedRef: "abc123",
            skills: ["skill-a", "skill-b"],
          },
        },
      });

      vi.mocked(fileExists).mockResolvedValue(true);
      vi.mocked(readFileContent).mockResolvedValue(legacyContent);

      const lock = await readLockFile({ baseDir: "/project" });

      expect(lock).toEqual({
        lockfileVersion: 1,
        sources: {
          "org/repo": {
            resolvedRef: "abc123",
            skills: {
              "skill-a": { integrity: "" },
              "skill-b": { integrity: "" },
            },
          },
        },
      });
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("Migrated legacy sources lockfile"),
      );
    });
  });

  describe("writeLockFile", () => {
    it("should write formatted JSON to the lockfile path", async () => {
      vi.mocked(writeFileContent).mockResolvedValue(undefined);

      const lock = {
        lockfileVersion: LOCKFILE_VERSION,
        sources: {
          "https://github.com/org/repo": {
            resolvedRef: "abc123",
            skills: { "skill-a": { integrity: "sha256-x" } },
          },
        },
      };

      await writeLockFile({ baseDir: "/project", lock });

      const expectedPath = join("/project", RULESYNC_SOURCES_LOCK_RELATIVE_FILE_PATH);
      expect(writeFileContent).toHaveBeenCalledWith(
        expectedPath,
        JSON.stringify(lock, null, 2) + "\n",
      );
    });
  });

  describe("normalizeSourceKey", () => {
    it("should strip https://github.com/ prefix", () => {
      expect(normalizeSourceKey("https://github.com/org/repo")).toBe("org/repo");
    });

    it("should strip https://www.github.com/ prefix", () => {
      expect(normalizeSourceKey("https://www.github.com/org/repo")).toBe("org/repo");
    });

    it("should strip http://github.com/ prefix", () => {
      expect(normalizeSourceKey("http://github.com/org/repo")).toBe("org/repo");
    });

    it("should strip github: prefix", () => {
      expect(normalizeSourceKey("github:org/repo")).toBe("org/repo");
    });

    it("should remove trailing slashes", () => {
      expect(normalizeSourceKey("org/repo/")).toBe("org/repo");
      expect(normalizeSourceKey("org/repo///")).toBe("org/repo");
    });

    it("should remove .git suffix", () => {
      expect(normalizeSourceKey("https://github.com/org/repo.git")).toBe("org/repo");
    });

    it("should lowercase the key", () => {
      expect(normalizeSourceKey("Org/Repo")).toBe("org/repo");
      expect(normalizeSourceKey("https://github.com/ORG/REPO")).toBe("org/repo");
    });

    it("should leave shorthand format unchanged (except lowercase)", () => {
      expect(normalizeSourceKey("org/repo")).toBe("org/repo");
    });

    it("should handle combined transformations", () => {
      expect(normalizeSourceKey("https://github.com/ORG/Repo.git/")).toBe("org/repo");
    });
  });

  describe("getLockedSource", () => {
    it("should return the locked entry for an existing source key", () => {
      const lock = {
        lockfileVersion: LOCKFILE_VERSION,
        sources: {
          "https://github.com/org/repo": {
            resolvedRef: "abc123",
            skills: { "skill-a": { integrity: "sha256-x" } },
          },
        },
      };

      const result = getLockedSource(lock, "https://github.com/org/repo");

      expect(result).toEqual({
        resolvedRef: "abc123",
        skills: { "skill-a": { integrity: "sha256-x" } },
      });
    });

    it("should return undefined for a missing source key", () => {
      const lock = { lockfileVersion: LOCKFILE_VERSION, sources: {} };

      const result = getLockedSource(lock, "https://github.com/org/repo");

      expect(result).toBeUndefined();
    });

    it("should find entry regardless of source format", () => {
      const lock = {
        lockfileVersion: LOCKFILE_VERSION,
        sources: {
          "org/repo": {
            resolvedRef: "abc123",
            skills: { "skill-a": { integrity: "sha256-x" } },
          },
        },
      };

      // Look up with URL format, should find shorthand key
      const result = getLockedSource(lock, "https://github.com/org/repo");
      expect(result).toEqual({
        resolvedRef: "abc123",
        skills: { "skill-a": { integrity: "sha256-x" } },
      });
    });
  });

  describe("setLockedSource", () => {
    it("should add a new source entry", () => {
      const lock = { lockfileVersion: LOCKFILE_VERSION, sources: {} };

      const result = setLockedSource(lock, "https://github.com/org/repo", {
        resolvedRef: "abc123",
        skills: { "skill-a": { integrity: "sha256-x" } },
      });

      expect(result.sources["org/repo"]).toEqual({
        resolvedRef: "abc123",
        skills: { "skill-a": { integrity: "sha256-x" } },
      });
    });

    it("should update an existing source entry", () => {
      const lock = {
        lockfileVersion: LOCKFILE_VERSION,
        sources: {
          "https://github.com/org/repo": {
            resolvedRef: "old-sha",
            skills: { "skill-a": { integrity: "sha256-x" } },
          },
        },
      };

      const result = setLockedSource(lock, "https://github.com/org/repo", {
        resolvedRef: "new-sha",
        skills: {
          "skill-a": { integrity: "sha256-x" },
          "skill-b": { integrity: "sha256-y" },
        },
      });

      expect(result.sources["org/repo"]).toEqual({
        resolvedRef: "new-sha",
        skills: {
          "skill-a": { integrity: "sha256-x" },
          "skill-b": { integrity: "sha256-y" },
        },
      });
    });

    it("should deduplicate entries with different formats for the same source", () => {
      const lock = {
        lockfileVersion: LOCKFILE_VERSION,
        sources: {
          "https://github.com/org/repo": {
            resolvedRef: "old-sha",
            skills: { "skill-a": { integrity: "sha256-x" } },
          },
        },
      };

      const result = setLockedSource(lock, "org/repo", {
        resolvedRef: "new-sha",
        skills: { "skill-b": { integrity: "sha256-y" } },
      });

      // Old URL-format entry should be removed, replaced with normalized key
      expect(result.sources["https://github.com/org/repo"]).toBeUndefined();
      expect(result.sources["org/repo"]).toEqual({
        resolvedRef: "new-sha",
        skills: { "skill-b": { integrity: "sha256-y" } },
      });
    });

    it("should not mutate the original lock", () => {
      const lock = { lockfileVersion: LOCKFILE_VERSION, sources: {} };
      const result = setLockedSource(lock, "key", { resolvedRef: "sha", skills: {} });

      expect(lock.sources).toEqual({});
      expect(result.sources["key"]).toBeDefined();
    });
  });

  describe("computeSkillIntegrity", () => {
    it("should produce deterministic hash for same content", () => {
      const filesA = [
        { path: "b.md", content: "hello" },
        { path: "a.md", content: "world" },
      ];
      const filesB = [
        { path: "a.md", content: "world" },
        { path: "b.md", content: "hello" },
      ];

      expect(computeSkillIntegrity(filesA)).toBe(computeSkillIntegrity(filesB));
    });

    it("should produce different hash for different content", () => {
      const filesA = [{ path: "a.md", content: "hello" }];
      const filesB = [{ path: "a.md", content: "world" }];

      expect(computeSkillIntegrity(filesA)).not.toBe(computeSkillIntegrity(filesB));
    });

    it("should return sha256- prefixed string", () => {
      const result = computeSkillIntegrity([{ path: "a.md", content: "test" }]);

      expect(result).toMatch(/^sha256-[0-9a-f]+$/);
    });
  });

  describe("getLockedSkillNames", () => {
    it("should return skill names from a locked source entry", () => {
      const entry = {
        resolvedRef: "sha",
        skills: {
          a: { integrity: "sha256-x" },
          b: { integrity: "sha256-y" },
        },
      };

      expect(getLockedSkillNames(entry)).toEqual(["a", "b"]);
    });

    it("should return empty array for entry with no skills", () => {
      const entry = {
        resolvedRef: "sha",
        skills: {},
      };

      expect(getLockedSkillNames(entry)).toEqual([]);
    });
  });
});
