import { describe, expect, it } from "vitest";

import {
  collapseRulesToSingleAction,
  failSafeCatchAllAction,
  hasPatternSpecificRules,
  PERMISSION_ACTION_PRIORITY,
} from "./single-action-collapse.js";

describe("single-action-collapse", () => {
  describe("PERMISSION_ACTION_PRIORITY", () => {
    it("should rank deny above ask above allow", () => {
      expect(PERMISSION_ACTION_PRIORITY.deny).toBeGreaterThan(PERMISSION_ACTION_PRIORITY.ask);
      expect(PERMISSION_ACTION_PRIORITY.ask).toBeGreaterThan(PERMISSION_ACTION_PRIORITY.allow);
    });
  });

  describe("collapseRulesToSingleAction", () => {
    it.each([
      ["allow + ask", { "*": "allow", "site:example.com": "ask" }, "ask"],
      ["allow + deny", { "*": "allow", "site:example.com": "deny" }, "deny"],
      ["ask + deny", { "*": "ask", "site:example.com": "deny" }, "deny"],
    ] as const)("should let the strictest action win for %s", (_label, rules, expected) => {
      expect(collapseRulesToSingleAction({ rules })).toBe(expected);
    });

    it("should keep a lone catch-all as is", () => {
      expect(collapseRulesToSingleAction({ rules: { "*": "allow" } })).toBe("allow");
      expect(collapseRulesToSingleAction({ rules: { "*": "deny" } })).toBe("deny");
    });

    it("should add an implicit ask when there is no catch-all", () => {
      expect(collapseRulesToSingleAction({ rules: { "site:example.com": "allow" } })).toBe("ask");
    });

    it("should still let deny win over the implicit ask", () => {
      expect(collapseRulesToSingleAction({ rules: { "site:example.com": "deny" } })).toBe("deny");
    });

    it("should return undefined for an empty map", () => {
      expect(collapseRulesToSingleAction({ rules: {} })).toBeUndefined();
    });
  });

  describe("hasPatternSpecificRules", () => {
    it("should be false for an empty map or a lone catch-all", () => {
      expect(hasPatternSpecificRules({})).toBe(false);
      expect(hasPatternSpecificRules({ "*": "allow" })).toBe(false);
    });

    it("should be true once any non-catch-all pattern is present", () => {
      expect(hasPatternSpecificRules({ "*": "allow", "site:example.com": "ask" })).toBe(true);
      expect(hasPatternSpecificRules({ "site:example.com": "allow" })).toBe(true);
    });
  });
});

describe("failSafeCatchAllAction", () => {
  it("downgrades a catch-all allow to ask when a narrower deny or ask exists", () => {
    expect(failSafeCatchAllAction({ "*": "allow", "src/**": "deny" })).toEqual({
      action: "ask",
      downgraded: true,
    });
    expect(failSafeCatchAllAction({ "*": "allow", "src/**": "ask" })).toEqual({
      action: "ask",
      downgraded: true,
    });
  });

  it("keeps a catch-all allow whose narrower rules only allow", () => {
    expect(failSafeCatchAllAction({ "*": "allow", "src/**": "allow" })).toEqual({
      action: "allow",
      downgraded: false,
    });
  });

  it("keeps a restricting catch-all and reports a missing one as undefined", () => {
    expect(failSafeCatchAllAction({ "*": "deny", "src/**": "allow" })).toEqual({
      action: "deny",
      downgraded: false,
    });
    expect(failSafeCatchAllAction({ "src/**": "deny" })).toEqual({
      action: undefined,
      downgraded: false,
    });
  });
});
