import { join } from "node:path";

import { AUGMENTCODE_SETTINGS_LOCAL_FILE_NAME } from "../constants/augmentcode-paths.js";
import { formatError } from "./error.js";
import { readFileContentOrNull } from "./file.js";
import { isPrototypePollutionKey } from "./prototype-pollution.js";
import { isPlainObject } from "./type-guards.js";

/**
 * Top-level keys AugmentCode *replaces* (higher-precedence wins wholesale)
 * rather than combining across tiers. Everything else combines.
 *
 * @see https://docs.augmentcode.com/cli/config
 */
const AUGMENTCODE_REPLACE_KEYS: ReadonlySet<string> = new Set(["mcpServers", "plugins"]);

/**
 * Combine a base settings object with a higher-precedence (local) one following
 * AugmentCode's documented layering: simple values take the local override,
 * `mcpServers` / `plugins` are replaced wholesale, and every other object/list
 * is combined across tiers — objects recurse, arrays concatenate **local-first**
 * (Auggie evaluates higher-precedence rules first under first-match logic). This
 * preserves base entries (e.g. committed `toolPermissions` denies) instead of
 * dropping them when local defines the same top-level key.
 */
function combineAugmentSettings(
  base: Record<string, unknown>,
  local: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, localValue] of Object.entries(local)) {
    if (isPrototypePollutionKey(key)) continue;

    const baseValue = result[key];
    if (AUGMENTCODE_REPLACE_KEYS.has(key)) {
      result[key] = localValue;
    } else if (Array.isArray(localValue) && Array.isArray(baseValue)) {
      result[key] = [...localValue, ...baseValue];
    } else if (isPlainObject(localValue) && isPlainObject(baseValue)) {
      result[key] = combineAugmentSettings(baseValue, localValue);
    } else {
      result[key] = localValue;
    }
  }
  return result;
}

/**
 * Read the base `.augment/settings.json` content and, when a project-scope
 * `.augment/settings.local.json` overrides file exists, combine it ON TOP of the
 * base settings (per AugmentCode's documented layering) before returning the
 * merged JSON string.
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
 * (rejecting class instances for prototype-pollution hardening). The merge
 * follows AugmentCode's documented semantics: `mcpServers` / `plugins` replace
 * wholesale, while other objects/lists (notably `toolPermissions` and `hooks`)
 * are combined across tiers so base entries — e.g. committed `deny` rules — are
 * preserved rather than dropped when local defines the same key.
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

  // Combine per AugmentCode's documented layering (local wins for scalars,
  // mcpServers/plugins replace, other objects/lists combine local-first).
  const merged = combineAugmentSettings(baseObject, localParsed);
  return JSON.stringify(merged, null, 2);
}
