import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { readFileContent } from "../../utils/file.js";
import {
  createEmptyGhLock,
  findGhLockInstallation,
  GH_LOCKFILE_VERSION,
  getGhLockPath,
  parseGhLock,
  readGhLock,
  serializeGhLock,
  writeGhLock,
} from "./gh-lock.js";

const VALID_SHA = "a".repeat(40);

describe("gh-lock", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("createEmptyGhLock", () => {
    it("uses lockfile_version 1 and an empty installations array", () => {
      const lock = createEmptyGhLock();
      expect(lock.lockfile_version).toBe(GH_LOCKFILE_VERSION);
      expect(lock.installations).toEqual([]);
      expect(typeof lock.generated_at).toBe("string");
    });

    it("preserves top-level looseObject extras from existingLock", () => {
      const existing = parseGhLock(
        `lockfile_version: "1"
generated_at: "2026-04-20T00:00:00Z"
custom_top_level:
  any: thing
installations: []
`,
      );
      expect(existing).not.toBeNull();
      const lock = createEmptyGhLock({ existingLock: existing });
      expect((lock as unknown as { custom_top_level: unknown }).custom_top_level).toEqual({
        any: "thing",
      });
      expect(lock.installations).toEqual([]);
    });
  });

  describe("parseGhLock", () => {
    it("returns null for empty content", () => {
      expect(parseGhLock("")).toBeNull();
    });

    it("returns null for malformed YAML", () => {
      expect(parseGhLock("::: not yaml :::")).toBeNull();
    });

    it("parses a minimal v1 lockfile", () => {
      const content = `lockfile_version: "1"
generated_at: "2026-04-20T00:00:00Z"
installations:
  - source: owner/repo
    owner: owner
    repo: repo
    agent: claude-code
    scope: project
    skill: my-skill
    resolved_ref: v1.0.0
    resolved_commit: ${VALID_SHA}
    install_dir: .claude/skills
    deployed_files:
      - .claude/skills/my-skill/SKILL.md
`;
      const parsed = parseGhLock(content);
      expect(parsed).not.toBeNull();
      expect(parsed?.installations).toHaveLength(1);
      expect(parsed?.installations[0]).toMatchObject({
        source: "owner/repo",
        agent: "claude-code",
        scope: "project",
        skill: "my-skill",
        resolved_commit: VALID_SHA,
      });
    });

    it("preserves unknown installation fields via looseObject", () => {
      const content = `lockfile_version: "1"
generated_at: "2026-04-20T00:00:00Z"
installations:
  - source: owner/repo
    owner: owner
    repo: repo
    agent: claude-code
    scope: project
    skill: my-skill
    resolved_ref: v1.0.0
    resolved_commit: ${VALID_SHA}
    install_dir: .claude/skills
    deployed_files: []
    future_field: preserved
`;
      const parsed = parseGhLock(content);
      expect(parsed?.installations[0]).toMatchObject({
        future_field: "preserved",
      });
    });

    it("throws when resolved_commit is not a 40-char SHA", () => {
      const content = `lockfile_version: "1"
generated_at: "2026-04-20T00:00:00Z"
installations:
  - source: owner/repo
    owner: owner
    repo: repo
    agent: claude-code
    scope: project
    skill: my-skill
    resolved_ref: v1.0.0
    resolved_commit: not-a-sha
    install_dir: .claude/skills
    deployed_files: []
`;
      expect(() => parseGhLock(content)).toThrow(/resolved_commit/);
    });

    it('throws when lockfile_version is not "1"', () => {
      const content = `lockfile_version: "2"
generated_at: "2026-04-20T00:00:00Z"
installations: []
`;
      expect(() => parseGhLock(content)).toThrow(/Invalid rulesync-gh\.lock\.yaml/);
    });

    it("throws when scope is not project|user", () => {
      const content = `lockfile_version: "1"
generated_at: "2026-04-20T00:00:00Z"
installations:
  - source: owner/repo
    owner: owner
    repo: repo
    agent: claude-code
    scope: global
    skill: my-skill
    resolved_ref: v1.0.0
    resolved_commit: ${VALID_SHA}
    install_dir: .claude/skills
    deployed_files: []
`;
      expect(() => parseGhLock(content)).toThrow(/Invalid rulesync-gh\.lock\.yaml/);
    });
  });

  describe("serializeGhLock round-trip", () => {
    it("survives a serialize/parse round-trip", () => {
      const lock = createEmptyGhLock();
      lock.installations.push({
        source: "owner/repo",
        owner: "owner",
        repo: "repo",
        agent: "claude-code",
        scope: "project",
        skill: "my-skill",
        resolved_ref: "v1.0.0",
        resolved_commit: VALID_SHA,
        install_dir: ".claude/skills",
        deployed_files: [".claude/skills/my-skill/SKILL.md"],
      });
      const serialized = serializeGhLock(lock);
      const parsed = parseGhLock(serialized);
      expect(parsed).toEqual(lock);
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
      expect(await readGhLock(testDir)).toBeNull();
    });

    it("writes and reads back a lockfile", async () => {
      const lock = createEmptyGhLock();
      lock.installations.push({
        source: "owner/repo",
        owner: "owner",
        repo: "repo",
        agent: "claude-code",
        scope: "project",
        skill: "my-skill",
        resolved_ref: "v1.0.0",
        resolved_commit: VALID_SHA,
        install_dir: ".claude/skills",
        deployed_files: [],
      });
      await writeGhLock({ projectRoot: testDir, lock });
      const written = await readFileContent(getGhLockPath(testDir));
      expect(written).toContain("lockfile_version:");
      const readBack = await readGhLock(testDir);
      expect(readBack).toEqual(lock);
    });
  });

  describe("findGhLockInstallation", () => {
    it("matches the (source, agent, scope, skill) tuple case-insensitively on source", () => {
      const lock = createEmptyGhLock();
      lock.installations.push({
        source: "Owner/Repo",
        owner: "owner",
        repo: "repo",
        agent: "claude-code",
        scope: "project",
        skill: "my-skill",
        resolved_ref: "v1",
        resolved_commit: VALID_SHA,
        install_dir: ".claude/skills",
        deployed_files: [],
      });
      expect(
        findGhLockInstallation(lock, {
          source: "owner/repo",
          agent: "claude-code",
          scope: "project",
          skill: "my-skill",
        }),
      ).toBeDefined();
      expect(
        findGhLockInstallation(lock, {
          source: "owner/repo",
          agent: "claude-code",
          scope: "user",
          skill: "my-skill",
        }),
      ).toBeUndefined();
      expect(
        findGhLockInstallation(lock, {
          source: "owner/other",
          agent: "claude-code",
          scope: "project",
          skill: "my-skill",
        }),
      ).toBeUndefined();
    });
  });
});
