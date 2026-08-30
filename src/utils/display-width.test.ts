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
    // Added to Unicode after the older emoji block, and drawn just as wide.
    ["a recently added emoji", "\u{1fa70}", 2],
    // The selector asks for the emoji form of the heart, which is two columns.
    ["an emoji presentation selector", "\u2764\ufe0f", 2],
    ["extended kana", "\u{1b132}", 2],
    // The kana block between the wide planes the pattern already named: the
    // gap between two ranges is where a padding character hides.
    ["kana in the block between the wide planes", "\u{1aff0}", 2],
    // Emoji drawn as pictures without being asked to, living among the
    // ordinary symbols rather than in the emoji planes.
    ["an emoji among the symbols", "\u2705", 2],
    ["a black large square", "\u2b1b", 2],
    // A symbol drawn as text unless a selector asks otherwise stays one column.
    ["a text-presentation symbol", "\u2600", 1],
    // The Hangul jamo extended block, which sits above the syllables with a
    // reserved gap between the two: the range has to start at U+D7B0 rather
    // than run on from U+D7A3.
    ["an extended Hangul jamo", "\ud7b0", 2],
    ["the last extended Hangul jamo", "\ud7fb", 2],
    // The reserved gap itself is not drawn wide by a terminal, and counting it
    // as one column is what keeps the range honest.
    ["the gap above the Hangul syllables", "\ud7a4", 1],
    ["a hexagram", "\u4dc0", 2],
    ["an angle bracket", "\u2329", 2],
    // Two marks on one letter are how a written language uses them.
    ["a letter carrying two marks", "a\u0301\u0323", 1],
  ])("should measure %s", (_label, text, expected) => {
    expect(displayWidthOf(text)).toBe(expected);
  });

  // `@inquirer/core` measures the rows it wraps with `fast-string-width`, which
  // takes the whole of `Script=Hangul` as wide and every `Emoji_Modifier_Base`
  // as an emoji. Counting either of them narrower here would hand a label a
  // budget it does not fit in, and the row it wraps onto carries no checkbox of
  // the prompt's own.
  it.each([
    ["a Hangul vowel jamo", "\u1161"],
    ["a Hangul final jamo", "\u11a8"],
    ["the pointing hand, an emoji base drawn as text by default", "\u261d"],
    ["the victory hand", "\u270c"],
  ])("should count %s the way the prompt's renderer counts it", (_description, character) => {
    expect(displayWidthOf(character)).toBe(2);
  });

  // The joiners draw as nothing and are counted as something, because the
  // renderer counts them and they are the only invisible characters a name that
  // reaches the prompt is allowed to carry.
  it.each([
    ["the zero-width non-joiner", "\u200c"],
    ["the zero-width joiner", "\u200d"],
  ])("should count %s at the column the renderer spends on it", (_description, character) => {
    expect(displayWidthOf(character)).toBe(1);
  });

  it("should not hand a name a budget it fills with joiners", () => {
    // 39 Arabic letters and 38 non-joiners: drawn in 39 columns, wrapped as 77.
    expect(displayWidthOf(`${"\u0627\u200c".repeat(38)}\u0627`)).toBe(77);
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

  it("should count marks piled on one character past what a language uses", () => {
    // A name of one letter and three hundred marks draws over the lines above
    // and below it while measuring a single column if the marks are free.
    expect(displayWidthOf(`a${"\u0301".repeat(300)}`)).toBe(299);
    expect(displayWidthOf(shortenToWidth({ text: `a${"\u0301".repeat(300)}`, budget: 72 }))).toBe(
      72,
    );
  });

  it("should still mark the cut when nothing fits", () => {
    expect(shortenToWidth({ text: "abc", budget: 0 })).toBe("…");
  });
});
