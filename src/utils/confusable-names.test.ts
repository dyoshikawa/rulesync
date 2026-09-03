// cspell:ignore eploy forrnat revievv -- deliberate lookalike spellings used as fixtures
import { describe, expect, it } from "vitest";

import { describeConfusableNames, mixedScriptsOf } from "./confusable-names.js";

/**
 * "copy" spelled entirely in Cyrillic: U+0441 U+043E U+0440 U+0443. Written as
 * escapes on purpose — the point of the name is that it cannot be told from the
 * Latin word on sight, and a reviewer reading this file is owed the same
 * warning the prompt gives.
 */
const CYRILLIC_COPY = "\u0441\u043e\u0440\u0443";
/** "good" with both o's replaced by the Cyrillic o, U+043E. */
const HALF_CYRILLIC_GOOD = "g\u043e\u043ed";
/** The note both halves of a lookalike pair are given. */
const TWIN_NOTE = "another entry differs from it only by lookalike letters";
/** The note both halves of a pair that prints identically are given. */
const SAME_FORM_NOTE = "another entry has the same display form";
/** The note a name carrying more whitespace than it shows is given. */
const WHITESPACE_NOTE = "carries more whitespace than the row shows";

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

  it.each([
    ["Vai", "\ua500pdf", ["Latin", "Vai"]],
    ["Canadian Aboriginal", "\u1401pdf", ["Canadian Aboriginal", "Latin"]],
  ])(
    "should report %s beside Latin even though it is not read as Latin on its own",
    (_label, name, expected) => {
      // Neither script is taken whole by the Latin-shaped list, because neither
      // is drawn in Latin shapes throughout. Both are still named rather than
      // left in the `Other` bucket, so the letters of theirs that do resemble a
      // Latin one are reported when they turn up in a Latin name.
      expect(mixedScriptsOf(name)).toEqual(expected);
    },
  );

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
    expect(describeConfusableNames({ names: ["skill-a", "skill-b"], localNames: [] })).toEqual(
      new Map(),
    );
  });

  it("should note both entries that share a display form", () => {
    const notes = describeConfusableNames({ names: ["Skill", "skill"], localNames: [] });

    expect(notes.get("Skill")).toBe(SAME_FORM_NOTE);
    expect(notes.get("skill")).toBe(SAME_FORM_NOTE);
  });

  it("should fold compatibility forms when comparing display forms", () => {
    // Fullwidth "pdf" (U+FF50 U+FF44 U+FF46) normalizes to "pdf" under NFKC.
    const fullwidth = "\uff50\uff44\uff46";
    const notes = describeConfusableNames({ names: ["pdf", fullwidth], localNames: [] });

    expect(notes.get("pdf")).toBe(SAME_FORM_NOTE);
    expect(notes.get(fullwidth)).toBe(SAME_FORM_NOTE);
  });

  it("should fold invisible characters when comparing display forms", () => {
    // A zero-width space (U+200B) survives NFKC while showing nothing at all,
    // so the two names below are drawn identically.
    const invisible = "pd\u200bf";
    const notes = describeConfusableNames({ names: ["pdf", invisible], localNames: [] });

    expect(notes.get("pdf")).toBe(SAME_FORM_NOTE);
    expect(notes.get(invisible)).toBe(SAME_FORM_NOTE);
  });

  it("should note a name spelled entirely in another script beside its twin", () => {
    // Neither name mixes scripts and neither normalizes into the other, so this
    // pair is only visible by comparing the two against each other.
    const notes = describeConfusableNames({ names: ["copy", CYRILLIC_COPY], localNames: [] });

    expect(notes.get("copy")).toBe(TWIN_NOTE);
    expect(notes.get(CYRILLIC_COPY)).toBe(
      `${TWIN_NOTE}; reads as Latin letters but is written in Cyrillic`,
    );
  });

  it("should note a name written entirely in Latin lookalikes with nothing to compare it to", () => {
    // The whole-script confusable of UTS #39: one script, so no mixture, and no
    // Latin twin on the list, so the other two checks have nothing to see.
    const notes = describeConfusableNames({ names: [CYRILLIC_COPY, "unrelated"], localNames: [] });

    expect(notes.get(CYRILLIC_COPY)).toBe("reads as Latin letters but is written in Cyrillic");
    expect(notes.has("unrelated")).toBe(false);
  });

  it("should not report an ordinary word of a script that merely has some lookalikes", () => {
    // "\u043f\u0440\u0430\u0432\u0438\u043b\u0430" (rules, in Russian) carries Cyrillic
    // letters that are drawn as Latin ones, but not only those, so it does not
    // read as a Latin word.
    expect(
      describeConfusableNames({
        names: ["\u043f\u0440\u0430\u0432\u0438\u043b\u0430"],
        localNames: [],
      }),
    ).toEqual(new Map());
    // No letter shape in common with the Cyrillic word above:
    // matching them up as twins is what a script-only rule would do.
    expect(
      describeConfusableNames({
        names: ["\u043f\u0440\u0430\u0432\u0438\u043b\u0430", "rulesync"],
        localNames: [],
      }),
    ).toEqual(new Map());
  });

  it("should not call two same-length names twins when no letter shape matches", () => {
    // "\u03bb\u03cc\u03b3\u03bf\u03c2" is Greek for "word" and is five letters,
    // like "rules", but none of them is drawn as the Latin letter beside it.
    expect(
      describeConfusableNames({
        names: ["rules", "\u03bb\u03cc\u03b3\u03bf\u03c2"],
        localNames: [],
      }),
    ).toEqual(new Map());
  });

  it("should fold whitespace differences into the display form", () => {
    // A padded name and a plain one occupy the same row on screen once the
    // terminal has drawn them, so they are reported as the pair they are. The
    // padded one is told which half of the pair it is, too.
    const padded = "pdf  ";
    const notes = describeConfusableNames({ names: ["pdf", padded], localNames: [] });

    expect(notes.get("pdf")).toBe(SAME_FORM_NOTE);
    expect(notes.get(padded)).toBe(`${WHITESPACE_NOTE}; ${SAME_FORM_NOTE}`);
  });

  it.each([
    ["a name that ends in a space", "pdf "],
    ["a name that begins with a space", " pdf"],
    ["a name with a doubled space", "pdf  reader"],
    ["a name with a doubled ideographic space", "pdf\u3000\u3000reader"],
    // The blank a name inside is spared for is marked at an edge all the same:
    // there the question is not which blank was chosen but that the name
    // reaches past where it appears to end.
    ["a name that ends in an ideographic space", "\u8a2d\u5b9a\u3000"],
  ])("should note %s with nothing to compare it to", (_label, name) => {
    // No twin on the list, so nothing else says the row reaches past what can
    // be seen of it.
    expect(describeConfusableNames({ names: [name], localNames: [] })).toEqual(
      new Map([[name, WHITESPACE_NOTE]]),
    );
  });

  it.each([
    ["a single space inside a name", "pdf reader"],
    // Drawn, and drawn wider than a plain space at that. A name that swaps one
    // blank for another is the display-form check's business, and reporting it
    // here would put a warning on an ordinary Japanese name.
    ["a single ideographic space inside a name", "\u8a2d\u5b9a\u3000\u30ac\u30a4\u30c9"],
    ["a single no-break space inside a name", "pdf\u00a0reader"],
  ])("should leave %s alone", (_label, name) => {
    expect(describeConfusableNames({ names: [name], localNames: [] })).toEqual(new Map());
  });

  it("should still pair a name that swaps a blank for one drawn like it", () => {
    // The pair is what makes the substitution visible, and the display form is
    // what reports it.
    const wide = "pdf\u00a0reader";
    const notes = describeConfusableNames({ names: ["pdf reader", wide], localNames: [] });

    expect(notes.get("pdf reader")).toBe(SAME_FORM_NOTE);
    expect(notes.get(wide)).toBe(SAME_FORM_NOTE);
  });

  it("should not note names that differ within a single script", () => {
    expect(describeConfusableNames({ names: ["cat", "dog", "cap"], localNames: [] })).toEqual(
      new Map(),
    );
  });

  it("should note a mixed-script name even when no lookalike is on the list", () => {
    const notes = describeConfusableNames({ names: [HALF_CYRILLIC_GOOD], localNames: [] });

    expect(notes.get(HALF_CYRILLIC_GOOD)).toBe("mixes characters from Cyrillic and Latin");
  });

  it("should note every reason that applies to the same name", () => {
    const notes = describeConfusableNames({ names: ["good", HALF_CYRILLIC_GOOD], localNames: [] });

    expect(notes.get(HALF_CYRILLIC_GOOD)).toBe(
      `${TWIN_NOTE}; mixes characters from Cyrillic and Latin`,
    );
    expect(notes.get("good")).toBe(TWIN_NOTE);
  });

  it("should list three scripts as a sentence rather than a chain of ands", () => {
    // Latin "a", the Greek alpha and the Cyrillic a, all drawn alike.
    const threeScripts = "a\u03b1\u0430";
    const notes = describeConfusableNames({ names: [threeScripts], localNames: [] });

    expect(notes.get(threeScripts)).toBe("mixes characters from Cyrillic, Greek and Latin");
  });

  it("should not name the internal bucket an unlisted script falls into", () => {
    // Cyrillic beside Arabic: reported, but as "another script" rather than by
    // the bucket's own name.
    const withArabic = "\u0440\u0645";
    const notes = describeConfusableNames({ names: [withArabic], localNames: [] });

    expect(notes.get(withArabic)).toBe("mixes characters from Cyrillic and another script");
  });

  it("should fold an invisible character that normalization turns into another", () => {
    // U+3164 HANGUL FILLER shows nothing and is a Hangul letter, so a check
    // aimed at Latin would pass it; NFKC then turns it into U+1160, which shows
    // nothing either. Stripping only once, on either side of the
    // normalization, would leave the two names apart.
    const hangulFiller = "pd\u3164f";
    const notes = describeConfusableNames({ names: ["pdf", hangulFiller], localNames: [] });

    expect(notes.get("pdf")).toBe(SAME_FORM_NOTE);
    expect(notes.get(hangulFiller)).toBe(SAME_FORM_NOTE);
  });

  it("should not call two names of the same length twins when nothing links them", () => {
    // Same length and no shared script, but no one would take a Japanese name
    // for a two-letter Latin one. Marking these would fire on ordinary
    // repositories often enough to make the mark worth ignoring.
    expect(describeConfusableNames({ names: ["\u8a2d\u5b9a", "ai"], localNames: [] })).toEqual(
      new Map(),
    );
    expect(describeConfusableNames({ names: ["\uaddc\uce59", "go"], localNames: [] })).toEqual(
      new Map(),
    );
  });

  it("should note a twin written in an alphabet only UTS #39 would name", () => {
    // "copy" with the Latin o replaced by the Armenian o, U+0585.
    const armenian = "c\u0585py";
    const notes = describeConfusableNames({ names: ["copy", armenian], localNames: [] });

    expect(notes.get("copy")).toBe(TWIN_NOTE);
    expect(notes.get(armenian)).toBe(`${TWIN_NOTE}; mixes characters from Armenian and Latin`);
  });

  it("should note a twin that never leaves the Latin alphabet", () => {
    // A digit for a letter, a capital I for an l, the script g (U+0261) and the
    // dotless i (U+0131): four ways to spell a name in characters this project
    // already uses, none of which changes what the name looks like.
    expect(describeConfusableNames({ names: ["copy", "c0py"], localNames: [] })).toEqual(
      new Map([
        ["copy", TWIN_NOTE],
        ["c0py", TWIN_NOTE],
      ]),
    );
    expect(describeConfusableNames({ names: ["rules", "ruIes"], localNames: [] })).toEqual(
      new Map([
        ["rules", TWIN_NOTE],
        ["ruIes", TWIN_NOTE],
      ]),
    );
    expect(describeConfusableNames({ names: ["git", "\u0261it"], localNames: [] })).toEqual(
      new Map([
        ["git", TWIN_NOTE],
        ["\u0261it", TWIN_NOTE],
      ]),
    );
    expect(describeConfusableNames({ names: ["git", "g\u0131t"], localNames: [] })).toEqual(
      new Map([
        ["git", TWIN_NOTE],
        ["g\u0131t", TWIN_NOTE],
      ]),
    );
  });

  it("should note a twin the compatibility normalization would have hidden", () => {
    // U+2160 ROMAN NUMERAL ONE normalizes to a capital I, which is read as an
    // l — a pairing only visible to a fold that runs after the normalization.
    expect(describeConfusableNames({ names: ["list", "\u2160ist"], localNames: [] })).toEqual(
      new Map([
        ["list", TWIN_NOTE],
        ["\u2160ist", TWIN_NOTE],
      ]),
    );
  });

  it("should leave an ordinary word in a lookalike alphabet alone", () => {
    // Every one of these is a plain Russian or Greek word. They are written in
    // letters whose capitals are drawn like Latin ones — в for B, к for K, τ
    // for T — which is not the same as being drawn like Latin ones as written.
    const ordinary = ["нет", "как", "тема", "мост", "текст", "автор", "και", "κατα", "ωρα"];

    expect(describeConfusableNames({ names: ordinary, localNames: [] })).toEqual(new Map());
  });

  it("should still report a word whose every letter is drawn as a Latin one", () => {
    expect(
      describeConfusableNames({ names: [CYRILLIC_COPY], localNames: [] }).get(CYRILLIC_COPY),
    ).toBe("reads as Latin letters but is written in Cyrillic");
  });

  it("should report an alphabet drawn like Latin that the ordinary mixtures once hid", () => {
    // "rules" with the Osage letter for the r (U+104D8). Osage is not one of
    // the everyday multi-script combinations, however unlisted it is.
    const osage = `\u{104d8}${"rules".slice(1)}`;

    expect(describeConfusableNames({ names: [osage], localNames: [] }).get(osage)).toBe(
      "mixes characters from Latin and Osage",
    );
  });

  it("should name the third entry that reads like two others", () => {
    // Two entries are the same string and a third only reads like them: the
    // third is the one the reader has no other way to notice.
    const notes = describeConfusableNames({
      names: ["copy", "copy ", "c\u043epy"],
      localNames: [],
    });

    expect(notes.get("copy")).toBe(`${SAME_FORM_NOTE}; ${TWIN_NOTE}`);
    expect(notes.get("c\u043epy")).toBe(`${TWIN_NOTE}; mixes characters from Cyrillic and Latin`);
  });

  it("should note a twin that only replaces the hyphen", () => {
    // Nearly every name here is kebab-case, so the separator is the one
    // character that can be swapped without touching a letter. U+2010 HYPHEN is
    // drawn exactly as the ASCII one, belongs to no script, and survives the
    // compatibility normalization untouched.
    expect(
      describeConfusableNames({ names: ["code-review", "code\u2010review"], localNames: [] }),
    ).toEqual(
      new Map([
        ["code-review", TWIN_NOTE],
        ["code\u2010review", TWIN_NOTE],
      ]),
    );
  });

  it("should leave the dash this tool marks its own rows with alone", () => {
    // U+2014 EM DASH separates a note from a name in the prompt, and it is
    // drawn plainly longer than a hyphen. Folding it would hand a name a way
    // into how the prompt marks its rows.
    expect(
      describeConfusableNames({ names: ["code-review", "code\u2014review"], localNames: [] }),
    ).toEqual(new Map());
  });

  it("should note a twin that only replaces the apostrophe", () => {
    expect(
      describeConfusableNames({ names: ["let's-go", "let\u2019s-go"], localNames: [] }),
    ).toEqual(
      new Map([
        ["let's-go", TWIN_NOTE],
        ["let\u2019s-go", TWIN_NOTE],
      ]),
    );
  });

  it("should report a name written wholly in an alphabet drawn like Latin", () => {
    // Four Lisu letters, read as PDF. Lisu maps no letter in the tables, so
    // neither the skeleton nor a mixture says anything about it; being written
    // in nothing but a Latin-shaped alphabet is the whole of what is wrong.
    expect(
      describeConfusableNames({ names: ["\ua4d1\ua4d3\ua4de"], localNames: [] }).get(
        "\ua4d1\ua4d3\ua4de",
      ),
    ).toBe("reads as Latin letters but is written in Lisu");
  });

  it.each([
    ["Tifinagh", "\u2d4f\u2d3d\u2d4d"],
    ["Deseret", "\u{10428}\u{10429}\u{1042a}"],
    ["Coptic", "\u2c9f\u2ca3\u2c9b"],
  ])("should report a name written wholly in %s the same way", (script, name) => {
    expect(describeConfusableNames({ names: [name], localNames: [] }).get(name)).toBe(
      `reads as Latin letters but is written in ${script}`,
    );
  });

  it.each([
    ["Vai", "\ua500\ua502\ua504"],
    ["Canadian Aboriginal", "\u1401\u1403\u1405"],
  ])("should not report a name written wholly in %s", (_script, name) => {
    // Both alphabets are drawn in shapes of their own, so a name in either
    // reads as nothing Latin. Saying that it does would be a false note on an
    // ordinary name — the only alphabets taken whole are the ones built from
    // Latin letter shapes.
    expect(describeConfusableNames({ names: [name], localNames: [] })).toEqual(new Map());
  });

  it("should not report a repeated name as colliding with itself", () => {
    expect(describeConfusableNames({ names: ["skill-a", "skill-a"], localNames: [] })).toEqual(
      new Map(),
    );
  });

  it("should report a name that reads like a local one with no twin on the list", () => {
    // Nothing on the list to compare against, one script, plain ASCII: without
    // the local names this is a name every check has nothing to say about.
    expect(describeConfusableNames({ names: ["dep1oy"], localNames: ["deploy"] })).toEqual(
      new Map([["dep1oy", "a local skill differs from it only by lookalike letters"]]),
    );
  });

  it("should report a name that shares a display form with a local one", () => {
    expect(describeConfusableNames({ names: ["deploy"], localNames: ["deploy-v2"] })).toEqual(
      new Map(),
    );
    expect(describeConfusableNames({ names: ["deploy"], localNames: ["\uff44eploy"] })).toEqual(
      new Map([["deploy", "a local skill has the same display form"]]),
    );
  });

  it("should report a local name that differs only in case or composition", () => {
    // Whether these name one directory is a question about the filesystem, and
    // the caller settles it before the names get here: what reaches this
    // function is a local skill it has already decided is a separate directory.
    expect(describeConfusableNames({ names: ["Deploy"], localNames: ["deploy"] })).toEqual(
      new Map([["Deploy", "a local skill has the same display form"]]),
    );
    expect(describeConfusableNames({ names: ["caf\u00e9"], localNames: ["cafe\u0301"] })).toEqual(
      new Map([["caf\u00e9", "a local skill has the same display form"]]),
    );
  });

  it("should still report a local name that no filesystem folds onto it", () => {
    // Fullwidth letters are a second directory everywhere: NFC leaves them
    // alone, and only the display form the reader sees folds them together.
    expect(describeConfusableNames({ names: ["pdf"], localNames: ["\uff50\uff44\uff46"] })).toEqual(
      new Map([["pdf", "a local skill has the same display form"]]),
    );
  });

  it("should report a pair of letters drawn as the single letter it imitates", () => {
    // Two letters drawn as one, which the one-character tables cannot see:
    // both names are plain ASCII in a single script, so nothing else marks them.
    expect(describeConfusableNames({ names: ["forrnat"], localNames: ["format"] })).toEqual(
      new Map([["forrnat", "a local skill differs from it only by lookalike letters"]]),
    );
    expect(describeConfusableNames({ names: ["revievv", "review"], localNames: [] })).toEqual(
      new Map([
        ["revievv", "another entry differs from it only by lookalike letters"],
        ["review", "another entry differs from it only by lookalike letters"],
      ]),
    );
  });

  it("should leave the pairs that open ordinary words alone", () => {
    // `cl` for `d` is the third of the classic three and is not folded: it
    // opens too many words to tell an imitation from a name.
    expect(describeConfusableNames({ names: ["clone"], localNames: ["done"] })).toEqual(new Map());
    expect(describeConfusableNames({ names: ["cli"], localNames: ["di"] })).toEqual(new Map());
  });

  it("should not describe the local names themselves", () => {
    // They are compared against, not offered: a note on a name that is on no
    // list would be a note with no row to sit beside.
    expect(describeConfusableNames({ names: ["copy"], localNames: ["c0py", "pdf "] })).toEqual(
      new Map([["copy", "a local skill differs from it only by lookalike letters"]]),
    );
  });

  it("should not report a local name spelled exactly like one on the list", () => {
    // The skill being updated rather than one imitating it. Marking it would
    // mark every row of every second fetch of the same repository.
    expect(describeConfusableNames({ names: ["deploy"], localNames: ["deploy"] })).toEqual(
      new Map(),
    );
  });

  it("should name the entry on the list rather than the local skill when both collide", () => {
    // Both rows can be compared on screen, which the local skill cannot be, and
    // both are marked either way.
    expect(describeConfusableNames({ names: ["copy", "c0py"], localNames: ["c\u043epy"] })).toEqual(
      new Map([
        ["copy", "another entry differs from it only by lookalike letters"],
        ["c0py", "another entry differs from it only by lookalike letters"],
      ]),
    );
  });
});
