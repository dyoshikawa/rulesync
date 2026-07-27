import { extname } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { parse as parseJsonc, type ParseError } from "jsonc-parser";
import * as smolToml from "smol-toml";

import { addTrailingNewline } from "./file.js";
import { parseFrontmatter } from "./frontmatter.js";
import { loadYaml } from "./yaml.js";

/**
 * Result of a structured parse. `ok: false` means "this content is not parseable
 * as its extension's format" — distinct from a successful parse that happens to
 * yield `undefined` (e.g. `loadYaml` on a comment-only document).
 */
type ParseResult = { readonly ok: true; readonly value: unknown } | { readonly ok: false };

const PARSE_FAILED: ParseResult = { ok: false };

/**
 * Structured parse for known extensions. JSON and JSONC both go through
 * jsonc-parser (valid JSON parses the same as JSONC). Returns `ok: false` for
 * unknown extensions and for content that does not parse.
 */
function tryParseStructured(filePath: string, content: string): ParseResult {
  const ext = extname(filePath).toLowerCase();

  switch (ext) {
    case ".json":
    case ".jsonc": {
      const errors: ParseError[] = [];
      const value = parseJsonc(content, errors);
      return errors.length > 0 ? PARSE_FAILED : { ok: true, value };
    }
    case ".yaml":
    case ".yml":
      try {
        return { ok: true, value: loadYaml(content) };
      } catch {
        return PARSE_FAILED;
      }
    case ".toml":
      try {
        return { ok: true, value: smolToml.parse(content) };
      } catch {
        return PARSE_FAILED;
      }
    default:
      return PARSE_FAILED;
  }
}

/**
 * gray-matter often includes extra newlines right after the closing ---; strip those so the
 * body matches across generators vs on-disk formatters. Trailing whitespace is normalized via
 * addTrailingNewline (trimEnd + single newline), same as writes.
 */
function normalizeMarkdownBody(body: string): string {
  return addTrailingNewline(body.replace(/^\n+/, ""));
}

function tryMarkdownEquivalent(expected: string, existing: string): boolean | undefined {
  try {
    const parsedExpected = parseFrontmatter(expected);
    const parsedExisting = parseFrontmatter(existing);

    if (!isDeepStrictEqual(parsedExpected.frontmatter, parsedExisting.frontmatter)) {
      return false;
    }

    return (
      normalizeMarkdownBody(parsedExpected.body) === normalizeMarkdownBody(parsedExisting.body)
    );
  } catch {
    return undefined;
  }
}

/**
 * Structured compare for known extensions. Returns `undefined` when this path should use
 * strict text comparison instead (unknown extension, or parse not applicable / failed).
 */
function tryFileContentsEquivalent(
  filePath: string,
  expected: string,
  existing: string,
): boolean | undefined {
  const ext = extname(filePath).toLowerCase();

  if (ext === ".md" || ext === ".mdc") {
    return tryMarkdownEquivalent(expected, existing);
  }

  const parsedExpected = tryParseStructured(filePath, expected);
  const parsedExisting = tryParseStructured(filePath, existing);

  if (!parsedExpected.ok || !parsedExisting.ok) {
    return undefined;
  }

  return isDeepStrictEqual(parsedExpected.value, parsedExisting.value);
}

/**
 * Whether a parsed structured value carries no information: `null`/`undefined`,
 * an empty array, or a plain object whose every value is itself empty by this
 * same rule. Any scalar (string, number, boolean) counts as content.
 *
 * Deliberately conservative — anything it cannot prove empty counts as content,
 * because the only consequence of "not empty" is that the file gets written:
 *
 * - A non-empty array is content regardless of what its elements hold, so
 *   `[{}]` counts as content while `{"a":{}}` does not.
 * - An object with a non-plain prototype counts as content. That covers `Date` /
 *   `TomlDate` values (whose payload is invisible to `Object.values`) and a
 *   `{"__proto__": {...}}` entry, which jsonc-parser resolves by replacing the
 *   prototype rather than creating an own property.
 * - A value already on the current path counts as content, so a self-referential
 *   YAML anchor cannot drive this into infinite recursion.
 */
function isEmptyStructuredValue(value: unknown, seen: Set<object> = new Set()): boolean {
  if (value === null || value === undefined) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  if (typeof value === "object") {
    if (seen.has(value)) {
      return false;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return false;
    }
    seen.add(value);
    const empty = Object.values(value).every((child) => isEmptyStructuredValue(child, seen));
    seen.delete(value);
    return empty;
  }
  return false;
}

/**
 * Whether generated content carries nothing worth writing — an empty structured
 * document such as `{}`, `{"permissions":{}}` or `{"mcpServers":{}}`, or (for
 * unstructured formats) whitespace-only text.
 *
 * Used to avoid creating shared, user-managed config files that rulesync merges
 * into but does not own: writing an empty file there hands the user a file to
 * manage without giving them anything in return.
 */
export function fileContentIsEmptyPayload({
  filePath,
  content,
}: {
  filePath: string;
  content: string;
}): boolean {
  if (content.trim() === "") {
    return true;
  }

  const parsed = tryParseStructured(filePath, content);

  return parsed.ok && isEmptyStructuredValue(parsed.value);
}

/**
 * Whether on-disk content is equivalent to generated content for --check / dry-run.
 *
 * Uses structured comparison for JSON/JSONC (via jsonc-parser), YAML, TOML, and Markdown-like
 * frontmatter files (.md, .mdc — same gray-matter path as elsewhere).
 */
export function fileContentsEquivalent({
  filePath,
  expected,
  existing,
}: {
  filePath: string;
  expected: string;
  existing: string | null;
}): boolean {
  if (existing === null) {
    return false;
  }

  const structured = tryFileContentsEquivalent(filePath, expected, existing);

  if (structured !== undefined) {
    return structured;
  }

  return addTrailingNewline(expected) === addTrailingNewline(existing);
}
