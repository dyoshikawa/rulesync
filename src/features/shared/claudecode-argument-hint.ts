import { z } from "zod/mini";

/**
 * Turns a YAML-list `argument-hint` back into the bracketed string form Claude
 * Code documents (`[issue-number]`, `[filename] [format]`), one bracketed
 * placeholder per list entry.
 */
export function joinArgumentHint(value: string | Array<string | number>): string {
  if (typeof value === "string") {
    return value;
  }
  return value.map((entry) => `[${String(entry)}]`).join(" ");
}

/**
 * `argument-hint` as Claude Code reads it from skill and command frontmatter.
 *
 * The documented examples (`[issue-number]`) are written unquoted, and YAML
 * parses an unquoted `[issue-number]` as a one-element list. Claude Code
 * accepts that form, so it is accepted here too and normalized to the
 * bracketed string, keeping the parsed value (and everything downstream of it)
 * a plain string. A number entry (`[1]`) is stringified rather than rejected.
 * https://code.claude.com/docs/en/skills
 *
 * The unquoted multi-placeholder form (`argument-hint: [filename] [format]`)
 * is not valid YAML at all, so it fails before this schema is reached.
 */
export const ClaudecodeArgumentHintSchema = z.pipe(
  z.union([z.string(), z.array(z.union([z.string(), z.number()]))]),
  z.transform(joinArgumentHint),
);
