import { describe, expect, it } from "vitest";

import { describeConfusableNames, mixedScriptsOf } from "./confusable-names.js";

/** "copy" spelled entirely in Cyrillic: U+0441 U+043E U+0440 U+0443. */
const CYRILLIC_COPY = "\u0441\u043e\u0440\u0443";
/** "good" with both o's replaced by the Cyrillic o, U+043E. */
const HALF_CYRILLIC_GOOD = "g\u043e\u043ed";

describe("mixedScriptsOf", () => {
  it.each([
    ["a plain ASCII name", "code-review"],
    ["a name with digits and punctuation", "pdf_2024.v2"],
    ["a Japanese name mixing Han, Hiragana and Katakana", "設定のルール"],
    ["a Japanese name carrying Latin", "Rulesyncのルール"],
    ["a Korean name carrying Latin", "규칙-sync"],
    ["a name written only in Cyrillic", "\u043f\u0440\u0430\u0432\u0438\u043b\u0430"],
    // Thai beside Latin is an everyday combination rather than a lookalike: no
    // script left unnamed by this module shares letter shapes with Latin.
    ["a Thai name carrying Latin", "\u0e01\u0e0e-sync"],
  ])("should report no mixture for %s", (_label, name) => {
    expect(mixedScriptsOf(name)).toBeUndefined();
  });

  it("should report the scripts of a Latin name spelled with Cyrillic lookalikes", () => {
    expect(mixedScriptsOf(HALF_CYRILLIC_GOOD)).toEqual(["Cyrillic", "Latin"]);
  });

  it("should report a Latin name carrying a Greek lookalike", () => {
    // A Latin "a" beside the Greek alpha (U+03B1) many fonts draw like it.
    expect(mixedScriptsOf("a\u03b1")).toEqual(["Greek", "Latin"]);
  });

  it("should report an alphabet that looks like Latin without being a familiar one", () => {
    // "good" with both o's replaced by the Armenian o, U+0585. Armenian is one
    // of the scripts UTS #39 lists as confusable with Latin, so it is named
    // rather than left in the `Other` bucket, where a Latin mixture would be
    // waved through as ordinary.
    expect(mixedScriptsOf("g\u0585\u0585d")).toEqual(["Armenian", "Latin"]);
  });

  it("should report Cherokee beside Latin", () => {
    // U+13AA is drawn as a capital A.
    expect(mixedScriptsOf("\u13aadf")).toEqual(["Cherokee", "Latin"]);
  });

  it("should treat a script it does not name as one bucket", () => {
    // Arabic and Thai are both `Other`, so a name built from the two alone is
    // not reported. This is the documented limit of the one-bucket fallback.
    expect(mixedScriptsOf("\u0645\u0e01")).toBeUndefined();
    // Beside a named script that is not Latin, the fallback still shows up.
    expect(mixedScriptsOf("\u0440\u0645")).toEqual(["Cyrillic", "Other"]);
  });
});

describe("describeConfusableNames", () => {
  it("should note nothing for names that cannot be mistaken for each other", () => {
    expect(describeConfusableNames(["skill-a", "skill-b"])).toEqual(new Map());
  });

  it("should note both entries that share a display form", () => {
    const notes = describeConfusableNames(["Skill", "skill"]);

    expect(notes.get("Skill")).toBe("another entry has the same display form");
    expect(notes.get("skill")).toBe("another entry has the same display form");
  });

  it("should fold compatibility forms when comparing display forms", () => {
    // Fullwidth "pdf" (U+FF50 U+FF44 U+FF46) normalizes to "pdf" under NFKC.
    const fullwidth = "\uff50\uff44\uff46";
    const notes = describeConfusableNames(["pdf", fullwidth]);

    expect(notes.get("pdf")).toBe("another entry has the same display form");
    expect(notes.get(fullwidth)).toBe("another entry has the same display form");
  });

  it("should fold invisible characters when comparing display forms", () => {
    // A zero-width space (U+200B) survives NFKC while showing nothing at all,
    // so the two names below are drawn identically.
    const invisible = "pd\u200bf";
    const notes = describeConfusableNames(["pdf", invisible]);

    expect(notes.get("pdf")).toBe("another entry has the same display form");
    expect(notes.get(invisible)).toBe("another entry has the same display form");
  });

  it("should note a name spelled entirely in another script beside its twin", () => {
    // Neither name mixes scripts and neither normalizes into the other, so this
    // pair is only visible by comparing the two against each other.
    const notes = describeConfusableNames(["copy", CYRILLIC_COPY]);

    expect(notes.get("copy")).toBe("another entry differs from it only by lookalike letters");
    expect(notes.get(CYRILLIC_COPY)).toBe(
      "another entry differs from it only by lookalike letters; " +
        "reads as Latin letters but is written in Cyrillic",
    );
  });

  it("should note a name written entirely in Latin lookalikes with nothing to compare it to", () => {
    // The whole-script confusable of UTS #39: one script, so no mixture, and no
    // Latin twin on the list, so the other two checks have nothing to see.
    const notes = describeConfusableNames([CYRILLIC_COPY, "unrelated"]);

    expect(notes.get(CYRILLIC_COPY)).toBe("reads as Latin letters but is written in Cyrillic");
    expect(notes.has("unrelated")).toBe(false);
  });

  it("should not report an ordinary word of a script that merely has some lookalikes", () => {
    // "\u043f\u0440\u0430\u0432\u0438\u043b\u0430" (rules, in Russian) carries Cyrillic
    // letters that are drawn as Latin ones, but not only those, so it does not
    // read as a Latin word.
    expect(describeConfusableNames(["\u043f\u0440\u0430\u0432\u0438\u043b\u0430"])).toEqual(
      new Map(),
    );
    // No letter shape in common with the Cyrillic word above:
    // matching them up as twins is what a script-only rule would do.
    expect(
      describeConfusableNames(["\u043f\u0440\u0430\u0432\u0438\u043b\u0430", "rulesync"]),
    ).toEqual(new Map());
  });

  it("should not call two same-length names twins when no letter shape matches", () => {
    // "\u03bb\u03cc\u03b3\u03bf\u03c2" is Greek for "word" and is five letters,
    // like "rules", but none of them is drawn as the Latin letter beside it.
    expect(describeConfusableNames(["rules", "\u03bb\u03cc\u03b3\u03bf\u03c2"])).toEqual(new Map());
  });

  it("should fold whitespace differences into the display form", () => {
    // A padded name and a plain one occupy the same row on screen once the
    // terminal has drawn them, so they are reported as the pair they are.
    const padded = "pdf  ";
    const notes = describeConfusableNames(["pdf", padded]);

    expect(notes.get("pdf")).toBe("another entry has the same display form");
    expect(notes.get(padded)).toBe("another entry has the same display form");
  });

  it("should not note names that differ within a single script", () => {
    expect(describeConfusableNames(["cat", "dog", "cap"])).toEqual(new Map());
  });

  it("should note a mixed-script name even when no lookalike is on the list", () => {
    const notes = describeConfusableNames([HALF_CYRILLIC_GOOD]);

    expect(notes.get(HALF_CYRILLIC_GOOD)).toBe("mixes characters from Cyrillic and Latin");
  });

  it("should note every reason that applies to the same name", () => {
    const notes = describeConfusableNames(["good", HALF_CYRILLIC_GOOD]);

    expect(notes.get(HALF_CYRILLIC_GOOD)).toBe(
      "another entry differs from it only by lookalike letters; " +
        "mixes characters from Cyrillic and Latin",
    );
    expect(notes.get("good")).toBe("another entry differs from it only by lookalike letters");
  });

  it("should list three scripts as a sentence rather than a chain of ands", () => {
    // Latin "a", the Greek alpha and the Cyrillic a, all drawn alike.
    const threeScripts = "a\u03b1\u0430";
    const notes = describeConfusableNames([threeScripts]);

    expect(notes.get(threeScripts)).toBe("mixes characters from Cyrillic, Greek and Latin");
  });

  it("should not name the internal bucket an unlisted script falls into", () => {
    // Cyrillic beside Arabic: reported, but as "another script" rather than by
    // the bucket's own name.
    const withArabic = "\u0440\u0645";
    const notes = describeConfusableNames([withArabic]);

    expect(notes.get(withArabic)).toBe("mixes characters from Cyrillic and another script");
  });

  it("should fold an invisible character that normalization turns into another", () => {
    // U+3164 HANGUL FILLER shows nothing and is a Hangul letter, so a check
    // aimed at Latin would pass it; NFKC then turns it into U+1160, which shows
    // nothing either. Stripping only once, on either side of the
    // normalization, would leave the two names apart.
    const hangulFiller = "pd\u3164f";
    const notes = describeConfusableNames(["pdf", hangulFiller]);

    expect(notes.get("pdf")).toBe("another entry has the same display form");
    expect(notes.get(hangulFiller)).toBe("another entry has the same display form");
  });

  it("should not call two names of the same length twins when nothing links them", () => {
    // Same length and no shared script, but no one would take a Japanese name
    // for a two-letter Latin one. Marking these would fire on ordinary
    // repositories often enough to make the mark worth ignoring.
    expect(describeConfusableNames(["\u8a2d\u5b9a", "ai"])).toEqual(new Map());
    expect(describeConfusableNames(["\uaddc\uce59", "go"])).toEqual(new Map());
  });

  it("should note a twin written in an alphabet only UTS #39 would name", () => {
    // "copy" with the Latin o replaced by the Armenian o, U+0585.
    const armenian = "c\u0585py";
    const notes = describeConfusableNames(["copy", armenian]);

    expect(notes.get("copy")).toBe("another entry differs from it only by lookalike letters");
    expect(notes.get(armenian)).toBe(
      "another entry differs from it only by lookalike letters; " +
        "mixes characters from Armenian and Latin",
    );
  });

  it("should note a twin that never leaves the Latin alphabet", () => {
    const twin = "another entry differs from it only by lookalike letters";
    // A digit for a letter, a capital I for an l, the script g (U+0261) and the
    // dotless i (U+0131): four ways to spell a name in characters this project
    // already uses, none of which changes what the name looks like.
    expect(describeConfusableNames(["copy", "c0py"])).toEqual(
      new Map([
        ["copy", twin],
        ["c0py", twin],
      ]),
    );
    expect(describeConfusableNames(["rules", "ruIes"])).toEqual(
      new Map([
        ["rules", twin],
        ["ruIes", twin],
      ]),
    );
    expect(describeConfusableNames(["git", "\u0261it"])).toEqual(
      new Map([
        ["git", twin],
        ["\u0261it", twin],
      ]),
    );
    expect(describeConfusableNames(["git", "g\u0131t"])).toEqual(
      new Map([
        ["git", twin],
        ["g\u0131t", twin],
      ]),
    );
  });

  it("should report an alphabet drawn like Latin that the ordinary mixtures once hid", () => {
    // "rules" with the Osage letter for the r (U+104D8). Osage is not one of
    // the everyday multi-script combinations, however unlisted it is.
    const osage = `\u{104d8}${"rules".slice(1)}`;

    expect(describeConfusableNames([osage]).get(osage)).toBe(
      "mixes characters from Latin and Osage",
    );
  });

  it("should name the third entry that reads like two others", () => {
    // Two entries are the same string and a third only reads like them: the
    // third is the one the reader has no other way to notice.
    const notes = describeConfusableNames(["copy", "copy ", "c\u043epy"]);

    expect(notes.get("copy")).toBe(
      "another entry has the same display form; " +
        "another entry differs from it only by lookalike letters",
    );
    expect(notes.get("c\u043epy")).toBe(
      "another entry differs from it only by lookalike letters; " +
        "mixes characters from Cyrillic and Latin",
    );
  });

  it("should not report a repeated name as colliding with itself", () => {
    expect(describeConfusableNames(["skill-a", "skill-a"])).toEqual(new Map());
  });
});
