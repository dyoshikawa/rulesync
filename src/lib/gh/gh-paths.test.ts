import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import {
  type GhAgent,
  type GhScope,
  relativeInstallDirFor,
  resolveGhInstallDir,
} from "./gh-paths.js";

describe("relativeInstallDirFor", () => {
  // Project scope: github-copilot + the four "shared layout" agents all
  // collapse to .agents/skills; claude-code is the lone exception.
  const PROJECT_CASES: Array<[GhAgent, string]> = [
    ["github-copilot", join(".agents", "skills")],
    ["claude-code", join(".claude", "skills")],
    ["cursor", join(".agents", "skills")],
    ["codex", join(".agents", "skills")],
    ["gemini", join(".agents", "skills")],
    ["antigravity", join(".agents", "skills")],
  ];

  it.each(PROJECT_CASES)("project scope: %s -> %s", (agent, expected) => {
    expect(relativeInstallDirFor({ agent, scope: "project" })).toBe(expected);
  });

  // User scope: each agent fans out to its own per-tool dot-prefixed directory.
  const USER_CASES: Array<[GhAgent, string]> = [
    ["github-copilot", join(".copilot", "skills")],
    ["claude-code", join(".claude", "skills")],
    ["cursor", join(".cursor", "skills")],
    ["codex", join(".codex", "skills")],
    ["gemini", join(".gemini", "skills")],
    ["antigravity", join(".gemini", "antigravity", "skills")],
  ];

  it.each(USER_CASES)("user scope: %s -> %s", (agent, expected) => {
    expect(relativeInstallDirFor({ agent, scope: "user" })).toBe(expected);
  });
});

describe("resolveGhInstallDir", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;
  let originalHome: string | undefined;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory({ home: true }));
    originalHome = process.env.HOME_DIR;
    process.env.HOME_DIR = testDir;
  });

  afterEach(async () => {
    if (originalHome === undefined) {
      delete process.env.HOME_DIR;
    } else {
      process.env.HOME_DIR = originalHome;
    }
    await cleanup();
  });

  it("returns absolute path under baseDir for project scope", () => {
    const baseDir = "/tmp/some-project";
    expect(resolveGhInstallDir({ agent: "github-copilot", scope: "project", baseDir })).toBe(
      join(baseDir, ".agents", "skills"),
    );
    expect(resolveGhInstallDir({ agent: "claude-code", scope: "project", baseDir })).toBe(
      join(baseDir, ".claude", "skills"),
    );
  });

  it("returns absolute path under HOME_DIR for user scope", () => {
    const cases: Array<[GhAgent, GhScope, string]> = [
      ["github-copilot", "user", join(testDir, ".copilot", "skills")],
      ["antigravity", "user", join(testDir, ".gemini", "antigravity", "skills")],
    ];
    for (const [agent, scope, expected] of cases) {
      expect(resolveGhInstallDir({ agent, scope, baseDir: "/ignored" })).toBe(expected);
    }
  });
});
