import { join } from "node:path";

import { AUGMENTCODE_SETTINGS_LOCAL_FILE_NAME } from "../constants/augmentcode-paths.js";
import { readFileContentOrNull } from "./file.js";
import type { Logger } from "./logger.js";
import { isPrototypePollutionKey } from "./prototype-pollution.js";
import { readSettingsWithLocalOverlay } from "./settings-local-overlay.js";
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
 * The read-and-parse mechanics are shared with the other tools that layer a
 * personal settings file (see `readSettingsWithLocalOverlay`); only the merge
 * below is AugmentCode's own, following its documented semantics: `mcpServers` / `plugins` replace
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
  logger,
}: {
  outputRoot: string;
  relativeDirPath: string;
  baseFileName: string;
  baseFallbackContent: string;
  includeLocalOverlay: boolean;
  logger?: Logger;
}): Promise<string> {
  if (!includeLocalOverlay) {
    const baseFilePath = join(outputRoot, relativeDirPath, baseFileName);
    return (await readFileContentOrNull(baseFilePath)) ?? baseFallbackContent;
  }

  const merged = await readSettingsWithLocalOverlay({
    outputRoot,
    relativeDirPath,
    baseFileName,
    localFileName: AUGMENTCODE_SETTINGS_LOCAL_FILE_NAME,
    toolLabel: "AugmentCode",
    baseFallbackContent,
    // Combine per AugmentCode's documented layering (local wins for scalars,
    // mcpServers/plugins replace, other objects/lists combine local-first).
    merge: combineAugmentSettings,
    logger,
  });
  // `baseFallbackContent` stands in for a missing base file, so the overlay
  // never returns null here.
  return merged ?? baseFallbackContent;
}
