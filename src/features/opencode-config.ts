import { join } from "node:path";

import { parse as parseJsonc } from "jsonc-parser";

import {
  OPENCODE_GLOBAL_DIR,
  OPENCODE_JSON_FILE_NAME,
  OPENCODE_JSONC_FILE_NAME,
} from "../constants/opencode-paths.js";
import { readFileContentOrNull } from "../utils/file.js";

/**
 * Reads and parses the OpenCode config (`opencode.jsonc` preferred, then
 * `opencode.json`) from the project root (or `~/.config/opencode/` in global
 * mode), returning an empty object when no readable config object exists.
 *
 * OpenCode lets users define commands and agents inline in this config (under
 * the top-level `command` / `agent` keys) in addition to the Markdown files
 * under `.opencode/command/` and `.opencode/agent/`. This shared reader is the
 * entry point used to import those inline definitions.
 *
 * @see https://opencode.ai/docs/commands/#json
 * @see https://opencode.ai/docs/agents/#json
 */
export async function readOpencodeConfig({
  outputRoot,
  global = false,
}: {
  outputRoot: string;
  global?: boolean;
}): Promise<Record<string, unknown>> {
  const configDir = join(outputRoot, global ? OPENCODE_GLOBAL_DIR : ".");

  const fileContent =
    (await readFileContentOrNull(join(configDir, OPENCODE_JSONC_FILE_NAME))) ??
    (await readFileContentOrNull(join(configDir, OPENCODE_JSON_FILE_NAME)));

  if (!fileContent) {
    return {};
  }

  const parsed = parseJsonc(fileContent) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  return parsed as Record<string, unknown>;
}

/**
 * Narrows an unknown value to a plain record of entries keyed by name, as used
 * for OpenCode's `command` / `agent` config sections. Returns `null` when the
 * value is not a usable object.
 */
export function asOpencodeEntries(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}
