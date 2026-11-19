import { describe, expect, it } from "vite-plus/test";

import { firstNonHeadingParagraph } from "./markdown-paragraph.js";

describe("firstNonHeadingParagraph", () => {
  it("skips leading headings and blank lines", () => {
    expect(firstNonHeadingParagraph("# Title\n\n## Sub\nFirst line\nsecond line\n\nNext")).toBe(
      "First line second line",
    );
  });

  it("ends the paragraph at a heading", () => {
    expect(firstNonHeadingParagraph("Intro text\n# Heading\nmore")).toBe("Intro text");
  });

  it("returns an empty string when the body has only headings", () => {
    expect(firstNonHeadingParagraph("# Only\n\n## Headings\n")).toBe("");
  });
});
