import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import vitepressConfig from "../docs/.vitepress/config.js";

const SKILL_DIR = join(process.cwd(), "skills", "rulesync");
const DOCS_DIR = join(process.cwd(), "docs");

const FRONTMATTER = `---
name: rulesync
description: >-
  Rulesync CLI tool documentation - unified AI rule file management
  for various AI coding tools
targets: ["*"]
---`;

type SidebarItem = {
  text: string;
  link?: string;
  items?: SidebarItem[];
};

function removeVitepressSyntax(content: string): string {
  let result = content;

  // Convert ::: details <title> to ### <title>
  result = result.replace(/^::: details (.+)$/gm, "### $1");

  // Convert ::: tip/warning/info/danger to blockquote-style headings
  result = result.replace(
    /^::: tip(?: (.+))?$/gm,
    (_, title?: string) => `> **${title ?? "Tip"}:**`,
  );
  result = result.replace(
    /^::: warning(?: (.+))?$/gm,
    (_, title?: string) => `> **${title ?? "Warning"}:**`,
  );
  result = result.replace(
    /^::: info(?: (.+))?$/gm,
    (_, title?: string) => `> **${title ?? "Info"}:**`,
  );
  result = result.replace(
    /^::: danger(?: (.+))?$/gm,
    (_, title?: string) => `> **${title ?? "Danger"}:**`,
  );

  // Remove closing :::
  result = result.replace(/^:::$/gm, "");

  // Collapse 3+ consecutive blank lines to 2
  result = result.replace(/\n{4,}/g, "\n\n\n");

  return result;
}

function isSidebarItemArray(value: unknown): value is SidebarItem[] {
  return Array.isArray(value);
}

function main(): void {
  const sidebar = vitepressConfig.themeConfig?.sidebar;
  if (!isSidebarItemArray(sidebar)) {
    throw new Error("No sidebar array found in VitePress config");
  }

  // Clean existing .md files in skill dir
  mkdirSync(SKILL_DIR, { recursive: true });
  for (const file of readdirSync(SKILL_DIR)) {
    if (file.endsWith(".md")) {
      rmSync(join(SKILL_DIR, file));
    }
  }

  const tocLines: string[] = [];
  let fileCount = 0;

  for (const entry of sidebar) {
    if (entry.items) {
      // Grouped section
      tocLines.push("", `### ${entry.text}`, "");
      for (const item of entry.items) {
        if (!item.link) continue;
        const fileName = `${basename(item.link)}.md`;
        const docPath = join(DOCS_DIR, `${item.link}.md`);
        const content = readFileSync(docPath, "utf-8");
        const cleaned = removeVitepressSyntax(content);
        writeFileSync(join(SKILL_DIR, fileName), cleaned.trimEnd() + "\n");
        tocLines.push(`- [${item.text}](./${fileName})`);
        fileCount++;
      }
    } else if (entry.link) {
      // Standalone item
      tocLines.push("");
      const fileName = `${basename(entry.link)}.md`;
      const docPath = join(DOCS_DIR, `${entry.link}.md`);
      const content = readFileSync(docPath, "utf-8");
      const cleaned = removeVitepressSyntax(content);
      writeFileSync(join(SKILL_DIR, fileName), cleaned.trimEnd() + "\n");
      tocLines.push(`- [${entry.text}](./${fileName})`);
      fileCount++;
    }
  }

  // Write SKILL.md
  const description = vitepressConfig.description ?? "";
  const skillContent = [
    FRONTMATTER,
    "",
    "# Rulesync",
    "",
    description,
    "",
    "## Table of Contents",
    ...tocLines,
    "",
  ].join("\n");
  writeFileSync(join(SKILL_DIR, "SKILL.md"), skillContent);

  // oxlint-disable-next-line no-console
  console.log(`Synced docs/ to ${SKILL_DIR}/ (${String(fileCount)} content files + SKILL.md)`);
}

main();
