import matter from "gray-matter";

export function stringifyFrontmatter(body: string, frontmatter: Record<string, unknown>): string {
  const cleanFrontmatter = Object.fromEntries(
    Object.entries(frontmatter).filter(([, value]) => value !== null && value !== undefined),
  );

  return matter.stringify(body, cleanFrontmatter);
}

export function parseFrontmatter(content: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const { data: frontmatter, content: body } = matter(content);

  return { frontmatter, body };
}
