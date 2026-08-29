import { join } from "node:path";

import { FACTORYDROID_LOCAL_SETTINGS_FILE_NAME } from "../constants/factorydroid-paths.js";
import { formatError } from "./error.js";
import { readFileContentOrNull } from "./file.js";
import { isPrototypePollutionKey } from "./prototype-pollution.js";
import { isPlainObject } from "./type-guards.js";

/**
 * Read `settings.json` for a Factory Droid scope and, when the sibling
 * `settings.local.json` exists, apply it on top before returning the merged
 * JSON string.
 *
 * Droid layers four settings files — user `settings.json`, user
 * `settings.local.json`, project `settings.json`, project `settings.local.json`
 * — each overriding the previous one, so `settings.local.json` is read at
 * **both** scopes rather than the project scope only. This helper covers the
 * two files of a single scope; layering user under project is the processor's
 * job, not this one's.
 *
 * The overlay applies to the IMPORT direction only. Droid documents
 * `settings.local.json` as personal, uncommitted settings, so generating must
 * keep writing `settings.json` alone — pulling a machine-local override into the
 * shared file would publish it to the whole team.
 *
 * Keys are replaced at the top level rather than deep-merged: Droid documents
 * the file as an override and does not describe combining values across tiers,
 * so a local `commandAllowlist` is taken to be the effective list rather than an
 * addition to the committed one.
 *
 * Returns `null` when neither file exists, so callers can tell "no settings at
 * this scope" apart from an empty one and apply their own fallback.
 *
 * @see https://docs.factory.ai/droid-cli/settings
 */
export async function readFactorydroidSettingsWithLocalOverlay({
  outputRoot,
  relativeDirPath,
  baseFileName,
}: {
  outputRoot: string;
  relativeDirPath: string;
  baseFileName: string;
}): Promise<string | null> {
  const baseContent = await readFileContentOrNull(join(outputRoot, relativeDirPath, baseFileName));

  const localFilePath = join(outputRoot, relativeDirPath, FACTORYDROID_LOCAL_SETTINGS_FILE_NAME);
  const localContent = await readFileContentOrNull(localFilePath);
  if (localContent === null) {
    return baseContent;
  }

  const configPath = join(relativeDirPath, FACTORYDROID_LOCAL_SETTINGS_FILE_NAME);
  let localParsed: unknown;
  try {
    localParsed = JSON.parse(localContent);
  } catch (error) {
    throw new Error(
      `Failed to parse Factory Droid settings at ${configPath}: ${formatError(error)}`,
      { cause: error },
    );
  }
  // `isPlainObject` (not `isRecord`) rejects class instances for
  // prototype-pollution hardening; `JSON.parse` always yields a plain object.
  if (!isPlainObject(localParsed)) {
    throw new Error(
      `Failed to parse Factory Droid settings at ${configPath}: expected a JSON object`,
    );
  }

  let baseParsed: unknown = {};
  if (baseContent !== null) {
    try {
      baseParsed = JSON.parse(baseContent);
    } catch {
      // The base settings.json is malformed. Leave it to the caller's own parse
      // to surface a descriptive error; returning the raw base content here
      // preserves the pre-existing error path and message.
      return baseContent;
    }
  }

  const merged: Record<string, unknown> = isPlainObject(baseParsed) ? { ...baseParsed } : {};
  for (const [key, value] of Object.entries(localParsed)) {
    if (isPrototypePollutionKey(key)) continue;
    merged[key] = value;
  }
  return JSON.stringify(merged, null, 2);
}
