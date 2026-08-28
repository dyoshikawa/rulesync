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

/**
 * Matches the characters that take no width of their own: the zero-width space,
 * joiners and non-joiner, the soft hyphen, the Mongolian vowel separator, the
 * Arabic letter mark, the word joiner and the invisible operators beside it,
 * the byte order mark, the interlinear annotation marks, and the tag
 * characters. None of them is a
 * control character, so none is caught by `stripControlCharacters` — and none
 * of them shows. A name that differs from another only by one of these is drawn
 * exactly like it, which is why a name that carries one is not a name a user can
 * be asked to judge.
 */
const INVISIBLE_CHARACTERS_PATTERN =
  /[\u00ad\u061c\u180e\u200b-\u200d\u2060-\u2064\ufeff\ufff9-\ufffb\u{e0000}-\u{e007f}]/gu;

/**
 * Removes every zero-width and otherwise invisible character from `text`.
 *
 * Kept apart from `stripControlCharacters` because the two answer different
 * questions. That one asks what is safe to print; this one asks whether a name
 * shows everything it contains, which is what a prompt needs before it offers
 * the name as something to pick.
 */
export function stripInvisibleCharacters(text: string): string {
  return text.replace(INVISIBLE_CHARACTERS_PATTERN, "");
}
