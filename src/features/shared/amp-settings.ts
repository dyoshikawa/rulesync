import { formatError } from "../../utils/error.js";
import { parseJsoncReportingDroppedKeys } from "../../utils/jsonc.js";
import { isPlainObject } from "../../utils/type-guards.js";

/**
 * Parse an Amp `settings.json` / `settings.jsonc` document.
 *
 * Shared by the MCP and permissions adapters because both read the very same
 * file. Two separately maintained copies drifted once already: the permissions
 * side was hardened while the MCP side kept calling `jsonc-parser` directly,
 * which left it importing MCP servers reachable only through an injected
 * `__proto__`.
 *
 * The parse is the strict, sanitizing one: it throws on any syntax error
 * instead of returning `jsonc-parser`'s best-effort value, and it rebuilds
 * every object from its own enumerable entries, so a root `__proto__` cannot
 * swap the returned object's prototype and `constructor` / `prototype` never
 * survive as own keys.
 *
 * Note the consequence for a root `__proto__`: sanitizing runs before the
 * plain-object check, so such a document parses successfully with the key
 * stripped rather than failing that check. That is deliberate — dropping the
 * one poisoned key keeps the user's unrelated settings — and matches the
 * sanitize-before-the-root-check design the shared config gateway documents.
 */
export function parseAmpSettings({
  fileContent,
}: {
  fileContent: string;
}): Record<string, unknown> {
  return parseAmpSettingsReportingDroppedKeys({ fileContent }).json;
}

/**
 * The same parse as {@link parseAmpSettings}, additionally reporting the dotted
 * paths of the prototype-pollution keys it removed.
 *
 * Sanitizing is what makes those keys unobservable in the parsed value, so an
 * adapter that wants to fail loudly on a poisoned settings file has to be told
 * separately. Reporting them beats the own-key scan this replaced, which could
 * never see a `__proto__` — the engine turns it into a prototype swap rather
 * than an own property, so only the source text still knows it was written.
 */
export function parseAmpSettingsReportingDroppedKeys({ fileContent }: { fileContent: string }): {
  json: Record<string, unknown>;
  droppedKeys: string[];
} {
  let value: unknown;
  let droppedKeys: string[];
  try {
    ({ value, droppedKeys } = parseJsoncReportingDroppedKeys({ content: fileContent || "{}" }));
  } catch (error) {
    throw new Error(`Failed to parse Amp settings: ${formatError(error)}`, { cause: error });
  }

  // `isPlainObject` (not `isRecord`) also rejects class instances. The parser
  // cannot produce one today, so this is the layer that pins the contract for
  // callers rather than a second line of defense against the parser.
  if (!isPlainObject(value)) {
    throw new Error("Amp settings must be a JSON object");
  }

  return { json: value, droppedKeys };
}
