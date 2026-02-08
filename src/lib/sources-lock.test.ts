import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_SOURCES_LOCK_RELATIVE_FILE_PATH } from "../constants/rulesync-paths.js";
import { fileExists, readFileContent, writeFileContent } from "../utils/file.js";
import {
  createEmptyLock,
  getLockedSource,
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

describe("sources-lock", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("createEmptyLock", () => {
    it("should return an empty lock structure", () => {
      const lock = createEmptyLock();
      expect(lock).toEqual({ sources: {} });
    });
  });

  describe("readLockFile", () => {
    it("should return empty lock when file does not exist", async () => {
      vi.mocked(fileExists).mockResolvedValue(false);

      const lock = await readLockFile({ baseDir: "/project" });

      expect(lock).toEqual({ sources: {} });
      expect(fileExists).toHaveBeenCalledWith(
        join("/project", RULESYNC_SOURCES_LOCK_RELATIVE_FILE_PATH),
      );
    });

    it("should parse a valid lockfile", async () => {
      const lockContent = JSON.stringify({
        sources: {
          "https://github.com/org/repo": {
            resolvedRef: "abc123",
            skills: ["skill-a", "skill-b"],
          },
        },
      });

      vi.mocked(fileExists).mockResolvedValue(true);
      vi.mocked(readFileContent).mockResolvedValue(lockContent);

      const lock = await readLockFile({ baseDir: "/project" });

      expect(lock.sources["https://github.com/org/repo"]).toEqual({
        resolvedRef: "abc123",
        skills: ["skill-a", "skill-b"],
      });
    });

    it("should return empty lock for invalid JSON", async () => {
      vi.mocked(fileExists).mockResolvedValue(true);
      vi.mocked(readFileContent).mockResolvedValue("not-json");

      const lock = await readLockFile({ baseDir: "/project" });

      expect(lock).toEqual({ sources: {} });
    });

    it("should return empty lock for invalid schema", async () => {
      vi.mocked(fileExists).mockResolvedValue(true);
      vi.mocked(readFileContent).mockResolvedValue(JSON.stringify({ wrong: "shape" }));

      const lock = await readLockFile({ baseDir: "/project" });

      expect(lock).toEqual({ sources: {} });
    });

    it("should return empty lock when read throws", async () => {
      vi.mocked(fileExists).mockResolvedValue(true);
      vi.mocked(readFileContent).mockRejectedValue(new Error("read error"));

      const lock = await readLockFile({ baseDir: "/project" });

      expect(lock).toEqual({ sources: {} });
    });
  });

  describe("writeLockFile", () => {
    it("should write formatted JSON to the lockfile path", async () => {
      vi.mocked(writeFileContent).mockResolvedValue(undefined);

      const lock = {
        sources: {
          "https://github.com/org/repo": {
            resolvedRef: "abc123",
            skills: ["skill-a"],
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

  describe("getLockedSource", () => {
    it("should return the locked entry for an existing source key", () => {
      const lock = {
        sources: {
          "https://github.com/org/repo": {
            resolvedRef: "abc123",
            skills: ["skill-a"],
          },
        },
      };

      const result = getLockedSource(lock, "https://github.com/org/repo");

      expect(result).toEqual({ resolvedRef: "abc123", skills: ["skill-a"] });
    });

    it("should return undefined for a missing source key", () => {
      const lock = { sources: {} };

      const result = getLockedSource(lock, "https://github.com/org/repo");

      expect(result).toBeUndefined();
    });
  });

  describe("setLockedSource", () => {
    it("should add a new source entry", () => {
      const lock = { sources: {} };

      const result = setLockedSource(lock, "https://github.com/org/repo", {
        resolvedRef: "abc123",
        skills: ["skill-a"],
      });

      expect(result.sources["https://github.com/org/repo"]).toEqual({
        resolvedRef: "abc123",
        skills: ["skill-a"],
      });
    });

    it("should update an existing source entry", () => {
      const lock = {
        sources: {
          "https://github.com/org/repo": {
            resolvedRef: "old-sha",
            skills: ["skill-a"],
          },
        },
      };

      const result = setLockedSource(lock, "https://github.com/org/repo", {
        resolvedRef: "new-sha",
        skills: ["skill-a", "skill-b"],
      });

      expect(result.sources["https://github.com/org/repo"]).toEqual({
        resolvedRef: "new-sha",
        skills: ["skill-a", "skill-b"],
      });
    });

    it("should not mutate the original lock", () => {
      const lock = { sources: {} };
      const result = setLockedSource(lock, "key", { resolvedRef: "sha", skills: [] });

      expect(lock.sources).toEqual({});
      expect(result.sources["key"]).toBeDefined();
    });
  });
});
