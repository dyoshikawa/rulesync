import matter from "gray-matter";
import { dump, load } from "js-yaml";

import { formatError } from "./error.js";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function deepRemoveNullishValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (Array.isArray(value)) {
    const cleanedArray = value
      .map((item) => deepRemoveNullishValue(item))
      .filter((item) => item !== undefined);
    return cleanedArray;
  }

  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      const cleaned = deepRemoveNullishValue(val);
      if (cleaned !== undefined) {
        result[key] = cleaned;
      }
    }
    return result;
  }

  return value;
}

function deepRemoveNullishObject(
  obj: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!obj || typeof obj !== "object") {
    return {};
  }

  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    const cleaned = deepRemoveNullishValue(val);
    if (cleaned !== undefined) {
      result[key] = cleaned;
    }
  }
  return result;
}

function deepFlattenStringsValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value === "string") {
    return value.replace(/\n+/g, " ").trim();
  }

  if (Array.isArray(value)) {
    const cleanedArray = value
      .map((item) => deepFlattenStringsValue(item))
      .filter((item) => item !== undefined);
    return cleanedArray;
  }

  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      const cleaned = deepFlattenStringsValue(val);
      if (cleaned !== undefined) {
        result[key] = cleaned;
      }
    }
    return result;
  }

  return value;
}

function deepFlattenStringsObject(
  obj: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!obj || typeof obj !== "object") {
    return {};
  }

  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    const cleaned = deepFlattenStringsValue(val);
    if (cleaned !== undefined) {
      result[key] = cleaned;
    }
  }
  return result;
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
          parse: (input: string) => load(input) ?? {},
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
} {
  let frontmatter: Record<string, unknown>;
  let body: string;
  try {
    const result = matter(content);
    frontmatter = result.data;
    body = result.content;
  } catch (error) {
    if (filePath) {
      throw new Error(`Failed to parse frontmatter in ${filePath}: ${formatError(error)}`, {
        cause: error,
      });
    }
    throw error;
  }

  // Strip null/undefined values from parsed frontmatter for consistency.
  // YAML parses bare keys (e.g. "description:") as null, which would fail
  // Zod validation (z.optional(z.string()) does not accept null).
  const cleanFrontmatter = deepRemoveNullishObject(frontmatter);

  return { frontmatter: cleanFrontmatter, body };
}
