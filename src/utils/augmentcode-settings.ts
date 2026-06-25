import { join } from "node:path";

import { AUGMENTCODE_SETTINGS_LOCAL_FILE_NAME } from "../constants/augmentcode-paths.js";
import { formatError } from "./error.js";
import { readFileContentOrNull } from "./file.js";
import { isPlainObject } from "./type-guards.js";

/**
 * Read the base `.augment/settings.json` content and, when a project-scope
 * `.augment/settings.local.json` overrides file exists, shallow-merge it ON TOP
 * of the base settings (local wins) before returning the merged JSON string.
 *
 * Auggie CLI 0.16.0+ evaluates a layered settings model in which
 * `<workspace>/.augment/settings.local.json` (a gitignored, machine-specific
 * overrides file) is merged over `<workspace>/.augment/settings.json`. This
 * helper applies that overlay on the IMPORT direction only so user-local
 * permission / hook / mcp overrides are not silently dropped when importing the
 * AugmentCode config into rulesync's canonical model.
 *
 * The overlay is project-scope only: AugmentCode documents no global
 * `~/.augment/settings.local.json`, so callers operating in global mode must
 * not request it (`includeLocalOverlay: false`). When the overrides file is
 * absent the base content is returned unchanged.
 *
 * Both files are parsed with the same `isPlainObject` guard the adapters use
 * (rejecting class instances for prototype-pollution hardening); a top-level
 * shallow merge is sufficient because the canonical model only consumes the
 * top-level `toolPermissions` / `hooks` / `mcpServers` keys.
 *
 * @see https://docs.augmentcode.com/cli/config
 */
export async function readAugmentcodeSettingsWithLocalOverlay({
  outputRoot,
  relativeDirPath,
  baseFileName,
  baseFallbackContent,
  includeLocalOverlay,
}: {
  outputRoot: string;
  relativeDirPath: string;
  baseFileName: string;
  baseFallbackContent: string;
  includeLocalOverlay: boolean;
}): Promise<string> {
  const baseFilePath = join(outputRoot, relativeDirPath, baseFileName);
  const baseContent = (await readFileContentOrNull(baseFilePath)) ?? baseFallbackContent;

  if (!includeLocalOverlay) {
    return baseContent;
  }

  const localFilePath = join(outputRoot, relativeDirPath, AUGMENTCODE_SETTINGS_LOCAL_FILE_NAME);
  const localContent = await readFileContentOrNull(localFilePath);
  if (localContent === null) {
    return baseContent;
  }

  const configPath = join(relativeDirPath, AUGMENTCODE_SETTINGS_LOCAL_FILE_NAME);
  let localParsed: unknown;
  try {
    localParsed = JSON.parse(localContent);
  } catch (error) {
    throw new Error(
      `Failed to parse AugmentCode settings at ${configPath}: ${formatError(error)}`,
      { cause: error },
    );
  }
  // `isPlainObject` (not `isRecord`) rejects class instances for
  // prototype-pollution hardening; `JSON.parse` always yields a plain object.
  if (!isPlainObject(localParsed)) {
    throw new Error(
      `Failed to parse AugmentCode settings at ${configPath}: expected a JSON object`,
    );
  }

  let baseParsed: unknown;
  try {
    baseParsed = JSON.parse(baseContent);
  } catch {
    // The base settings.json is malformed. Leave it to the adapter's own
    // (schema-aware) parse to surface a descriptive error; returning the raw
    // base content here preserves the pre-existing error path and message.
    return baseContent;
  }
  const baseObject = isPlainObject(baseParsed) ? baseParsed : {};

  // Shallow merge: local-scope keys win over base-scope keys.
  const merged = { ...baseObject, ...localParsed };
  return JSON.stringify(merged, null, 2);
}
