import { type ParseError, parse, printParseErrorCode } from "jsonc-parser";

import { PROTOTYPE_POLLUTION_KEYS } from "./prototype-pollution.js";

/**
 * Rebuild the parsed value from its own enumerable entries, dropping
 * prototype-pollution keys (`__proto__`, `constructor`, `prototype`).
 * `jsonc-parser` assigns keys with plain `obj[key] = value` semantics, so a
 * literal `__proto__` key would replace the containing object's prototype
 * instead of becoming an own property; rebuilding gives every object a clean
 * `Object.prototype` again and severs that path.
 */
function deepSanitize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => deepSanitize(item));
  }
  if (value !== null && typeof value === "object") {
    const sanitized: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (PROTOTYPE_POLLUTION_KEYS.has(key)) continue;
      sanitized[key] = deepSanitize(entry);
    }
    return sanitized;
  }
  return value;
}

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
  return deepSanitize(result);
}
