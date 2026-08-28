import { describe, expect, it } from "vitest";

import { describeConfusableNames, mixedScriptsOf } from "./confusable-names.js";

describe("mixedScriptsOf", () => {
  it.each([
    ["a plain ASCII name", "code-review"],
    ["a name with digits and punctuation", "pdf_2024.v2"],
    ["a Japanese name mixing Han, Hiragana and Katakana", "設定のルール"],
    ["a Japanese name carrying Latin", "Rulesyncのルール"],
    ["a Korean name carrying Latin", "규칙-sync"],
    ["a name written only in Cyrillic", "\u043f\u0440\u0430\u0432\u0438\u043b\u0430"],
  ])("should report no mixture for %s", (_label, name) => {
    expect(mixedScriptsOf(name)).toBeUndefined();
  });

  it("should report the scripts of a Latin name spelled with Cyrillic lookalikes", () => {
    // "good" with both o's replaced by Cyrillic U+043E.
    expect(mixedScriptsOf("g\u043e\u043ed")).toEqual(["Cyrillic", "Latin"]);
  });

  it("should report a Latin name carrying a Greek lookalike", () => {
    // A Latin "a" beside the Greek alpha (U+03B1) many fonts draw like it.
    expect(mixedScriptsOf("a\u03b1")).toEqual(["Greek", "Latin"]);
  });

  it("should treat a script it does not name as one bucket", () => {
    // Arabic and Thai are both `Other`, so a name built from the two alone is
    // not reported. This is the documented limit of the one-bucket fallback.
    expect(mixedScriptsOf("\u0645\u0e01")).toBeUndefined();
    // Mixed with a named script, the fallback still shows up.
    expect(mixedScriptsOf("a\u0645")).toEqual(["Latin", "Other"]);
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

  it("should note a mixed-script name even when no lookalike is on the list", () => {
    // "good" with both o's replaced by Cyrillic U+043E.
    const lookalike = "g\u043e\u043ed";
    const notes = describeConfusableNames([lookalike]);

    expect(notes.get(lookalike)).toBe("mixes Cyrillic and Latin characters");
  });

  it("should note the mixed-script twin of a name that does not normalize into it", () => {
    // "good" with the second o replaced by Cyrillic U+043E.
    const lookalike = "go\u043ed";
    const notes = describeConfusableNames(["good", lookalike]);

    // The two differ by one code point, so only the Cyrillic one is flagged as
    // mixed — but neither normalizes into the other, which is exactly why the
    // script check is there as well.
    expect(notes.get(lookalike)).toBe("mixes Cyrillic and Latin characters");
    expect(notes.has("good")).toBe(false);
  });

  it("should not report a repeated name as colliding with itself", () => {
    expect(describeConfusableNames(["skill-a", "skill-a"])).toEqual(new Map());
  });
});
