import {
  parse as parseJsoncContent,
  type ParseError as JsoncParseError,
  printParseErrorCode,
} from "jsonc-parser";

/**
 * Parse JSON or JSONC (JSON with comments and trailing commas) content.
 * Plain JSON is always valid JSONC, so this is a drop-in replacement for
 * `JSON.parse` wherever a rulesync source file may be authored as either
 * `.json` or `.jsonc`. Unlike jsonc-parser's default best-effort recovery,
 * a syntax error throws so a partially parsed file can't silently drop
 * user content.
 */
export function parseJsonc(fileContent: string): unknown {
  const errors: JsoncParseError[] = [];
  const parsed: unknown = parseJsoncContent(fileContent, errors, {
    allowTrailingComma: true,
  });
  if (errors.length > 0) {
    const details = errors
      .map((error) => `${printParseErrorCode(error.error)} at offset ${error.offset}`)
      .join(", ");
    throw new Error(`Failed to parse JSONC content: ${details}`);
  }
  return parsed;
}
