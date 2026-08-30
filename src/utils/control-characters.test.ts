import { describe, expect, it } from "vitest";

import {
  hasDeceptiveHiddenCharacters,
  stripControlCharacters,
  stripControlCharactersKeepingLineFeeds,
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

describe("hasDeceptiveHiddenCharacters", () => {
  it.each([
    ["a plain ASCII name", "skill-a"],
    ["a Japanese name", "\u8a2d\u5b9a"],
    // Persian for "settings": the zero-width non-joiner is how the word is
    // written, and the letters beside it are the ones that need it.
    ["a Persian name written with ZWNJ", "\u062a\u0646\u0638\u06cc\u0645\u200c\u0627\u062a"],
    // A zero-width joiner between two emoji, which is what makes them one.
    ["an emoji sequence", "\u{1f468}\u200d\u{1f4bb}"],
    ["an emoji with a variation selector", "\u2764\ufe0f"],
    // Devanagari writes a half form with a ZWNJ after the virama.
    ["an Indic name written with ZWNJ", "\u0915\u094d\u200c\u0937"],
  ])("should accept %s", (_label, name) => {
    expect(hasDeceptiveHiddenCharacters(name)).toBe(false);
  });

  it.each([
    ["a control character", "skill\u0007a"],
    ["a bidi override", "skill\u202ea"],
    ["a zero-width space", "pd\u200bf"],
    ["a Hangul filler", "pd\u3164f"],
    ["a braille blank", "pd\u2800f"],
    // The same joiner as above, but between Latin letters, where no script
    // joins anything: it is padding that makes a second "pdf" directory.
    ["a joiner between Latin letters", "pd\u200cf"],
    ["a joiner after a digit", "pdf2\u200d0"],
    // Nothing precedes it, so it joins nothing.
    ["a joiner at the start of a name", "\u200c\u062a\u062a"],
    ["a variation selector on a Latin letter", "pdf\ufe0f"],
    // It binds the character before it to nothing, so the name is the name
    // beside it with an extra directory underneath.
    ["a joiner at the end of a name", "\u8a2d\u5b9a\u200d"],
    ["a joiner between a letter and a space", "\u8a2d\u200d \u5b9a"],
    // Han joins nothing, so a joiner between two of its characters is padding
    // for a second directory drawn exactly like the name beside it.
    ["a joiner between Han characters", "\u8a2d\u200d\u5b9a"],
    ["a joiner between Hangul characters", "\ud55c\u200d\uae00"],
    ["a joiner between Cyrillic letters", "\u043f\u0440\u0430\u0432\u200d\u0438\u043b\u0430"],
    ["a variation selector on a Han character", "\u8a2d\ufe00"],
  ])("should reject %s", (_label, name) => {
    expect(hasDeceptiveHiddenCharacters(name)).toBe(true);
  });
});

describe("stripControlCharactersKeepingLineFeeds", () => {
  it("should keep a line feed, since some messages are written over more than one line", () => {
    expect(stripControlCharactersKeepingLineFeeds("held by pid 42\nsince 10:00")).toBe(
      "held by pid 42\nsince 10:00",
    );
  });

  it("should still remove what reorders or escapes", () => {
    expect(stripControlCharactersKeepingLineFeeds("one\u001b[31m two\u202e three\u009b four")).toBe(
      "one[31m two three four",
    );
  });

  it("should remove a carriage return, which paints over the line already written", () => {
    expect(stripControlCharactersKeepingLineFeeds("real message\r painted over")).toBe(
      "real message painted over",
    );
  });
});
