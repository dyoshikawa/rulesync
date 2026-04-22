import { describe, expect, it } from "vitest";

import { assertSafeTaktName } from "./takt-shared.js";

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
