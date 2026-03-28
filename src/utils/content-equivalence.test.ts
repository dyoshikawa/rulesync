import { describe, expect, it } from "vitest";

import { fileContentsEquivalent } from "./content-equivalence.js";
import { addTrailingNewline } from "./file.js";
import { stringifyFrontmatter } from "./frontmatter.js";

describe("fileContentsEquivalent", () => {
  it("returns false when existing is null", () => {
    expect(fileContentsEquivalent({ filePath: "/x/a.json", expected: "{}", existing: null })).toBe(
      false,
    );
  });

  it("treats JSON with different formatting as equivalent", () => {
    const a = '{"x":1,"y":[2,3]}';
    const b = `{
  "x": 1,
  "y": [2, 3]
}`;
    expect(
      fileContentsEquivalent({
        filePath: "/project/settings.json",
        expected: `${a}\n`,
        existing: `${b}\n`,
      }),
    ).toBe(true);
  });

  it("detects real JSON value changes", () => {
    expect(
      fileContentsEquivalent({
        filePath: "/x/c.json",
        expected: '{"a":1}\n',
        existing: '{"a":2}\n',
      }),
    ).toBe(false);
  });

  it("falls back to text compare for invalid JSON", () => {
    expect(
      fileContentsEquivalent({
        filePath: "/x/broken.json",
        expected: "not json\n",
        existing: "not json\n",
      }),
    ).toBe(true);
    expect(
      fileContentsEquivalent({
        filePath: "/x/broken.json",
        expected: "not json\n",
        existing: "not json 2\n",
      }),
    ).toBe(false);
  });

  it("treats JSONC with comments and formatting differences as equivalent", () => {
    const a = `{
  // server
  "mcp": { "x": 1 }
}`;
    const b = '{"mcp":{"x":1}}';
    expect(
      fileContentsEquivalent({
        filePath: "/x/opencode.jsonc",
        expected: `${a}\n`,
        existing: `${b}\n`,
      }),
    ).toBe(true);
  });

  it("treats YAML with different layout as equivalent", () => {
    const a = "a: 1\nb:\n  c: 2\n";
    const b = "a: 1\nb: {c: 2}\n";
    expect(
      fileContentsEquivalent({ filePath: "/x/copilot-mcp.yml", expected: a, existing: b }),
    ).toBe(true);
  });

  it("treats TOML with different layout as equivalent when semantic match", () => {
    const a = `[sec]\na = 1\n`;
    const b = `[sec]\na=1\n\n`;
    expect(fileContentsEquivalent({ filePath: "/x/config.toml", expected: a, existing: b })).toBe(
      true,
    );
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
    expect(
      fileContentsEquivalent({
        filePath: "/skill/SKILL.md",
        expected: generated,
        existing: onDisk,
      }),
    ).toBe(true);
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
    expect(
      fileContentsEquivalent({
        filePath: ".cursor/rules/rule.mdc",
        expected: generated,
        existing: onDisk,
      }),
    ).toBe(true);
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
    expect(
      fileContentsEquivalent({
        filePath: "/skill/SKILL.md",
        expected: generated,
        existing: onDisk,
      }),
    ).toBe(true);
  });

  it("uses strict text compare for unknown extensions", () => {
    expect(
      fileContentsEquivalent({ filePath: "/x/foo.txt", expected: "a\n", existing: "a\n" }),
    ).toBe(true);
    expect(
      fileContentsEquivalent({ filePath: "/x/foo.txt", expected: "a\n", existing: "b\n" }),
    ).toBe(false);
  });
});
