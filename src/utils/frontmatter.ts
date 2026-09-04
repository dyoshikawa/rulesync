import matter from "gray-matter";
import { dump } from "js-yaml";

import { type BoundedWalk, createBoundedWalk } from "./bounded-walk.js";
import { stripControlCharacters } from "./control-characters.js";
import { formatError } from "./error.js";
import { toPosixPath } from "./file.js";
import { warnOnceWithFallback } from "./logger.js";
import { isPrototypePollutionKey } from "./prototype-pollution.js";
import { isPlainObject } from "./type-guards.js";
import { loadYaml } from "./yaml.js";

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
 * `matter()`'s output — but a complex YAML key (an array or mapping used as a
 * mapping key) is joined into a string by js-yaml while it parses, and a
 * mapping with many such keys can cost real memory before that walk ever
 * starts, or even before `matter()` returns. Capping the raw block size keeps
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
 * Every alias is still written out as an independent copy, as gray-matter's
 * default YAML engine would otherwise serialize shared references as `&ref_0`
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

  // Pass a pre-split file object rather than the raw body string. When
  // gray-matter's `file` argument is a string, `matter.stringify` re-parses
  // that whole string as a document and merges the result's `data` under
  // `cleanFrontmatter` before turning the result into a string — so a body that itself contains a
  // `---`-delimited block (a fenced YAML example inside a skill's
  // instructions, say) would inject its own frontmatter keys into the output
  // unsanitized, bypassing every budget above. Passing `{ content: body }`
  // skips that re-parse: `file.data` is left `undefined`, so gray-matter
  // merges nothing extra in and the body is carried through byte-for-byte.
  const file = { content: body };

  if (avoidBlockScalars) {
    // Use a custom YAML engine with lineWidth disabled to prevent js-yaml from
    // emitting block scalars (>- or |-). Some tools use simplified frontmatter
    // parsers that interpret these indicators as literal string values.
    return matter.stringify(file, cleanFrontmatter, {
      engines: {
        yaml: {
          parse: (input: string) => loadYaml(input) ?? {},
          stringify: (data: object) => dump(data, { lineWidth: -1 }),
        },
      },
    });
  }

  return matter.stringify(file, cleanFrontmatter);
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
    const bounds = findFrontmatterBlockBounds(content);
    if (bounds && bounds.blockEnd - bounds.blockStart > MAX_FRONTMATTER_RAW_CHARS) {
      // A complex YAML key (an array or mapping used as a mapping key) costs
      // real memory inside js-yaml while it parses, before any post-parse
      // budget above ever runs. Refusing an oversized block outright keeps
      // that cost bounded regardless of what the block contains.
      throw new Error(
        `Frontmatter block is larger than ${MAX_FRONTMATTER_RAW_CHARS} characters; refusing to parse it (a complex YAML key can cost memory while parsing, before any post-parse budget applies)`,
      );
    }

    // The empty options object is what turns gray-matter's content cache off,
    // and it has to stay off. The cache is written *before* the YAML is
    // parsed, so a file that throws leaves an entry behind whose `data` is
    // empty and whose `content` is the whole unparsed file; the next parse of
    // identical content — the same malformed skill vendored under two
    // directories, say — hits that entry and returns empty frontmatter with the
    // frontmatter text spilled into the body, instead of reporting the error
    // again. Caching a parse this cheap is not worth failing silently.
    const result = matter(content, {});
    // Strip null/undefined values from parsed frontmatter for consistency.
    // YAML parses bare keys (e.g. "description:") as null, which would fail
    // Zod validation (z.optional(z.string()) does not accept null). The same
    // walk drops cyclic aliases and prototype keys and refuses a document that
    // expands past MAX_FRONTMATTER_VALUES, so it belongs with the parse errors.
    frontmatter = deepRemoveNullishObject(result.data);
    body = result.content;
    // gray-matter returns an empty .matter string and sets .content equal to
    // the original input when no YAML frontmatter fence (---) is present.
    // Use this to detect whether the file actually contained frontmatter.
    hasFrontmatter = result.matter !== "" || content.trimStart().startsWith("---");
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
 * without parsing it. Shared by the size guard in {@link parseFrontmatter} and
 * the YAML repair pass below, so both agree on exactly what gray-matter would
 * treat as the block: gray-matter ends it at the first `\n---`, with no
 * requirement that the delimiter be alone on its line, so a stricter pattern
 * here would run past gray-matter's delimiter and act on text that is really
 * the body.
 */
function findFrontmatterBlockBounds(
  content: string,
): { blockStart: number; blockEnd: number } | undefined {
  const opening = /^\uFEFF?---[^\S\r\n]*\r?\n/.exec(content);
  if (!opening) {
    return undefined;
  }

  const blockStart = opening[0].length;
  const closing = /\r?\n---/.exec(content.slice(blockStart));
  if (!closing) {
    return undefined;
  }

  return { blockStart, blockEnd: blockStart + closing.index };
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
 * `---`, or one whose opening fence carries a language tag, is not repaired at
 * all: neither is a frontmatter block gray-matter would have read.
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
