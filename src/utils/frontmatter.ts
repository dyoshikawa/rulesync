import matter from "gray-matter";

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

export function stringifyFrontmatter(
  body: string,
  frontmatter: Record<string, unknown> | null | undefined,
): string {
  const cleanFrontmatter = deepRemoveNullishObject(frontmatter);

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
      throw new Error(
        `Failed to parse frontmatter in ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    throw error;
  }

  // Strip null/undefined values from parsed frontmatter for consistency.
  // YAML parses bare keys (e.g. "description:") as null, which would fail
  // Zod validation (z.optional(z.string()) does not accept null).
  // This mirrors the deepRemoveNullishObject cleanup done in stringifyFrontmatter.
  const cleanFrontmatter = deepRemoveNullishObject(frontmatter);

  return { frontmatter: cleanFrontmatter, body };
}
