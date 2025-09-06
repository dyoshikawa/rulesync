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

function deepRemoveNullishObject(obj: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!obj || typeof obj !== 'object') {
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

export function stringifyFrontmatter(body: string, frontmatter: Record<string, unknown> | null | undefined): string {
  const cleanFrontmatter = deepRemoveNullishObject(frontmatter);

  return matter.stringify(body, cleanFrontmatter);
}

export function parseFrontmatter(content: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const { data: frontmatter, content: body } = matter(content);

  return { frontmatter, body };
}
