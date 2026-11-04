import { isDeepStrictEqual } from "node:util";

import {
  applyEdits,
  findNodeAtLocation,
  type FormattingOptions as JsoncFormattingOptions,
  modify,
  type ModificationOptions as JsoncModificationOptions,
  type Node as JsoncNode,
  parseTree,
} from "jsonc-parser";

import { isPrototypePollutionKey } from "../../utils/prototype-pollution.js";
import { isPlainObject } from "../../utils/type-guards.js";

/**
 * In-place editing of a JSONC object's text: the engine behind the shared
 * config gateway's JSONC write path (`serializeSharedConfig`). Every function
 * here works on text and parsed values alone — nothing depends on the
 * ownership declarations — so regions an edit does not touch keep their
 * comments, blank lines and key order byte for byte.
 */

/**
 * Where the line holding `from` starts and where the line starting at `from`
 * ends: the nearest `\r` or `\n` in each direction, or the edge of the text.
 *
 * Both characters count in both directions, because the JSONC scanner treats
 * either as a line break. A file written with lone CRs parses without an error
 * and so reaches these paths, and a comment read only up to the next `\n`
 * would run past its own line and take the closing brace — or a whole sibling
 * key — with it.
 */
function endOfLineFrom({ text, from }: { text: string; from: number }): number {
  for (let index = from; index < text.length; index += 1) {
    const character = text[index];
    if (character === "\n" || character === "\r") return index;
  }
  return text.length;
}

function startOfLineAt({ text, from }: { text: string; from: number }): number {
  for (let index = from - 1; index >= 0; index -= 1) {
    const character = text[index];
    if (character === "\n" || character === "\r") return index + 1;
  }
  return 0;
}

/**
 * Read the indentation and line ending a JSONC document already uses, so
 * inserted properties match the surrounding file instead of imposing the
 * 2-space `JSON.stringify` shape on a file written with 4 spaces or tabs.
 *
 * The root object's first property decides, located through the syntax tree
 * rather than by scanning for the first indented line: a file opening with a
 * banner comment indents that comment's continuation lines too (` * ...`
 * aligns at three columns), and reading the width off one of those would leave
 * `modify` re-indenting the lines it touches to a width nothing else in the
 * file uses. A property that does not start its own line — a one-line object,
 * or an empty one — carries no indent to read, so those fall back to the
 * 2-space default the whole-document writer emits.
 */
export function detectJsoncFormattingOptions({
  text,
  root,
}: {
  text: string;
  root: JsoncNode;
}): JsoncFormattingOptions {
  // A document that states a line break of its own has `modify` read the
  // ending off the text; this one is the fallback for the document that
  // states none — which, having no line break at all, cannot be a CRLF file.
  const eol = "\n";
  const first = root.children?.[0];
  const indent =
    first === undefined
      ? ""
      : text.slice(startOfLineAt({ text, from: first.offset }), first.offset);
  // A width past this is not a style to match but a line to stop reading: an
  // insert indented to it re-emits the whole run on every line it writes, so a
  // file opening with a very long indent would be rewritten far larger than
  // its author wrote it.
  const widestReadableIndent = 8;
  if (indent === "" || indent.length > widestReadableIndent || !/^[ \t]+$/.test(indent)) {
    return { tabSize: 2, insertSpaces: true, eol };
  }
  if (indent.includes("\t")) return { tabSize: 2, insertSpaces: false, eol };
  return { tabSize: indent.length, insertSpaces: true, eol };
}

/**
 * The first key in the document that no edit-based write can be trusted with,
 * or `undefined` when there is none.
 *
 * Two kinds, both answered from the syntax tree because the parsed value no
 * longer knows about either:
 *
 * - A key stated twice. That is legal JSON text which every reader resolves
 *   last-wins, while `modify` edits the *first* occurrence — so an edit-based
 *   write would land on the dead copy and leave the live one saying whatever
 *   it said before. For an owned key that is a silent ownership failure: a
 *   `deny` rulesync just wrote would sit above the `allow` the tool reads.
 * - `__proto__`, `constructor` or `prototype`. None survives into the parsed
 *   document — a nested one is dropped, a root-level `__proto__` replaces the
 *   root's prototype — so an edit-based write would find no difference to
 *   apply and leave the key in the file.
 *
 * The whole-document writer resolves duplicates last-wins and drops pollution
 * keys, which is what it has always done, so those files go to it.
 */
type UneditableKey = { kind: "duplicate" | "prototype-pollution"; key: string };

export function uneditableKeyOf(node: JsoncNode): UneditableKey | undefined {
  if (node.type === "array") {
    for (const child of node.children ?? []) {
      const found = uneditableKeyOf(child);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (node.type !== "object") return undefined;
  const seen = new Set<string>();
  for (const property of node.children ?? []) {
    const key = property.children?.[0]?.value;
    if (typeof key === "string") {
      if (isPrototypePollutionKey(key)) return { kind: "prototype-pollution", key };
      if (seen.has(key)) return { kind: "duplicate", key };
      seen.add(key);
    }
    const value = property.children?.[1];
    if (value !== undefined) {
      const found = uneditableKeyOf(value);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

/**
 * The offset just past the whitespace and comments starting at `from`.
 */
function skipJsoncTrivia({ text, from }: { text: string; from: number }): number {
  let index = from;
  while (index < text.length) {
    const char = text[index];
    if (char === " " || char === "\t" || char === "\n" || char === "\r") {
      index += 1;
      continue;
    }
    if (char === "/" && text[index + 1] === "/") {
      index = endOfLineFrom({ text, from: index });
      continue;
    }
    if (char === "/" && text[index + 1] === "*") {
      const commentEnd = text.indexOf("*/", index + 2);
      index = commentEnd === -1 ? text.length : commentEnd + 2;
      continue;
    }
    break;
  }
  return index;
}

/**
 * Where the deletion of a property whose text ends at `end` should stop.
 *
 * A comment written after the property on its own line is that property's
 * note — `"stale": {...}, // retired` says something about `stale` and nothing
 * about the key above it. Leaving it behind would re-attach it to whichever
 * property now ends that line, so a note about a server rulesync removed would
 * read as a note about the one before it. A comment with a sibling after it on
 * the same line is not claimed: it may belong to either.
 */
function endOfRemoval({ text, end }: { text: string; end: number }): number {
  const stop = endOfLineFrom({ text, from: end });
  const tail = text.slice(end, stop);
  const lineComment = /^[ \t]*\/\/[^\r\n]*$/;
  const blockComment = /^[ \t]*\/\*(?:[^*]|\*(?!\/))*\*\/[ \t]*$/;
  // Whitespace runs to the newline as well, so the line the property had to
  // itself does not survive as a trailing-space stub on the line above it.
  const blank = /^[ \t]*$/;
  return lineComment.test(tail) || blockComment.test(tail) || blank.test(tail) ? stop : end;
}

/**
 * Where the deletion of a property ending at `end` should begin.
 *
 * A property that has its line to itself is removed with the line: its
 * indentation and the newline above it would otherwise be left as a blank gap.
 * A property sharing its line with something else — a sibling, or the object's
 * own `}` — is removed on its own, because swallowing the newline would splice
 * whatever follows onto the line above, and a line comment up there would
 * comment it out: a key rulesync means to write would vanish from the file, or
 * the closing brace would, leaving the document unparsable.
 */
function startOfRemoval({
  text,
  propertyOffset,
  end,
}: {
  text: string;
  propertyOffset: number;
  end: number;
}): number {
  let after = end;
  while (text[after] === " " || text[after] === "\t") after += 1;
  const endsTheLine = after >= text.length || text[after] === "\n" || text[after] === "\r";
  if (!endsTheLine) {
    return propertyOffset;
  }
  let start = propertyOffset;
  while (start > 0 && (text[start - 1] === " " || text[start - 1] === "\t")) start -= 1;
  if (start > 0 && text[start - 1] === "\n") {
    start -= 1;
  }
  if (start > 0 && text[start - 1] === "\r") start -= 1;
  return start;
}

/**
 * Delete the property at `path` from `text`, taking its own line and its
 * separating comma but nothing else.
 *
 * `modify(..., undefined)` would do this, but the range it deletes runs from
 * the end of the *previous* property to the end of this one — or, for the
 * first property of an object, all the way to where the *next* one starts. So
 * removing one key takes the comments sitting between it and the keys around
 * it, including the comment describing the key that survives.
 * Deleting the property's own text instead leaves the comments around it in
 * place. Only the note that follows the property on its own line goes with it
 * (see {@link endOfRemoval}); a comment written on the line *above* is left
 * behind rather than guessed at, which is the direction this whole path errs
 * in.
 */
function removeJsoncProperty({ text, path }: { text: string; path: readonly string[] }): string {
  const root = parseTree(text, [], { allowTrailingComma: true });
  const property = root === undefined ? undefined : findNodeAtLocation(root, [...path])?.parent;
  const object = property?.parent;
  if (property?.type !== "property" || object?.type !== "object") {
    // Already absent — nothing to delete.
    return text;
  }
  const siblings = object.children ?? [];
  const edits: { offset: number; length: number; content: string }[] = [];

  let end = property.offset + property.length;
  const afterProperty = skipJsoncTrivia({ text, from: end });
  if (text[afterProperty] === ",") {
    end = afterProperty + 1;
  } else {
    // No comma follows, so this is the last property: the comma separating it
    // from the previous one has to go too, or the object is left holding a
    // trailing comma that strict JSON readers reject.
    const previous = siblings[siblings.indexOf(property) - 1];
    if (previous !== undefined) {
      const comma = skipJsoncTrivia({ text, from: previous.offset + previous.length });
      if (text[comma] === ",") edits.push({ offset: comma, length: 1, content: "" });
    }
  }

  end = endOfRemoval({ text, end });
  const start = startOfRemoval({ text, propertyOffset: property.offset, end });
  edits.push({ offset: start, length: end - start, content: "" });
  return applyEdits(text, edits);
}

/**
 * Where the comment written at `from` (past any spaces or tabs) ends, or
 * `undefined` if what stands there is not a comment.
 */
function endOfNoteAt({ text, from }: { text: string; from: number }): number | undefined {
  let cursor = from;
  while (text[cursor] === " " || text[cursor] === "\t") cursor += 1;
  if (text.startsWith("//", cursor)) {
    return endOfLineFrom({ text, from: cursor });
  }
  if (text.startsWith("/*", cursor)) {
    const closing = text.indexOf("*/", cursor + 2);
    return closing === -1 ? undefined : closing + 2;
  }
  return undefined;
}

/**
 * Every comment written at `from`, as spans of `text`, each span running from
 * where the previous one stopped so the whitespace between them is carried
 * along. A comma is stepped over once (a file may spell one before its note,
 * or after it) but never collected, because the separator belongs to the
 * property rather than to its note. So a file that writes a note on each side
 * of its comma gets both of them back, in order, after the comma: the notes
 * stay with the key they describe, and the comma keeps the place the file gave
 * it. The run stops at the first thing that is neither: a newline ends it, so
 * a comment on the next line is left alone.
 */
function notesAt({ text, from }: { text: string; from: number }): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  let cursor = from;
  let steppedOverComma = false;
  for (;;) {
    const end = endOfNoteAt({ text, from: cursor });
    if (end !== undefined) {
      spans.push({ start: cursor, end });
      cursor = end;
      continue;
    }
    if (steppedOverComma) return spans;
    let comma = cursor;
    while (text[comma] === " " || text[comma] === "\t") comma += 1;
    if (text[comma] !== ",") return spans;
    steppedOverComma = true;
    cursor = comma + 1;
  }
}

/**
 * Detach the notes written at the point where the object at `path` will take a
 * new key: after its last property (and around the comma a trailing-comma file
 * spells there), or just inside the `{` when it has no properties yet or when
 * the key is to be written first (`at: "start"`).
 *
 * `modify` computes its insert from exactly that point — in front of a note
 * written there — so applying the edit unchanged re-emits the note *after* the
 * key that was just inserted: `"stale": {...} // retired` turns into a note
 * about a server rulesync has only now written, and `{ /* none yet *\/ }`
 * turns into a note about the first entry rulesync puts in it. Lifting the
 * notes out before the insert and putting them back afterwards keeps them
 * where their author wrote them, matching what {@link endOfRemoval} does on
 * the way out.
 *
 * Returns `undefined` when there is no such note, which is the common case.
 */
function detachInsertionNote({
  text,
  path,
  at,
}: {
  text: string;
  path: readonly string[];
  at: "start" | "end";
}): { text: string; note: string; anchorKey: string | undefined } | undefined {
  const root = parseTree(text, [], { allowTrailingComma: true });
  const object = root === undefined ? undefined : findNodeAtLocation(root, [...path]);
  if (object?.type !== "object") return undefined;
  const property = at === "end" ? object.children?.at(-1) : undefined;
  const anchorKey = property?.children?.[0]?.value;
  if (property !== undefined && typeof anchorKey !== "string") return undefined;

  const from = property === undefined ? object.offset + 1 : property.offset + property.length;
  const spans = notesAt({ text, from });
  if (spans.length === 0) return undefined;

  // Only the comments are lifted out; a comma between them stays where the
  // file spells it, so the file keeps its own trailing-comma style.
  let stripped = text;
  for (const span of spans.toReversed()) {
    stripped = stripped.slice(0, span.start) + stripped.slice(span.end);
  }
  return {
    text: stripped,
    note: spans.map((span) => text.slice(span.start, span.end)).join(""),
    anchorKey: typeof anchorKey === "string" ? anchorKey : undefined,
  };
}

/**
 * Put a note detached by {@link detachInsertionNote} back where it was: after
 * the property it describes (behind the comma the insert gave that property),
 * or just inside the `{` of the object it was written in when there was no
 * property to describe. Returns `undefined` if that place can no longer be
 * located, so the caller can fall back to the plain insert rather than drop
 * the note.
 */
function reattachTrailingNote({
  text,
  path,
  anchorKey,
  note,
}: {
  text: string;
  path: readonly string[];
  anchorKey: string | undefined;
  note: string;
}): string | undefined {
  const root = parseTree(text, [], { allowTrailingComma: true });
  const location = anchorKey === undefined ? [...path] : [...path, anchorKey];
  const anchor = root === undefined ? undefined : findNodeAtLocation(root, location);
  if (anchor === undefined) return undefined;
  if (anchorKey === undefined) {
    if (anchor.type !== "object") return undefined;
    const brace = anchor.offset + 1;
    return text.slice(0, brace) + note + text.slice(brace);
  }
  let cursor = anchor.offset + anchor.length;
  while (text[cursor] === " " || text[cursor] === "\t") cursor += 1;
  if (text[cursor] === ",") cursor += 1;
  return text.slice(0, cursor) + note + text.slice(cursor);
}

/**
 * Write `value` at `[...path, key]`, keeping the note written at the point of
 * insertion where its author put it (see {@link detachInsertionNote}): the
 * trailing note of the property the new key is appended after, or — for a
 * `leading` key, which `modify` places before every other property — the note
 * written just inside the `{`. Replacing an existing key needs none of this:
 * `modify` rewrites the value's own span and leaves every comment where it is.
 */
function insertJsoncProperty({
  text,
  path,
  key,
  value,
  options,
  leading = false,
}: {
  text: string;
  path: readonly string[];
  key: string;
  value: unknown;
  options: JsoncModificationOptions;
  leading?: boolean;
}): string {
  const modification: JsoncModificationOptions = leading
    ? { ...options, getInsertionIndex: () => 0 }
    : options;
  const write = (source: string): string =>
    applyEdits(source, modify(source, [...path, key], value, modification));
  const detached = detachInsertionNote({ text, path, at: leading ? "start" : "end" });
  if (detached === undefined) return write(text);
  const reattached = reattachTrailingNote({
    text: write(detached.text),
    path,
    anchorKey: detached.anchorKey,
    note: detached.note,
  });
  return reattached ?? write(text);
}

/**
 * How much work an edit-based write may cost, as the file's length times the
 * number of keys that differ.
 *
 * Each changed key re-parses the whole file, so a file whose keys nearly all
 * change costs quadratic work: an 823 KB `opencode.json` whose 6,400 servers
 * are all replaced took 40 seconds to write as edits, and cloning a
 * repository that ships such a file is enough to reach that. Past this budget
 * the file is written whole instead — it loses its comments, the same as a
 * file rulesync cannot parse does, which is the better of the two outcomes
 * against a `generate` that looks like it has hung. The limit is under a
 * second of editing for a replacement and a second or two for an insert,
 * which parses more; a hand-written config file is orders of magnitude below
 * either.
 */
export const JSONC_EDIT_BUDGET_BYTES = 50_000_000;

/**
 * How much text the edits of one write may put into the file, all of them
 * together.
 *
 * The budget above charges by the number of keys that differ, which prices an
 * insert of a whole subtree as one edit — but `modify` re-indents the text it
 * writes, and it does that in time quadratic in the length of that text: a
 * 127 KB value takes half a second to write, a 516 KB one 9 seconds, a 1 MB
 * one 35. The cost is quadratic in the total as well as in each part, because
 * every edit re-indents against the text the ones before it left, so a limit
 * on the widest single value would let a handful of values just under it cost
 * minutes between them. This is a limit on their sum, which holds the
 * re-indenting to about a second whether it arrives as one value or twenty.
 * A hand-written config file changes a few hundred bytes at a time.
 */
export const JSONC_EDIT_WRITTEN_BYTES = 200_000;

/**
 * How much text one edit writes: the value as `modify` formats it, plus the
 * indentation that formatting puts in front of every line of it.
 *
 * A value written deep in a document is written far wider than it reads on
 * its own — a 114 KB server list nested 1,200 deep is 36 MB of text once
 * every line of it carries 2,400 spaces — so measuring the value alone would
 * miss the whole of what makes that write expensive.
 */
function measureJsoncWrite({ value, depth }: { value: unknown; depth: number }): number {
  const formatted = JSON.stringify(value, null, 2) ?? "";
  let lines = 1;
  for (let at = formatted.indexOf("\n"); at !== -1; at = formatted.indexOf("\n", at + 1)) {
    lines += 1;
  }
  return formatted.length + lines * 2 * depth;
}

/**
 * How much {@link applyJsoncObjectEdits} would write, deciding each key
 * exactly the way it does — the two walk together, so a new case in one needs
 * the same case here. It reports both how many edits there would be and how
 * much text they would write between them, because the two are budgeted
 * separately: one stands for the parse each edit costs, the other for the
 * re-indenting each edit costs. Counting is a walk of the documents alone: no
 * text is touched, so the budgets above are spent on the write rather than on
 * finding out how large the write is.
 */
export function countJsoncEdits({
  base,
  next,
  depth,
}: {
  base: Record<string, unknown>;
  next: Record<string, unknown>;
  depth: number;
}): { edits: number; written: number } {
  let edits = 0;
  let written = 0;
  for (const [key, value] of Object.entries(next)) {
    if (isPrototypePollutionKey(key)) continue;
    const present = Object.hasOwn(base, key);
    const previous = present ? base[key] : undefined;
    if (value === undefined) {
      if (present) edits += 1;
      continue;
    }
    if (isPlainObject(previous) && isPlainObject(value)) {
      const nested = countJsoncEdits({ base: previous, next: value, depth: depth + 1 });
      edits += nested.edits;
      written += nested.written;
      continue;
    }
    if (present && isDeepStrictEqual(previous, value)) continue;
    edits += 1;
    written += measureJsoncWrite({ value, depth: depth + 1 });
  }
  for (const key of Object.keys(base)) {
    if (!Object.hasOwn(next, key)) edits += 1;
  }
  return { edits, written };
}

/**
 * Rewrite `text` so the object at `path` matches `next`, touching only the
 * spans that actually differ from `base`.
 *
 * Each difference is applied on its own — `modify` computes an edit against
 * the current text and `applyEdits` returns the text with that edit applied,
 * which is then the input for the next difference, because every edit shifts
 * the offsets the following ones would have been computed from. Nested objects
 * present on both sides are recursed into rather than replaced wholesale, so a
 * one-key change deep in the document leaves its siblings — and the comments
 * attached to them — byte-identical.
 *
 * Every difference re-parses the document, so the work is one parse of the
 * file per *changed* key rather than one parse overall. A regeneration that
 * changes nothing costs a single parse, and the files this runs on are config
 * files, so the shape is left simple rather than batched — with the file
 * large enough and enough of it changing, the product of the two is what
 * {@link JSONC_EDIT_BUDGET_BYTES} keeps off this path.
 */
export function applyJsoncObjectEdits({
  text,
  base,
  next,
  path,
  options,
  leadingKeys,
}: {
  text: string;
  base: Record<string, unknown>;
  next: Record<string, unknown>;
  path: readonly string[];
  options: JsoncModificationOptions;
  /** Root keys written in front of every other property when inserted. */
  leadingKeys: readonly string[];
}): string {
  let result = text;
  for (const [key, value] of Object.entries(next)) {
    // Never reachable through the gateway (both the parsed base and every
    // merge policy drop these), but this walker writes straight into the
    // user's file, so it does not rely on its callers to have done that.
    if (isPrototypePollutionKey(key)) continue;
    const present = Object.hasOwn(base, key);
    const previous = present ? base[key] : undefined;
    if (value === undefined) {
      // A key retracted by the merge policy. `JSON.stringify` drops it by
      // omission; here it has to be deleted from the text explicitly.
      if (present) result = removeJsoncProperty({ text: result, path: [...path, key] });
      continue;
    }
    if (isPlainObject(previous) && isPlainObject(value)) {
      result = applyJsoncObjectEdits({
        text: result,
        base: previous,
        next: value,
        path: [...path, key],
        options,
        leadingKeys: [],
      });
      continue;
    }
    if (present) {
      if (isDeepStrictEqual(previous, value)) continue;
      result = applyEdits(result, modify(result, [...path, key], value, options));
      continue;
    }
    result = insertJsoncProperty({
      text: result,
      path,
      key,
      value,
      options,
      leading: leadingKeys.includes(key),
    });
  }
  for (const key of Object.keys(base)) {
    if (!Object.hasOwn(next, key)) {
      result = removeJsoncProperty({ text: result, path: [...path, key] });
    }
  }
  return result;
}
