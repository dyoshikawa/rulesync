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
export function getOpencodeConfigDir({
  outputRoot,
  global = false,
}: {
  outputRoot: string;
  global?: boolean;
}): string {
  return join(outputRoot, global ? OPENCODE_GLOBAL_DIR : ".");
}

export async function readOpencodeConfig({
  outputRoot,
  global = false,
}: {
  outputRoot: string;
  global?: boolean;
}): Promise<Record<string, unknown>> {
  const configDir = getOpencodeConfigDir({ outputRoot, global });

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

/** Matches a string whose entire value is an OpenCode `{file:...}` reference. */
const OPENCODE_FILE_TEMPLATE_PATTERN = /^\s*\{file:(.+?)\}\s*$/;

/**
 * Resolves an OpenCode `{file:./path}` string reference into the referenced
 * file's contents. OpenCode resolves these paths relative to the config file's
 * location, so `configDir` must be the directory holding `opencode.json`. When
 * the value is not a whole-value file reference it is returned unchanged; when
 * the referenced file cannot be read the literal value is preserved (so the
 * reference is not silently lost).
 *
 * @see https://opencode.ai/docs/agents/
 */
export async function resolveOpencodeFileTemplate({
  value,
  configDir,
}: {
  value: string;
  configDir: string;
}): Promise<string> {
  const match = OPENCODE_FILE_TEMPLATE_PATTERN.exec(value);
  if (!match) {
    return value;
  }

  const referencedPath = match[1]?.trim().replace(/^\.\//, "");
  if (!referencedPath) {
    return value;
  }

  return (await readFileContentOrNull(join(configDir, referencedPath))) ?? value;
}
