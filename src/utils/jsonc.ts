import { type ParseError, parse, printParseErrorCode } from "jsonc-parser";

/**
 * Parse a JSONC (JSON with Comments) document strictly.
 *
 * Unlike `jsonc-parser`'s bare `parse` (which silently tolerates syntax
 * errors and returns a best-effort value), this throws on any parse error so
 * a malformed source file fails loudly instead of generating half-empty tool
 * configs. Plain JSON is valid JSONC, so this is a drop-in replacement for
 * `JSON.parse` on files that may contain comments or trailing commas.
 */
export function parseJsonc(content: string): unknown {
  const errors: ParseError[] = [];
  const result: unknown = parse(content, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  });
  if (errors.length > 0) {
    const details = errors
      .map((e) => `${printParseErrorCode(e.error)} at offset ${e.offset}`)
      .join(", ");
    // SyntaxError keeps parity with JSON.parse, which callers historically
    // relied on for malformed-content handling.
    throw new SyntaxError(`Failed to parse JSONC content: ${details}`);
  }
  return result;
}
