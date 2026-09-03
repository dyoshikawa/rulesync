import matter from "gray-matter";
import { dump } from "js-yaml";

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

type DeepCleanOptions = {
  /** Applied to every string leaf; the default keeps strings as they are. */
  transformString?: (value: string) => string;
  /**
   * Containers on the current descent path. A reference back to one of them
   * (a YAML anchor that aliases its own ancestor) is a cycle and is dropped
   * rather than walked until the stack overflows.
   */
  ancestors: WeakSet<object>;
  /** Values still allowed before the walk refuses the document. */
  budget: { remaining: number; stringCharsRemaining: number };
};

function consumeBudget(options: DeepCleanOptions, stringChars = 0): void {
  options.budget.remaining -= 1;
  if (options.budget.remaining < 0) {
    throw new Error(
      `Frontmatter expands to more than ${MAX_FRONTMATTER_VALUES} values; refusing to process it (a chain of YAML aliases may be amplifying the document)`,
    );
  }
  options.budget.stringCharsRemaining -= stringChars;
  if (options.budget.stringCharsRemaining < 0) {
    throw new Error(
      `Frontmatter's string values expand to more than ${MAX_FRONTMATTER_STRING_CHARS} characters; refusing to process it (a chain of YAML aliases may be amplifying the document)`,
    );
  }
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
  consumeBudget(options, typeof value === "string" ? value.length : 0);

  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value === "string") {
    return options.transformString ? options.transformString(value) : value;
  }

  if (Array.isArray(value)) {
    if (options.ancestors.has(value)) {
      return undefined;
    }
    options.ancestors.add(value);
    const cleanedArray: unknown[] = [];
    for (const item of value) {
      const cleaned = deepCleanValue(item, options);
      if (cleaned !== undefined) {
        cleanedArray.push(cleaned);
      }
    }
    options.ancestors.delete(value);
    return cleanedArray;
  }

  if (isPlainObject(value)) {
    if (options.ancestors.has(value)) {
      return undefined;
    }
    options.ancestors.add(value);
    const result = cleanOwnEntries(value, options);
    options.ancestors.delete(value);
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
    if (isPrototypePollutionKey(key)) {
      continue;
    }
    const cleaned = deepCleanValue(val, options);
    if (cleaned !== undefined) {
      result[key] = cleaned;
    }
  }
  return result;
}

function deepCleanObject(
  obj: Record<string, unknown> | null | undefined,
  options: Omit<DeepCleanOptions, "ancestors" | "budget">,
): Record<string, unknown> {
  if (!obj || typeof obj !== "object") {
    return {};
  }
  return cleanOwnEntries(obj, {
    ...options,
    ancestors: new WeakSet([obj]),
    budget: {
      remaining: MAX_FRONTMATTER_VALUES,
      stringCharsRemaining: MAX_FRONTMATTER_STRING_CHARS,
    },
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

  if (avoidBlockScalars) {
    // Use a custom YAML engine with lineWidth disabled to prevent js-yaml from
    // emitting block scalars (>- or |-). Some tools use simplified frontmatter
    // parsers that interpret these indicators as literal string values.
    return matter.stringify(body, cleanFrontmatter, {
      engines: {
        yaml: {
          parse: (input: string) => loadYaml(input) ?? {},
          stringify: (data: object) => dump(data, { lineWidth: -1 }),
        },
      },
    });
  }

  return matter.stringify(body, cleanFrontmatter);
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
 * Quote the unquoted scalars that make a frontmatter block unparseable, or
 * return `undefined` when there is nothing to repair. Only the frontmatter
 * block is rewritten; the body is passed through untouched.
 */
function repairMalformedFrontmatterYaml(
  content: string,
): { content: string; droppedComment: boolean } | undefined {
  const opening = /^\uFEFF?---[^\S\r\n]*\r?\n/.exec(content);
  if (!opening) {
    return undefined;
  }

  const blockStart = opening[0].length;
  // gray-matter ends the block at the first `\n---`, with no requirement that
  // the delimiter be alone on its line. Matching that exactly matters: a
  // stricter pattern here would run past gray-matter's delimiter and rewrite
  // lines that are really body text.
  const closing = /\r?\n---/.exec(content.slice(blockStart));
  if (!closing) {
    return undefined;
  }

  const blockEnd = blockStart + closing.index;
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
