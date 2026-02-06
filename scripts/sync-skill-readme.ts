import { marked } from "marked";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SKILL_DIR = join(process.cwd(), "skills", "rulesync");
const README_PATH = join(process.cwd(), "README.md");

const FRONTMATTER = `---
name: rulesync
description: >-
  Rulesync CLI tool documentation - unified AI rule file management
  for various AI coding tools
targets: ["*"]
---`;

function toKebabCase(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function main(): void {
  const readmeContent = readFileSync(README_PATH, "utf-8");
  const tokens = marked.lexer(readmeContent);

  let introText = "";
  const sections: Array<{ heading: string; raw: string }> = [];
  let currentSection: { heading: string; raw: string } | null = null;
  let inIntro = false;

  for (const token of tokens) {
    if (token.type === "heading" && token.depth === 1) {
      inIntro = true;
      continue;
    }
    if (inIntro && token.type === "heading" && token.depth === 2) {
      inIntro = false;
      // Fall through to section handling below
    }
    if (inIntro) {
      if (token.type === "paragraph") {
        const text = token.raw.trimEnd();
        // Skip badge lines and HTML links (e.g. [![...] or <a ...)
        const isBadge = text.startsWith("[![") || /^<a[\s>]/.test(text);
        if (!isBadge) {
          introText += (introText ? "\n\n" : "") + text;
        }
      }
      continue;
    }
    if (token.type === "heading" && token.depth === 2) {
      if (currentSection) sections.push(currentSection);
      currentSection = { heading: token.text, raw: token.raw };
      continue;
    }
    if (currentSection) {
      currentSection.raw += token.raw;
    }
  }
  if (currentSection) sections.push(currentSection);

  // Clean existing .md files in skill dir
  mkdirSync(SKILL_DIR, { recursive: true });
  for (const file of readdirSync(SKILL_DIR)) {
    if (file.endsWith(".md")) {
      rmSync(join(SKILL_DIR, file));
    }
  }

  // Build table of contents
  const tocLines = sections.map((s) => {
    const fileName = `${toKebabCase(s.heading)}.md`;
    return `- [${s.heading}](./${fileName})`;
  });

  // Write SKILL.md
  const skillContent = [
    FRONTMATTER,
    "",
    "# Rulesync",
    "",
    introText,
    "",
    "## Table of Contents",
    "",
    ...tocLines,
    "",
  ].join("\n");
  writeFileSync(join(SKILL_DIR, "SKILL.md"), skillContent);

  // Write section files
  for (const section of sections) {
    const fileName = `${toKebabCase(section.heading)}.md`;
    writeFileSync(join(SKILL_DIR, fileName), section.raw.trimEnd() + "\n");
  }

  // oxlint-disable-next-line no-console
  console.log(`Synced README.md to ${SKILL_DIR}/ (${sections.length} section files + SKILL.md)`);
}

main();
