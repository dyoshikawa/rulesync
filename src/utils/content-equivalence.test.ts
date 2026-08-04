import { describe, expect, it } from "vitest";

import {
  companionFileContentsEquivalent,
  fileContentIsEmptyPayload,
  fileContentsEquivalent,
} from "./content-equivalence.js";
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

  it("treats CRLF and LF as equivalent for text files", () => {
    expect(
      fileContentsEquivalent({
        filePath: "/x/foo.txt",
        expected: "line1\nline2\n",
        existing: "line1\r\nline2\r\n",
      }),
    ).toBe(true);
  });

  it("treats standalone carriage returns and LF as equivalent for text files", () => {
    expect(
      fileContentsEquivalent({
        filePath: "/x/foo.txt",
        expected: "line1\nline2\n",
        existing: "line1\rline2\r",
      }),
    ).toBe(true);
  });
});

describe("fileContentIsEmptyPayload", () => {
  it("treats whitespace-only content as empty for any extension", () => {
    expect(fileContentIsEmptyPayload({ filePath: "/x/settings.json", content: "" })).toBe(true);
    expect(fileContentIsEmptyPayload({ filePath: "/x/config.toml", content: "\n  \n" })).toBe(true);
    expect(fileContentIsEmptyPayload({ filePath: "/x/notes.txt", content: "  " })).toBe(true);
  });

  it("treats structurally empty JSON documents as empty", () => {
    expect(fileContentIsEmptyPayload({ filePath: "/x/settings.json", content: "{}" })).toBe(true);
    expect(
      fileContentIsEmptyPayload({ filePath: "/x/settings.json", content: '{"permissions":{}}' }),
    ).toBe(true);
    expect(
      fileContentIsEmptyPayload({
        filePath: "/x/config.json",
        content: '{"mcpServers":{},"permissions":{"allow":[]}}',
      }),
    ).toBe(true);
  });

  it("treats any scalar value as content", () => {
    expect(
      fileContentIsEmptyPayload({ filePath: "/x/settings.json", content: '{"enabled":false}' }),
    ).toBe(false);
    expect(
      fileContentIsEmptyPayload({
        filePath: "/x/settings.json",
        content: '{"permissions":{"allow":["read"]}}',
      }),
    ).toBe(false);
  });

  it("handles YAML and TOML documents", () => {
    expect(
      fileContentIsEmptyPayload({ filePath: "/x/config.yaml", content: "extensions: {}" }),
    ).toBe(true);
    expect(
      fileContentIsEmptyPayload({ filePath: "/x/config.yaml", content: "extensions:\n  a: 1\n" }),
    ).toBe(false);
    expect(fileContentIsEmptyPayload({ filePath: "/x/config.toml", content: "# comment\n" })).toBe(
      true,
    );
    expect(
      fileContentIsEmptyPayload({ filePath: "/x/config.toml", content: 'model = "x"\n' }),
    ).toBe(false);
  });

  it("treats unparseable or unstructured content as non-empty", () => {
    expect(fileContentIsEmptyPayload({ filePath: "/x/settings.json", content: "{not json" })).toBe(
      false,
    );
    expect(fileContentIsEmptyPayload({ filePath: "/x/AGENTS.md", content: "# Title\n" })).toBe(
      false,
    );
  });

  it("treats a comment-only YAML document as empty", () => {
    // `loadYaml` legitimately returns `undefined` here, which must not be
    // confused with a parse failure.
    expect(fileContentIsEmptyPayload({ filePath: "/x/config.yaml", content: "# comment\n" })).toBe(
      true,
    );
  });

  it("treats a null document and empty containers as empty", () => {
    expect(fileContentIsEmptyPayload({ filePath: "/x/settings.json", content: "null" })).toBe(true);
    expect(fileContentIsEmptyPayload({ filePath: "/x/settings.json", content: "[]" })).toBe(true);
    expect(
      fileContentIsEmptyPayload({ filePath: "/x/settings.jsonc", content: "// note\n{}\n" }),
    ).toBe(true);
  });

  it("treats a non-empty array as content regardless of its elements", () => {
    expect(fileContentIsEmptyPayload({ filePath: "/x/settings.json", content: '{"a":[{}]}' })).toBe(
      false,
    );
    expect(fileContentIsEmptyPayload({ filePath: "/x/settings.json", content: "[{}]" })).toBe(
      false,
    );
  });

  it("treats a __proto__ entry as content instead of losing its payload", () => {
    // jsonc-parser resolves `__proto__` by replacing the prototype, so the
    // nested servers would be invisible to a plain own-property walk.
    expect(
      fileContentIsEmptyPayload({
        filePath: "/x/settings.json",
        content: '{"mcpServers":{"__proto__":{"evil":1}}}',
      }),
    ).toBe(false);
  });

  it("does not recurse forever on a self-referential YAML anchor", () => {
    expect(
      fileContentIsEmptyPayload({ filePath: "/x/config.yaml", content: "&r\nfoo: *r\n" }),
    ).toBe(false);
  });

  it("treats a date-only TOML document as content", () => {
    expect(
      fileContentIsEmptyPayload({ filePath: "/x/config.toml", content: "updated = 2026-01-01\n" }),
    ).toBe(false);
  });
});

const compare = (filePath: string, expected: Buffer, existing: Buffer | null) =>
  companionFileContentsEquivalent({ filePath, expected, existing });

describe("companionFileContentsEquivalent", () => {
  it("returns false when the file does not exist yet", () => {
    expect(compare("/x/logo.png", Buffer.from("a"), null)).toBe(false);
  });

  it("returns true for byte-identical buffers", () => {
    const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe]);
    expect(compare("/x/logo.png", buffer, Buffer.from(buffer))).toBe(true);
  });

  it("returns false when binary bytes differ", () => {
    expect(compare("/x/logo.png", Buffer.from([0xff, 0xfe]), Buffer.from([0xff, 0xfd]))).toBe(
      false,
    );
  });

  it("returns false for text differing only in line endings or trailing newline", () => {
    expect(compare("/x/fixture.txt", Buffer.from("a\r\nb"), Buffer.from("a\nb\n"))).toBe(false);
  });

  it("returns true for a structurally equivalent YAML companion", () => {
    expect(
      compare("/x/agents/openai.yaml", Buffer.from("name: deploy\n"), Buffer.from("name:  deploy")),
    ).toBe(true);
  });

  it("returns false for a structurally different YAML companion", () => {
    expect(
      compare("/x/agents/openai.yaml", Buffer.from("name: deploy\n"), Buffer.from("name: build\n")),
    ).toBe(false);
  });

  it("returns false when a structured extension holds unparsable content", () => {
    expect(compare("/x/data.json", Buffer.from("{"), Buffer.from("{{"))).toBe(false);
  });
});
