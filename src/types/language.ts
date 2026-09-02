import { z } from "zod/mini";

/**
 * Response languages the root `language` key of `rulesync.jsonc` accepts.
 *
 * BCP 47-style codes: a bare ISO 639-1 code where one language name is
 * unambiguous, and a region-qualified code where the written form differs by
 * region (`zh-CN` / `zh-TW`, `pt-BR`). Widening the list is a non-breaking
 * change; respelling an existing code is not, so the code style is fixed here.
 */
export const LANGUAGE_CODES = [
  "en",
  "ja",
  "zh-CN",
  "zh-TW",
  "ko",
  "fr",
  "de",
  "es",
  "pt-BR",
  "ru",
] as const;

export const LanguageSchema = z.enum(LANGUAGE_CODES);
export type Language = z.infer<typeof LanguageSchema>;

type LanguageDisplay = {
  /** English name used in the prompt appended to generated rule files. */
  readonly name: string;
  /**
   * Value written to Claude Code's native `language` setting, which takes a
   * lower-case language name (e.g. `"japanese"`) rather than a code.
   */
  readonly claudecode: string;
};

const LANGUAGE_DISPLAY: Readonly<Record<Language, LanguageDisplay>> = {
  en: { name: "English", claudecode: "english" },
  ja: { name: "Japanese", claudecode: "japanese" },
  "zh-CN": { name: "Simplified Chinese", claudecode: "simplified chinese" },
  "zh-TW": { name: "Traditional Chinese", claudecode: "traditional chinese" },
  ko: { name: "Korean", claudecode: "korean" },
  fr: { name: "French", claudecode: "french" },
  de: { name: "German", claudecode: "german" },
  es: { name: "Spanish", claudecode: "spanish" },
  "pt-BR": { name: "Brazilian Portuguese", claudecode: "brazilian portuguese" },
  ru: { name: "Russian", claudecode: "russian" },
};

/** English display name of a language, as used in the appended prompt. */
export function getLanguageName(language: Language): string {
  return LANGUAGE_DISPLAY[language].name;
}

/** The value Claude Code's `language` settings key expects for a language. */
export function getClaudecodeLanguageValue(language: Language): string {
  return LANGUAGE_DISPLAY[language].claudecode;
}

/**
 * The one sentence rulesync appends to generated root rule files when
 * `language` is set. Every supported language — `en` included — emits it, so
 * the instruction is explicit rather than implied by the absence of a block.
 */
export function buildLanguageInstruction(language: Language): string {
  return `You must always answer in ${getLanguageName(language)}. On the other hand, reasoning (thinking) should be in English to improve token efficiency.`;
}

/**
 * Separator that opens the appended block. A thematic break makes the
 * concatenation visible, so a reader can tell the sentence was appended by
 * rulesync rather than authored as part of the rules.
 */
const LANGUAGE_BLOCK_SEPARATOR = "---";

/**
 * Append the language block to a rule body: a blank line, the separator, a
 * blank line, then the instruction. A body that is empty (or whitespace only)
 * gets the instruction alone, because a file that starts with `---` reads as
 * the opening of a frontmatter block.
 */
export function appendLanguageBlock({
  content,
  language,
}: {
  content: string;
  language: Language;
}): string {
  const instruction = buildLanguageInstruction(language);
  const body = content.trimEnd();
  if (body.length === 0) {
    return instruction;
  }
  return `${body}\n\n${LANGUAGE_BLOCK_SEPARATOR}\n\n${instruction}`;
}

const INSTRUCTIONS: readonly string[] = LANGUAGE_CODES.map((code) =>
  buildLanguageInstruction(code),
);

const isBlank = (value: string): boolean => value === " " || value === "\t";

/**
 * Remove one trailing block exactly as {@link appendLanguageBlock} writes it,
 * for any supported language: the separator on its own line, blank space
 * with at least one line break, the instruction, trailing whitespace. Only
 * the end of the body is inspected, so a sentence quoted mid-file is left
 * alone. Returns the body unchanged when no block closes it.
 *
 * Walks the body from its end with string operations rather than a regular
 * expression: an unanchored pattern over optional blank lines backtracks in
 * polynomial time, and a rule file padded with a few hundred thousand
 * trailing newlines would hang `rulesync import` on it.
 */
function stripOneLanguageBlock(body: string): string {
  const trimmed = body.trimEnd();
  const instruction = INSTRUCTIONS.find((candidate) => trimmed.endsWith(candidate));
  if (instruction === undefined) {
    return body;
  }
  const beforeInstruction = trimmed.slice(0, trimmed.length - instruction.length);
  const beforeGap = beforeInstruction.trimEnd();
  // Nothing but the instruction: an empty rule body was appended to.
  if (beforeGap.length === 0) {
    return "";
  }
  // Between the separator and the instruction there is only blank space,
  // spanning at least one line break.
  if (!beforeInstruction.slice(beforeGap.length).includes("\n")) {
    return body;
  }
  if (!beforeGap.endsWith(LANGUAGE_BLOCK_SEPARATOR)) {
    return body;
  }
  // The separator opens its line: only blanks may precede it there.
  let lineStart = beforeGap.length - LANGUAGE_BLOCK_SEPARATOR.length;
  while (lineStart > 0 && isBlank(beforeGap.charAt(lineStart - 1))) {
    lineStart -= 1;
  }
  if (lineStart > 0 && beforeGap.charAt(lineStart - 1) !== "\n") {
    return body;
  }
  return body.slice(0, lineStart).trimEnd();
}

/**
 * Remove the trailing language block(s) from an imported rule body so that
 * `rulesync import` followed by `rulesync generate` does not stack a second
 * copy. Repeats until nothing more comes off, so a file that already carries
 * two stacked blocks (generated twice by an older flow, say) comes back
 * clean. Returns the body unchanged when no block is present.
 */
export function stripLanguageBlock(body: string): string {
  let current = body;
  for (;;) {
    const next = stripOneLanguageBlock(current);
    if (next === current) {
      return current;
    }
    current = next;
  }
}
