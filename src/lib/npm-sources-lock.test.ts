import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RULESYNC_NPM_SOURCES_LOCK_RELATIVE_FILE_PATH } from "../constants/rulesync-paths.js";
import { createMockLogger } from "../test-utils/mock-logger.js";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { readFileContent, writeFileContent } from "../utils/file.js";
import {
  createEmptyNpmLock,
  getNpmLockedSkillNames,
  getNpmLockedSource,
  NPM_LOCKFILE_VERSION,
  readNpmLockFile,
  setNpmLockedSource,
  writeNpmLockFile,
} from "./npm-sources-lock.js";

const logger = createMockLogger();

describe("npm-sources-lock", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  it("returns an empty lock when the lockfile does not exist", async () => {
    const lock = await readNpmLockFile({ projectRoot: testDir, logger });
    expect(lock).toEqual({ lockfileVersion: NPM_LOCKFILE_VERSION, sources: {} });
  });

  it("round-trips a lock through write and read", async () => {
    const lock = setNpmLockedSource(createEmptyNpmLock(), "@acme/skills", {
      registry: "https://registry.example.com",
      requestedVersion: "latest",
      resolvedVersion: "1.2.3",
      integrity: "sha512-fakeintegrityvalue",
      resolvedAt: "2026-01-01T00:00:00.000Z",
      skills: { "my-skill": { integrity: "sha256-fakehash" } },
    });

    await writeNpmLockFile({ projectRoot: testDir, lock, logger });
    const readBack = await readNpmLockFile({ projectRoot: testDir, logger });

    expect(readBack).toEqual(lock);
    const entry = getNpmLockedSource(readBack, "@acme/skills");
    expect(entry?.resolvedVersion).toBe("1.2.3");
    expect(getNpmLockedSkillNames(entry!)).toEqual(["my-skill"]);
  });

  it("returns an empty lock for invalid lockfile content", async () => {
    await writeFileContent(
      join(testDir, RULESYNC_NPM_SOURCES_LOCK_RELATIVE_FILE_PATH),
      '{"not": "a lock"}',
    );

    const lock = await readNpmLockFile({ projectRoot: testDir, logger });
    expect(lock).toEqual({ lockfileVersion: NPM_LOCKFILE_VERSION, sources: {} });
    expect(logger.warn).toHaveBeenCalled();
  });

  it("returns an empty lock for unparseable content", async () => {
    await writeFileContent(
      join(testDir, RULESYNC_NPM_SOURCES_LOCK_RELATIVE_FILE_PATH),
      "not json at all",
    );

    const lock = await readNpmLockFile({ projectRoot: testDir, logger });
    expect(lock).toEqual({ lockfileVersion: NPM_LOCKFILE_VERSION, sources: {} });
  });

  it("writes JSON with a trailing newline", async () => {
    await writeNpmLockFile({ projectRoot: testDir, lock: createEmptyNpmLock(), logger });
    const content = await readFileContent(
      join(testDir, RULESYNC_NPM_SOURCES_LOCK_RELATIVE_FILE_PATH),
    );
    expect(content.endsWith("\n")).toBe(true);
  });

  it("looks up sources by trimmed key", () => {
    const lock = setNpmLockedSource(createEmptyNpmLock(), " my-pkg ", {
      resolvedVersion: "1.0.0",
      skills: {},
    });
    expect(getNpmLockedSource(lock, "my-pkg")?.resolvedVersion).toBe("1.0.0");
    expect(getNpmLockedSource(lock, "other-pkg")).toBeUndefined();
  });
});
