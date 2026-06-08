import { describe, expect, it } from "vitest";

import { assertSafeTaktName, prependTaktExtends } from "./takt-shared.js";

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

describe("prependTaktExtends", () => {
  it("returns the body unchanged when extendsName is undefined", () => {
    expect(
      prependTaktExtends({
        extendsName: undefined,
        body: "# Body",
        featureLabel: "rule",
        sourceLabel: "x.md",
      }),
    ).toBe("# Body");
  });

  it("returns the body unchanged when extendsName is empty", () => {
    expect(
      prependTaktExtends({
        extendsName: "",
        body: "# Body",
        featureLabel: "rule",
        sourceLabel: "x.md",
      }),
    ).toBe("# Body");
  });

  it("prepends the canonical {extends:<parent>} directive (no space)", () => {
    expect(
      prependTaktExtends({
        extendsName: "fix",
        body: "# Body",
        featureLabel: "policies",
        sourceLabel: "x.md",
      }),
    ).toBe("{extends:fix}\n\n# Body");
  });

  it("emits a standalone directive when the body is empty", () => {
    expect(
      prependTaktExtends({
        extendsName: "fix",
        body: "   ",
        featureLabel: "policies",
        sourceLabel: "x.md",
      }),
    ).toBe("{extends:fix}\n");
  });

  it.each([["a/b"], ["../escape"], [".."], ["with\\slash"], ["a b"]])(
    "rejects an unsafe parent name %s",
    (name) => {
      expect(() =>
        prependTaktExtends({
          extendsName: name,
          body: "x",
          featureLabel: "rule",
          sourceLabel: "src.md",
        }),
      ).toThrow(/Invalid takt\.extends/);
    },
  );
});
