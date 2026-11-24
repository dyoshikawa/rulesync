import { join } from "node:path";

import { dump } from "js-yaml";
import { dump as dumpYamlV4, load as loadYamlV4 } from "js-yaml-v4";
import type { z } from "zod/mini";

import type { ValidationResult } from "../types/ai-file.js";
import { type BoundedWalk, createBoundedWalk } from "./bounded-walk.js";
import { stripControlCharacters } from "./control-characters.js";
import { formatError } from "./error.js";
import { toPosixPath } from "./file.js";
import { warnOnceWithFallback } from "./logger.js";
import { isPrototypePollutionKey } from "./prototype-pollution.js";
import { isPlainObject } from "./type-guards.js";

/**
 * Upper bound on the number of values a frontmatter document may expand to
 * once every YAML alias is written out.
 *
 * A YAML alias makes one parsed container reachable from many keys, and the
 * cleaners below copy each reachable value, so a small file with a few levels
 * of nested aliases (an "alias bomb") can expand into megabytes of output or
 * exhaust the heap. Counting every visited value against this budget turns
 * that into an error instead. Real frontmatter is a handful of keys; even a
 * generous skill manifest stays orders of magnitude below the limit.
 */
export const MAX_FRONTMATTER_VALUES = 100_000;

/**
 * Upper bound on the total character count of string leaves a frontmatter
 * document may expand to.
 *
 * {@link MAX_FRONTMATTER_VALUES} bounds how many values are visited, but a
 * single long string aliased thousands of times still fits that budget while
 * the duplicated output balloons: one scalar of a few KB, chained through a
 * handful of aliases within the value budget, can multiply into a document
 * many megabytes larger than it started. Charging every visited string's
 * length against this separate budget bounds that output regardless of how
 * many aliases point at it.
 */
export const MAX_FRONTMATTER_STRING_CHARS = 4_000_000;

/**
 * Upper bound on how many containers deep a frontmatter document may nest.
 *
 * Both budgets above cap the *breadth* of the walk, but a chain of aliases
 * that each wrap the previous one (`a1: [*a0]`, `a2: [*a1]`, ...) is deep
 * rather than wide: it stays a small handful of values per level while
 * recursing one more stack frame per level. That overflows the JS call stack
 * well before either budget trips, turning a bounded document into an
 * unhandled `RangeError` instead of the intended refusal. Capping nesting
 * depth explicitly, far below where the stack would actually overflow, keeps
 * that failure mode a clear, recognizable error.
 *
 * The cap is also the only thing bounding an otherwise-uncharged cost: YAML
 * output indents every level, so a document sitting near the limit costs
 * several times more emitted bytes per value than a shallow one. Keeping this
 * cap itself small — well below the previous, far more generous limit — is
 * what bounds that worst case, since indentation width is not separately
 * charged against {@link MAX_FRONTMATTER_STRING_CHARS}. Real frontmatter
 * nests at most a few levels deep, so this still leaves generous headroom
 * while staying comfortably under js-yaml's own 100-level cap on raw
 * (non-aliased) nesting.
 */
export const MAX_FRONTMATTER_DEPTH = 64;

/**
 * Upper bound on the raw character length of the `---`-delimited frontmatter
 * block itself, checked before it is ever handed to the YAML parser.
 *
 * The budgets above only bound the *parsed* document — the walk over
 * the parser's output — but a complex YAML key (an array or mapping used as a
 * mapping key) is joined into a string by js-yaml while it parses, and a
 * mapping with many such keys can cost real memory before that walk ever
 * starts, or even before the parser returns. Capping the raw block size keeps
 * that parse-time cost bounded regardless of what the block contains. Real
 * frontmatter blocks are a few hundred bytes at most; even a large project
 * manifest stays well under this.
 */
export const MAX_FRONTMATTER_RAW_CHARS = 65_536;

type DeepCleanOptions = {
  /** Applied to every string leaf; the default keeps strings as they are. */
  transformString?: (value: string) => string;
  /**
   * The budgets, depth cap and descent path of this walk. A reference back
   * to a container on the path (a YAML anchor that aliases its own ancestor)
   * is a cycle and is dropped rather than walked until the stack overflows.
   */
  walk: BoundedWalk;
};

/**
 * Estimate the serialized character cost of a leaf that is not a string (a
 * string leaf is charged by its own length instead).
 *
 * js-yaml's default schema resolves `!!binary` scalars to a `Uint8Array`, and
 * its dumper writes one back out as base64 — roughly 4 output characters per
 * 3 input bytes. Without this, an aliased binary blob would walk the budget
 * for free even though it can dominate the emitted document's size.
 */
function estimateLeafChars(value: unknown): number {
  if (value instanceof Uint8Array) {
    return Math.ceil(value.byteLength / 3) * 4;
  }
  return 0;
}

/**
 * Copy one parsed value, dropping nullish leaves and cyclic references.
 *
 * Every alias is still written out as an independent copy, as js-yaml's
 * dumper would otherwise serialize shared references as `&ref_0`
 * anchors that simplified frontmatter parsers cannot read; the expansion is
 * bounded by {@link MAX_FRONTMATTER_VALUES} instead.
 */
function deepCleanValue(value: unknown, options: DeepCleanOptions): unknown {
  // Charge nullish leaves too: an aliased array of nulls would otherwise be
  // walked for free, and the walk is the work being bounded.
  const leafChars = typeof value === "string" ? value.length : estimateLeafChars(value);
  options.walk.chargeValue(leafChars);

  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value === "string") {
    return options.transformString ? options.transformString(value) : value;
  }

  if (Array.isArray(value)) {
    if (options.walk.isAncestor(value)) {
      return undefined;
    }
    options.walk.enter(value);
    const cleanedArray: unknown[] = [];
    for (const item of value) {
      const cleaned = deepCleanValue(item, options);
      if (cleaned !== undefined) {
        cleanedArray.push(cleaned);
      }
    }
    options.walk.leave(value);
    return cleanedArray;
  }

  if (isPlainObject(value)) {
    if (options.walk.isAncestor(value)) {
      return undefined;
    }
    options.walk.enter(value);
    const result = cleanOwnEntries(value, options);
    options.walk.leave(value);
    return result;
  }

  return value;
}

/**
 * Copy the cleaned own entries of a parsed object into a fresh record.
 *
 * A YAML parser defines a `__proto__:` key as an own property, and assigning
 * it back with bracket notation would instead replace the new record's
 * prototype, whose members zod's loose object schemas then promote to real
 * keys. So a fetched skill could hide `allowed-tools` under an innocuous
 * looking `__proto__:` block. That key, `constructor` and `prototype` are
 * therefore dropped rather than copied, and cannot be used as frontmatter
 * keys.
 */
function cleanOwnEntries(
  obj: Record<string, unknown>,
  options: DeepCleanOptions,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    // A YAML mapping key can itself be an alias, so its length has to be
    // charged against the character budget the same as a string leaf's; the
    // key is written into the output regardless of whether its value survives.
    options.walk.chargeChars(key.length);
    // Walk the value — and so charge its budget — even under a dropped
    // prototype-pollution key. Skipping the walk for `__proto__:` and its
    // siblings would let them hide an unbudgeted alias chain: free space to
    // build the rest of an attack cheaply, since nothing charged for visiting it.
    const cleaned = deepCleanValue(val, options);
    if (isPrototypePollutionKey(key)) {
      continue;
    }
    if (cleaned !== undefined) {
      result[key] = cleaned;
    }
  }
  return result;
}

function deepCleanObject(
  obj: Record<string, unknown> | null | undefined,
  options: Omit<DeepCleanOptions, "walk">,
): Record<string, unknown> {
  if (!obj || typeof obj !== "object") {
    return {};
  }
  return cleanOwnEntries(obj, {
    ...options,
    walk: createBoundedWalk({
      subject: "Frontmatter",
      limits: {
        maxValues: MAX_FRONTMATTER_VALUES,
        maxStringChars: MAX_FRONTMATTER_STRING_CHARS,
        maxDepth: MAX_FRONTMATTER_DEPTH,
      },
      // The root object is itself one level of nesting.
      root: obj,
    }),
  });
}

/** Drop null and undefined values, recursively. */
function deepRemoveNullishObject(
  obj: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  return deepCleanObject(obj, {});
}

/** Drop nullish values and collapse every string onto a single line. */
function deepFlattenStringsObject(
  obj: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  return deepCleanObject(obj, {
    transformString: (value) => value.replace(/\n+/g, " ").trim(),
  });
}

export type StringifyFrontmatterOptions = {
  /**
   * When true, ensures output avoids YAML block scalar indicators (>-, |-)
   * that simplified frontmatter parsers (e.g. Cursor) cannot handle.
   * Collapses newlines in string values and disables line wrapping.
   */
  avoidBlockScalars?: boolean;
};

export function stringifyFrontmatter(
  body: string,
  frontmatter: Record<string, unknown> | null | undefined,
  options?: StringifyFrontmatterOptions,
): string {
  const { avoidBlockScalars = false } = options ?? {};

  const cleanFrontmatter = avoidBlockScalars
    ? deepFlattenStringsObject(frontmatter)
    : deepRemoveNullishObject(frontmatter);

  // With lineWidth disabled js-yaml never folds a long string into a block
  // scalar (>- or |-). Some tools use simplified frontmatter parsers that read
  // those indicators as literal string values. The default output is dumped
  // with js-yaml 4, as gray-matter did here through its pnpm override, because
  // v5 stops folding a long string that has no space to break at and would
  // change files on regeneration.
  const yaml = (
    avoidBlockScalars ? dump(cleanFrontmatter, { lineWidth: -1 }) : dumpYamlV4(cleanFrontmatter)
  ).trim();

  // The body is carried through byte-for-byte and never re-parsed, so a body
  // that itself opens with a `---`-delimited block (a fenced YAML example
  // inside a skill's instructions, say) cannot inject keys into the output.
  // An empty mapping writes no fence at all, just the body.
  const head = yaml === "{}" ? "" : `---\n${yaml}\n---\n`;
  return head + withTrailingNewline(body);
}

function withTrailingNewline(text: string): string {
  return text.endsWith("\n") ? text : `${text}\n`;
}

/** Frontmatter languages accepted after the opening `---` fence. */
const ALLOWED_FRONTMATTER_LANGUAGE_PATTERN = /^(?:ya?ml)?$/i;

type FrontmatterFence = {
  /** The language named after the opening `---`, trimmed (`""` for none). */
  language: string;
  /**
   * Offset in `content` of the fence line's line break, or `undefined` when
   * the content has no line break at all. The splitter looks for the closing
   * `\n---` from here, so an empty block (`---\n---`) closes on this very
   * line break.
   */
  lineBreakStart: number | undefined;
  /** Offset in `content` just past that line break. */
  lineEnd: number | undefined;
};

/**
 * Read the opening frontmatter fence, or return `undefined` when the content
 * carries no frontmatter at all.
 *
 * The grammar is gray-matter's, which rulesync used to depend on, kept so that
 * every file reads the same as before: one byte order mark is skipped, `---`
 * is a fence only when a fourth `-` does not follow, and the language is the
 * text between the fence and the first `\r?\n`, trimmed — dropping the last
 * character when there is no line break at all. Every check that has to agree
 * with {@link splitFrontmatter} on where the block is (the language check and
 * the repair pass) goes through this one reading, so none of them
 * can be bypassed by a fence line the splitter accepts and a stricter pattern
 * would not (a stray `\r` before the line break, say).
 */
function readFrontmatterFence(content: string): FrontmatterFence | undefined {
  const offset = content.startsWith("\uFEFF") ? 1 : 0;
  const text = content.slice(offset);
  if (!text.startsWith("---") || text.charAt(3) === "-") {
    return undefined;
  }

  const afterFence = text.slice(3);
  const lineBreak = /\r?\n/.exec(afterFence);
  const language = afterFence.slice(0, lineBreak ? lineBreak.index : -1).trim();
  const lineBreakStart = lineBreak ? offset + 3 + lineBreak.index : undefined;
  const lineEnd =
    lineBreak && lineBreakStart !== undefined ? lineBreakStart + lineBreak[0].length : undefined;
  return { language, lineBreakStart, lineEnd };
}

/**
 * Refuse a frontmatter fence that names any language other than YAML.
 *
 * Only YAML is ever written by rulesync or by the tools it targets. Generic
 * frontmatter libraries pick a parser from the fence language, and some hand a
 * `---js` block to `eval()`; rulesync parses everything as YAML, and refusing
 * any other language keeps a file meant for such a parser from being read as
 * something it is not.
 */
function assertYamlFrontmatterLanguage(content: string): void {
  const fence = readFrontmatterFence(content);
  if (fence && !ALLOWED_FRONTMATTER_LANGUAGE_PATTERN.test(fence.language)) {
    throw new Error(
      `Unsupported frontmatter language ${JSON.stringify(fence.language.slice(0, 40))}; only YAML frontmatter is supported`,
    );
  }
}

/**
 * Split `content` into its raw frontmatter block and its body, the way
 * gray-matter 4 did (see {@link readFrontmatterFence}).
 *
 * The block ends at the first `\n---`, with no requirement that the delimiter
 * be alone on its line, and one line break after it is dropped from the body.
 * A fence nothing closes makes the rest of the file the block and leaves the
 * body empty. Without a fence, `block` is `""` and the body is the content
 * minus a leading byte order mark.
 */
// Keep in step with readFrontmatterFence: both read the BOM, the `----` rule
// and the fence language the same way. They stay separate because the
// splitter must reproduce gray-matter's quirk of keeping a whitespace-only
// language in the block, which the fence reading has no use for.
function splitFrontmatter(content: string): { block: string; body: string } {
  const text = content.startsWith("\uFEFF") ? content.slice(1) : content;
  if (!text.startsWith("---") || text.charAt(3) === "-") {
    return { block: "", body: text };
  }

  let rest = text.slice(3);
  // `search` returns -1 without a line break, so the slice then drops the last
  // character; readFrontmatterFence reads the language the same way.
  const rawLanguage = rest.slice(0, rest.search(/\r?\n/));
  if (rawLanguage.trim() !== "") {
    rest = rest.slice(rawLanguage.length);
  }

  const closeIndex = rest.indexOf("\n---");
  if (closeIndex === -1) {
    return { block: rest, body: "" };
  }

  let body = rest.slice(closeIndex + "\n---".length);
  if (body.startsWith("\r")) {
    body = body.slice(1);
  }
  if (body.startsWith("\n")) {
    body = body.slice(1);
  }
  return { block: rest.slice(0, closeIndex), body };
}

/**
 * Whether a raw block holds nothing but blank and comment lines. Checked line
 * by line rather than with gray-matter's `/^\s*#[^\n]+/gm`, whose `\s*` also
 * spans line breaks and backtracks quadratically on a long run of blank lines.
 */
function isBlankFrontmatterBlock(block: string): boolean {
  return block.split(/\r\n|\r|\n/).every((line) => {
    const trimmed = line.trim();
    return trimmed === "" || trimmed.startsWith("#");
  });
}

export function parseFrontmatter(
  content: string,
  filePath?: string,
): {
  frontmatter: Record<string, unknown>;
  body: string;
  hasFrontmatter: boolean;
} {
  let frontmatter: Record<string, unknown>;
  let body: string;
  let hasFrontmatter: boolean;
  try {
    assertYamlFrontmatterLanguage(content);
    // Measured on the block the splitter actually returns, so the guard and
    // the parser can never disagree on what the block is (a whitespace-only
    // fence language or a file with no line break at all, say).
    const split = splitFrontmatter(content);
    if (split.block.length > MAX_FRONTMATTER_RAW_CHARS) {
      // A complex YAML key (an array or mapping used as a mapping key) costs
      // real memory inside js-yaml while it parses, before any post-parse
      // budget above ever runs. Refusing an oversized block outright keeps
      // that cost bounded regardless of what the block contains.
      throw new Error(
        `Frontmatter block is larger than ${MAX_FRONTMATTER_RAW_CHARS} characters; refusing to parse it (a complex YAML key can cost memory while parsing, before any post-parse budget applies)`,
      );
    }

    // js-yaml 4, not the js-yaml 5 the rest of rulesync uses: v5 is stricter
    // (it rejects, for one, a flow list whose closing `]` sits at column 0)
    // and drops v4's default timestamp, merge and binary tags, so it would
    // refuse or misread frontmatter that has always been accepted.
    const data = isBlankFrontmatterBlock(split.block) ? {} : loadYamlV4(split.block);
    // Strip null/undefined values from parsed frontmatter for consistency.
    // YAML parses bare keys (e.g. "description:") as null, which would fail
    // Zod validation (z.optional(z.string()) does not accept null). The same
    // walk drops cyclic aliases and prototype keys and refuses a document that
    // expands past MAX_FRONTMATTER_VALUES, so it belongs with the parse errors.
    // A scalar block (not a mapping) yields `{}`.
    frontmatter = deepRemoveNullishObject(data as Record<string, unknown> | null | undefined);
    body = split.body;
    // An empty file has always counted as carrying (empty) frontmatter; keep
    // it that way so an empty command or skill file is not newly rejected as
    // missing its frontmatter.
    hasFrontmatter = content === "" || split.block !== "" || content.trimStart().startsWith("---");
  } catch (error) {
    if (filePath) {
      throw new Error(`Failed to parse frontmatter in ${filePath}: ${formatError(error)}`, {
        cause: error,
      });
    }
    throw error;
  }

  return { frontmatter, body, hasFrontmatter };
}

/**
 * A top-level `key: value` entry. Nested entries are left alone deliberately:
 * the repair below rewrites a value's meaning, and the failure it exists for —
 * an unquoted sentence with a colon in it — is a `description`, which is always
 * top-level.
 */
const TOP_LEVEL_ENTRY_PATTERN = /^([A-Za-z_][\w.-]*):[^\S\r\n]+(\S.*)$/;

/** A plain scalar that already starts as some other YAML construct. */
const YAML_CONSTRUCT_PREFIX_PATTERN = /^["'|>&*![{#]/;

/**
 * Cut a plain scalar at its inline comment — whitespace followed by `#`.
 *
 * This has to happen before anything else looks at the value, or a line such as
 * `allowed-tools: Read # TODO: add Bash later` reads as needing repair and comes
 * back quoted with the comment inside it, which for a list of tool permissions
 * would grant what the comment had disabled. Scanning by hand rather than with
 * `/\s+#.*$/`: that pattern is unanchored, so a long run of spaces with no `#`
 * after it backtracks from every starting position, and a value padded with a
 * megabyte of spaces takes minutes to reject. This is linear in the value.
 */
function stripInlineComment(rawValue: string): string {
  for (let index = 1; index < rawValue.length; index++) {
    if (rawValue[index] === "#" && /\s/.test(rawValue[index - 1] ?? "")) {
      return rawValue.slice(0, index).trimEnd();
    }
  }
  return rawValue.trimEnd();
}

type RepairedLine = {
  line: string;
  /** Whether repairing this line dropped an inline comment from the value. */
  droppedComment: boolean;
};

function repairFrontmatterLine(line: string): RepairedLine {
  const unchanged: RepairedLine = { line, droppedComment: false };
  const carriageReturn = line.endsWith("\r") ? "\r" : "";
  const bareLine = carriageReturn === "" ? line : line.slice(0, -1);
  const match = TOP_LEVEL_ENTRY_PATTERN.exec(bareLine);
  if (!match) {
    return unchanged;
  }

  const [, key = "", rawValue = ""] = match;
  const value = stripInlineComment(rawValue);
  if (value === "") {
    return unchanged;
  }
  // A colon only ends a plain scalar when a space or the line end follows it,
  // so `homepage: https://example.com` parses fine and must not be touched.
  if (!/:(?:\s|$)/.test(value)) {
    return unchanged;
  }
  if (YAML_CONSTRUCT_PREFIX_PATTERN.test(value)) {
    return unchanged;
  }

  // JSON string syntax is a subset of YAML's double-quoted scalar, so this
  // escapes quotes and backslashes exactly the way YAML reads them back.
  return {
    line: `${key}: ${JSON.stringify(value)}${carriageReturn}`,
    droppedComment: value !== rawValue.trimEnd(),
  };
}

/**
 * Locate a raw `---`-delimited frontmatter block's bounds within `content`,
 * without parsing it, for the YAML repair pass below and the rule loaders that
 * pre-process `globs:`. The opening fence is read exactly as the splitter reads
 * it ({@link readFrontmatterFence}); an explicit `yaml` / `yml` language is
 * still YAML, any other language yields no bounds. The splitter ends the block
 * at the first `\n---`, with no requirement that the delimiter be alone on its
 * line, so a stricter pattern here would run past the splitter's delimiter and
 * act on text that is really the body. A block with no closing fence has no
 * bounds; the size guard measures that case separately.
 */
export function findFrontmatterBlockBounds(
  content: string,
): { blockStart: number; blockEnd: number } | undefined {
  const fence = readFrontmatterFence(content);
  if (
    fence?.lineBreakStart === undefined ||
    fence.lineEnd === undefined ||
    !ALLOWED_FRONTMATTER_LANGUAGE_PATTERN.test(fence.language)
  ) {
    return undefined;
  }

  const blockStart = fence.lineEnd;
  // Search from the fence line's own line break, as the splitter does, so an
  // empty block (`---\n---`) closes there instead of at a later `---` in the
  // body.
  const closing = /\r?\n---/.exec(content.slice(fence.lineBreakStart));
  if (!closing) {
    return undefined;
  }
  if (closing.index === 0) {
    return { blockStart, blockEnd: blockStart };
  }

  return { blockStart, blockEnd: fence.lineBreakStart + closing.index };
}

/**
 * Quote the unquoted scalars that make a frontmatter block unparseable, or
 * return `undefined` when there is nothing to repair. Only the frontmatter
 * block is rewritten; the body is passed through untouched.
 */
function repairMalformedFrontmatterYaml(
  content: string,
): { content: string; droppedComment: boolean } | undefined {
  const bounds = findFrontmatterBlockBounds(content);
  if (!bounds) {
    return undefined;
  }

  const { blockStart, blockEnd } = bounds;
  const block = content.slice(blockStart, blockEnd);
  const repairedLines = block.split("\n").map(repairFrontmatterLine);
  const repairedBlock = repairedLines.map(({ line }) => line).join("\n");
  if (repairedBlock === block) {
    return undefined;
  }

  return {
    content: content.slice(0, blockStart) + repairedBlock + content.slice(blockEnd),
    droppedComment: repairedLines.some(({ droppedComment }) => droppedComment),
  };
}

/**
 * Parse frontmatter, retrying once with unquoted colon-bearing values quoted.
 *
 * Files authored for another client routinely carry YAML that only that
 * client's parser accepts — `description: Use this skill when: the user asks
 * about PDFs` is the case the Agent Skills client guide names. Without a retry
 * such a file is not merely reported, it is dropped: the lenient skill import
 * catches the parse error and skips the whole skill. The retry is deliberately
 * narrow — one pass, top-level entries only, and the original error is what
 * surfaces if it does not help, so a genuinely broken file still fails with the
 * message that describes what is actually wrong with it. A file with no closing
 * `---` is not repaired at all, and one whose opening fence names a language
 * other than YAML is refused outright (an explicit `---yaml` / `---yml` fence
 * is repaired like a plain one).
 *
 * @see https://agentskills.io/client-implementation/adding-skills-support
 */
export function parseFrontmatterWithYamlRepair(
  content: string,
  filePath?: string,
  options: {
    /**
     * Skip the recovery warning. Set by the ownership probes that read a file
     * only to decide whether the file belongs to a target: they parse the same
     * file the loader parses moments later, and warning twice about one file
     * says nothing the first warning did not.
     */
    quiet?: boolean;
  } = {},
): {
  frontmatter: Record<string, unknown>;
  body: string;
  hasFrontmatter: boolean;
} {
  try {
    return parseFrontmatter(content, filePath);
  } catch (error) {
    const repaired = repairMalformedFrontmatterYaml(content);
    if (repaired === undefined) {
      throw error;
    }

    let result: ReturnType<typeof parseFrontmatter>;
    try {
      result = parseFrontmatter(repaired.content, filePath);
    } catch {
      // The repair made it no better; report the failure the file actually has.
      throw error;
    }

    if (options.quiet === true) {
      return result;
    }

    // A repaired value stops at an inline comment, which is what YAML says it
    // does but not what the client that wrote the file may have shown. Say so,
    // because a silently shortened `description` is hard to notice.
    const commentNote = repaired.droppedComment
      ? " Text following a space and `#` was read as a YAML comment and left out of the value."
      : "";
    warnOnceWithFallback(
      undefined,
      `Recovered malformed YAML frontmatter in ${filePath === undefined ? "the input" : stripControlCharacters(toPosixPath(filePath))} by quoting values that contain a colon.${commentNote} Quote them in the file itself so other tools can read it too.`,
    );
    return result;
  }
}

/**
 * Validate a parsed frontmatter object against a schema, reporting a failure as
 * `Invalid frontmatter in <relativeDirPath>/<relativeFilePath>: <details>`.
 *
 * This is the shared body of the `validate()` methods of rule, command,
 * subagent and check files. Callers that tolerate a missing frontmatter keep
 * their own early return before calling it.
 */
export function validateFrontmatterSchema({
  schema,
  frontmatter,
  relativeDirPath,
  relativeFilePath,
}: {
  schema: z.ZodMiniType;
  frontmatter: unknown;
  relativeDirPath: string;
  relativeFilePath: string;
}): ValidationResult {
  const result = schema.safeParse(frontmatter);
  if (result.success) {
    return { success: true, error: null };
  }
  return {
    success: false,
    error: new Error(
      `Invalid frontmatter in ${join(relativeDirPath, relativeFilePath)}: ${formatError(result.error)}`,
    ),
  };
}
