import { extname } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { load } from "js-yaml";
import { parse as parseJsonc, type ParseError } from "jsonc-parser";
import * as smolToml from "smol-toml";

import { addTrailingNewline } from "./file.js";
import { parseFrontmatter } from "./frontmatter.js";

/**
 * Structural equality for JSON and JSONC using jsonc-parser (valid JSON parses the same as JSONC).
 */
function tryJsonEquivalent(a: string, b: string): boolean | undefined {
  const errorsA: ParseError[] = [];
  const errorsB: ParseError[] = [];
  const parsedA = parseJsonc(a, errorsA);
  const parsedB = parseJsonc(b, errorsB);

  if (errorsA.length > 0 || errorsB.length > 0) {
    return undefined;
  }

  return isDeepStrictEqual(parsedA, parsedB);
}

function tryYamlEquivalent(a: string, b: string): boolean | undefined {
  try {
    return isDeepStrictEqual(load(a), load(b));
  } catch {
    return undefined;
  }
}

function tryTomlEquivalent(a: string, b: string): boolean | undefined {
  try {
    return isDeepStrictEqual(smolToml.parse(a), smolToml.parse(b));
  } catch {
    return undefined;
  }
}

function tryMarkdownEquivalent(expected: string, existing: string): boolean | undefined {
  /**
   * gray-matter often includes extra newlines right after the closing ---; strip those so the
   * body matches across generators vs on-disk formatters. Trailing whitespace is normalized via
   * addTrailingNewline (trimEnd + single newline), same as writes.
   */
  function normalizeMarkdownBody(body: string): string {
    return addTrailingNewline(body.replace(/^\n+/, ""));
  }

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

  switch (ext) {
    case ".json":
    case ".jsonc":
      return tryJsonEquivalent(expected, existing);
    case ".yaml":
    case ".yml":
      return tryYamlEquivalent(expected, existing);
    case ".toml":
      return tryTomlEquivalent(expected, existing);
    case ".md":
    case ".mdc":
      return tryMarkdownEquivalent(expected, existing);
    default:
      return undefined;
  }
}

/**
 * Whether on-disk content is equivalent to generated content for --check / dry-run.
 *
 * Uses structured comparison for JSON/JSONC (via jsonc-parser), YAML, TOML, and Markdown-like
 * frontmatter files (.md, .mdc — same gray-matter path as elsewhere).
 */
export function fileContentsEquivalent(
  filePath: string,
  expected: string,
  existing: string | null,
): boolean {
  if (existing === null) {
    return false;
  }

  const structured = tryFileContentsEquivalent(filePath, expected, existing);

  if (structured !== undefined) {
    return structured;
  }

  return addTrailingNewline(expected) === addTrailingNewline(existing);
}
