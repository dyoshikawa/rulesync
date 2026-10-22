/**
 * Source lines of a `sanitizeBlockReason(raw)` helper, emitted into generated
 * hook plugins that hand a hook command's output to the agent as the reason a
 * call was blocked (the Pi / oh-my-pi extension and the OpenCode-style plugin).
 * It returns the sanitized, length-capped text, or `""` when nothing survives
 * so the caller can substitute its own fallback.
 *
 * The text is sanitized because a hook command's output can relay third-party
 * content (linter output, matched file lines) into a terminal or, in RPC mode,
 * into an external client. Escape sequences, C1 and other control characters,
 * and format characters such as bidirectional overrides and zero-width joiners
 * are stripped so the reason cannot repaint or reorder what the user is shown,
 * and carriage returns are folded into newlines so it cannot overwrite an
 * already printed line. The format-character pass is a superset of the bidi
 * controls listed in `CONTROL_CHARACTERS_PATTERN`
 * (`src/utils/control-characters.ts`): a blocked-hook reason is short
 * diagnostic text, so dropping every `Cf` character is safer than enumerating
 * the harmful ones and missing `U+061C`, `U+FEFF`, or a future addition.
 *
 * Sanitization runs before truncation so a reason that begins with a progress
 * banner is still reported by its content. The raw text is only sliced to a
 * generous backstop first: a hook command may emit a large amount of output,
 * and the slice bounds the work even if a later edit reintroduces a pattern
 * that is not linear. A slice that actually fired is reported as truncated, so
 * the text is never silently cut.
 *
 * Both slices cut on UTF-16 code units, so each drops a trailing lone high
 * surrogate: the reason may travel as JSON, and half a surrogate pair is not
 * text a strict consumer has to accept.
 *
 * `typed` emits TypeScript parameter and return annotations (for the Pi
 * extension, a `.ts` module); without it the lines are plain JavaScript.
 */
export function buildBlockReasonSanitizerLines({ typed }: { typed: boolean }): string[] {
  const str = typed ? ": string" : "";
  return [
    "const MAX_BLOCK_REASON_LENGTH = 2000;",
    "const MAX_SCANNED_REASON_LENGTH = 128_000;",
    "",
    `function dropTrailingLoneSurrogate(text${str})${str} {`,
    '  return text.replace(/[\\ud800-\\udbff]$/, "");',
    "}",
    "",
    `function sanitizeBlockReason(raw${str})${str} {`,
    "  const scannedTruncated = raw.length > MAX_SCANNED_REASON_LENGTH;",
    "  const scanned = scannedTruncated",
    "    ? dropTrailingLoneSurrogate(raw.slice(0, MAX_SCANNED_REASON_LENGTH))",
    "    : raw;",
    "  const sanitized = scanned",
    '    .replace(/\\r\\n?/g, "\\n")',
    '    .replace(/\\u001b\\[[0-9;?]*[\\u0020-\\u002f]*[\\u0040-\\u007e]/g, "")',
    '    .replace(/\\u001b\\][^\\u0007\\u001b]{0,256}(?:\\u0007|\\u001b\\\\)/g, "")',
    '    .replace(/[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f-\\u009f]/g, "")',
    '    .replace(/[\\p{Cf}\\p{Zl}\\p{Zp}]/gu, "")',
    "    .trim();",
    '  if (!sanitized) return "";',
    "  if (sanitized.length <= MAX_BLOCK_REASON_LENGTH && !scannedTruncated) return sanitized;",
    "  return `${dropTrailingLoneSurrogate(sanitized.slice(0, MAX_BLOCK_REASON_LENGTH))}...`;",
    "}",
  ];
}
