import { formatError } from "../../utils/error.js";
import { parseJsonc } from "../../utils/jsonc.js";
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
 * {@link parseJsonc} is the strict, sanitizing parser: it throws on any syntax
 * error instead of returning `jsonc-parser`'s best-effort value, and it
 * rebuilds every object from its own enumerable entries, so a root `__proto__`
 * cannot swap the returned object's prototype and `constructor` / `prototype`
 * never survive as own keys, at any depth.
 *
 * Removal is silent, matching every other tool-side adapter (opencode, kilo,
 * copilot). Reporting the removed keys through `droppedPollutionKeysError` is
 * reserved for the three files a user authors under `.rulesync/`, whose whole
 * purpose is to be turned into tool config — a key that vanishes there needs
 * explaining, whereas here the surrounding settings are the user's own file
 * and are left alone.
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
  let parsed: unknown;
  try {
    parsed = parseJsonc(fileContent || "{}");
  } catch (error) {
    throw new Error(`Failed to parse Amp settings: ${formatError(error)}`, { cause: error });
  }

  // `isPlainObject` (not `isRecord`) also rejects class instances. The parser
  // cannot produce one today, so this is the layer that pins the contract for
  // callers rather than a second line of defense against the parser.
  if (!isPlainObject(parsed)) {
    throw new Error("Amp settings must be a JSON object");
  }

  return parsed;
}
