import { describe, expect, it } from "vitest";

import { displayWidthOf, shortenToWidth } from "./display-width.js";

describe("displayWidthOf", () => {
  it.each([
    ["an empty string", "", 0],
    ["plain ASCII", "pdf", 3],
    // U+3000 IDEOGRAPHIC SPACE and the CJK ideographs are two columns each.
    ["an ideographic space", "　", 2],
    ["a Japanese word", "設定", 4],
    ["a fullwidth letter", "ｐ", 2],
    ["Hangul syllables", "규칙", 4],
    // A combining acute accent is drawn on the letter before it.
    ["a combining mark", "e\u0301", 1],
    ["a zero-width space", "pd\u200bf", 3],
    // Outside the Basic Multilingual Plane, so counted per code point.
    ["an emoji", "\u{1f600}", 2],
  ])("should measure %s", (_label, text, expected) => {
    expect(displayWidthOf(text)).toBe(expected);
  });
});

describe("shortenToWidth", () => {
  it("should leave a string that fits alone", () => {
    expect(shortenToWidth({ text: "pdf", budget: 10 })).toBe("pdf");
  });

  it("should keep the ellipsis inside the budget", () => {
    expect(shortenToWidth({ text: "abcdef", budget: 4 })).toBe("abc…");
  });

  it("should count wide characters as the two columns they occupy", () => {
    // Four ideographs are eight columns; a budget of five leaves room for two
    // of them plus the ellipsis.
    const result = shortenToWidth({ text: "設定設定", budget: 5 });

    expect(result).toBe("設定…");
    expect(displayWidthOf(result)).toBeLessThanOrEqual(5);
  });

  it("should not split a wide character across the budget", () => {
    const result = shortenToWidth({ text: "設定設", budget: 4 });

    expect(result).toBe("設…");
  });

  it("should still mark the cut when nothing fits", () => {
    expect(shortenToWidth({ text: "abc", budget: 0 })).toBe("…");
  });
});
