import { describe, expect, it } from "vitest";

import type { PermissionAction } from "../../types/permissions.js";
import {
  collectShellCommandRules,
  createShadowedAllowTest,
  partitionCommandRules,
} from "./shell-command-categories.js";

const bashRule = (pattern: string, action: PermissionAction) => ({
  pattern,
  action,
  fromAllToolsCategory: false,
});

const allToolsRule = (pattern: string, action: PermissionAction) => ({
  pattern,
  action,
  fromAllToolsCategory: true,
});

describe("collectShellCommandRules", () => {
  it("collects every bash rule in the order it was written", () => {
    const { rules, foreignDenyCategories } = collectShellCommandRules({
      bash: { "git *": "allow", "npm *": "ask", "rm -rf *": "deny" },
    });

    expect(rules).toEqual([
      bashRule("git *", "allow"),
      bashRule("npm *", "ask"),
      bashRule("rm -rf *", "deny"),
    ]);
    expect(foreignDenyCategories).toEqual([]);
  });

  it("collects the all-tools category's restricting rules", () => {
    // A `deny` written under `*` covers shell commands too. Dropping it would
    // leave an adapter auto-approving the very command the file blocks.
    const { rules } = collectShellCommandRules({
      "*": { "rm *": "deny", "npm *": "ask" },
      bash: { "rm *": "allow" },
    });

    expect(rules).toEqual([
      allToolsRule("rm *", "deny"),
      allToolsRule("npm *", "ask"),
      bashRule("rm *", "allow"),
    ]);
  });

  it("does not report the all-tools category as a foreign deny", () => {
    // It is no longer a restriction the adapters cannot express, so the
    // "cannot be represented" warning must not name it.
    const { foreignDenyCategories } = collectShellCommandRules({ "*": { "rm *": "deny" } });

    expect(foreignDenyCategories).toEqual([]);
  });

  it("never collects the all-tools category's allow rules", () => {
    // A pattern under `*` need not be a command at all, so carrying it in the
    // permissive direction would grant something the author never said about
    // commands.
    const { rules } = collectShellCommandRules({
      "*": { "src/**": "allow" },
      bash: { "git *": "allow" },
    });

    expect(rules).toEqual([bashRule("git *", "allow")]);
  });

  it("reports only the other categories that carry a deny rule", () => {
    const { rules, foreignDenyCategories } = collectShellCommandRules({
      read: { "src/**": "allow" },
      write: { "secrets/**": "deny" },
      webfetch: { "*": "ask" },
      mcp__github: { "*": "deny" },
    });

    expect(rules).toEqual([]);
    expect(foreignDenyCategories).toEqual(["write", "mcp__github"]);
  });

  it("returns nothing for an empty config", () => {
    expect(collectShellCommandRules({})).toEqual({ rules: [], foreignDenyCategories: [] });
  });
});

describe("createShadowedAllowTest", () => {
  it("compares the two patterns in both directions", () => {
    // The stricter rule wins whatever its width, so a broad restriction covers
    // a narrow allow and a broad allow is covered by a narrow restriction.
    const isShadowed = createShadowedAllowTest(["*", "npm publish"]);

    expect(isShadowed("git *")).toBe(true);
    expect(isShadowed("npm *")).toBe(true);
  });

  it("leaves an allow no restriction reaches alone", () => {
    const isShadowed = createShadowedAllowTest(["npm publish"]);

    expect(isShadowed("git *")).toBe(false);
  });
});

describe("partitionCommandRules", () => {
  it("splits allow and deny and writes no list for ask", () => {
    const { allow, deny, shadowedAllowPatterns, unwrittenDenyPatterns } = partitionCommandRules({
      rules: [bashRule("git *", "allow"), bashRule("npm *", "ask"), bashRule("rm -rf *", "deny")],
      writesAllToolsDeny: true,
    });

    expect(allow).toEqual(["git *"]);
    expect(deny).toEqual(["rm -rf *"]);
    expect(shadowedAllowPatterns).toEqual([]);
    expect(unwrittenDenyPatterns).toEqual([]);
  });

  it("withholds an allow that another rule asks about", () => {
    // `deny > ask > allow`: auto-approving a command the file also asks about
    // would answer the prompt the author wanted.
    const { allow, shadowedAllowPatterns } = partitionCommandRules({
      rules: [
        allToolsRule("npm *", "ask"),
        bashRule("npm publish", "allow"),
        bashRule("git *", "allow"),
      ],
      writesAllToolsDeny: true,
    });

    expect(allow).toEqual(["git *"]);
    expect(shadowedAllowPatterns).toEqual(["npm publish"]);
  });

  it("withholds every allow a catch-all ask covers", () => {
    const { allow, shadowedAllowPatterns } = partitionCommandRules({
      rules: [allToolsRule("*", "ask"), bashRule("git *", "allow")],
      writesAllToolsDeny: true,
    });

    expect(allow).toEqual([]);
    expect(shadowedAllowPatterns).toEqual(["git *"]);
  });

  it("keeps an allow that a written deny names, because the denylist outranks it", () => {
    const { allow, deny, shadowedAllowPatterns } = partitionCommandRules({
      rules: [allToolsRule("rm *", "deny"), bashRule("rm *", "allow")],
      writesAllToolsDeny: true,
    });

    expect(allow).toEqual(["rm *"]);
    expect(deny).toEqual(["rm *"]);
    expect(shadowedAllowPatterns).toEqual([]);
  });

  it("withholds instead of writing when the denylist cannot carry an all-tools pattern", () => {
    // Warp: a denylist entry replaces the tool's built-in default list, so a
    // pattern that may not even name a command must not be written there.
    const { allow, deny, shadowedAllowPatterns, unwrittenDenyPatterns } = partitionCommandRules({
      rules: [
        allToolsRule("rm *", "deny"),
        allToolsRule("secrets/**", "deny"),
        bashRule("rm *", "allow"),
        bashRule("git *", "allow"),
      ],
      writesAllToolsDeny: false,
    });

    expect(deny).toEqual([]);
    expect(allow).toEqual(["git *"]);
    expect(shadowedAllowPatterns).toEqual(["rm *"]);
    expect(unwrittenDenyPatterns).toEqual(["rm *", "secrets/**"]);
  });

  it("still writes the bash category's own deny rules when all-tools ones cannot be written", () => {
    const { deny, unwrittenDenyPatterns } = partitionCommandRules({
      rules: [bashRule("rm -rf .*", "deny"), allToolsRule("secrets/**", "deny")],
      writesAllToolsDeny: false,
    });

    expect(deny).toEqual(["rm -rf .*"]);
    expect(unwrittenDenyPatterns).toEqual(["secrets/**"]);
  });
});
