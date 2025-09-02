import matter from "gray-matter";

export function stringifyFrontmatter(body: string, frontmatter: Record<string, unknown>): string {
  const cleanFrontmatter = Object.fromEntries(
    Object.entries(frontmatter).filter(([, value]) => value != null),
  );

  return matter.stringify(body, cleanFrontmatter);
}
