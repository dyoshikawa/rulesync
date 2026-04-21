import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { readFileContent } from "../../utils/file.js";
import {
  APM_LOCKFILE_VERSION,
  createEmptyApmLock,
  findApmLockDependency,
  getApmLockPath,
  parseApmLock,
  readApmLock,
  serializeApmLock,
  writeApmLock,
} from "./apm-lock.js";

const VALID_SHA = "a".repeat(40);

describe("apm-lock", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("createEmptyApmLock", () => {
    it("uses the APM v1 lockfile_version and a provided apm_version string", () => {
      const lock = createEmptyApmLock({ apmVersion: "rulesync-compat/0.1" });
      expect(lock.lockfile_version).toBe(APM_LOCKFILE_VERSION);
      expect(lock.apm_version).toBe("rulesync-compat/0.1");
      expect(lock.dependencies).toEqual([]);
      expect(typeof lock.generated_at).toBe("string");
    });
  });

  describe("parseApmLock", () => {
    it("returns null for empty content", () => {
      expect(parseApmLock("")).toBeNull();
    });

    it("returns null for malformed YAML", () => {
      expect(parseApmLock("::: not yaml :::")).toBeNull();
    });

    it("parses a minimal v1 lockfile", () => {
      const content = `lockfile_version: "1"
generated_at: "2026-04-20T00:00:00Z"
apm_version: "0.7.7"
dependencies:
  - repo_url: https://github.com/owner/repo
    resolved_commit: ${VALID_SHA}
    resolved_ref: v1.0.0
    version: "1.0.0"
    depth: 1
    package_type: apm_package
    deployed_files:
      - .github/instructions/security.instructions.md
`;
      const parsed = parseApmLock(content);
      expect(parsed).not.toBeNull();
      expect(parsed?.dependencies).toHaveLength(1);
      expect(parsed?.dependencies[0]).toMatchObject({
        repo_url: "https://github.com/owner/repo",
        resolved_commit: VALID_SHA,
        depth: 1,
        package_type: "apm_package",
      });
    });

    it("preserves unknown fields via looseObject", () => {
      const validHash = `sha256:${"0".repeat(64)}`;
      const content = `lockfile_version: "1"
generated_at: "2026-04-20T00:00:00Z"
apm_version: "0.7.7"
mcp_servers:
  - security-scanner
dependencies:
  - repo_url: https://github.com/owner/repo
    resolved_commit: ${VALID_SHA}
    resolved_ref: main
    depth: 1
    package_type: apm_package
    content_hash: ${validHash}
    deployed_files: []
    future_field: preserved
`;
      const parsed = parseApmLock(content);
      expect(parsed).not.toBeNull();
      expect(parsed?.mcp_servers).toEqual(["security-scanner"]);
      expect(parsed?.dependencies[0]).toMatchObject({
        content_hash: validHash,
        future_field: "preserved",
      });
    });

    it("throws when a dependency has a non-SHA resolved_commit", () => {
      const content = `lockfile_version: "1"
generated_at: "2026-04-20T00:00:00Z"
apm_version: "0.7.7"
dependencies:
  - repo_url: https://github.com/owner/repo
    resolved_commit: not-a-sha
    resolved_ref: main
    depth: 1
    package_type: apm_package
    deployed_files: []
`;
      expect(() => parseApmLock(content)).toThrow(/resolved_commit/);
    });

    it("throws when depth is negative", () => {
      const content = `lockfile_version: "1"
generated_at: "2026-04-20T00:00:00Z"
apm_version: "0.7.7"
dependencies:
  - repo_url: https://github.com/owner/repo
    resolved_commit: ${VALID_SHA}
    resolved_ref: main
    depth: -1
    package_type: apm_package
    deployed_files: []
`;
      expect(() => parseApmLock(content)).toThrow(/Invalid apm\.lock\.yaml/);
    });

    it("throws when content_hash does not match sha256:<64-hex>", () => {
      const content = `lockfile_version: "1"
generated_at: "2026-04-20T00:00:00Z"
apm_version: "0.7.7"
dependencies:
  - repo_url: https://github.com/owner/repo
    resolved_commit: ${VALID_SHA}
    resolved_ref: main
    depth: 1
    package_type: apm_package
    content_hash: sha256:abc
    deployed_files: []
`;
      expect(() => parseApmLock(content)).toThrow(/content_hash/);
    });

    it('throws when lockfile_version is not "1"', () => {
      const content = `lockfile_version: "2"
generated_at: "2026-04-20T00:00:00Z"
apm_version: "0.7.7"
dependencies: []
`;
      expect(() => parseApmLock(content)).toThrow(/Invalid apm\.lock\.yaml/);
    });
  });

  describe("serializeApmLock", () => {
    it("round-trips a simple lockfile", () => {
      const original = createEmptyApmLock({ apmVersion: "0.7.7" });
      original.dependencies.push({
        repo_url: "https://github.com/owner/repo",
        resolved_commit: VALID_SHA,
        resolved_ref: "main",
        depth: 1,
        package_type: "apm_package",
        deployed_files: [".github/instructions/a.instructions.md"],
      });
      const serialized = serializeApmLock(original);
      const parsed = parseApmLock(serialized);
      expect(parsed).toEqual(original);
    });
  });

  describe("read/write", () => {
    let testDir: string;
    let cleanup: () => Promise<void>;

    beforeEach(async () => {
      ({ testDir, cleanup } = await setupTestDirectory());
    });

    afterEach(async () => {
      await cleanup();
    });

    it("returns null when the lockfile does not exist", async () => {
      expect(await readApmLock(testDir)).toBeNull();
    });

    it("writes and reads back a lockfile", async () => {
      const lock = createEmptyApmLock({ apmVersion: "0.7.7" });
      lock.dependencies.push({
        repo_url: "https://github.com/owner/repo",
        resolved_commit: VALID_SHA,
        resolved_ref: "main",
        depth: 1,
        package_type: "apm_package",
        deployed_files: [".github/instructions/a.instructions.md"],
      });
      await writeApmLock({ baseDir: testDir, lock });
      const written = await readFileContent(getApmLockPath(testDir));
      expect(written).toContain("lockfile_version:");
      const readBack = await readApmLock(testDir);
      expect(readBack).toEqual(lock);
    });
  });

  describe("findApmLockDependency", () => {
    it("matches on exact repo_url", () => {
      const lock = createEmptyApmLock({ apmVersion: "0.7.7" });
      lock.dependencies.push({
        repo_url: "https://github.com/owner/repo",
        resolved_commit: VALID_SHA,
        resolved_ref: "main",
        depth: 1,
        package_type: "apm_package",
        deployed_files: [],
      });
      expect(findApmLockDependency(lock, "https://github.com/owner/repo")).toBeDefined();
      expect(findApmLockDependency(lock, "https://github.com/owner/other")).toBeUndefined();
    });
  });
});
