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

    expect(notes.get("copy")).toBe("another entry is the same name in a different script");
    expect(notes.get(CYRILLIC_COPY)).toBe("another entry is the same name in a different script");
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
      "another entry is the same name in a different script; " +
        "mixes characters from Cyrillic and Latin",
    );
    expect(notes.get("good")).toBe("another entry is the same name in a different script");
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

  it("should not report a repeated name as colliding with itself", () => {
    expect(describeConfusableNames(["skill-a", "skill-a"])).toEqual(new Map());
  });
});
