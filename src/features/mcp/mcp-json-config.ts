import { formatError } from "../../utils/error.js";
import { isPlainObject } from "../../utils/type-guards.js";

/**
 * Parse a hand-written MCP config file, wrapping a syntax error in a message
 * that names the tool (`label`) and the file. The root is not checked: this is
 * the historical behavior of the writers that read their file with a bare
 * `JSON.parse`, and the return type matches what they assumed of it. Prefer
 * {@link parseMcpJsonObjectOrThrow}, which also refuses a non-object root.
 */
export function parseMcpJsonOrThrow({
  fileContent,
  relativePath,
  label,
  parse = JSON.parse,
}: {
  fileContent: string;
  relativePath: string;
  label: string;
  parse?: (content: string) => unknown;
}): Record<string, unknown> {
  try {
    return parse(fileContent) as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `Failed to parse ${label} MCP config at ${relativePath}: ${formatError(error)}`,
      {
        cause: error,
      },
    );
  }
}

/**
 * Parse a hand-written MCP config file whose root must be a JSON object,
 * failing closed on malformed content or a non-object root (`null`, an array,
 * a scalar) rather than spreading whatever came back into the regenerated
 * file. `parse` is the tool's dialect (`JSON.parse`, `parseJsonc`, ...);
 * `label` names the tool in the error message.
 */
export function parseMcpJsonObjectOrThrow({
  fileContent,
  relativePath,
  label,
  parse,
}: {
  fileContent: string;
  relativePath: string;
  label: string;
  parse: (content: string) => unknown;
}): Record<string, unknown> {
  const parsed: unknown = parseMcpJsonOrThrow({ fileContent, relativePath, label, parse });
  if (!isPlainObject(parsed)) {
    throw new Error(
      `Failed to parse ${label} MCP config at ${relativePath}: expected a JSON object at the root`,
    );
  }
  return parsed;
}
