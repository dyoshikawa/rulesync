import { stripControlCharacters } from "./control-characters.js";
import { truncateText } from "./truncate.js";

/**
 * How much of a value read off disk a diagnostic quotes.
 *
 * Enough to recognize which entry is meant, and no more. A warning names the
 * offending value so the reader can find it, but the values these warnings
 * quote come from files rulesync did not write — a tool's own settings, a
 * machine-local overrides file, a repository fetched from elsewhere — and they
 * no longer stop at a terminal: they travel into a `--json` document another
 * program parses and into an MCP result an agent reads as context. A command
 * line or a header is the shape most likely to carry a credential, and a long
 * value is the shape most likely to carry instructions aimed at the agent.
 */
const MAX_QUOTED_VALUE_LENGTH = 60;

/**
 * A short, quotable rendering of a value for a diagnostic.
 *
 * Serialized rather than interpolated, because an unquoted value is what lets a
 * crafted one read as a second line; stripped of the control characters
 * `JSON.stringify` leaves intact (it escapes C0 only, not the C1 range or the
 * bidirectional overrides); and truncated.
 */
export function quoteValueForWarning(value: unknown): string {
  const encoded = stripControlCharacters(serialize(value));
  return truncateText({
    text: encoded,
    maxLength: MAX_QUOTED_VALUE_LENGTH,
    suffix: "…(truncated)",
  });
}

function serialize(value: unknown): string {
  try {
    // `JSON.stringify` returns undefined for a function or a bare `undefined`,
    // neither of which is data we would want to lose the mention of.
    return JSON.stringify(value, stripStrings) ?? String(value);
  } catch {
    // A YAML config can hold a recursive anchor, and js-yaml resolves it into a
    // genuinely circular object; a BigInt throws here too. Neither is a reason
    // for a warning to become the failure of the whole run.
    return `[unserializable ${typeof value}]`;
  }
}

/**
 * Strip the control characters out of every string before `JSON.stringify`
 * sees it, not only out of the document it produces: `JSON.stringify` escapes
 * a C0 character into the six literal characters `\u001b`, which no later pass
 * over the output can recognize as a control character again.
 */
function stripStrings(_key: string, value: unknown): unknown {
  return typeof value === "string" ? stripControlCharacters(value) : value;
}
