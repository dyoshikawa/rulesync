import { describe, expect, it } from "vitest";

import { deriveSharedFileWriters } from "../../lib/shared-file-derive.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import type { ClaudeSettingsJson } from "../../types/claude-settings.js";
import * as sharedConfigGateway from "./shared-config-gateway.js";
import {
  applyIgnoreReadDenies,
  applyPermissions,
  applySharedConfigPatch,
  buildReadDenyEntry,
  HERMES_CONFIG_SHARED_FILE_KEY,
  isReadDenyEntry,
  mergeSharedConfigDeep,
  mergeSharedConfigShallow,
  parseSharedConfig,
  serializeSharedConfig,
  SHARED_CONFIG_OWNERSHIP,
  stringifySharedConfig,
  TAKT_CONFIG_SHARED_FILE_KEY,
} from "./shared-config-gateway.js";

describe("parseSharedConfig", () => {
  it("treats an empty file as an empty document in every format", () => {
    expect(parseSharedConfig({ format: "yaml", fileContent: "  \n" })).toEqual({});
    expect(parseSharedConfig({ format: "json", fileContent: "" })).toEqual({});
    expect(parseSharedConfig({ format: "jsonc", fileContent: "" })).toEqual({});
    expect(parseSharedConfig({ format: "toml", fileContent: "  \n" })).toEqual({});
  });

  it("parses each format into a plain document", () => {
    expect(parseSharedConfig({ format: "yaml", fileContent: "model: hermes-3" })).toEqual({
      model: "hermes-3",
    });
    expect(parseSharedConfig({ format: "json", fileContent: '{"a": 1}' })).toEqual({ a: 1 });
    expect(
      parseSharedConfig({ format: "jsonc", fileContent: '{\n  // comment\n  "a": 1,\n}' }),
    ).toEqual({ a: 1 });
    expect(parseSharedConfig({ format: "toml", fileContent: 'model = "hermes-3"' })).toEqual({
      model: "hermes-3",
    });
  });

  it("coerces a non-mapping root to an empty document by default", () => {
    expect(parseSharedConfig({ format: "yaml", fileContent: "- item" })).toEqual({});
    expect(parseSharedConfig({ format: "jsonc", fileContent: "[1, 2]" })).toEqual({});
  });

  it("throws with the file path on a non-mapping root when declared strict", () => {
    expect(() =>
      parseSharedConfig({
        format: "yaml",
        fileContent: "- item",
        filePath: ".takt/config.yaml",
        invalidRootPolicy: "error",
      }),
    ).toThrow(/Failed to parse shared config at \.takt\/config\.yaml/);
  });

  it("throws with the file path on invalid syntax", () => {
    expect(() =>
      parseSharedConfig({
        format: "yaml",
        fileContent: "foo: [unclosed",
        filePath: ".takt/config.yaml",
      }),
    ).toThrow(/Failed to parse shared config at \.takt\/config\.yaml/);
    expect(() =>
      parseSharedConfig({
        format: "json",
        fileContent: "{ not json",
        filePath: ".claude/settings.json",
      }),
    ).toThrow(/Failed to parse shared config at \.claude\/settings\.json/);
  });

  it("drops prototype-pollution keys recursively", () => {
    const config = parseSharedConfig({
      format: "yaml",
      fileContent: `
model: hermes-3
__proto__:
  polluted: true
mcp_servers:
  docs:
    url: https://example.com/mcp
    constructor:
      polluted: true
plugins:
  enabled:
    - rulesync-subagents
  prototype:
    polluted: true
`,
    });

    expect(config).toEqual({
      model: "hermes-3",
      mcp_servers: {
        docs: {
          url: "https://example.com/mcp",
        },
      },
      plugins: {
        enabled: ["rulesync-subagents"],
      },
    });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("keeps the rest of a JSONC file that states a root-level pollution key", () => {
    // `jsonc-parser` assigns `"__proto__"` with `obj[key] = value`, which
    // replaces the root object's prototype instead of adding a key: the root
    // stops being a plain object. Judging it before sanitizing would coerce
    // the whole document to `{}` and silently drop every setting beside it.
    const config = parseSharedConfig({
      format: "jsonc",
      fileContent: [
        "{",
        '  "model": "gpt",',
        '  "__proto__": { "polluted": true },',
        '  "mcp": { "docs": { "type": "local" } }',
        "}",
      ].join("\n"),
    });

    expect(config).toEqual({ model: "gpt", mcp: { docs: { type: "local" } } });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect((config as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("keeps the siblings of a nested JSONC pollution key", () => {
    const config = parseSharedConfig({
      format: "jsonc",
      fileContent: '{ "permission": { "__proto__": { "polluted": true }, "bash": "ask" } }',
    });

    expect(config).toEqual({ permission: { bash: "ask" } });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("preserves the dates a TOML config states", () => {
    // `smol-toml` resolves date-times to `TomlDate`. Sanitizing rebuilds every
    // other object, so dates have to be passed through rather than flattened
    // into an empty mapping.
    const config = parseSharedConfig({
      format: "toml",
      fileContent: "released = 2020-01-02T00:00:00Z\n",
    });

    expect((config as { released: unknown }).released).toBeInstanceOf(Date);
  });
});

describe("stringifySharedConfig", () => {
  it("emits YAML with exactly one trailing newline", () => {
    expect(stringifySharedConfig({ format: "yaml", document: { a: 1 } })).toBe("a: 1\n");
  });

  it("emits 2-space JSON without a trailing newline", () => {
    expect(stringifySharedConfig({ format: "json", document: { a: 1 } })).toBe('{\n  "a": 1\n}');
  });

  it("emits TOML matching smol-toml's stringify shape", () => {
    const toml = stringifySharedConfig({ format: "toml", document: { model: "hermes-3" } });
    expect(toml).toBe('model = "hermes-3"\n');
    // Round-trips back through the toml codec.
    expect(parseSharedConfig({ format: "toml", fileContent: toml })).toEqual({ model: "hermes-3" });
  });
});

const parse = (fileContent: string): Record<string, unknown> =>
  parseSharedConfig({ format: "jsonc", fileContent });

describe("serializeSharedConfig", () => {
  const commented = [
    "{",
    "  // The comment the user wrote about their servers.",
    '  "servers": {',
    '    "kept": { "command": "node" }',
    "  },",
    "  // And the one about inputs.",
    '  "inputs": []',
    "}",
  ].join("\n");

  it("edits a JSONC document in place, keeping comments and untouched keys", () => {
    const document = parse(commented);
    document.servers = { fresh: { command: "bun" } };

    const result = serializeSharedConfig({
      format: "jsonc",
      document,
      existingContent: commented,
    });

    expect(result).toContain("// The comment the user wrote about their servers.");
    expect(result).toContain("// And the one about inputs.");
    expect(parse(result)).toEqual({ servers: { fresh: { command: "bun" } }, inputs: [] });
  });

  it("returns the existing text byte-identically when the document did not change", () => {
    // The regeneration case: rulesync recomputes the same content it wrote last
    // time, so the file must not be rewritten at all.
    expect(
      serializeSharedConfig({
        format: "jsonc",
        document: parse(commented),
        existingContent: commented,
      }),
    ).toBe(commented);
  });

  it("recurses into a nested object instead of replacing it wholesale", () => {
    const existingContent = [
      "{",
      '  "servers": {',
      "    // Why this one is here.",
      '    "kept": { "command": "node" },',
      '    "stale": { "command": "old" }',
      "  }",
      "}",
    ].join("\n");
    const document = parse(existingContent);
    document.servers = { kept: { command: "node" }, added: { command: "bun" } };

    const result = serializeSharedConfig({ format: "jsonc", document, existingContent });

    expect(result).toContain("// Why this one is here.");
    expect(result).not.toContain("stale");
    expect(parse(result)).toEqual({
      servers: { kept: { command: "node" }, added: { command: "bun" } },
    });
  });

  it("removes a key the document no longer carries", () => {
    const document = parse(commented);
    delete document.inputs;

    const result = serializeSharedConfig({
      format: "jsonc",
      document,
      existingContent: commented,
    });

    expect(parse(result)).toEqual({ servers: { kept: { command: "node" } } });
  });

  it("matches the file's own space indentation when inserting a key", () => {
    const existingContent = ["{", '    "servers": {}', "}"].join("\n");
    const document = parse(existingContent);
    document.inputs = [];

    const result = serializeSharedConfig({ format: "jsonc", document, existingContent });

    expect(result).toContain('\n    "inputs": []');
  });

  it("matches the file's own tab indentation when inserting a key", () => {
    const existingContent = ["{", '\t"servers": {}', "}"].join("\n");
    const document = parse(existingContent);
    document.inputs = [];

    const result = serializeSharedConfig({ format: "jsonc", document, existingContent });

    expect(result).toContain('\n\t"inputs": []');
  });

  it("keeps CRLF line endings when inserting a key", () => {
    const existingContent = ["{", '  "servers": {}', "}"].join("\r\n");
    const document = parse(existingContent);
    document.inputs = [];

    const result = serializeSharedConfig({ format: "jsonc", document, existingContent });

    expect(result).toContain('\r\n  "inputs": []');
    // Every newline is part of a CRLF pair, including a would-be first byte.
    expect(result.replaceAll("\r\n", "")).not.toContain("\n");
  });

  it("keeps CRLF line endings when rewriting a nested value", () => {
    const existingContent = [
      "{",
      '  "servers": {',
      "    // Why this one is here.",
      '    "kept": { "command": "node" }',
      "  }",
      "}",
    ].join("\r\n");
    const document = parse(existingContent);
    document.servers = { kept: { command: "node" }, added: { command: "bun" } };

    const result = serializeSharedConfig({ format: "jsonc", document, existingContent });

    expect(result).toContain("// Why this one is here.");
    expect(result.replaceAll("\r\n", "")).not.toContain("\n");
    expect(parse(result)).toEqual({
      servers: { kept: { command: "node" }, added: { command: "bun" } },
    });
  });

  it("indents against the first property, not a banner comment's own column", () => {
    // The banner sits at column 0, so reading the line after `{` would report "no
    // indentation" and re-indent the whole file with the default two spaces.
    const existingContent = [
      "{",
      "// Managed by hand. Do not reformat.",
      '\t"servers": {}',
      "}",
    ].join("\n");
    const document = parse(existingContent);
    document.inputs = [];

    const result = serializeSharedConfig({ format: "jsonc", document, existingContent });

    expect(result).toContain("// Managed by hand. Do not reformat.");
    expect(result).toContain('\n\t"inputs": []');
    expect(result).toContain('\n\t"servers": {}');
  });

  it("keeps the comment of the key that follows a removed one", () => {
    const existingContent = ["{", '  "gone": 1,', "  // about b", '  "b": 2', "}"].join("\n");
    const document = parse(existingContent);
    delete document.gone;

    const result = serializeSharedConfig({ format: "jsonc", document, existingContent });

    expect(result).toContain("// about b");
    expect(parse(result)).toEqual({ b: 2 });
  });

  it("drops the separating comma when the last property is removed", () => {
    const existingContent = ["{", '  "a": 1, // trailing note about a', '  "gone": 2', "}"].join(
      "\n",
    );
    const document = parse(existingContent);
    delete document.gone;

    const result = serializeSharedConfig({ format: "jsonc", document, existingContent });

    expect(result).toContain("// trailing note about a");
    expect(parse(result)).toEqual({ a: 1 });
  });

  it("keeps a lone comment when the only property is removed", () => {
    const existingContent = ["{", "  // note", '  "gone": 1', "}"].join("\n");
    const document = parse(existingContent);
    delete document.gone;

    const result = serializeSharedConfig({ format: "jsonc", document, existingContent });

    expect(result).toContain("// note");
    expect(parse(result)).toEqual({});
  });

  it("takes the removed key's own trailing note with it", () => {
    // The note describes the key being removed, so leaving it would re-attach it
    // to whichever key now ends that line.
    const existingContent = [
      "{",
      '  "a": 1,',
      '  "gone": 2, // this server was retired',
      '  "b": 3',
      "}",
    ].join("\n");
    const document = parse(existingContent);
    delete document.gone;

    const result = serializeSharedConfig({ format: "jsonc", document, existingContent });

    expect(result).not.toContain("retired");
    expect(result).toBe(["{", '  "a": 1,', '  "b": 3', "}"].join("\n"));
  });

  it("leaves an inserted key's anchor holding its own trailing note", () => {
    // `modify` computes its insert from the end of the last property, in front
    // of the note written after it: applying that edit unchanged would re-emit
    // the note after the key just inserted, so a note about `a` would read as
    // a note about `b`.
    const existingContent = ["{", '  "a": 1 // note about a', "}"].join("\n");

    const result = serializeSharedConfig({
      format: "jsonc",
      document: { a: 1, b: 2 },
      existingContent,
    });

    expect(result).toBe(["{", '  "a": 1, // note about a', '  "b": 2', "}"].join("\n"));
  });

  it("leaves an inserted key's anchor holding its note across a trailing comma", () => {
    // The note sits after the comma in a file that spells one, so the insert
    // point the note has to be lifted from is past the comma, not at the
    // property's end.
    const existingContent = ["{", '  "a": 1, // note about a', "}"].join("\n");

    const result = serializeSharedConfig({
      format: "jsonc",
      document: { a: 1, b: 2 },
      existingContent,
    });

    expect(result).toBe(["{", '  "a": 1, // note about a', '  "b": 2,', "}"].join("\n"));
  });

  it("leaves an inserted key's anchor holding every note written at the insert point", () => {
    // Two notes around the comma: lifting only the first would leave the
    // second where `modify` inserts, so it would come out describing the key
    // rulesync has only now written.
    const existingContent = [
      "{",
      '  "mcp": {',
      '    "internal": 1 /* audited */, // reviewed, safe',
      "  }",
      "}",
    ].join("\n");

    const result = serializeSharedConfig({
      format: "jsonc",
      document: { mcp: { internal: 1, added: 2 } },
      existingContent,
    });

    expect(result).toBe(
      [
        "{",
        '  "mcp": {',
        '    "internal": 1, /* audited */ // reviewed, safe',
        '    "added": 2,',
        "  }",
        "}",
      ].join("\n"),
    );
  });

  it("leaves an object that had nothing in it yet holding every note it carried", () => {
    const existingContent = ["{", '  "mcp": { /* none yet */ /* ask ops first */ }', "}"].join(
      "\n",
    );

    const result = serializeSharedConfig({
      format: "jsonc",
      document: { mcp: { added: 2 } },
      existingContent,
    });

    expect(result).toBe(
      ["{", '  "mcp": { /* none yet */ /* ask ops first */', '    "added": 2', "  }", "}"].join(
        "\n",
      ),
    );
  });

  it("leaves an object that had nothing in it yet holding a line-comment note", () => {
    const existingContent = ["{", '  "mcp": { // none yet', "  }", "}"].join("\n");

    const result = serializeSharedConfig({
      format: "jsonc",
      document: { mcp: { added: 2 } },
      existingContent,
    });

    expect(result).toBe(["{", '  "mcp": { // none yet', '    "added": 2', "  }", "}"].join("\n"));
  });

  it("ends a note at a lone CR, the way the JSONC scanner does", () => {
    // A file written with old-Mac line endings parses without an error, so it
    // reaches the editing path; a note read to the next "\n" would swallow the
    // rest of the document.
    const existingContent = '{\r  "a": 1 // note about a\r}';

    const result = serializeSharedConfig({
      format: "jsonc",
      document: { a: 1, b: 2 },
      existingContent,
    });

    expect(result).toBe('{\r  "a": 1, // note about a\r  "b": 2\r}');
    expect(parseSharedConfig({ format: "jsonc", fileContent: result })).toEqual({ a: 1, b: 2 });
  });

  it("ends a nested note at a lone CR inside an otherwise LF file", () => {
    const existingContent = '{\n  "s": {\n    "a": 1 // note about a\r  }\n}';

    const result = serializeSharedConfig({
      format: "jsonc",
      document: { s: { a: 1, b: 2 } },
      existingContent,
    });

    expect(result).toBe('{\n  "s": {\n    "a": 1, // note about a\n    "b": 2\r  }\n}');
    expect(parseSharedConfig({ format: "jsonc", fileContent: result })).toEqual({
      s: { a: 1, b: 2 },
    });
  });

  it("finds the comma past a lone-CR note when removing a key", () => {
    // The trivia scan has to end the note where the scanner does too: reading
    // it to the next "\n" hides the comma, and the key goes without it.
    const existingContent = '{\r  "gone": 1 // this server was retired\r  ,\r  "b": 2\r}\r';

    const result = serializeSharedConfig({
      format: "jsonc",
      document: { b: 2 },
      existingContent,
    });

    expect(result).toBe('{\r  "b": 2\r}\r');
    expect(parseSharedConfig({ format: "jsonc", fileContent: result })).toEqual({ b: 2 });
  });

  it("reads the indentation of a lone-CR file", () => {
    const existingContent = '{\r    "a": 1\r}';

    const result = serializeSharedConfig({
      format: "jsonc",
      document: { a: 1, b: { c: 1 } },
      existingContent,
    });

    expect(result).toBe('{\r    "a": 1,\r    "b": {\r        "c": 1\r    }\r}');
  });

  it("gives a single-line document the line ending it has none of yet", () => {
    // The only case the detected `eol` decides: `modify` reads the ending off
    // the document itself as soon as the document states one.
    const result = serializeSharedConfig({
      format: "jsonc",
      document: { a: 1, b: 2 },
      existingContent: '{"a": 1}',
    });

    expect(result).toBe(["{", '  "a": 1,', '  "b": 2', "}"].join("\n"));
  });

  it("takes a removed key's line with it on a lone-CR file", () => {
    const existingContent = '{\r  "a": 1,\r  "gone": 2 // this server was retired\r}';

    const result = serializeSharedConfig({
      format: "jsonc",
      document: { a: 1 },
      existingContent,
    });

    expect(result).toBe('{\r  "a": 1\r}');
  });

  it("takes a removed key's trailing note with it in a trailing-comma file", () => {
    const existingContent = ["{", '  "a": 1,', '  "gone": 2, // this server was retired', "}"].join(
      "\n",
    );

    const result = serializeSharedConfig({
      format: "jsonc",
      document: { a: 1, fresh: 3 },
      existingContent,
    });

    expect(result).not.toContain("retired");
    expect(result).toBe(["{", '  "a": 1,', '  "fresh": 3,', "}"].join("\n"));
  });

  it("leaves the note of an object that had nothing in it yet", () => {
    // `{ /* none yet */ }` says something about the object, not about the
    // first key rulesync puts in it.
    const existingContent = ["{", '  "servers": { /* none yet */ }', "}"].join("\n");

    const result = serializeSharedConfig({
      format: "jsonc",
      document: { servers: { docs: 1 } },
      existingContent,
    });

    expect(result).toBe(
      ["{", '  "servers": { /* none yet */', '    "docs": 1', "  }", "}"].join("\n"),
    );
  });

  it("leaves an inserted key's anchor holding a block-comment note", () => {
    const existingContent = ["{", '  "a": 1 /* note about a */', "}"].join("\n");

    const result = serializeSharedConfig({
      format: "jsonc",
      document: { a: 1, b: 2 },
      existingContent,
    });

    expect(result).toBe(["{", '  "a": 1, /* note about a */', '  "b": 2', "}"].join("\n"));
  });

  it("leaves a nested insert's anchor holding its trailing note", () => {
    const existingContent = [
      "{",
      '  "mcp": {',
      '    "docs": 1 // note about docs',
      "  }",
      "}",
    ].join("\n");

    const result = serializeSharedConfig({
      format: "jsonc",
      document: { mcp: { docs: 1, fresh: 2 } },
      existingContent,
    });

    expect(result).toBe(
      ["{", '  "mcp": {', '    "docs": 1, // note about docs', '    "fresh": 2', "  }", "}"].join(
        "\n",
      ),
    );
  });

  it("leaves an inserted key's anchor holding its trailing note on CRLF files", () => {
    const existingContent = ["{", '  "a": 1 // note about a', "}"].join("\r\n");

    const result = serializeSharedConfig({
      format: "jsonc",
      document: { a: 1, b: 2 },
      existingContent,
    });

    expect(result).toBe(["{", '  "a": 1, // note about a', '  "b": 2', "}"].join("\r\n"));
  });

  it("leaves a comment written on its own line where the author put it", () => {
    // Only the note sharing the anchor's line is claimed: a comment on its own
    // line may describe the object, the key above it, or the key below it.
    const existingContent = ["{", '  "a": 1', "  // own line", "}"].join("\n");

    const result = serializeSharedConfig({
      format: "jsonc",
      document: { a: 1, b: 2 },
      existingContent,
    });

    expect(result).toBe(["{", '  "a": 1,', '  "b": 2', "  // own line", "}"].join("\n"));
  });

  it("takes the trailing spaces of a removed key's line with it", () => {
    const existingContent = ["{", '  "gone": 1,  ', '  "b": 2', "}"].join("\n");

    const result = serializeSharedConfig({ format: "jsonc", document: { b: 2 }, existingContent });

    expect(result).toBe(["{", '  "b": 2', "}"].join("\n"));
  });

  it("keeps a trailing note that a surviving sibling shares the line with", () => {
    const existingContent = ["{", '  "gone": 1, "b": 2 // about this line', "}"].join("\n");
    const document = parse(existingContent);
    delete document.gone;

    const result = serializeSharedConfig({ format: "jsonc", document, existingContent });

    expect(result).toContain("// about this line");
    expect(parse(result)).toEqual({ b: 2 });
  });

  it("keeps a sibling that shares the removed key's line", () => {
    // Taking the newline above would splice `"edit"` onto the comment line and
    // comment out a permission rulesync means to write.
    const existingContent = [
      "{",
      '  "permission": {',
      "    // managed",
      '    "bash": "deny", "edit": "allow"',
      "  }",
      "}",
    ].join("\n");
    const document = parse(existingContent);
    document.permission = { edit: "allow" };

    const result = serializeSharedConfig({ format: "jsonc", document, existingContent });

    expect(result).toContain("// managed");
    expect(parse(result)).toEqual({ permission: { edit: "allow" } });
  });

  it("keeps the object closed when the removed key shares its line with the brace", () => {
    const existingContent = ["{", '  "kept": 0,', "  // note", '  "gone": 1 }'].join("\n");
    const document = parse(existingContent);
    delete document.gone;

    const result = serializeSharedConfig({ format: "jsonc", document, existingContent });

    expect(result).toContain("// note");
    // The brace still closes the object rather than sitting inside the comment.
    expect(result.split("\n").at(-1)?.trim()).toBe("}");
    expect(parse(result)).toEqual({ kept: 0 });
  });

  it("falls back to the whole-document writer when a key is stated twice", () => {
    // `jsonc-parser` edits the first occurrence while the parsed value comes from
    // the last one, so an in-place edit would land on the copy nothing reads and
    // silently leave the effective value untouched.
    const existingContent = [
      "{",
      '  "permission": { "bash": "allow" },',
      '  "permission": { "bash": "deny" }',
      "}",
    ].join("\n");
    const document = parse(existingContent);
    document.permission = { bash: "ask" };

    const result = serializeSharedConfig({ format: "jsonc", document, existingContent });

    expect(result).toBe(
      stringifySharedConfig({ format: "jsonc", document: { permission: { bash: "ask" } } }),
    );
    expect(parse(result)).toEqual({ permission: { bash: "ask" } });
  });

  it("falls back to the whole-document writer when a nested key is stated twice", () => {
    const existingContent = ["{", '  "permission": { "bash": "allow", "bash": "deny" }', "}"].join(
      "\n",
    );
    const document = parse(existingContent);
    document.permission = { bash: "ask" };

    const result = serializeSharedConfig({ format: "jsonc", document, existingContent });

    expect(result).toBe(
      stringifySharedConfig({ format: "jsonc", document: { permission: { bash: "ask" } } }),
    );
  });

  it("falls back to the whole-document writer for an empty file", () => {
    expect(
      serializeSharedConfig({ format: "jsonc", document: { a: 1 }, existingContent: "  \n" }),
    ).toBe(stringifySharedConfig({ format: "jsonc", document: { a: 1 } }));
  });

  it("falls back to the whole-document writer for content that does not parse", () => {
    expect(
      serializeSharedConfig({ format: "jsonc", document: { a: 1 }, existingContent: "{ oops" }),
    ).toBe(stringifySharedConfig({ format: "jsonc", document: { a: 1 } }));
  });

  it("falls back to the whole-document writer for a non-object root", () => {
    expect(
      serializeSharedConfig({ format: "jsonc", document: { a: 1 }, existingContent: "[1, 2]" }),
    ).toBe(stringifySharedConfig({ format: "jsonc", document: { a: 1 } }));
  });

  it("falls back to the whole-document writer when the file uses a prototype-pollution key", () => {
    // Editing would leave the key in the file, because it is absent from every
    // document rulesync parses and so never shows up as a difference. The
    // whole-document writer drops it, which is what it has always done.
    const existingContent = [
      "{",
      "  // kept only by the edit path",
      '  "__proto__": { "a": 1 }',
      "}",
    ].join("\n");

    const result = serializeSharedConfig({ format: "jsonc", document: { a: 1 }, existingContent });

    expect(result).toBe(stringifySharedConfig({ format: "jsonc", document: { a: 1 } }));
    expect(result).not.toContain("__proto__");
  });

  it("re-serializes every non-JSONC format", () => {
    // YAML/TOML/JSON writers are unchanged: the existing content is ignored.
    expect(
      serializeSharedConfig({
        format: "json",
        document: { a: 1 },
        existingContent: '{\n    "a": 2\n}',
      }),
    ).toBe(stringifySharedConfig({ format: "json", document: { a: 1 } }));
    expect(
      serializeSharedConfig({ format: "yaml", document: { a: 1 }, existingContent: "a: 2\n" }),
    ).toBe(stringifySharedConfig({ format: "yaml", document: { a: 1 } }));
  });
});

describe("mergeSharedConfigShallow", () => {
  it("replaces patch keys wholesale and preserves the rest", () => {
    const merged = mergeSharedConfigShallow({
      base: { hooks: { old: true }, model: "hermes-3" },
      patch: { hooks: { new: true } },
    });
    expect(merged).toEqual({ hooks: { new: true }, model: "hermes-3" });
  });
});

describe("mergeSharedConfigDeep", () => {
  it("merges nested plain objects key-by-key (patch wins)", () => {
    const merged = mergeSharedConfigDeep({
      base: { approvals: { deny: ["rm -rf *"] } },
      patch: { approvals: { mode: "smart" } },
    });
    expect(merged).toEqual({ approvals: { deny: ["rm -rf *"], mode: "smart" } });
  });

  it("replaces arrays and scalars wholesale", () => {
    const merged = mergeSharedConfigDeep({
      base: { list: [1, 2], flag: true },
      patch: { list: [3], flag: false },
    });
    expect(merged).toEqual({ list: [3], flag: false });
  });

  it("retracts a key whose patch value is undefined", () => {
    // Same spelling as `replace-owned-keys`. Leaving the key present with an
    // `undefined` value disappears from YAML and JSON output but makes the TOML
    // serializer throw.
    const merged = mergeSharedConfigDeep({
      base: { keep: 1, drop: true },
      patch: { drop: undefined },
    });
    expect(merged).toEqual({ keep: 1 });
    expect(Object.hasOwn(merged, "drop")).toBe(false);
  });

  it("drops prototype-pollution keys from the patch", () => {
    const merged = mergeSharedConfigDeep({
      base: {},
      patch: JSON.parse('{"__proto__":{"polluted":true},"ok":1}'),
    });
    expect(merged).toEqual({ ok: 1 });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("SHARED_CONFIG_OWNERSHIP", () => {
  it("declares exactly the writer features the processor registry derives per file", () => {
    // minWriters: 1 so declarations for gateway-managed files with a single
    // writer (e.g. the global kilo config) are validated against the registry
    // too, not just the cross-feature shared ones.
    const derived = new Map(
      deriveSharedFileWriters({ minWriters: 1 }).map((w) => [w.key, [...w.features]]),
    );
    for (const [fileKey, declaration] of Object.entries(SHARED_CONFIG_OWNERSHIP)) {
      expect(
        Object.keys(declaration.features).toSorted(),
        `ownership declaration for '${fileKey}' out of sync with the registry-derived writers`,
      ).toEqual(derived.get(fileKey) ?? []);
    }
  });

  it("accounts for every registry-derived shared file with an ownership declaration", () => {
    const unaccounted = deriveSharedFileWriters()
      .map((writer) => writer.key)
      .filter((key) => SHARED_CONFIG_OWNERSHIP[key] === undefined);
    expect(
      unaccounted,
      "a shared file appeared without an ownership decision; declare it in SHARED_CONFIG_OWNERSHIP",
    ).toEqual([]);
  });

  it("resolves every custom policyFunction name to an exported function", () => {
    // The `custom` policy references its implementation by string name; a rename
    // that misses the declaration would otherwise stale silently. Pin the names
    // so they must resolve to a real exported function of this module.
    const exports = sharedConfigGateway as Record<string, unknown>;
    for (const [fileKey, declaration] of Object.entries(SHARED_CONFIG_OWNERSHIP)) {
      for (const [feature, policy] of Object.entries(declaration.features)) {
        if (policy?.kind !== "custom") continue;
        expect(
          typeof exports[policy.policyFunction],
          `policyFunction '${policy.policyFunction}' declared for feature '${feature}' on ` +
            `'${fileKey}' does not resolve to an exported function in shared-config-gateway.ts`,
        ).toBe("function");
      }
    }
  });
});

describe("applySharedConfigPatch", () => {
  it("executes replace-owned-keys: owned key replaced, user keys preserved", () => {
    const result = applySharedConfigPatch({
      fileKey: HERMES_CONFIG_SHARED_FILE_KEY,
      feature: "hooks",
      existingContent: "model: hermes-large\nhooks:\n  stale: true\n",
      patch: { hooks: { pre_tool_call: [] } },
    });
    expect(parseSharedConfig({ format: "yaml", fileContent: result })).toEqual({
      model: "hermes-large",
      hooks: { pre_tool_call: [] },
    });
  });

  it("retracts an owned key whose patch value is undefined (replace-owned-keys)", () => {
    // A feature retracts a key it owns by setting that key to `undefined` in the
    // patch (e.g. a regeneration that yields no entries). The key is removed from
    // the merged document, while unowned user keys are preserved untouched.
    const result = applySharedConfigPatch({
      fileKey: HERMES_CONFIG_SHARED_FILE_KEY,
      feature: "hooks",
      existingContent: "model: hermes-large\nhooks:\n  stale: true\n",
      patch: { hooks: undefined },
    });
    expect(parseSharedConfig({ format: "yaml", fileContent: result })).toEqual({
      model: "hermes-large",
    });
  });

  it("rejects a patch that strays outside the feature's owned keys", () => {
    expect(() =>
      applySharedConfigPatch({
        fileKey: HERMES_CONFIG_SHARED_FILE_KEY,
        feature: "hooks",
        existingContent: "",
        patch: { hooks: {}, model: "hijacked" },
      }),
    ).toThrow(/undeclared keys \[model\]/);
  });

  it("executes deep-merge with replaceKeys snapshots", () => {
    const result = applySharedConfigPatch({
      fileKey: HERMES_CONFIG_SHARED_FILE_KEY,
      feature: "permissions",
      existingContent: [
        "approvals:",
        "  mode: smart",
        "permissions:",
        "  rulesync:",
        "    stale: true",
      ].join("\n"),
      patch: {
        approvals: { deny: ["rm -rf *"] },
        permissions: { rulesync: { fresh: true } },
      },
    });
    expect(parseSharedConfig({ format: "yaml", fileContent: result })).toEqual({
      // Deep merge: the user's approvals.mode coexists with the generated deny.
      approvals: { mode: "smart", deny: ["rm -rf *"] },
      // Snapshot key: replaced wholesale, the stale entry is not resurrected.
      permissions: { rulesync: { fresh: true } },
    });
  });

  it("preserves nested sibling keys under deep-merge (the takt provider_options regression)", () => {
    const result = applySharedConfigPatch({
      fileKey: TAKT_CONFIG_SHARED_FILE_KEY,
      feature: "permissions",
      existingContent: [
        "provider: codex",
        "provider_options:",
        "  codex:",
        "    base_url: http://127.0.0.1:8080",
      ].join("\n"),
      patch: { provider_options: { codex: { network_access: true } } },
    });
    expect(parseSharedConfig({ format: "yaml", fileContent: result })).toEqual({
      provider: "codex",
      provider_options: {
        codex: { base_url: "http://127.0.0.1:8080", network_access: true },
      },
    });
  });

  it("preserves a JSONC file's comments end-to-end", () => {
    // `.vscode/mcp.json` is the file VS Code's own "MCP: Add Server" scaffold
    // writes a comment into, so a regeneration must not strip it.
    const existingContent = [
      "// For more info, visit https://aka.ms/vscode-add-mcp",
      "{",
      '  "inputs": [{ "id": "api-key", "type": "promptString" }],',
      '  "servers": {',
      "    // Retired, but the note explains why.",
      '    "stale": { "command": "old" }',
      "  }",
      "}",
    ].join("\n");

    const result = applySharedConfigPatch({
      fileKey: ".vscode/mcp.json",
      feature: "mcp",
      existingContent,
      patch: { servers: { fresh: { command: "node" } } },
    });

    expect(result).toContain("// For more info, visit https://aka.ms/vscode-add-mcp");
    // The note outlives the entry it describes: removing a key never reaches back
    // over the line above it, so a comment is only ever dropped by the user.
    expect(result).toContain("// Retired, but the note explains why.");
    expect(parseSharedConfig({ format: "jsonc", fileContent: result })).toEqual({
      inputs: [{ id: "api-key", type: "promptString" }],
      servers: { fresh: { command: "node" } },
    });
  });

  it("preserves comments around a dotted owned key", () => {
    // `amp.mcpServers` is one literal key, not a path: the editor must replace
    // the key spelled with the dot and leave the comment beside it alone.
    const existingContent = [
      "{",
      "  // Kept by hand: the editor settings this project shares.",
      '  "amp.notifications.enabled": true,',
      '  "amp.mcpServers": { "stale": { "command": "old" } }',
      "}",
    ].join("\n");

    const result = applySharedConfigPatch({
      fileKey: ".amp/settings.json",
      feature: "mcp",
      existingContent,
      patch: { "amp.mcpServers": { fresh: { command: "node" } } },
    });

    expect(result).toContain("// Kept by hand: the editor settings this project shares.");
    expect(parseSharedConfig({ format: "jsonc", fileContent: result })).toEqual({
      "amp.notifications.enabled": true,
      "amp.mcpServers": { fresh: { command: "node" } },
    });
  });

  it("retracts an owned key from .vscode/settings.json without touching the rest", () => {
    // The file the issue names: a settings file that is mostly the user's, with
    // one dotted key rulesync owns and, this run, no longer has anything to say
    // about.
    const existingContent = [
      "{",
      "  // Editor settings this project shares.",
      '  "editor.formatOnSave": true,',
      '  "chat.tools.terminal.autoApprove": { "ls": true }',
      "}",
    ].join("\n");

    const result = applySharedConfigPatch({
      fileKey: ".vscode/settings.json",
      feature: "permissions",
      existingContent,
      patch: { "chat.tools.terminal.autoApprove": undefined },
    });

    expect(result).toBe(
      ["{", "  // Editor settings this project shares.", '  "editor.formatOnSave": true', "}"].join(
        "\n",
      ),
    );
  });

  it("preserves the comments of opencode.json and kilo.json", () => {
    const existingContent = [
      "{",
      "  // The model this project talks to.",
      '  "model": "x",',
      '  "permission": { "bash": "allow" }',
      "}",
    ].join("\n");

    for (const fileKey of ["opencode.json", "kilo.json"] as const) {
      const result = applySharedConfigPatch({
        fileKey,
        feature: "mcp",
        existingContent,
        patch: { mcp: { fresh: { type: "local", command: ["node"] } } },
      });

      expect(result).toContain("// The model this project talks to.");
      expect(parseSharedConfig({ format: "jsonc", fileContent: result })).toEqual({
        model: "x",
        permission: { bash: "allow" },
        mcp: { fresh: { type: "local", command: ["node"] } },
      });
    }
  });

  it("keeps the user keys of a file that states a prototype-pollution key", () => {
    // The edit path bails out on such a file and the whole document is
    // rewritten, dropping the pollution key — but everything the user
    // legitimately wrote beside it has to survive that rewrite.
    const result = applySharedConfigPatch({
      fileKey: "opencode.json",
      feature: "mcp",
      existingContent: [
        "{",
        '  "model": "x",',
        '  "__proto__": { "polluted": true },',
        '  "permission": { "bash": "allow" }',
        "}",
      ].join("\n"),
      patch: { mcp: { fresh: { type: "local", command: ["node"] } } },
    });

    expect(result).not.toContain("__proto__");
    expect(parseSharedConfig({ format: "jsonc", fileContent: result })).toEqual({
      model: "x",
      permission: { bash: "allow" },
      mcp: { fresh: { type: "local", command: ["node"] } },
    });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("rejects writes to undeclared files and undeclared writer features", () => {
    expect(() =>
      applySharedConfigPatch({
        fileKey: "unknown.json",
        feature: "mcp",
        existingContent: "",
        patch: {},
      }),
    ).toThrow(/no SHARED_CONFIG_OWNERSHIP declaration/);
    expect(() =>
      applySharedConfigPatch({
        fileKey: TAKT_CONFIG_SHARED_FILE_KEY,
        feature: "rules",
        existingContent: "",
        patch: {},
      }),
    ).toThrow(/declares no ownership/);
  });

  it("directs custom-policy features to their policy function", () => {
    expect(() =>
      applySharedConfigPatch({
        fileKey: ".claude/settings.json",
        feature: "ignore",
        existingContent: "",
        patch: {},
      }),
    ).toThrow(/applyIgnoreReadDenies/);
  });
});

// ---------------------------------------------------------------------------
// `.claude/settings.json` custom policy
// ---------------------------------------------------------------------------

// The permissions feature parses "Bash(npm *)" into its tool name; the gateway
// is agnostic to the format and takes this extractor as a parameter.
const toolNameOf = (entry: string): string => {
  const parenIndex = entry.indexOf("(");
  return parenIndex === -1 ? entry : entry.slice(0, parenIndex);
};

describe("isReadDenyEntry", () => {
  it("recognizes Read(...) entries", () => {
    expect(isReadDenyEntry("Read(.env)")).toBe(true);
    expect(isReadDenyEntry("Read(*.log)")).toBe(true);
  });

  it("rejects non-Read and malformed entries", () => {
    expect(isReadDenyEntry("Write(secret.txt)")).toBe(false);
    expect(isReadDenyEntry("Read(unterminated")).toBe(false);
    expect(isReadDenyEntry("Bash")).toBe(false);
  });
});

describe("buildReadDenyEntry", () => {
  it("wraps a pattern into a Read deny entry", () => {
    expect(buildReadDenyEntry("*.log")).toBe("Read(*.log)");
  });
});

describe("applyIgnoreReadDenies", () => {
  it("preserves non-Read deny entries while replacing the Read set", () => {
    const settings: ClaudeSettingsJson = {
      permissions: { deny: ["Write(secret.txt)", "Read(old.log)"] },
    };

    const result = applyIgnoreReadDenies({
      settings,
      readDenies: ["Read(*.log)", "Read(node_modules/**)"],
    });

    expect(result.permissions?.deny).toEqual([
      "Read(*.log)",
      "Read(node_modules/**)",
      "Write(secret.txt)",
    ]);
  });

  it("leaves allow/ask untouched and other top-level keys intact", () => {
    const settings: ClaudeSettingsJson = {
      permissions: { allow: ["Bash(ls)"], ask: ["Bash(rm *)"], deny: ["Read(a)"] },
      hooks: { PreToolUse: [] },
    };

    const result = applyIgnoreReadDenies({ settings, readDenies: ["Read(b)"] });

    expect(result.permissions?.allow).toEqual(["Bash(ls)"]);
    expect(result.permissions?.ask).toEqual(["Bash(rm *)"]);
    expect(result.permissions?.deny).toEqual(["Read(b)"]);
    expect(result.hooks).toEqual({ PreToolUse: [] });
  });

  it("deduplicates and sorts", () => {
    const result = applyIgnoreReadDenies({
      settings: { permissions: { deny: ["Read(z)"] } },
      readDenies: ["Read(b)", "Read(a)", "Read(b)"],
    });

    expect(result.permissions?.deny).toEqual(["Read(a)", "Read(b)"]);
  });
});

describe("applyPermissions", () => {
  it("keeps entries for unmanaged tools and replaces managed ones", () => {
    const settings: ClaudeSettingsJson = {
      permissions: { deny: ["Read(.env)", "Bash(dangerous *)"] },
    };

    const result = applyPermissions({
      settings,
      managedToolNames: new Set(["Bash"]),
      toolNameOf,
      allow: [],
      ask: [],
      deny: ["Bash(rm *)"],
    });

    // Read (unmanaged) preserved; old Bash replaced by the new Bash rule.
    expect(result.permissions?.deny).toEqual(["Bash(rm *)", "Read(.env)"]);
  });

  it("overwrites ignore-derived Read denies when Read is managed and warns", () => {
    const logger = createMockLogger();
    const settings: ClaudeSettingsJson = {
      permissions: { deny: ["Read(.env)", "Read(*.secret)"] },
    };

    const result = applyPermissions({
      settings,
      managedToolNames: new Set(["Read"]),
      toolNameOf,
      allow: ["Read(src/**)"],
      ask: [],
      deny: [],
      logger,
    });

    expect(result.permissions?.deny).toBeUndefined();
    expect(result.permissions?.allow).toEqual(["Read(src/**)"]);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("manages 'Read' tool"));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("2 existing Read deny"));
    // The warning no longer speculates about the ignore feature by name.
    expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining("ignore"));
  });

  it("does not warn when Read is not managed", () => {
    const logger = createMockLogger();

    applyPermissions({
      settings: { permissions: { deny: ["Read(.env)"] } },
      managedToolNames: new Set(["Bash"]),
      toolNameOf,
      allow: [],
      ask: [],
      deny: ["Bash(rm *)"],
      logger,
    });

    expect(logger.warn).not.toHaveBeenCalled();
  });
});
