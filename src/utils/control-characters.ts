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
 * Matches the characters that take no width of their own.
 *
 * `Default_Ignorable_Code_Point` is the Unicode property for exactly this — the
 * zero-width joiners, the soft hyphen, the variation selectors, the Hangul
 * fillers, the tag characters — and the format category `Cf` covers the few
 * that sit outside it, such as the interlinear annotation marks. Both are used
 * rather than a list of ranges because a list has to be revisited every time
 * Unicode adds one, and the one that is missed is the one an attacker reaches
 * for: U+3164 HANGUL FILLER, the classic of the homograph domain names, is a
 * letter of the Hangul script and would pass every check aimed at Latin.
 *
 * The braille blank is named on its own. It carries no dots, so it draws as
 * nothing while belonging to neither set.
 *
 * None of these is a control character, so none is caught by
 * `stripControlCharacters` — and none of them shows. A name that differs from
 * another only by one of these is drawn exactly like it, which is why a name
 * that carries one is not a name a user can be asked to judge.
 */
const INVISIBLE_CHARACTERS_PATTERN = /[\p{Default_Ignorable_Code_Point}\p{Cf}\u2800]/gu;

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

/**
 * Removes every character that does not show: the control characters and the
 * invisible ones alike.
 *
 * This is the form a name has to survive unchanged before it can be offered as
 * something to choose. Callers that need the whole answer should reach for this
 * rather than composing the two strippers themselves, so that the order — and
 * the definition of "hidden" — lives in one place.
 */
export function stripHiddenCharacters(text: string): string {
  return stripInvisibleCharacters(stripControlCharacters(text));
}
