import { formatError } from "../../utils/error.js";
import { isPlainObject } from "../../utils/type-guards.js";

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
  let parsed: unknown;
  try {
    parsed = parse(fileContent);
  } catch (error) {
    throw new Error(
      `Failed to parse ${label} MCP config at ${relativePath}: ${formatError(error)}`,
      {
        cause: error,
      },
    );
  }
  if (!isPlainObject(parsed)) {
    throw new Error(
      `Failed to parse ${label} MCP config at ${relativePath}: expected a JSON object at the root`,
    );
  }
  return parsed;
}
