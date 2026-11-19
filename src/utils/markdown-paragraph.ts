/** An ATX markdown heading line (`#` … `######`). */
const HEADING_LINE = /^#{1,6}(\s|$)/;

/**
 * The first non-heading paragraph of a Markdown body, collapsed onto one line.
 *
 * JetBrains Junie falls back to this paragraph as the description of a skill
 * or subagent whose frontmatter omits one. Heading lines are skipped rather
 * than taken, so a body opening with `# Title` does not yield the title. A
 * paragraph runs to the first blank line or heading, and is collapsed onto one
 * line because callers store it as a YAML frontmatter value. A fenced code
 * block is not treated specially: it is ordinary content, so a body whose
 * first paragraph is a fence yields the fence text. Returns an empty string
 * when the body holds no such paragraph.
 */
export function firstNonHeadingParagraph(body: string): string {
  const paragraph: string[] = [];
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (paragraph.length === 0) {
      // Still looking for the paragraph: blank lines and headings are skipped.
      if (line === "" || HEADING_LINE.test(line)) continue;
      paragraph.push(line);
      continue;
    }
    // Inside the paragraph: a blank line or a heading ends it.
    if (line === "" || HEADING_LINE.test(line)) break;
    paragraph.push(line);
  }
  return paragraph.join(" ").trim();
}
