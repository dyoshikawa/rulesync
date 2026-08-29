import { FACTORYDROID_SETTINGS_LOCAL_FILE_NAME } from "../constants/factorydroid-paths.js";
import { FACTORYDROID_OVERRIDE_KEYS } from "../constants/factorydroid-settings-keys.js";
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
 * Settings a machine-local file must not publish by accident, so the overlay's
 * warning calls them out by name: every key the `factorydroid` permissions
 * override round-trips — the sandbox and network tiers, the autonomy ceilings,
 * the hard command blocklist, the Droid Shield switch, the plugin and
 * marketplace bootstrap, the hooks and skills kill-switches — plus the command
 * lists and the hooks themselves, which the shared blocks own.
 *
 * The list is derived from the override rather than written out, so it cannot
 * drift behind it as keys are added there. That sweeps in a couple that shape
 * how a session behaves by default rather than what Droid may do
 * (`interactionMode`, `sessionDefaultSettings`), and deliberately: naming one
 * key too many costs a sentence, while missing one that grants power is the
 * failure this warning exists to prevent.
 *
 * @see https://docs.factory.ai/cli/configuration/settings
 */
const FACTORYDROID_GUARDRAIL_KEYS = [
  ...FACTORYDROID_OVERRIDE_KEYS,
  "commandAllowlist",
  "commandDenylist",
  "hooks",
] as const;

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
  quiet = false,
  logger,
}: {
  outputRoot: string;
  relativeDirPath: string;
  baseFileName: string;
  /** Read without warning about the machine-local file; see the shared helper. */
  quiet?: boolean;
  logger?: Logger;
}): Promise<string | null> {
  return await readSettingsWithLocalOverlay({
    outputRoot,
    relativeDirPath,
    baseFileName,
    localFileName: FACTORYDROID_SETTINGS_LOCAL_FILE_NAME,
    toolLabel: "Factory Droid",
    sensitiveKeys: FACTORYDROID_GUARDRAIL_KEYS,
    quiet,
    merge: overrideFactorydroidSettings,
    logger,
  });
}
