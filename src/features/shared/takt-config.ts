import { join } from "node:path";

import { load } from "js-yaml";

import { formatError } from "../../utils/error.js";
import { isPlainObject } from "../../utils/type-guards.js";

/**
 * Parse a Takt `config.yaml` into a plain object, treating an empty file as `{}`.
 *
 * Shared by the Takt adapters that read-modify-write the same `config.yaml`
 * (mcp, permissions, ...). Uses `isPlainObject` (not `isRecord`) so class
 * instances are rejected for prototype-pollution hardening; a YAML mapping
 * always parses to a plain object.
 */
export function parseTaktConfig(
  fileContent: string,
  relativeDirPath: string,
  relativeFilePath: string,
): Record<string, unknown> {
  const configPath = join(relativeDirPath, relativeFilePath);
  let parsed: unknown;
  try {
    parsed = fileContent.trim() === "" ? {} : load(fileContent);
  } catch (error) {
    throw new Error(`Failed to parse Takt config at ${configPath}: ${formatError(error)}`, {
      cause: error,
    });
  }
  // An empty config.yaml parses to undefined/null; treat it as an empty object.
  if (parsed === undefined || parsed === null) {
    return {};
  }
  if (!isPlainObject(parsed)) {
    throw new Error(`Failed to parse Takt config at ${configPath}: expected a YAML mapping`);
  }
  return parsed;
}
