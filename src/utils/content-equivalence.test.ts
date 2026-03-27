import { describe, expect, it } from "vitest";

import { fileContentsEquivalent } from "./content-equivalence.js";
import { addTrailingNewline } from "./file.js";
import { stringifyFrontmatter } from "./frontmatter.js";

describe("fileContentsEquivalent", () => {
  it("returns false when existing is null", () => {
    expect(fileContentsEquivalent("/x/a.json", "{}", null)).toBe(false);
  });

  it("treats JSON with different formatting as equivalent", () => {
    const a = '{"x":1,"y":[2,3]}';
    const b = `{
  "x": 1,
  "y": [2, 3]
}`;
    expect(fileContentsEquivalent("/project/settings.json", `${a}\n`, `${b}\n`)).toBe(true);
  });

  it("detects real JSON value changes", () => {
    expect(fileContentsEquivalent("/x/c.json", '{"a":1}\n', '{"a":2}\n')).toBe(false);
  });

  it("falls back to text compare for invalid JSON", () => {
    expect(fileContentsEquivalent("/x/broken.json", "not json\n", "not json\n")).toBe(true);
    expect(fileContentsEquivalent("/x/broken.json", "not json\n", "not json 2\n")).toBe(false);
  });

  it("treats JSONC with comments and formatting differences as equivalent", () => {
    const a = `{
  // server
  "mcp": { "x": 1 }
}`;
    const b = '{"mcp":{"x":1}}';
    expect(fileContentsEquivalent("/x/opencode.jsonc", `${a}\n`, `${b}\n`)).toBe(true);
  });

  it("treats YAML with different layout as equivalent", () => {
    const a = "a: 1\nb:\n  c: 2\n";
    const b = "a: 1\nb: {c: 2}\n";
    expect(fileContentsEquivalent("/x/copilot-mcp.yml", a, b)).toBe(true);
  });

  it("treats TOML with different layout as equivalent when semantic match", () => {
    const a = `[sec]\na = 1\n`;
    const b = `[sec]\na=1\n\n`;
    expect(fileContentsEquivalent("/x/config.toml", a, b)).toBe(true);
  });

  it("treats markdown as equivalent when frontmatter differs only in YAML layout or key order", () => {
    const body = "Hello\n";
    const fm = { name: "test", version: "1.0.0" };
    const generated = addTrailingNewline(stringifyFrontmatter(body, fm));
    const onDisk = `---
version: "1.0.0"
name: test
---

Hello
`;
    expect(fileContentsEquivalent("/skill/SKILL.md", generated, onDisk)).toBe(true);
  });

  it("uses the same markdown rules for .mdc (e.g. Cursor rules)", () => {
    const body = "Hello\n";
    const fm = { name: "test" };
    const generated = addTrailingNewline(stringifyFrontmatter(body, fm));
    const onDisk = `---
name: test
---

Hello
`;
    expect(fileContentsEquivalent(".cursor/rules/rule.mdc", generated, onDisk)).toBe(true);
  });

  it("treats avoidBlockScalars-flattened frontmatter as equivalent to prettier-styled YAML", () => {
    const body = "Body\n";
    const fm = { description: "line1\nline2" };
    const generated = addTrailingNewline(
      stringifyFrontmatter(body, fm, { avoidBlockScalars: true }),
    );
    const onDisk = `---
description: "line1 line2"
---

Body
`;
    expect(fileContentsEquivalent("/skill/SKILL.md", generated, onDisk)).toBe(true);
  });

  it("uses strict text compare for unknown extensions", () => {
    expect(fileContentsEquivalent("/x/foo.txt", "a\n", "a\n")).toBe(true);
    expect(fileContentsEquivalent("/x/foo.txt", "a\n", "b\n")).toBe(false);
  });
});
