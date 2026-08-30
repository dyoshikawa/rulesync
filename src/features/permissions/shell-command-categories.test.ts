import { describe, expect, it } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import type { PermissionAction } from "../../types/permissions.js";
import {
  collectShellCommandRules,
  createShadowingRestrictionsTest,
  partitionCommandRules,
  warnAboutUnwrittenCommandRules,
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

  it("reports the all-tools allow patterns it read past", () => {
    const { rules, ignoredAllToolsAllowPatterns } = collectShellCommandRules({
      "*": { "git *": "allow", "rm *": "deny" },
    });

    expect(rules).toEqual([{ pattern: "rm *", action: "deny", fromAllToolsCategory: true }]);
    expect(ignoredAllToolsAllowPatterns).toEqual(["git *"]);
  });

  it("returns nothing for an empty config", () => {
    expect(collectShellCommandRules({})).toEqual({
      rules: [],
      foreignDenyCategories: [],
      foreignRestrictingCategories: [],
      ignoredAllToolsAllowPatterns: [],
    });
  });
});

describe("createShadowingRestrictionsTest", () => {
  it("compares the two patterns in both directions", () => {
    // The stricter rule wins whatever its width, so a broad restriction covers
    // a narrow allow and a broad allow is covered by a narrow restriction.
    const shadowing = createShadowingRestrictionsTest([
      allToolsRule("*", "ask"),
      bashRule("npm publish", "ask"),
    ]);

    // The answer names the restrictions that reached the allow rule, so a
    // caller can report both what it withheld and what withheld it.
    expect(shadowing("git *")).toEqual(["*"]);
    expect(shadowing("npm *")).toEqual(["*", "npm publish"]);
  });

  it("catches a restriction that crosses an allow without covering it", () => {
    // Neither pattern's text matches the other, yet every `git ... --force`
    // command matches both — which is the pair the author meant to restrict.
    const shadowing = createShadowingRestrictionsTest([allToolsRule("* --force", "ask")]);

    expect(shadowing("git *").length).toBeGreaterThan(0);
  });

  it("leaves an allow no restriction reaches alone", () => {
    const shadowing = createShadowingRestrictionsTest([bashRule("npm publish", "ask")]);

    expect(shadowing("git *")).toEqual([]);
  });
});

/** A pattern long enough that one comparison nearly fills the per-pair cap. */
const longPattern = (seed: string): string => `${seed}${"a*".repeat(495)}`;

describe("createShadowingRestrictionsTest with many long patterns", () => {
  it("stays bounded across the whole run rather than per pair", () => {
    // A hundred restrictions against a hundred allow rules is ten thousand
    // comparisons, each just under the cap one pair may cost. Without a budget
    // shared by the run, walking them all takes minutes; with one, the walks
    // stop and the remaining pairs answer the fail-closed way.
    const restrictions = Array.from({ length: 100 }, (_, index) =>
      bashRule(longPattern(`r${index}`), "ask"),
    );
    const shadowing = createShadowingRestrictionsTest(restrictions);

    const answers = Array.from({ length: 100 }, (_, index) => shadowing(longPattern(`a${index}`)));

    // The run ends inside the test timeout, and once the budget is gone every
    // allow rule is withheld rather than written.
    expect(answers.at(-1)?.length).toBe(restrictions.length);
  });

});

describe("createShadowingRestrictionsTest with many short patterns", () => {
  it("stays bounded on the number of pairs, not only on how long each walk is", () => {
    // Three thousand short restrictions against three thousand short allow
    // rules is nine million comparisons that each walk a couple of cells: cheap
    // one at a time, minutes together. The budget has to end on the count of
    // pairs as well as on the length of each.
    const restrictions = Array.from({ length: 3000 }, (_, index) =>
      bashRule(`*q${index}*z`, "ask"),
    );
    const shadowing = createShadowingRestrictionsTest(restrictions);

    const start = performance.now();
    const answers = Array.from({ length: 3000 }, (_, index) => shadowing(`c${index} arg`));

    expect(performance.now() - start).toBeLessThan(5000);
    // Once the budget is gone every allow rule left is withheld rather than
    // written — the fail-closed answer.
    expect(answers.at(-1)?.length).toBe(restrictions.length);
  });
});

describe("createShadowingRestrictionsTest with a bracket pattern", () => {
  it("matches an identical spelling a glob does not match against itself", () => {
    // `compileGlob` reads `[rf]` as a character class, so the compiled pattern
    // does not match its own text. Comparing the strings keeps a bracket
    // anywhere in the pattern from switching the whole check off.
    const shadowing = createShadowingRestrictionsTest([bashRule("rm -[rf]*", "deny")]);

    expect(shadowing("rm -[rf]*").length).toBeGreaterThan(0);
    expect(shadowing("git status")).toEqual([]);
  });
});

describe("createShadowingRestrictionsTest with a normalizer", () => {
  it("reads a tool-language pattern through the normalizer", () => {
    // Stands in for Warp's regex-to-glob widening: without it, `.*` is a
    // literal dot beside a wildcard rather than the catch-all it really is.
    const shadowing = createShadowingRestrictionsTest([bashRule("rm", "ask")], {
      normalizePattern: (pattern) => pattern.replaceAll(".*", "*"),
    });

    expect(shadowing(".*").length).toBeGreaterThan(0);
    expect(shadowing("git status")).toEqual([]);
  });

  it("leaves an all-tools pattern alone, since it is a glob already", () => {
    // Under `*` the pattern is canonical, so its `.` is the character it looks
    // like. Widening it as if it were written in the tool's own language would
    // shadow `rm x` as well, which the author never restricted.
    const shadowing = createShadowingRestrictionsTest([allToolsRule("rm .*", "deny")], {
      normalizePattern: (pattern) => pattern.replaceAll(".*", "*"),
    });

    expect(shadowing("rm x")).toEqual([]);
    expect(shadowing("rm .y").length).toBeGreaterThan(0);
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

  it("keeps an allow that a written bash deny names, because the denylist outranks it", () => {
    const { allow, deny, shadowedAllowPatterns } = partitionCommandRules({
      rules: [bashRule("rm *", "deny"), bashRule("rm *", "allow")],
      writesAllToolsDeny: true,
    });

    expect(allow).toEqual(["rm *"]);
    expect(deny).toEqual(["rm *"]);
    expect(shadowedAllowPatterns).toEqual([]);
  });

  it("writes an all-tools deny and withholds the allow it covers all the same", () => {
    // A pattern under `*` need not name a command, so the denylist entry alone
    // cannot be trusted to enforce it — see the `secrets/**` case below.
    const { allow, deny, shadowedAllowPatterns } = partitionCommandRules({
      rules: [allToolsRule("rm *", "deny"), bashRule("rm *", "allow"), bashRule("git *", "allow")],
      writesAllToolsDeny: true,
    });

    expect(allow).toEqual(["git *"]);
    expect(deny).toEqual(["rm *"]);
    expect(shadowedAllowPatterns).toEqual(["rm *"]);
  });

  it("withholds a catch-all allow that an all-tools deny of a path covers", () => {
    // `secrets/**` in a command denylist matches no command at all, so writing
    // it beside an allowed `*` would auto-approve every command the author was
    // trying to keep away from those files.
    const { allow, deny, shadowedAllowPatterns } = partitionCommandRules({
      rules: [allToolsRule("secrets/**", "deny"), bashRule("*", "allow")],
      writesAllToolsDeny: true,
    });

    expect(allow).toEqual([]);
    expect(deny).toEqual(["secrets/**"]);
    expect(shadowedAllowPatterns).toEqual(["*"]);
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

const warnedBy = (
  overrides: Partial<Parameters<typeof warnAboutUnwrittenCommandRules>[0]>,
): string[] => {
  const logger = createMockLogger();
  warnAboutUnwrittenCommandRules({
    toolLabel: "Warp",
    surfaceLabel: "commandAllowlist/commandDenylist",
    foreignDenyCategories: [],
    shadowedAllowPatterns: [],
    logger,
    ...overrides,
  });
  return logger.warn.mock.calls.map(([message]) => String(message));
};

describe("warnAboutUnwrittenCommandRules", () => {
  it("says nothing when every rule was written", () => {
    expect(warnedBy({})).toEqual([]);
  });

  it("names each category whose deny rules the command lists cannot carry", () => {
    const warnings = warnedBy({ foreignDenyCategories: ["write", "webfetch"] });

    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain("'write' deny rules cannot be represented");
    expect(warnings[1]).toContain("'webfetch' deny rules cannot be represented");
  });

  it("gives the tool's own reason for a deny it could not write", () => {
    const warnings = warnedBy({
      unwrittenDenyPatterns: ["secrets/**"],
      unwrittenDenyReason: "its denylist replaces the built-in one.",
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("secrets/**");
    expect(warnings[0]).toContain("its denylist replaces the built-in one.");
  });

  it("reports the all-tools allow rules it read past", () => {
    expect(warnedBy({ ignoredAllToolsAllowPatterns: ["git *"] })).toEqual([
      expect.stringContaining("deny and ask rules only"),
    ]);
  });

  it("reports the allow rules a restriction withheld", () => {
    expect(warnedBy({ shadowedAllowPatterns: ["git *"] })).toEqual([
      expect.stringContaining("was not given the allow rule(s) for git *"),
    ]);
  });
});
