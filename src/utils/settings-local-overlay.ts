import { join } from "node:path";

import { stripControlCharacters } from "./control-characters.js";
import { formatError } from "./error.js";
import { readFileContentOrNull } from "./file.js";
import { type Logger, warnOnceWithFallback } from "./logger.js";
import { isPlainObject } from "./type-guards.js";

/**
 * Read a tool's base settings file and, when the sibling machine-local
 * overrides file exists, apply it on top before returning the merged JSON
 * string.
 *
 * Several tools layer a personal, uncommitted settings file over the committed
 * one — AugmentCode's `.augment/settings.local.json`, Factory Droid's
 * `.factory/settings.local.json` — and rulesync reads the pair on **import** so
 * it does not model permissions or hooks the tool does not actually enforce.
 * The generate direction is unaffected: rulesync writes the base file alone,
 * because a machine-local override is not the team's to publish.
 *
 * What differs per tool is only how the two tiers combine, so `merge` is the
 * caller's: it receives two plain objects and returns the effective settings.
 * A merge implementation is responsible for skipping prototype-pollution keys
 * coming from the local file.
 *
 * Whatever the local file contributes is named in a warning — once per run,
 * however many features read the same pair — because the import's own output — `.rulesync/permissions.jsonc` and
 * friends — is committed: a value that was personal to one machine becomes the
 * team's on the next generate unless someone takes it out first.
 *
 * Returns `null` when neither file exists and no `baseFallbackContent` is
 * given, so callers can tell "no settings at this scope" apart from empty ones.
 */
export async function readSettingsWithLocalOverlay({
  outputRoot,
  relativeDirPath,
  baseFileName,
  localFileName,
  toolLabel,
  baseFallbackContent,
  merge,
  logger,
}: {
  outputRoot: string;
  relativeDirPath: string;
  baseFileName: string;
  localFileName: string;
  /** Names the tool in parse errors, e.g. `"Factory Droid"`. */
  toolLabel: string;
  /** Stands in for a missing base file; omit to get `null` instead. */
  baseFallbackContent?: string;
  /**
   * Receives the warning naming what the machine-local file contributed; the
   * shared fallback logger does when it is omitted.
   */
  logger?: Logger;
  merge: (base: Record<string, unknown>, local: Record<string, unknown>) => Record<string, unknown>;
}): Promise<string | null> {
  const baseContent =
    (await readFileContentOrNull(join(outputRoot, relativeDirPath, baseFileName))) ??
    baseFallbackContent ??
    null;

  const localContent = await readFileContentOrNull(
    join(outputRoot, relativeDirPath, localFileName),
  );
  if (localContent === null) {
    return baseContent;
  }

  const configPath = join(relativeDirPath, localFileName);
  let localParsed: unknown;
  try {
    localParsed = JSON.parse(localContent);
  } catch (error) {
    throw new Error(
      `Failed to parse ${toolLabel} settings at ${configPath}: ${formatError(error)}`,
      {
        cause: error,
      },
    );
  }
  // `isPlainObject` (not `isRecord`) rejects class instances for
  // prototype-pollution hardening; `JSON.parse` always yields a plain object.
  if (!isPlainObject(localParsed)) {
    throw new Error(
      `Failed to parse ${toolLabel} settings at ${configPath}: expected a JSON object`,
    );
  }

  let baseParsed: Record<string, unknown> = {};
  if (baseContent !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(baseContent);
    } catch {
      // The base file is malformed. Leave it to the adapter's own (schema-aware)
      // parse to surface a descriptive error; returning the raw base content
      // here preserves the pre-existing error path and message.
      return baseContent;
    }
    // Same reasoning for a base that parses but is not an object: merging onto
    // `{}` would silently discard it and hand the caller a file it never wrote.
    if (!isPlainObject(parsed)) {
      return baseContent;
    }
    baseParsed = parsed;
  }

  warnAboutLocalKeys({ localParsed, configPath, toolLabel, logger });

  return JSON.stringify(merge(baseParsed, localParsed), null, 2);
}

/**
 * Name the settings the machine-local file contributed, so nobody publishes one
 * by accident. The keys are the user's own, so they are quoted and stripped of
 * control characters like every other name read off disk.
 *
 * Once per run: one `import` reads the same pair of files once per feature —
 * permissions, hooks and MCP all go through here — and the warning describes
 * the file rather than the feature, so it would otherwise repeat verbatim.
 */
function warnAboutLocalKeys({
  localParsed,
  configPath,
  toolLabel,
  logger,
}: {
  localParsed: Record<string, unknown>;
  configPath: string;
  toolLabel: string;
  logger?: Logger;
}): void {
  const keys = Object.keys(localParsed);
  if (keys.length === 0) {
    return;
  }
  const named = keys.map((key) => JSON.stringify(stripControlCharacters(key))).join(", ");
  warnOnceWithFallback(
    logger,
    `${toolLabel}: ${configPath} is a machine-local overrides file, and importing read ` +
      `${named} from it. What rulesync writes from an import is committed, so remove anything ` +
      `personal to this machine from the imported files before sharing them.`,
  );
}
