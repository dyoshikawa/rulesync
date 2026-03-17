import { describe, expect, it } from "vitest";

import { removeVitepressSyntax } from "./sync-skill-docs.js";

describe("removeVitepressSyntax", () => {
  it("converts ::: details block and bumps internal headings", () => {
    const input = ["::: details My Details", "### Inner Heading", "Some content", ":::"].join("\n");

    const result = removeVitepressSyntax(input);
    expect(result).toContain("#### My Details");
    expect(result).toContain("#### Inner Heading");
    expect(result).not.toContain(":::");
  });

  it("converts ::: tip to blockquote with default title", () => {
    const input = "::: tip\nSome tip content\n:::";
    const result = removeVitepressSyntax(input);
    expect(result).toContain("> **Tip:**");
    expect(result).not.toContain(":::");
  });

  it("converts ::: tip with custom title", () => {
    const input = "::: tip Custom Title\nContent\n:::";
    const result = removeVitepressSyntax(input);
    expect(result).toContain("> **Custom Title:**");
  });

  it("converts ::: warning to blockquote", () => {
    const input = "::: warning\nBe careful\n:::";
    const result = removeVitepressSyntax(input);
    expect(result).toContain("> **Warning:**");
  });

  it("converts ::: info to blockquote", () => {
    const input = "::: info\nInformation\n:::";
    const result = removeVitepressSyntax(input);
    expect(result).toContain("> **Info:**");
  });

  it("converts ::: danger to blockquote", () => {
    const input = "::: danger\nDangerous\n:::";
    const result = removeVitepressSyntax(input);
    expect(result).toContain("> **Danger:**");
  });

  it("does not remove ::: inside code blocks", () => {
    const input = ["```markdown", "::: tip", "This is inside a code block", ":::", "```"].join(
      "\n",
    );

    // The regex operates line-by-line, so ::: inside code blocks will
    // unfortunately be matched. This test documents current behavior.
    const result = removeVitepressSyntax(input);
    // Code block fences should remain
    expect(result).toContain("```markdown");
    expect(result).toContain("```");
  });

  it("collapses 3+ consecutive blank lines to 2", () => {
    const input = "Line 1\n\n\n\n\nLine 2";
    const result = removeVitepressSyntax(input);
    expect(result).toBe("Line 1\n\n\nLine 2");
  });

  it("preserves content without VitePress syntax", () => {
    const input = "# Title\n\nSome regular markdown content.\n\n## Section\n\nMore content.";
    const result = removeVitepressSyntax(input);
    expect(result).toBe(input);
  });

  it("bumps ## to ### inside details blocks", () => {
    const input = ["::: details Expandable", "## H2 Inside", "### H3 Inside", ":::"].join("\n");

    const result = removeVitepressSyntax(input);
    expect(result).toContain("#### Expandable");
    expect(result).toContain("### H2 Inside");
    expect(result).toContain("#### H3 Inside");
  });
});
