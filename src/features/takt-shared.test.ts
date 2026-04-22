import { describe, expect, it } from "vitest";

import { assertSafeTaktName, resolveTaktFacetDir } from "./takt-shared.js";

describe("assertSafeTaktName", () => {
  it.each([["plain"], ["with-dash"], ["with_underscore"], ["with.dot"], ["mixed-1.2_3"]])(
    "accepts safe name %s",
    (name) => {
      expect(() =>
        assertSafeTaktName({ name, featureLabel: "rule", sourceLabel: "x.md" }),
      ).not.toThrow();
    },
  );

  it.each([
    ["with/slash"],
    ["with\\backslash"],
    [".."],
    ["."],
    ["a/b"],
    ["../escape"],
    ["a..b/c"],
    ["a b"],
    ["with$"],
    ["with-emoji-\u{1F600}"],
    [""],
  ])("rejects unsafe name %s", (name) => {
    expect(() => assertSafeTaktName({ name, featureLabel: "rule", sourceLabel: "x.md" })).toThrow(
      /Invalid takt\.name/,
    );
  });

  it("includes feature label and source label in the error message", () => {
    expect(() =>
      assertSafeTaktName({ name: "../bad", featureLabel: "skill", sourceLabel: "src.md" }),
    ).toThrow(/skill "src\.md"/);
  });
});

describe("resolveTaktFacetDir", () => {
  const allowed = ["a", "b"] as const;
  const dirMap = { a: "as", b: "bs" } as const;

  it("returns default when value is undefined", () => {
    expect(
      resolveTaktFacetDir({
        value: undefined,
        allowed,
        defaultDir: "as",
        dirMap,
        featureLabel: "rule",
        sourceLabel: "x.md",
      }),
    ).toBe("as");
  });

  it("returns mapped directory for allowed value", () => {
    expect(
      resolveTaktFacetDir({
        value: "b",
        allowed,
        defaultDir: "as",
        dirMap,
        featureLabel: "rule",
        sourceLabel: "x.md",
      }),
    ).toBe("bs");
  });

  it("throws on non-string value", () => {
    expect(() =>
      resolveTaktFacetDir({
        value: 5,
        allowed,
        defaultDir: "as",
        dirMap,
        featureLabel: "rule",
        sourceLabel: "x.md",
      }),
    ).toThrow(/expected a string/);
  });

  it("throws on disallowed value", () => {
    expect(() =>
      resolveTaktFacetDir({
        value: "z",
        allowed,
        defaultDir: "as",
        dirMap,
        featureLabel: "rule",
        sourceLabel: "x.md",
      }),
    ).toThrow(/Invalid takt\.facet "z"/);
  });
});
