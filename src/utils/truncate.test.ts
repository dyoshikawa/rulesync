import { describe, expect, it } from "vitest";

import { truncateText } from "./truncate.js";

describe("truncateText", () => {
  it("should return a short enough text unchanged", () => {
    expect(truncateText({ text: "short", maxLength: 10, suffix: "\u2026" })).toBe("short");
  });

  it("should append the suffix to what it kept", () => {
    expect(truncateText({ text: "abcdefgh", maxLength: 3, suffix: "\u2026" })).toBe("abc\u2026");
  });

  it("should not call a text truncated that fits in the limit as code points", () => {
    // Two code points, four UTF-16 units. Measured as units the text would be
    // marked truncated without a character having been dropped.
    expect(
      truncateText({ text: "\u{1f600}\u{1f600}", maxLength: 3, suffix: "\u2026(truncated)" }),
    ).toBe("\u{1f600}\u{1f600}");
  });

  it("should keep what it returns within the limit counted as code points", () => {
    const truncated = truncateText({
      text: "\u{1f600}".repeat(600),
      maxLength: 1_000,
      suffix: "",
    });

    expect([...truncated]).toHaveLength(600);
  });

  it("should not cut a surrogate pair in half", () => {
    // Sliced by UTF-16 unit, the third character would end as a lone surrogate
    // that the next encoder turns into a replacement character.
    const truncated = truncateText({
      text: "\u{1f600}\u{1f600}\u{1f600}",
      maxLength: 2,
      suffix: "",
    });

    expect([...truncated]).toHaveLength(2);
  });

  it("should not leave the backslash of an escape JSON.stringify wrote", () => {
    const text = JSON.stringify("ab\u0007cd");

    expect(truncateText({ text, maxLength: 4, suffix: "" })).toBe('"ab');
  });

  it("should keep a backslash that is itself escaped", () => {
    expect(truncateText({ text: "a\\\\bc", maxLength: 3, suffix: "" })).toBe("a\\\\");
  });
});
