import { describe, expect, it } from "vitest";

import { collectShellCommandRules, partitionCommandRules } from "./shell-command-categories.js";

describe("collectShellCommandRules", () => {
  it("collects every bash rule in the order it was written", () => {
    const { rules, foreignDenyCategories } = collectShellCommandRules({
      bash: { "git *": "allow", "npm *": "ask", "rm -rf *": "deny" },
    });

    expect(rules).toEqual([
      ["git *", "allow"],
      ["npm *", "ask"],
      ["rm -rf *", "deny"],
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
      ["rm *", "deny"],
      ["npm *", "ask"],
      ["rm *", "allow"],
    ]);
  });

  it("never collects the all-tools category's allow rules", () => {
    // A pattern under `*` need not be a command at all, so carrying it in the
    // permissive direction would grant something the author never said about
    // commands.
    const { rules } = collectShellCommandRules({
      "*": { "src/**": "allow" },
      bash: { "git *": "allow" },
    });

    expect(rules).toEqual([["git *", "allow"]]);
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

describe("partitionCommandRules", () => {
  it("splits allow and deny and writes no list for ask", () => {
    const { allow, deny, shadowedAllowPatterns } = partitionCommandRules([
      ["git *", "allow"],
      ["npm *", "ask"],
      ["rm -rf *", "deny"],
    ]);

    expect(allow).toEqual(["git *"]);
    expect(deny).toEqual(["rm -rf *"]);
    expect(shadowedAllowPatterns).toEqual([]);
  });

  it("withholds an allow that another rule asks about", () => {
    // `deny > ask > allow`: auto-approving a pattern the file also asks about
    // would answer the prompt the author wanted.
    const { allow, shadowedAllowPatterns } = partitionCommandRules([
      ["npm *", "ask"],
      ["npm *", "allow"],
      ["git *", "allow"],
    ]);

    expect(allow).toEqual(["git *"]);
    expect(shadowedAllowPatterns).toEqual(["npm *"]);
  });

  it("keeps an allow that a deny names, because the denylist already outranks it", () => {
    const { allow, deny, shadowedAllowPatterns } = partitionCommandRules([
      ["rm *", "deny"],
      ["rm *", "allow"],
    ]);

    expect(allow).toEqual(["rm *"]);
    expect(deny).toEqual(["rm *"]);
    expect(shadowedAllowPatterns).toEqual([]);
  });
});
