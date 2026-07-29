import { describe, expect, it } from "vitest";

import { slugifyCheckName } from "./check-slug.js";

describe("slugifyCheckName", () => {
  it("lowercases and collapses runs of non-alphanumerics into single hyphens", () => {
    expect(slugifyCheckName("No_Console  Logs!")).toBe("no-console-logs");
  });

  it("trims leading and trailing separators", () => {
    expect(slugifyCheckName("--style--")).toBe("style");
  });

  it("neutralizes a name that would otherwise escape the checks directory", () => {
    expect(slugifyCheckName("../../etc/passwd")).toBe("etc-passwd");
  });

  it("caps the length without leaving a trailing separator", () => {
    const slug = slugifyCheckName(`${"a".repeat(47)} tail`);

    expect(slug).toHaveLength(47);
    expect(slug.endsWith("-")).toBe(false);
  });

  it("returns an empty string when nothing survives, so callers can fall back", () => {
    expect(slugifyCheckName("///")).toBe("");
  });
});
