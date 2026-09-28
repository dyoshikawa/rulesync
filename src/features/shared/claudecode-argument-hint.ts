import { z } from "zod/mini";

type ArgumentHintEntry = string | number | boolean | null;

/**
 * Turns a YAML-list `argument-hint` back into the bracketed string form Claude
 * Code documents (`[issue-number]`, `[filename] [format]`), one bracketed
 * placeholder per list entry. The per-entry form is chosen over re-joining with
 * commas because it is the shape every Claude Code example uses. An empty list
 * carries no hint, so it yields `undefined` and the key is dropped.
 */
export function joinArgumentHint(value: string | ArgumentHintEntry[]): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (value.length === 0) {
    return undefined;
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
 * a plain string. A scalar entry YAML did not read as a string (`[1]`,
 * `[true]`, `[~]`) is stringified rather than rejected.
 * https://code.claude.com/docs/en/skills
 *
 * A list entry is stringified from the value YAML produced, so its original
 * spelling is not kept (`[1.0]` becomes `[1]`), and an entry YAML reads as a
 * date (`[2026-01-01]`) is rejected.
 *
 * The unquoted multi-placeholder form (`argument-hint: [filename] [format]`)
 * is not valid YAML at all, so it fails before this schema is reached.
 */
export const ClaudecodeArgumentHintSchema = z.pipe(
  z.union([z.string(), z.array(z.union([z.string(), z.number(), z.boolean(), z.null()]))]),
  z.transform(joinArgumentHint),
);
