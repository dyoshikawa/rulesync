import { describe, expect, it } from "vitest";

import {
  isSharedUserManagedConfigPath,
  SHARED_USER_MANAGED_CONFIG_PATHS,
} from "./shared-config-paths.js";

describe("SHARED_USER_MANAGED_CONFIG_PATHS", () => {
  it("stores paths without the glob prefix so the gitignore derivation can add it", () => {
    for (const path of SHARED_USER_MANAGED_CONFIG_PATHS) {
      expect(path.startsWith("*")).toBe(false);
      expect(path.startsWith("/")).toBe(false);
    }
  });
});

describe("isSharedUserManagedConfigPath", () => {
  it("matches a listed path at the project root", () => {
    expect(isSharedUserManagedConfigPath(".antigravity/settings.json")).toBe(true);
    expect(isSharedUserManagedConfigPath(".factory/settings.json")).toBe(true);
    expect(isSharedUserManagedConfigPath("opencode.json")).toBe(true);
  });

  it("matches at any depth, mirroring the `**` gitignore entries", () => {
    expect(isSharedUserManagedConfigPath("packages/app/.vscode/settings.json")).toBe(true);
    expect(isSharedUserManagedConfigPath("packages/app/reasonix.toml")).toBe(true);
  });

  it("normalizes a leading ./ and native separators", () => {
    expect(isSharedUserManagedConfigPath("./.claude/settings.json")).toBe(true);
    expect(isSharedUserManagedConfigPath(".claude\\settings.json")).toBe(true);
  });

  it("does not match files rulesync owns outright", () => {
    expect(isSharedUserManagedConfigPath(".agents/hooks.json")).toBe(false);
    expect(isSharedUserManagedConfigPath(".cursor/mcp.json")).toBe(false);
    expect(isSharedUserManagedConfigPath(".junie/allowlist.json")).toBe(false);
    expect(isSharedUserManagedConfigPath("AGENTS.md")).toBe(false);
  });

  it("does not match on a partial final segment", () => {
    expect(isSharedUserManagedConfigPath("my-opencode.json")).toBe(false);
    expect(isSharedUserManagedConfigPath("not-reasonix.toml")).toBe(false);
  });
});
