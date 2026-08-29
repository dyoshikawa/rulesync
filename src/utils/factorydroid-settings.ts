import { FACTORYDROID_SETTINGS_LOCAL_FILE_NAME } from "../constants/factorydroid-paths.js";
import type { Logger } from "./logger.js";
import { isPrototypePollutionKey } from "./prototype-pollution.js";
import { readSettingsWithLocalOverlay } from "./settings-local-overlay.js";

/**
 * Combine base settings with the local overrides file the way Droid documents
 * it: a key the local file sets replaces the base one wholesale rather than
 * being merged into it. Droid describes the file as an override and does not
 * describe combining values across tiers, so a local `commandAllowlist` is the
 * effective list rather than an addition to the committed one.
 */
function overrideFactorydroidSettings(
  base: Record<string, unknown>,
  local: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(local)) {
    if (isPrototypePollutionKey(key)) continue;
    result[key] = value;
  }
  return result;
}

/**
 * Read `settings.json` for a Factory Droid scope with the sibling
 * `settings.local.json` applied on top (see `readSettingsWithLocalOverlay` for
 * the shared mechanism and the import-only rule).
 *
 * Droid layers four settings files — user `settings.json`, user
 * `settings.local.json`, project `settings.json`, project `settings.local.json`
 * — each overriding the previous one, so `settings.local.json` is read at
 * **both** scopes rather than the project scope only. This helper covers the
 * two files of a single scope; layering user under project is the processor's
 * job, not this one's.
 *
 * @see https://docs.factory.ai/droid-cli/settings
 */
export async function readFactorydroidSettingsWithLocalOverlay({
  outputRoot,
  relativeDirPath,
  baseFileName,
  logger,
}: {
  outputRoot: string;
  relativeDirPath: string;
  baseFileName: string;
  logger?: Logger;
}): Promise<string | null> {
  return await readSettingsWithLocalOverlay({
    outputRoot,
    relativeDirPath,
    baseFileName,
    localFileName: FACTORYDROID_SETTINGS_LOCAL_FILE_NAME,
    toolLabel: "Factory Droid",
    merge: overrideFactorydroidSettings,
    logger,
  });
}
