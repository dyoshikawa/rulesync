import { describe, expect, it } from "vitest";

import { createBoundedWalk } from "./bounded-walk.js";

const limits = { maxValues: 3, maxStringChars: 10, maxDepth: 2 };

describe("createBoundedWalk", () => {
  it("throws once more values are charged than the budget allows", () => {
    const walk = createBoundedWalk({ subject: "Document", limits });
    walk.chargeValue();
    walk.chargeValue();
    walk.chargeValue();
    expect(() => walk.chargeValue()).toThrow(
      "Document expands to more than 3 values; refusing to process it (a chain of YAML aliases may be amplifying the document)",
    );
  });

  it("charges string leaves and keys against the character budget", () => {
    const walk = createBoundedWalk({ subject: "Document", limits });
    walk.chargeValue(6);
    walk.chargeChars(4);
    expect(() => walk.chargeChars(1)).toThrow(
      "Document's string values expand to more than 10 characters; refusing to process it",
    );
  });

  it("throws once the descent nests deeper than the depth cap", () => {
    const walk = createBoundedWalk({ subject: "Document", limits });
    walk.enter({});
    walk.enter({});
    expect(() => walk.enter({})).toThrow(
      "Document nests more than 2 levels deep; refusing to process it",
    );
  });

  it("counts the root as the first level when it is given up front", () => {
    const root = {};
    const walk = createBoundedWalk({ subject: "Document", limits, root });
    expect(walk.isAncestor(root)).toBe(true);
    walk.enter({});
    expect(() => walk.enter({})).toThrow(/nests more than 2 levels deep/);
  });

  it("tracks only the containers on the current descent path as ancestors", () => {
    const walk = createBoundedWalk({ subject: "Document", limits });
    const outer = {};
    const inner = {};
    walk.enter(outer);
    walk.enter(inner);
    expect(walk.isAncestor(outer)).toBe(true);
    expect(walk.isAncestor(inner)).toBe(true);
    walk.leave(inner);
    expect(walk.isAncestor(inner)).toBe(false);
    expect(walk.isAncestor(outer)).toBe(true);
    // Leaving frees the level, so a sibling can be entered at the same depth.
    expect(() => walk.enter({})).not.toThrow();
  });
});
