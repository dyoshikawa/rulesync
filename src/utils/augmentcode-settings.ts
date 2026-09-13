import { join } from "node:path";

import { AUGMENTCODE_SETTINGS_LOCAL_FILE_NAME } from "../constants/augmentcode-paths.js";
import { parseSharedConfig } from "../features/shared/shared-config-gateway.js";
import { formatError } from "./error.js";
import { readFileContentOrNull } from "./file.js";
import type { Logger } from "./logger.js";
import { isPrototypePollutionKey } from "./prototype-pollution.js";
import { readSettingsWithLocalOverlay } from "./settings-local-overlay.js";
import { isPlainObject } from "./type-guards.js";

/**
 * Parse an AugmentCode settings file (`settings.json` / `settings.local.json`)
 * into a plain object.
 *
 * Auggie reads these files as JSON with Comments — "The files support JSON with
 * Comments (JSONC), allowing comments and trailing commas for better
 * documentation." (https://docs.augmentcode.com/cli/config) — so a bare
 * `JSON.parse` rejects a hand-written file the CLI itself accepts. The parse is
 * fail-closed: a syntax error or a non-object root throws instead of yielding a
 * partial document, because every caller either merges its own keys back into
 * this file or imports permissions from it, and neither may proceed on a file it
 * could not read in full. An empty file parses as `{}`.
 *
 * `configPath` names the file in the error message.
 */
export function parseAugmentcodeSettingsDocument({
  fileContent,
  configPath,
}: {
  fileContent: string;
  configPath: string;
}): Record<string, unknown> {
  try {
    return parseSharedConfig({
      format: "jsonc",
      fileContent,
      invalidRootPolicy: "error",
      jsoncParseErrors: "error",
    });
  } catch (error) {
    // The gateway wraps a syntax error with its own generic prefix and keeps the
    // parser's error as `cause`; report that one so the message reads the same
    // as it did with `JSON.parse`.
    const reason = error instanceof Error && error.cause !== undefined ? error.cause : error;
    throw new Error(
      `Failed to parse AugmentCode settings at ${configPath}: ${formatError(reason)}`,
      { cause: error },
    );
  }
}

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
 * The AugmentCode counterpart of Droid's guardrail keys: the tool-permission
 * rules, the hooks Auggie executes, and the servers and plugins it loads them
 * from. See `readSettingsWithLocalOverlay` for why they are named twice.
 */
const AUGMENTCODE_GUARDRAIL_KEYS = ["toolPermissions", "hooks", "mcpServers", "plugins"] as const;

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
    sensitiveKeys: AUGMENTCODE_GUARDRAIL_KEYS,
    // Both tiers are JSONC upstream (see `parseAugmentcodeSettingsDocument`).
    format: "jsonc",
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
