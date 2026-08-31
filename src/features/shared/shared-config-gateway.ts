import { isDeepStrictEqual } from "node:util";

import { uniq } from "es-toolkit";
import { dump } from "js-yaml";
import {
  applyEdits,
  findNodeAtLocation,
  type FormattingOptions as JsoncFormattingOptions,
  getNodeValue,
  modify,
  type ModificationOptions as JsoncModificationOptions,
  type Node as JsoncNode,
  parse as parseJsonc,
  type ParseError as JsoncParseError,
  parseTree,
  printParseErrorCode,
} from "jsonc-parser";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";

import { CODEXCLI_OVERRIDE_KEYS } from "../../constants/codexcli-paths.js";
import {
  TAKT_WORKFLOW_MCP_SERVERS_KEY,
  TAKT_WORKFLOW_OVERRIDES_KEY,
} from "../../constants/takt-paths.js";
import type { ClaudeSettingsJson } from "../../types/claude-settings.js";
import type { Feature } from "../../types/features.js";
import { formatError } from "../../utils/error.js";
import type { Logger } from "../../utils/logger.js";
import {
  isPrototypePollutionKey,
  PROTOTYPE_POLLUTION_KEYS,
} from "../../utils/prototype-pollution.js";
import { isPlainObject } from "../../utils/type-guards.js";
import { loadYaml } from "../../utils/yaml.js";

/**
 * Single gateway for the shared config files that several rulesync features
 * read-modify-write (`.claude/settings.json`, `.hermes/config.yaml`,
 * `.takt/config.yaml`, `opencode.json`, ...). It unifies the three concerns
 * that used to be scattered across per-file helper modules
 * (claudecode-settings-gateway / hermes-config / takt-config / opencode-config):
 *
 * 1. **Format codecs** — parsing and serializing YAML/JSON/JSONC with one
 *    empty-file rule and one prototype-pollution hardening pass.
 * 2. **Conflict policies** — the named merge semantics a feature can declare
 *    (`replace-owned-keys`, `deep-merge`), implemented once instead of being
 *    re-spelled per tool (the takt `provider_options` sibling-clobber and the
 *    hermes-class merge bugs were re-implementations going subtly wrong).
 * 3. **Ownership declarations** — {@link SHARED_CONFIG_OWNERSHIP} states, per
 *    file and per feature, which keys the feature owns and which policy
 *    resolves conflicts. {@link applySharedConfigPatch} executes the declared
 *    policy, and rejects writes outside the declared ownership.
 *
 * The cross-feature *order* in which these writers run is derived from the
 * registry in `src/lib/shared-file-derive.ts` (`SHARED_WRITE_FEATURE_ORDER`),
 * and the no-data-loss contract is enforced end-to-end by
 * `src/lib/shared-file-contract.test.ts`.
 */

// ---------------------------------------------------------------------------
// Format codecs
// ---------------------------------------------------------------------------

export type SharedConfigFormat = "yaml" | "json" | "jsonc" | "toml";

export type SharedConfigDocument = Record<string, unknown>;

/**
 * How {@link parseSharedConfig} treats a syntactically valid document whose
 * root is not a mapping: coerce it to `{}` (tolerant readers) or throw
 * (writers that would otherwise silently discard the user's file).
 */
export type SharedConfigInvalidRootPolicy = "coerce-empty" | "error";

/**
 * How {@link parseSharedConfig} treats JSONC syntax errors: `tolerate` keeps
 * jsonc-parser's best-effort recovery (the historical opencode/kilo behavior),
 * `error` refuses to read-modify-write a file it could not fully parse
 * (fail-closed, so a partial parse can't silently drop user content on the
 * write-back).
 */
export type SharedConfigJsoncParseErrorsPolicy = "tolerate" | "error";

/**
 * Rebuild a parsed document without its prototype-pollution keys.
 *
 * Every object is rebuilt, not just the ones that are already plain: a literal
 * `"__proto__"` is assigned with `obj[key] = value` by `jsonc-parser`, which
 * *replaces the containing object's prototype* instead of adding a key. Such
 * an object is no longer a plain object, and the injected value is reachable
 * through it by plain property access while `Object.keys` and `JSON.stringify`
 * show nothing — so leaving it as it came out of the parser would both hide a
 * server or permission the file does not state and, at the root, cost the
 * whole document (see {@link parseSharedConfig}). Rebuilding gives every
 * object `Object.prototype` back and drops the injected value with the key.
 *
 * Dates are the one object the YAML and TOML parsers produce that is not a
 * mapping, so they are passed through rather than flattened into `{}`.
 */
function sanitizeSharedConfigValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeSharedConfigValue);
  }
  if (value === null || typeof value !== "object" || value instanceof Date) {
    return value;
  }
  const result: SharedConfigDocument = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (isPrototypePollutionKey(key)) continue;
    result[key] = sanitizeSharedConfigValue(nested);
  }
  return result;
}

/**
 * Parse a shared config file into a plain document: an empty/whitespace file
 * is `{}`, prototype-pollution keys are dropped recursively, and a non-mapping
 * root follows `invalidRootPolicy`. Syntax errors are wrapped with the file
 * path when one is given.
 */
export function parseSharedConfig({
  format,
  fileContent,
  filePath,
  invalidRootPolicy = "coerce-empty",
  jsoncParseErrors = "tolerate",
}: {
  format: SharedConfigFormat;
  fileContent: string;
  filePath?: string | undefined;
  invalidRootPolicy?: SharedConfigInvalidRootPolicy;
  jsoncParseErrors?: SharedConfigJsoncParseErrorsPolicy;
}): SharedConfigDocument {
  if (fileContent.trim() === "") {
    return {};
  }

  const at = filePath === undefined ? "" : ` at ${filePath}`;
  let parsed: unknown;
  try {
    if (format === "yaml") {
      parsed = loadYaml(fileContent);
    } else if (format === "toml") {
      parsed = parseToml(fileContent);
    } else if (format === "json") {
      parsed = JSON.parse(fileContent);
    } else if (jsoncParseErrors === "error") {
      const errors: JsoncParseError[] = [];
      parsed = parseJsonc(fileContent, errors, { allowTrailingComma: true });
      if (errors.length > 0) {
        const details = errors
          .map((error) => `${printParseErrorCode(error.error)} at offset ${error.offset}`)
          .join(", ");
        throw new Error(details);
      }
    } else {
      parsed = parseJsonc(fileContent);
    }
  } catch (error) {
    throw new Error(`Failed to parse shared config${at}: ${formatError(error)}`, { cause: error });
  }

  if (parsed === undefined || parsed === null) {
    return {};
  }
  // Sanitized before the root is judged, not after: a root-level `__proto__`
  // leaves the parser holding an object whose prototype is the injected value,
  // which `isPlainObject` rejects — and coercing that to `{}` would throw away
  // every setting the file visibly states next to it.
  const sanitized = sanitizeSharedConfigValue(parsed);
  if (!isPlainObject(sanitized)) {
    if (invalidRootPolicy === "error") {
      throw new Error(`Failed to parse shared config${at}: expected a mapping at the root`);
    }
    return {};
  }
  return sanitized;
}

/**
 * Serialize a shared config document. YAML output always ends with exactly one
 * newline; JSON output matches the 2-space `JSON.stringify` shape the JSON
 * writers have always emitted (no trailing newline); TOML output matches the
 * `smol-toml` `stringify` shape the TOML writers have always emitted.
 */
export function stringifySharedConfig({
  format,
  document,
}: {
  format: SharedConfigFormat;
  document: SharedConfigDocument;
}): string {
  if (format === "yaml") {
    return dump(document, { noRefs: true, sortKeys: false }).trimEnd() + "\n";
  }
  if (format === "toml") {
    return stringifyToml(document);
  }
  return JSON.stringify(document, null, 2);
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
function detectJsoncFormattingOptions({
  text,
  root,
}: {
  text: string;
  root: JsoncNode;
}): JsoncFormattingOptions {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const first = root.children?.[0];
  const indent =
    first === undefined
      ? ""
      : text.slice(text.lastIndexOf("\n", first.offset - 1) + 1, first.offset);
  if (indent === "" || !/^[ \t]+$/.test(indent)) {
    return { tabSize: 2, insertSpaces: true, eol };
  }
  if (indent.includes("\t")) return { tabSize: 2, insertSpaces: false, eol };
  return { tabSize: indent.length, insertSpaces: true, eol };
}

/**
 * Whether the document states a key no edit-based write can be trusted with.
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
function statesUneditableKeys(node: JsoncNode): boolean {
  if (node.type === "array") {
    return (node.children ?? []).some((child) => statesUneditableKeys(child));
  }
  if (node.type !== "object") return false;
  const seen = new Set<string>();
  for (const property of node.children ?? []) {
    const key = property.children?.[0]?.value;
    if (typeof key === "string") {
      if (seen.has(key) || PROTOTYPE_POLLUTION_KEYS.has(key)) return true;
      seen.add(key);
    }
    const value = property.children?.[1];
    if (value !== undefined && statesUneditableKeys(value)) return true;
  }
  return false;
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
      const lineEnd = text.indexOf("\n", index);
      index = lineEnd === -1 ? text.length : lineEnd;
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
  const newline = text.indexOf("\n", end);
  let stop = newline === -1 ? text.length : newline;
  if (stop > end && text[stop - 1] === "\r") stop -= 1;
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
    if (start > 0 && text[start - 1] === "\r") start -= 1;
  }
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
    const newline = text.indexOf("\n", cursor);
    const end = newline === -1 ? text.length : newline;
    return end > cursor && text[end - 1] === "\r" ? end - 1 : end;
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
 * property rather than to its note. The run stops at the first thing that is
 * neither: a newline ends it, so a comment on the next line is left alone.
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
 * spells there), or just inside the `{` when it has no properties yet.
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
function detachTrailingNote({
  text,
  path,
}: {
  text: string;
  path: readonly string[];
}): { text: string; note: string; anchorKey: string | undefined } | undefined {
  const root = parseTree(text, [], { allowTrailingComma: true });
  const object = root === undefined ? undefined : findNodeAtLocation(root, [...path]);
  if (object?.type !== "object") return undefined;
  const property = object.children?.at(-1);
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
 * Put a note detached by {@link detachTrailingNote} back where it was: after
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
 * Write `value` at `[...path, key]`, keeping the trailing note of the property
 * the new key is inserted after (see {@link detachTrailingNote}). Replacing an
 * existing key needs none of this: `modify` rewrites the value's own span and
 * leaves every comment where it is.
 */
function insertJsoncProperty({
  text,
  path,
  key,
  value,
  options,
}: {
  text: string;
  path: readonly string[];
  key: string;
  value: unknown;
  options: JsoncModificationOptions;
}): string {
  const write = (source: string): string =>
    applyEdits(source, modify(source, [...path, key], value, options));
  const detached = detachTrailingNote({ text, path });
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
 * files, so the shape is left simple rather than batched.
 */
function applyJsoncObjectEdits({
  text,
  base,
  next,
  path,
  options,
}: {
  text: string;
  base: Record<string, unknown>;
  next: SharedConfigDocument;
  path: readonly string[];
  options: JsoncModificationOptions;
}): string {
  let result = text;
  for (const [key, value] of Object.entries(next)) {
    // Never reachable through the gateway (both the parsed base and every
    // merge policy drop these), but this walker writes straight into the
    // user's file, so it does not rely on its callers to have done that.
    if (PROTOTYPE_POLLUTION_KEYS.has(key)) continue;
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
      });
      continue;
    }
    if (present) {
      if (isDeepStrictEqual(previous, value)) continue;
      result = applyEdits(result, modify(result, [...path, key], value, options));
      continue;
    }
    result = insertJsoncProperty({ text: result, path, key, value, options });
  }
  for (const key of Object.keys(base)) {
    if (!Object.hasOwn(next, key)) {
      result = removeJsoncProperty({ text: result, path: [...path, key] });
    }
  }
  return result;
}

/**
 * Serialize a document back over the file it was parsed from.
 *
 * For every format but JSONC this is {@link stringifySharedConfig}: those
 * files carry no comments, so re-serializing loses nothing. A JSONC file does
 * carry comments — `.vscode/settings.json` and `opencode.json` are hand-edited
 * far more often than they are generated — and re-serializing would delete
 * every one of them, along with the author's blank lines and key order. So a
 * JSONC document is written back as a set of edits against the existing text:
 * regions the merge did not change stay byte-identical, and a regeneration
 * that changes nothing leaves the file untouched.
 *
 * The whole-document writer is still used when there is nothing to preserve or
 * nothing to edit against:
 *
 * - an empty (or whitespace-only) file, which has no comments to keep;
 * - a file that does not parse, or whose root is not an object — editing it
 *   would mean guessing at the author's intent, and the callers that reach
 *   here have already decided (via `invalidRootPolicy`) that such a file is
 *   replaced;
 * - a file stating the same key twice, or using `__proto__`, `constructor` or
 *   `prototype` as a key (see {@link statesUneditableKeys}).
 */
export function serializeSharedConfig({
  format,
  document,
  existingContent,
}: {
  format: SharedConfigFormat;
  document: SharedConfigDocument;
  existingContent: string;
}): string {
  if (format !== "jsonc" || existingContent.trim() === "") {
    return stringifySharedConfig({ format, document });
  }

  // One parse, as a syntax tree: it answers everything this path asks of the
  // file — whether it is well-formed, what it says, where its indentation is,
  // and whether it states a key an edit cannot be trusted with. Parsing the
  // text again for the value would mean a second parser and a second
  // sanitizer deciding what the document says, and the two silently drifting
  // apart would make the diff below miss a change rulesync means to write.
  const errors: JsoncParseError[] = [];
  const root = parseTree(existingContent, errors, { allowTrailingComma: true });
  if (
    root === undefined ||
    errors.length > 0 ||
    root.type !== "object" ||
    statesUneditableKeys(root)
  ) {
    return stringifySharedConfig({ format, document });
  }

  const base = sanitizeSharedConfigValue(getNodeValue(root));
  if (!isPlainObject(base)) {
    return stringifySharedConfig({ format, document });
  }

  return applyJsoncObjectEdits({
    text: existingContent,
    base,
    next: document,
    path: [],
    options: { formattingOptions: detectJsoncFormattingOptions({ text: existingContent, root }) },
  });
}

// ---------------------------------------------------------------------------
// Conflict policies
// ---------------------------------------------------------------------------

/**
 * Shallow merge: every top-level key in `patch` replaces the base key
 * wholesale; all other base keys are preserved. The policy for a feature that
 * owns a fixed set of top-level keys.
 */
export function mergeSharedConfigShallow({
  base,
  patch,
}: {
  base: SharedConfigDocument;
  patch: SharedConfigDocument;
}): SharedConfigDocument {
  return { ...base, ...(sanitizeSharedConfigValue(patch) as SharedConfigDocument) };
}

/**
 * Deep merge (`patch` wins): nested plain objects are merged key-by-key; every
 * other value (arrays, scalars) is replaced wholesale. The policy for a
 * feature whose contribution interleaves with user-authored siblings at any
 * depth (e.g. permissions overlays onto `approvals`/`security` structures, or
 * per-provider option tables) — nested sibling keys are preserved by
 * construction instead of by per-tool re-implementation. Prototype-pollution
 * keys are dropped.
 */
export function mergeSharedConfigDeep({
  base,
  patch,
}: {
  base: SharedConfigDocument;
  patch: SharedConfigDocument;
}): SharedConfigDocument {
  const result: SharedConfigDocument = { ...base };
  for (const [key, patchValue] of Object.entries(patch)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(key)) continue;
    if (patchValue === undefined) {
      // Retraction, spelled the same way `replace-owned-keys` spells it. Leaving
      // the key with an `undefined` value happens to disappear from YAML and
      // JSON output, but `smol-toml` throws on it.
      delete result[key];
      continue;
    }
    const baseValue = result[key];
    if (isPlainObject(baseValue) && isPlainObject(patchValue)) {
      result[key] = mergeSharedConfigDeep({ base: baseValue, patch: patchValue });
    } else {
      result[key] = sanitizeSharedConfigValue(patchValue);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Ownership declarations
// ---------------------------------------------------------------------------

export type SharedConfigConflictPolicy =
  | {
      /** The feature owns `ownedKeys` outright; a patch may only set those. */
      readonly kind: "replace-owned-keys";
      readonly ownedKeys: readonly string[];
    }
  | {
      /**
       * The feature's patch deep-merges into the document; `replaceKeys` are
       * authoritative snapshots replaced wholesale (a deep merge would
       * resurrect entries the user deleted from the rulesync source).
       */
      readonly kind: "deep-merge";
      readonly replaceKeys?: readonly string[];
    }
  | {
      /**
       * The merge needs entry-level ownership rules that the generic policies
       * cannot express; `policyFunction` names the exported function in this
       * module that implements it.
       */
      readonly kind: "custom";
      readonly policyFunction: string;
    };

export type SharedConfigFileDeclaration = {
  readonly format: SharedConfigFormat;
  readonly invalidRootPolicy?: SharedConfigInvalidRootPolicy;
  readonly jsoncParseErrors?: SharedConfigJsoncParseErrorsPolicy;
  readonly features: Partial<Record<Feature, SharedConfigConflictPolicy>>;
};

// `dir/file` tokens matching `deriveSharedFileWriters()` — always POSIX
// separators, independent of the platform-specific path constants.
export const CLAUDE_SETTINGS_SHARED_FILE_KEY = ".claude/settings.json";
export const HERMES_CONFIG_SHARED_FILE_KEY = ".hermes/config.yaml";
export const HERMES_WIN32_CONFIG_SHARED_FILE_KEY = "AppData/Local/hermes/config.yaml";
export const HERMES_HOME_CONFIG_SHARED_FILE_KEY = "config.yaml";
export const TAKT_CONFIG_SHARED_FILE_KEY = ".takt/config.yaml";
export const CODEXCLI_CONFIG_SHARED_FILE_KEY = ".codex/config.toml";
export const GROKCLI_CONFIG_SHARED_FILE_KEY = ".grok/config.toml";
export const VIBE_CONFIG_SHARED_FILE_KEY = ".vibe/config.toml";
export const KIMI_CODE_CONFIG_SHARED_FILE_KEY = ".kimi-code/config.toml";
export const KIMI_CODE_HOME_CONFIG_SHARED_FILE_KEY = "config.toml";
export const REASONIX_PROJECT_CONFIG_SHARED_FILE_KEY = "reasonix.toml";
export const REASONIX_GLOBAL_CONFIG_SHARED_FILE_KEY = ".reasonix/config.toml";
export const ROVODEV_CONFIG_SHARED_FILE_KEY = ".rovodev/config.yml";

/**
 * Build the `SHARED_CONFIG_OWNERSHIP` lookup key from a tool's settable paths.
 * Mirrors `sharedFileKey` in `src/lib/shared-file-derive.ts` (kept separate so
 * feature classes don't pull the processor registry through this module and
 * create an import cycle); the ownership lock-step test keeps the two aligned.
 * Lets a tool whose file lives at a scope-dependent path (`.zed/settings.json`
 * vs `.config/zed/settings.json`) resolve its declaration from the settable
 * paths it already holds.
 */
export const sharedConfigFileKey = ({
  relativeDirPath,
  relativeFilePath,
}: {
  relativeDirPath: string;
  relativeFilePath: string;
}): string => {
  const dir = relativeDirPath.replace(/\\/g, "/").replace(/\/$/, "");
  const file = relativeFilePath.replace(/\\/g, "/");
  return dir === "" || dir === "." ? file : `${dir}/${file}`;
};

/**
 * Who owns what in each gateway-managed shared config file, and which policy
 * resolves conflicts. Keys are `dir/file` tokens matching
 * `deriveSharedFileWriters()`; a test keeps each entry's feature set in
 * lock-step with the writers derived from the processor registry, so an
 * undeclared writer fails CI instead of merging by accident.
 */
/**
 * Hermes writes one `config.yaml`, but its global profile root has three
 * spellings (`~/.hermes`, the win32 `%LOCALAPPDATA%\hermes`, and `HERMES_HOME`
 * itself). They are the same file with the same owners, so the declaration is
 * written once and shared — a policy edit cannot land on one spelling only.
 */
const HERMES_CONFIG_DECLARATION: SharedConfigFileDeclaration = {
  format: "yaml",
  features: {
    // The plugins block is recomputed from the existing file (enabled list
    // appended) before being applied, so the whole key is owned here.
    commands: { kind: "replace-owned-keys", ownedKeys: ["plugins"] },
    subagents: { kind: "replace-owned-keys", ownedKeys: ["plugins"] },
    mcp: { kind: "replace-owned-keys", ownedKeys: ["mcp_servers"] },
    // rulesync owns the native event keys inside `hooks`, not the whole
    // mapping — v0.20.0 nests the `outbound:` webhook registry there too. The
    // hooks writer recomputes the mapping from the existing file (sibling keys
    // carried over, event keys replaced) before patching, the same way the
    // `plugins` writers above recompute their key.
    hooks: { kind: "replace-owned-keys", ownedKeys: ["hooks"] },
    // Deep-merged so `approvals.mode`-style user keys coexist with generated
    // `approvals.deny`; the `permissions` round-trip blob is an authoritative
    // snapshot and must not resurrect deleted rules.
    permissions: { kind: "deep-merge", replaceKeys: ["permissions"] },
  },
};

/**
 * Kimi Code's user config: hooks owns the flat `hooks` array; permissions owns
 * the ordered rule list and optional coarse default mode. `KIMI_CODE_HOME` can
 * name the profile directory itself, so the file has two spellings that share
 * one declaration — a policy edit cannot land on only one of them.
 */
const KIMI_CODE_CONFIG_DECLARATION: SharedConfigFileDeclaration = {
  format: "toml",
  invalidRootPolicy: "error",
  features: {
    hooks: { kind: "replace-owned-keys", ownedKeys: ["hooks"] },
    // `mcp` holds the global default MCP timeouts; the servers themselves
    // live in `mcp.json`, so this feature reaches the file as an auxiliary
    // writer (same shape as vibe hooks above).
    mcp: { kind: "replace-owned-keys", ownedKeys: ["mcp"] },
    permissions: {
      kind: "replace-owned-keys",
      // `tools` is Kimi's global tool allow/deny switch, a second enforcement
      // layer alongside `permission.rules`.
      ownedKeys: ["permission", "default_permission_mode", "tools"],
    },
  },
};

/**
 * ZCode's settings file, which also carries model/theme/permission keys
 * rulesync does not own. The workspace copy (`<project>/.zcode/config.json`)
 * and the user copy (`~/.zcode/cli/config.json`) are the same file with the
 * same owners, so the declaration is written once and shared — a policy edit
 * cannot land on one scope only. `mcp` is owned as a whole key because the
 * writer recomputes it from the existing file (non-`servers` siblings carried
 * over) before applying the patch.
 */
const ZCODE_CONFIG_DECLARATION: SharedConfigFileDeclaration = {
  format: "json",
  // The user's primary ZCode config: refuse to read-modify-write a file we
  // could not parse rather than replacing it with generated output.
  invalidRootPolicy: "error",
  features: {
    mcp: { kind: "replace-owned-keys", ownedKeys: ["mcp"] },
  },
};

export const SHARED_CONFIG_OWNERSHIP: Readonly<Record<string, SharedConfigFileDeclaration>> = {
  [CLAUDE_SETTINGS_SHARED_FILE_KEY]: {
    format: "json",
    features: {
      // `Read(...)` deny entries inside `permissions.deny` are owned by ignore;
      // the permissions feature's explicit rules win over them (with a warning).
      // That entry-level rule lives in applyIgnoreReadDenies/applyPermissions.
      ignore: { kind: "custom", policyFunction: "applyIgnoreReadDenies" },
      hooks: { kind: "replace-owned-keys", ownedKeys: ["hooks"] },
      permissions: { kind: "custom", policyFunction: "applyPermissions" },
    },
  },
  [HERMES_CONFIG_SHARED_FILE_KEY]: HERMES_CONFIG_DECLARATION,
  [HERMES_WIN32_CONFIG_SHARED_FILE_KEY]: HERMES_CONFIG_DECLARATION,
  [HERMES_HOME_CONFIG_SHARED_FILE_KEY]: HERMES_CONFIG_DECLARATION,
  [TAKT_CONFIG_SHARED_FILE_KEY]: {
    format: "yaml",
    // config.yaml is the user's primary Takt config; refusing to parse a
    // non-mapping beats silently replacing their file with generated output.
    invalidRootPolicy: "error",
    features: {
      mcp: { kind: "replace-owned-keys", ownedKeys: [TAKT_WORKFLOW_MCP_SERVERS_KEY] },
      // The whole `workflow_overrides` block is derived from `.rulesync/checks/`,
      // so it is replaced rather than merged: a gate deleted there must not
      // survive in config.yaml.
      checks: { kind: "replace-owned-keys", ownedKeys: [TAKT_WORKFLOW_OVERRIDES_KEY] },
      // provider_profiles.<provider>.default_permission_mode plus the takt
      // override's step/provider tables merge into user config at depth;
      // deep-merge preserves nested sibling keys by construction.
      // The workflow security policies are authoritative snapshots of what the
      // rulesync source states: deep-merging them would keep a default-deny
      // capability switched on after the user revoked it.
      permissions: {
        kind: "deep-merge",
        replaceKeys: [
          "workflow_arpeggio",
          "workflow_runtime_prepare",
          "workflow_command_gates",
          "sync_conflict_resolver",
          "allow_git_hooks",
          "allow_git_filters",
        ],
      },
    },
  },
  // Zed settings: each feature holds an exclusive top-level key. `private_files`
  // is recomputed from `.rulesync/.aiignore` alone, so a pattern deleted there is
  // retracted here. Blocks whose final value depends on existing entries
  // (`agent.tool_permissions.tools` keeps user entries for unmanaged tools, and
  // `agent` siblings are carried over) are recomputed from the existing file
  // before being applied, so the whole key is owned here either way.
  ".zed/settings.json": {
    format: "json",
    features: {
      ignore: { kind: "replace-owned-keys", ownedKeys: ["private_files"] },
      mcp: { kind: "replace-owned-keys", ownedKeys: ["context_servers"] },
      permissions: { kind: "replace-owned-keys", ownedKeys: ["agent"] },
    },
  },
  // Global scope of the Zed settings above. `private_files` is a worktree
  // setting, so Zed reads it from the user settings file too.
  ".config/zed/settings.json": {
    format: "json",
    features: {
      ignore: { kind: "replace-owned-keys", ownedKeys: ["private_files"] },
      mcp: { kind: "replace-owned-keys", ownedKeys: ["context_servers"] },
      permissions: { kind: "replace-owned-keys", ownedKeys: ["agent"] },
    },
  },
  // The same global Zed settings under the Windows user config dir
  // (`%APPDATA%\Zed`), which `getZedGlobalDir()` resolves to on win32.
  "AppData/Roaming/Zed/settings.json": {
    format: "json",
    features: {
      ignore: { kind: "replace-owned-keys", ownedKeys: ["private_files"] },
      mcp: { kind: "replace-owned-keys", ownedKeys: ["context_servers"] },
      permissions: { kind: "replace-owned-keys", ownedKeys: ["agent"] },
    },
  },
  // Pi Coding Agent settings (`.pi/settings.json` project /
  // `~/.pi/agent/settings.json` global): a hand-edited file carrying `theme`,
  // `defaultModel`, `packages`, `sessionDir` and more. Permissions owns the one
  // repository-syncable tool gate, `defaultTools`.
  ".pi/settings.json": {
    format: "json",
    invalidRootPolicy: "error",
    features: {
      permissions: { kind: "replace-owned-keys", ownedKeys: ["defaultTools"] },
    },
  },
  ".pi/agent/settings.json": {
    format: "json",
    invalidRootPolicy: "error",
    features: {
      permissions: { kind: "replace-owned-keys", ownedKeys: ["defaultTools"] },
    },
  },
  // Copilot CLI repository settings (`.github/copilot/settings.json`, CLI
  // v1.0.60+): a committed, hand-edited file that also carries `model`,
  // `effortLevel`, `hooks` and other repository-scope keys rulesync does not
  // own. Only `deniedUrls` is owned — `allowedUrls` is not accepted at
  // repository scope upstream, so a hand-written one here is left alone rather
  // than retracted.
  ".github/copilot/settings.json": {
    format: "json",
    // The user's committed Copilot CLI config: refuse to read-modify-write a
    // file we could not parse rather than replacing it with generated output.
    invalidRootPolicy: "error",
    features: {
      permissions: { kind: "replace-owned-keys", ownedKeys: ["deniedUrls"] },
    },
  },
  // Copilot CLI user settings (`~/.copilot/settings.json`): the same file the
  // CLI writes its own preferences into, so only the two URL lists are owned.
  ".copilot/settings.json": {
    format: "json",
    invalidRootPolicy: "error",
    features: {
      permissions: { kind: "replace-owned-keys", ownedKeys: ["allowedUrls", "deniedUrls"] },
    },
  },
  // VS Code workspace settings (`.vscode/settings.json`): a general-purpose
  // user/project settings file. Copilot permissions owns only the three flat
  // dotted `chat.tools.*.autoApprove` keys (VS Code stores dotted setting keys
  // flat at the top level); every unrelated editor setting is preserved by the
  // shallow merge. The Copilot MCP feature writes a SEPARATE file
  // (`.vscode/mcp.json`, declared just below).
  //
  // Three targets reach this file through the same `permissions` feature —
  // `copilot` (the `chat.tools.*` keys), `zoocode` (the `zoo-code.*` command
  // lists) and `roo` (the same lists under the archived lineage's `roo-cline.*`
  // spelling) — so `ownedKeys` is their union. They stay independent because a
  // patch only ever names the keys its own adapter builds: generating for one
  // target never mentions the other's keys, and a key is dropped only when its
  // own adapter explicitly retracts it (patch value `undefined`).
  ".vscode/settings.json": {
    format: "jsonc",
    // A general-purpose user file we promise to preserve untouched apart from
    // the one managed key. Refuse to read-modify-write a file we could not
    // fully parse (fail-closed), so a partial JSONC parse can never silently
    // drop unrelated user settings on the write-back — mirroring `.amp/`.
    invalidRootPolicy: "error",
    jsoncParseErrors: "error",
    features: {
      permissions: {
        kind: "replace-owned-keys",
        ownedKeys: [
          "chat.tools.terminal.autoApprove",
          "chat.tools.edits.autoApprove",
          "chat.tools.urls.autoApprove",
          "zoo-code.allowedCommands",
          "zoo-code.deniedCommands",
          "roo-cline.allowedCommands",
          "roo-cline.deniedCommands",
        ],
      },
    },
  },
  // VS Code MCP config (`.vscode/mcp.json`): a JSONC file VS Code recommends
  // committing. It has three documented top-level sections — `servers` (the one
  // rulesync owns), `inputs` (secret prompts referenced as `${input:id}`) and
  // `sandbox` (filesystem/network rules for sandboxed servers). Dropping an
  // `inputs` entry would leave `${input:…}` unresolvable and the affected
  // servers would fail to start, so everything but `servers` is preserved.
  // VS Code's own "MCP: Add Server" scaffold starts with a comment line, hence
  // the `jsonc` format.
  // https://code.visualstudio.com/docs/agents/reference/mcp-configuration
  ".vscode/mcp.json": {
    format: "jsonc",
    // Fail-closed like `.vscode/settings.json`: never read-modify-write a file
    // we could not fully parse, so a partial parse cannot silently drop the
    // user's `inputs` / `sandbox` on the write-back.
    invalidRootPolicy: "error",
    jsoncParseErrors: "error",
    features: {
      mcp: { kind: "replace-owned-keys", ownedKeys: ["servers"] },
    },
  },
  // Qwen Code settings: `permissions` is recomputed from the existing file
  // (unmanaged-tool entries preserved, managed ones replaced) before being
  // applied, and so are the `tools`/`security` override groups. Keys like
  // `disableAllHooks` are only present in the patch when authored, so an
  // existing user value survives an unrelated regeneration.
  ".qwen/settings.json": {
    format: "json",
    features: {
      mcp: { kind: "replace-owned-keys", ownedKeys: ["mcpServers"] },
      hooks: { kind: "replace-owned-keys", ownedKeys: ["hooks", "disableAllHooks"] },
      permissions: {
        kind: "replace-owned-keys",
        ownedKeys: ["permissions", "tools", "security"],
      },
    },
  },
  // AugmentCode settings: `toolPermissions` is recomputed from the existing
  // file (special entries and fail-closed denies preserved) before being
  // applied.
  ".augment/settings.json": {
    format: "json",
    features: {
      mcp: { kind: "replace-owned-keys", ownedKeys: ["mcpServers"] },
      hooks: { kind: "replace-owned-keys", ownedKeys: ["hooks"] },
      permissions: { kind: "replace-owned-keys", ownedKeys: ["toolPermissions"] },
    },
  },
  // Devin config: `permissions` is recomputed from the existing file
  // (unmanaged-scope entries preserved) before being applied. Hooks are
  // global-scope-only, so they appear only under `.config/devin/`. MCP left
  // this file in v3000.3 for the dedicated (rulesync-owned) mcp_config.json.
  ".devin/config.json": {
    format: "json",
    features: {
      permissions: { kind: "replace-owned-keys", ownedKeys: ["permissions"] },
    },
  },
  ".config/devin/config.json": {
    format: "json",
    features: {
      hooks: { kind: "replace-owned-keys", ownedKeys: ["hooks"] },
      permissions: { kind: "replace-owned-keys", ownedKeys: ["permissions"] },
    },
  },
  // Muse Code user settings (`~/.config/muse/settings.json`): mcp is its only
  // writer (Muse Code documents no project-scoped MCP location; hooks live in
  // `.muse/hooks.json`, which is not emitted). Declared anyway so the write
  // goes through the same codec and ownership enforcement, like the global
  // kilo config. `schema_version` is co-owned because the file is unusable
  // without it — Muse Code fails startup with `malformed settings file` — so
  // the mcp writer bootstraps it on file creation (an existing value is
  // carried over before the patch is applied, so the whole key is owned here).
  ".config/muse/settings.json": {
    format: "json",
    // The user's primary Muse Code config: refuse to read-modify-write a file
    // we could not parse rather than replacing it with generated output.
    invalidRootPolicy: "error",
    features: {
      mcp: { kind: "replace-owned-keys", ownedKeys: ["mcp_servers", "schema_version"] },
    },
  },
  ".zcode/config.json": ZCODE_CONFIG_DECLARATION,
  ".zcode/cli/config.json": ZCODE_CONFIG_DECLARATION,
  // Kiro agent config: `allowedTools`/`toolsSettings` are recomputed from the
  // existing file (existing tools and settings folded in) before being applied.
  ".kiro/agents/default.json": {
    format: "json",
    features: {
      hooks: { kind: "replace-owned-keys", ownedKeys: ["hooks"] },
      permissions: { kind: "replace-owned-keys", ownedKeys: ["allowedTools", "toolsSettings"] },
    },
  },
  // Amp settings (`settings.json`, or a hand-authored `settings.jsonc` twin the
  // writers probe for — both resolve to this declaration via the settable
  // paths). Keys are Amp's literal dotted names. `amp.permissions` is
  // recomputed from the existing file (fail-closed first-match-wins ordering,
  // authored/delegate entries folded in) before being applied, and is retracted
  // when the merge yields no entries. Amp's writers have always refused to
  // write over a file they could not fully parse, hence the strict policies.
  ".amp/settings.json": {
    format: "jsonc",
    invalidRootPolicy: "error",
    jsoncParseErrors: "error",
    features: {
      mcp: { kind: "replace-owned-keys", ownedKeys: ["amp.mcpServers"] },
      permissions: {
        kind: "replace-owned-keys",
        ownedKeys: [
          "amp.tools.disable",
          "amp.permissions",
          "amp.guardedFiles.allowlist",
          "amp.dangerouslyAllowAll",
          "amp.mcpPermissions",
        ],
      },
    },
  },
  ".config/amp/settings.json": {
    format: "jsonc",
    invalidRootPolicy: "error",
    jsoncParseErrors: "error",
    features: {
      mcp: { kind: "replace-owned-keys", ownedKeys: ["amp.mcpServers"] },
      permissions: {
        kind: "replace-owned-keys",
        ownedKeys: [
          "amp.tools.disable",
          "amp.permissions",
          "amp.guardedFiles.allowlist",
          "amp.dangerouslyAllowAll",
          "amp.mcpPermissions",
        ],
      },
    },
  },
  // OpenCode config (`opencode.json`, or the preferred `opencode.jsonc` twin —
  // both resolve here via the settable paths). `tools` is retracted when the
  // generated MCP servers yield no tool filters; `permission` and
  // `instructions` are recomputed from source/existing content before being
  // applied. Rules (`instructions`) are registered at both scopes.
  "opencode.json": {
    format: "jsonc",
    features: {
      mcp: { kind: "replace-owned-keys", ownedKeys: ["mcp", "tools"] },
      permissions: { kind: "replace-owned-keys", ownedKeys: ["permission"] },
      rules: { kind: "replace-owned-keys", ownedKeys: ["instructions"] },
    },
  },
  ".config/opencode/opencode.json": {
    format: "jsonc",
    features: {
      mcp: { kind: "replace-owned-keys", ownedKeys: ["mcp", "tools"] },
      permissions: { kind: "replace-owned-keys", ownedKeys: ["permission"] },
      // OpenCode reads `instructions` from the global config too; the rules
      // feature registers global non-root rules here (recomputed from the
      // existing list before being applied, like the project-scope entry).
      rules: { kind: "replace-owned-keys", ownedKeys: ["instructions"] },
    },
  },
  // Kilo config (`kilo.json` / preferred `kilo.jsonc` twin) — same shape as
  // OpenCode: `tools` is retracted when empty, `instructions` is recomputed
  // from the existing list before being applied.
  "kilo.json": {
    format: "jsonc",
    features: {
      mcp: { kind: "replace-owned-keys", ownedKeys: ["mcp", "tools"] },
      rules: { kind: "replace-owned-keys", ownedKeys: ["instructions"] },
    },
  },
  // Global Kilo config: mcp is its only writer (rules registers instructions in
  // project scope only), so this is not cross-feature shared — it is declared
  // anyway so the write goes through the same codec and ownership enforcement.
  ".config/kilo/kilo.json": {
    format: "jsonc",
    features: {
      mcp: { kind: "replace-owned-keys", ownedKeys: ["mcp", "tools"] },
    },
  },
  // Goose user config (`~/.config/goose/config.yaml`): the file holds the
  // user's model/provider settings alongside `extensions:`, and `extensions:`
  // itself is co-owned — Goose's `builtin`/`platform` extensions (`developer`,
  // `memory`, ...) live there next to the MCP servers rulesync manages. The
  // block is recomputed from the existing file (non-MCP extensions carried
  // over) before being applied, so the whole key is owned here.
  ".config/goose/config.yaml": {
    format: "yaml",
    // The user's primary Goose config: refuse to read-modify-write a file we
    // could not parse rather than replacing it with generated output.
    invalidRootPolicy: "error",
    features: {
      mcp: { kind: "replace-owned-keys", ownedKeys: ["extensions"] },
      // `slash_commands` registers generated recipes as `/name` commands. It is
      // co-owned the same way: the list is recomputed from the existing file
      // (entries pointing outside the rulesync-managed recipes directory carried
      // over) before being applied, so the whole key is owned here.
      commands: { kind: "replace-owned-keys", ownedKeys: ["slash_commands"] },
    },
  },
  // Codex CLI config: hooks/mcp/permissions each own an exclusive top-level
  // key. `features` (hooks' legacy `codex_hooks` cleanup) and `mcp_servers`
  // (per-server approval-state preservation) are recomputed from the existing
  // file before being applied, so the whole key is owned here.
  [CODEXCLI_CONFIG_SHARED_FILE_KEY]: {
    format: "toml",
    features: {
      hooks: { kind: "replace-owned-keys", ownedKeys: ["features"] },
      mcp: { kind: "replace-owned-keys", ownedKeys: ["mcp_servers"] },
      permissions: {
        kind: "replace-owned-keys",
        ownedKeys: ["permissions", "default_permissions", ...CODEXCLI_OVERRIDE_KEYS],
      },
    },
  },
  // Grok Build CLI config: mcp owns `mcp_servers`; permissions owns the
  // fine-grained `permission` allow/ask/deny arrays and the coarse `ui`
  // fallback. Both are recomputed from the existing file (unmanaged entries
  // preserved) before being applied.
  [GROKCLI_CONFIG_SHARED_FILE_KEY]: {
    format: "toml",
    features: {
      mcp: { kind: "replace-owned-keys", ownedKeys: ["mcp_servers"] },
      permissions: { kind: "replace-owned-keys", ownedKeys: ["permission", "ui"] },
    },
  },
  // Mistral Vibe config: mcp
  // owns `mcp_servers`; permissions owns `tools`/`enabled_tools`/`disabled_tools`.
  // `tools` is recomputed from the existing file (unmanaged tool entries and
  // sensitive-pattern overrides preserved) before being applied.
  [VIBE_CONFIG_SHARED_FILE_KEY]: {
    format: "toml",
    features: {
      mcp: { kind: "replace-owned-keys", ownedKeys: ["mcp_servers"] },
      permissions: {
        kind: "replace-owned-keys",
        ownedKeys: ["tools", "enabled_tools", "disabled_tools"],
      },
    },
  },
  [KIMI_CODE_CONFIG_SHARED_FILE_KEY]: KIMI_CODE_CONFIG_DECLARATION,
  [KIMI_CODE_HOME_CONFIG_SHARED_FILE_KEY]: KIMI_CODE_CONFIG_DECLARATION,
  // Reasonix project config (`./reasonix.toml`): mcp owns `plugins`;
  // permissions owns `permissions`/`sandbox`/`agent`. All three are recomputed
  // from the existing file (unmanaged entries and sibling override keys
  // preserved) before being applied. `ignore` writes `Read(...)` entries into
  // `permissions.deny` under the same entry-level rule as `.claude/settings.json`
  // — Reasonix's `[permissions]` table is documented as Claude-Code-style.
  [REASONIX_PROJECT_CONFIG_SHARED_FILE_KEY]: {
    format: "toml",
    features: {
      ignore: { kind: "custom", policyFunction: "applyIgnoreReadDenies" },
      mcp: { kind: "replace-owned-keys", ownedKeys: ["plugins"] },
      permissions: { kind: "replace-owned-keys", ownedKeys: ["permissions", "sandbox", "agent"] },
    },
  },
  // Reasonix global config (`~/.reasonix/config.toml`) — same shape as the
  // project file above.
  [REASONIX_GLOBAL_CONFIG_SHARED_FILE_KEY]: {
    format: "toml",
    features: {
      ignore: { kind: "custom", policyFunction: "applyIgnoreReadDenies" },
      mcp: { kind: "replace-owned-keys", ownedKeys: ["plugins"] },
      permissions: { kind: "replace-owned-keys", ownedKeys: ["permissions", "sandbox", "agent"] },
    },
  },
  [ROVODEV_CONFIG_SHARED_FILE_KEY]: {
    format: "yaml",
    features: {
      // The `mcp` block is recomputed from the existing file before being
      // applied (`disabledMcpServers` is rulesync-managed, and `mcpConfigPath`
      // is authored in project scope when it is absent; user keys like
      // `allowedMcpServers` — and a `mcpConfigPath` the user set — are carried
      // over), so the whole key is owned here — same shape as the Hermes
      // plugins writer. The servers themselves live in `mcp.json`; this
      // feature reaches the file as an auxiliary writer.
      mcp: { kind: "replace-owned-keys", ownedKeys: ["mcp"] },
      // Likewise recomputed: the generated levels are merged over the existing
      // `toolPermissions` block before the patch is applied.
      permissions: { kind: "replace-owned-keys", ownedKeys: ["toolPermissions"] },
    },
  },
};

/**
 * Execute a feature's declared write to a gateway-managed shared file: parse
 * the existing content, merge the patch under the feature's declared policy,
 * and serialize it back over the existing content (see
 * {@link serializeSharedConfig}, which keeps a JSONC file's comments and
 * formatting outside the spans the merge actually changed). Throws when the
 * file or feature is undeclared, when a
 * `replace-owned-keys` patch strays outside its owned keys, or when the
 * feature's policy is `custom` (those calls go to the named policy function
 * instead).
 */
export function applySharedConfigPatch({
  fileKey,
  feature,
  existingContent,
  patch,
  filePath,
}: {
  fileKey: string;
  feature: Feature;
  existingContent: string;
  patch: SharedConfigDocument;
  filePath?: string | undefined;
}): string {
  const declaration = SHARED_CONFIG_OWNERSHIP[fileKey];
  if (!declaration) {
    throw new Error(
      `Shared config file '${fileKey}' has no SHARED_CONFIG_OWNERSHIP declaration; ` +
        `declare its writers and policies before writing it through the gateway.`,
    );
  }
  const policy = declaration.features[feature];
  if (!policy) {
    throw new Error(
      `Feature '${feature}' declares no ownership of '${fileKey}'; ` +
        `add it to SHARED_CONFIG_OWNERSHIP before writing.`,
    );
  }
  if (policy.kind === "custom") {
    throw new Error(
      `Feature '${feature}' writes '${fileKey}' through its dedicated policy function ` +
        `'${policy.policyFunction}' in shared-config-gateway.ts, not applySharedConfigPatch.`,
    );
  }

  const base = parseSharedConfig({
    format: declaration.format,
    fileContent: existingContent,
    filePath,
    ...(declaration.invalidRootPolicy !== undefined && {
      invalidRootPolicy: declaration.invalidRootPolicy,
    }),
    ...(declaration.jsoncParseErrors !== undefined && {
      jsoncParseErrors: declaration.jsoncParseErrors,
    }),
  });

  if (policy.kind === "replace-owned-keys") {
    const unowned = Object.keys(patch).filter((key) => !policy.ownedKeys.includes(key));
    if (unowned.length > 0) {
      throw new Error(
        `Feature '${feature}' tried to write undeclared keys [${unowned.join(", ")}] to ` +
          `'${fileKey}'; extend its ownedKeys declaration if that ownership is intended.`,
      );
    }
    // An owned key set to `undefined` is removed from the document — the way a
    // feature retracts a key it owns (e.g. a regeneration that yields no
    // entries) without ever being able to touch keys it doesn't own.
    const document = mergeSharedConfigShallow({ base, patch });
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) {
        delete document[key];
      }
    }
    return serializeSharedConfig({ format: declaration.format, document, existingContent });
  }

  const merged = mergeSharedConfigDeep({ base, patch });
  for (const key of policy.replaceKeys ?? []) {
    if (patch[key] !== undefined) {
      merged[key] = sanitizeSharedConfigValue(patch[key]);
    }
  }
  return serializeSharedConfig({
    format: declaration.format,
    document: merged,
    existingContent,
  });
}

// ---------------------------------------------------------------------------
// `.claude/settings.json` custom policy
// ---------------------------------------------------------------------------
// Both `ignore` (writes `Read(...)` into `permissions.deny`) and `permissions`
// (writes the whole `allow`/`ask`/`deny`) read-modify-write the `permissions`
// block. The entry format, the merge, and the cross-feature ownership rule
// (permissions' explicit `Read` rules win over ignore-derived `Read` denies)
// live here once so each feature just states its intent and never reasons
// about the other's existence.

const READ_TOOL_NAME = "Read";

export const isReadDenyEntry = (entry: string): boolean =>
  entry.startsWith(`${READ_TOOL_NAME}(`) && entry.endsWith(")");

export const buildReadDenyEntry = (pattern: string): string => `${READ_TOOL_NAME}(${pattern})`;

const parsePermissionsBlock = (
  settings: ClaudeSettingsJson,
): { allow: string[]; ask: string[]; deny: string[] } => {
  const permissions = settings.permissions ?? {};
  return {
    allow: permissions.allow ?? [],
    ask: permissions.ask ?? [],
    deny: permissions.deny ?? [],
  };
};

// Empty arrays are omitted so the file never carries an empty allow/ask/deny key.
// Other top-level keys (e.g. `hooks`) and other keys under `permissions` are kept.
const withPermissions = (
  settings: ClaudeSettingsJson,
  next: { allow: string[]; ask: string[]; deny: string[] },
): ClaudeSettingsJson => {
  const permissions: Record<string, unknown> = { ...settings.permissions };
  const assign = (key: "allow" | "ask" | "deny", values: string[]): void => {
    if (values.length > 0) {
      permissions[key] = values;
    } else {
      delete permissions[key];
    }
  };
  assign("allow", next.allow);
  assign("ask", next.ask);
  assign("deny", next.deny);
  return { ...settings, permissions };
};

// Non-`Read` deny entries belong to the permissions feature and are preserved;
// `Read(...)` denies are replaced wholesale since the ignore source owns them.
export const applyIgnoreReadDenies = (params: {
  settings: ClaudeSettingsJson;
  readDenies: string[];
}): ClaudeSettingsJson => {
  const { settings, readDenies } = params;
  const current = parsePermissionsBlock(settings);
  const preservedDeny = current.deny.filter(
    (entry) => !isReadDenyEntry(entry) || readDenies.includes(entry),
  );
  return withPermissions(settings, {
    allow: current.allow,
    ask: current.ask,
    deny: uniq([...preservedDeny, ...readDenies].toSorted()),
  });
};

// Entries for managed tools are replaced; entries for unmanaged tools are kept.
// When `Read` is managed, permissions' rules win over ignore-derived `Read(...)`
// denies — those are overwritten, and the overwrite is warned about if a logger
// is given.
export const applyPermissions = (params: {
  settings: ClaudeSettingsJson;
  managedToolNames: ReadonlySet<string>;
  toolNameOf: (entry: string) => string;
  allow: string[];
  ask: string[];
  deny: string[];
  logger?: Logger | undefined;
}): ClaudeSettingsJson => {
  const { settings, managedToolNames, toolNameOf, allow, ask, deny, logger } = params;
  const current = parsePermissionsBlock(settings);

  // An entry this run emits is this run's to place, whatever list it currently
  // sits in — otherwise flipping a rule from deny to allow would leave the old
  // deny behind and win. Narrower than claiming its whole tool name, which
  // would also sweep up entries another feature or the user wrote: a tool name
  // is only claimed when the caller says the canonical config manages it.
  const emitted = new Set([...allow, ...ask, ...deny]);
  const keepUnmanaged = (entries: string[]): string[] =>
    entries.filter((entry) => !managedToolNames.has(toolNameOf(entry)) && !emitted.has(entry));

  if (logger && managedToolNames.has(READ_TOOL_NAME)) {
    const overwrittenReadDenies = current.deny.filter(
      (entry) => toolNameOf(entry) === READ_TOOL_NAME,
    );
    if (overwrittenReadDenies.length > 0) {
      logger.warn(
        `Permissions feature manages '${READ_TOOL_NAME}' tool and will overwrite ` +
          `${overwrittenReadDenies.length} existing ${READ_TOOL_NAME} deny entries. ` +
          `Permissions take precedence.`,
      );
    }
  }

  return withPermissions(settings, {
    allow: uniq([...keepUnmanaged(current.allow), ...allow].toSorted()),
    ask: uniq([...keepUnmanaged(current.ask), ...ask].toSorted()),
    deny: uniq([...keepUnmanaged(current.deny), ...deny].toSorted()),
  });
};
