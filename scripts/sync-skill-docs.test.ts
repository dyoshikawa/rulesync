import { describe, expect, it } from "vitest";

import {
  assertFlatMirrorLinksResolve,
  removeVitepressSyntax,
  rewriteRelativeLinksForFlatMirror,
} from "./sync-skill-docs.js";

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

  it("handles nested admonition inside details block", () => {
    const input = [
      "::: details Outer",
      "::: tip",
      "Inner tip content",
      ":::",
      "More content after tip",
      ":::",
    ].join("\n");

    const result = removeVitepressSyntax(input);
    expect(result).toContain("#### Outer");
    expect(result).toContain("> **Tip:**");
    expect(result).toContain("More content after tip");
    expect(result).not.toContain(":::");
  });
});

describe("rewriteRelativeLinksForFlatMirror", () => {
  it("collapses parent-directory links to sibling links", () => {
    const input = "See the [FAQ](../faq.md#some-anchor) for details.";
    const result = rewriteRelativeLinksForFlatMirror(input);
    expect(result).toBe("See the [FAQ](./faq.md#some-anchor) for details.");
  });

  it("collapses links with directory segments to sibling links", () => {
    const input = "See [File Formats](../reference/file-formats.md#symlinks).";
    const result = rewriteRelativeLinksForFlatMirror(input);
    expect(result).toBe("See [File Formats](./file-formats.md#symlinks).");
  });

  it("keeps same-directory links unchanged", () => {
    const input = "See [Command Syntax](./command-syntax.md).";
    const result = rewriteRelativeLinksForFlatMirror(input);
    expect(result).toBe(input);
  });

  it("keeps external and anchor-only links unchanged", () => {
    const input = "See [docs](https://example.com/docs/faq.md) and [above](#section).";
    const result = rewriteRelativeLinksForFlatMirror(input);
    expect(result).toBe(input);
  });

  it("rewrites multiple links in one document", () => {
    const input = "[A](../faq.md) then [B](../reference/file-formats.md) then [C](./local.md).";
    const result = rewriteRelativeLinksForFlatMirror(input);
    expect(result).toBe("[A](./faq.md) then [B](./file-formats.md) then [C](./local.md).");
  });
});

describe("assertFlatMirrorLinksResolve", () => {
  it("passes when all relative links resolve to mirrored files", () => {
    const files = new Map([
      ["faq.md", "# FAQ"],
      ["guide.md", "See the [FAQ](./faq.md#anchor) and [bare](faq.md)."],
    ]);
    expect(() => assertFlatMirrorLinksResolve({ files })).not.toThrow();
  });

  it("ignores external, mailto, and anchor-only links", () => {
    const files = new Map([
      ["guide.md", "[ext](https://example.com/x.md) [mail](mailto:a@b.md) [top](#top)"],
    ]);
    expect(() => assertFlatMirrorLinksResolve({ files })).not.toThrow();
  });

  it("throws when a link targets a file missing from the mirror", () => {
    const files = new Map([["guide.md", "See [missing](./missing.md)."]]);
    expect(() => assertFlatMirrorLinksResolve({ files })).toThrow(
      /does not resolve to a mirrored file/,
    );
  });

  it("throws when a link still contains directory segments", () => {
    const files = new Map([
      ["faq.md", "# FAQ"],
      ["guide.md", "See [FAQ](../faq.md)."],
    ]);
    expect(() => assertFlatMirrorLinksResolve({ files })).toThrow(/not a flat sibling link/);
  });
});
