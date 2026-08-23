/**
 * Matches C0 controls, DEL, the C1 range (which includes the 8-bit CSI
 * introducer U+009B), the bidirectional overrides and isolates, and the Unicode
 * line and paragraph separators, and the plain LRM/RLM marks. A name or value
 * copied out of an untrusted config file, a fetched repository, or a tool's own
 * settings file must never reach the terminal with these intact: they let the
 * text forge log lines, reorder what is printed around them, or inject escape
 * sequences. LRM/RLM open no bidi scope of their own, but they still reorder the
 * neutral characters beside them, so they go too — a diagnostic line is not the
 * place to preserve the typography of a right-to-left name.
 */
const CONTROL_CHARACTERS_PATTERN =
  // oxlint-disable-next-line no-control-regex
  /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069\u2028\u2029]/g;

/**
 * Removes every control character from `text` so it is safe to splice into a
 * log line or other terminal output.
 */
export function stripControlCharacters(text: string): string {
  return text.replace(CONTROL_CHARACTERS_PATTERN, "");
}
