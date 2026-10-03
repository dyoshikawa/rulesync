import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

import { injectSourceMetadata } from "./gh-frontmatter.js";

const PROVENANCE = {
  source: "https://github.com/owner/repo",
  repository: "owner/repo",
  ref: "v1.0.0",
};

function readFrontmatter(content: string): Record<string, unknown> {
  expect(content.startsWith("---\n")).toBe(true);
  const end = content.indexOf("\n---", 4);
  expect(end).toBeGreaterThan(0);
  const yaml = content.substring(4, end);
  const loaded = load(yaml);
  expect(typeof loaded).toBe("object");
  return loaded as Record<string, unknown>;
}

describe("injectSourceMetadata", () => {
  it("prepends a fresh frontmatter when the file has none", () => {
    const result = injectSourceMetadata({
      content: "# heading\n\nbody\n",
      ...PROVENANCE,
    });
    const fm = readFrontmatter(result);
    expect(fm).toEqual(PROVENANCE);
    expect(result).toContain("# heading\n\nbody\n");
  });

  it("preserves existing frontmatter keys and overwrites only provenance", () => {
    const original = `---
name: my-skill
description: A skill
custom_key: keep-me
source: https://github.com/old/old
---
# body
`;
    const result = injectSourceMetadata({
      content: original,
      ...PROVENANCE,
    });
    const fm = readFrontmatter(result);
    expect(fm.name).toBe("my-skill");
    expect(fm.description).toBe("A skill");
    expect(fm.custom_key).toBe("keep-me");
    expect(fm.source).toBe(PROVENANCE.source);
    expect(fm.repository).toBe(PROVENANCE.repository);
    expect(fm.ref).toBe(PROVENANCE.ref);
    expect(result).toContain("# body");
  });

  it("handles an empty frontmatter block by writing only provenance", () => {
    const result = injectSourceMetadata({
      content: "---\n---\n# body\n",
      ...PROVENANCE,
    });
    const fm = readFrontmatter(result);
    expect(fm).toEqual(PROVENANCE);
    expect(result).toContain("# body\n");
  });

  it("throws on malformed YAML inside the frontmatter block", () => {
    const original = `---
name: my-skill
unbalanced: [oops
---
# body
`;
    expect(() => injectSourceMetadata({ content: original, ...PROVENANCE })).toThrow(
      /invalid frontmatter/,
    );
  });

  it("throws on a frontmatter block whose body is a list (not an object)", () => {
    const original = `---
- one
- two
---
# body
`;
    expect(() => injectSourceMetadata({ content: original, ...PROVENANCE })).toThrow(
      /invalid frontmatter/,
    );
  });

  it("throws on a missing closing fence", () => {
    const original = `---
name: my-skill
# body without closing fence
`;
    expect(() => injectSourceMetadata({ content: original, ...PROVENANCE })).toThrow(
      /invalid frontmatter/,
    );
  });

  it("preserves existing keys when the file uses CRLF line endings", () => {
    // Common on Windows / certain editors. Without explicit CRLF support the
    // opening fence is treated as a normal line and a fresh provenance block
    // is prepended above the entire (still-fenced) original frontmatter,
    // producing two stacked frontmatter blocks and burying user metadata.
    const original = "---\r\nname: my-skill\r\ncustom_key: keep-me\r\n---\r\n# body\r\n";
    const result = injectSourceMetadata({ content: original, ...PROVENANCE });
    const fm = readFrontmatter(result);
    expect(fm.name).toBe("my-skill");
    expect(fm.custom_key).toBe("keep-me");
    expect(fm.source).toBe(PROVENANCE.source);
    expect(fm.repository).toBe(PROVENANCE.repository);
    expect(fm.ref).toBe(PROVENANCE.ref);
    // The original body must survive (modulo the fact that the re-emitted
    // frontmatter uses LF separators per js-yaml's dump output).
    expect(result).toContain("# body\r\n");
    // Crucially: there must be exactly one frontmatter block, not two.
    expect(result.match(/^---$/gm)?.length ?? 0).toBe(2);
  });
});
