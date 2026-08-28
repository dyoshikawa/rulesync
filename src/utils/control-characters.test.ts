import { describe, expect, it } from "vitest";

import {
  stripControlCharacters,
  stripHiddenCharacters,
  stripInvisibleCharacters,
} from "./control-characters.js";

describe("stripControlCharacters", () => {
  it("should leave printable text untouched", () => {
    expect(stripControlCharacters("statusLine")).toBe("statusLine");
  });

  it("should remove a newline that would forge a log line", () => {
    expect(stripControlCharacters("key\n[warn] forged")).toBe("key[warn] forged");
  });

  it("should remove C0 controls, DEL and the C1 range", () => {
    expect(stripControlCharacters("a\u0000b\u001bc\u007fd\u009be")).toBe("abcde");
  });

  it("should remove bidirectional overrides and line separators", () => {
    expect(stripControlCharacters("a\u202eb\u2028c")).toBe("abc");
  });

  it("should strip the plain right-to-left marks, which reorder the neutrals beside them", () => {
    expect(stripControlCharacters("a\u200fb\u200ec")).toBe("abc");
  });
});

describe("stripInvisibleCharacters", () => {
  it("should leave printable text untouched", () => {
    expect(stripInvisibleCharacters("statusLine")).toBe("statusLine");
  });

  it.each([
    ["the soft hyphen", "\u00ad"],
    ["the combining grapheme joiner", "\u034f"],
    ["the Arabic letter mark", "\u061c"],
    ["the Hangul choseong filler", "\u115f"],
    ["the Hangul jungseong filler", "\u1160"],
    ["the Mongolian vowel separator", "\u180e"],
    ["the zero width space", "\u200b"],
    ["the zero width non-joiner", "\u200c"],
    ["the zero width joiner", "\u200d"],
    ["the word joiner", "\u2060"],
    ["an invisible operator", "\u2064"],
    ["the braille blank", "\u2800"],
    ["the Hangul filler", "\u3164"],
    ["a variation selector", "\ufe0f"],
    ["the byte order mark", "\ufeff"],
    ["the halfwidth Hangul filler", "\uffa0"],
    ["an interlinear annotation mark", "\ufff9"],
    ["a tag character", "\u{e0041}"],
    ["a variation selector supplement character", "\u{e0100}"],
  ])("should remove %s", (_label, character) => {
    expect(stripInvisibleCharacters(`pd${character}f`)).toBe("pdf");
  });

  it("should keep a braille character that has dots to draw", () => {
    expect(stripInvisibleCharacters("\u2801")).toBe("\u2801");
  });

  it("should leave control characters alone, which are the other stripper's job", () => {
    expect(stripInvisibleCharacters("a\u001bb")).toBe("a\u001bb");
  });
});

describe("stripHiddenCharacters", () => {
  it("should remove both the control characters and the invisible ones", () => {
    // An escape and a right-to-left override, then a zero width space and a
    // Hangul filler: two of each kind, none of which shows.
    expect(stripHiddenCharacters("a\u001bb\u200bc\u202ed\u3164e")).toBe("abcde");
  });

  it("should leave a name that shows everything it contains untouched", () => {
    expect(stripHiddenCharacters("skill-a")).toBe("skill-a");
  });
});
