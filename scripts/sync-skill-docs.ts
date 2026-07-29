import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

import vitepressConfig from "../docs/.vitepress/config.js";

const SKILL_DIR = join(process.cwd(), "skills", "rulesync");
const DOCS_DIR = join(process.cwd(), "docs");

const FRONTMATTER = `---
name: rulesync
description: >-
  Generates and syncs AI rule configuration files (.cursorrules, CLAUDE.md,
  copilot-instructions.md) across 20+ coding tools from a single source.
  Use when syncing AI rules, running rulesync commands, importing or
  generating rule files, or managing shared AI coding configurations.
targets: ["*"]
---`;

type SidebarItem = {
  text: string;
  link?: string;
  items?: SidebarItem[];
};

export function removeVitepressSyntax(content: string): string {
  let result = content;

  // Convert ::: details <title> blocks: bump internal headings by one level,
  // then convert the details marker itself to #### <title>.
  // Process admonitions inside details first (tip/warning/info/danger) so that
  // the outer details closing ::: is not consumed by a nested block.
  result = result.replace(
    /^::: details (.+)$([\s\S]*?)^:::$/gm,
    (_, title: string, body: string) => {
      // Remove nested admonition markers (opening ::: <kind> and closing :::)
      let processed = body;
      for (const kind of ["tip", "warning", "info", "danger"] as const) {
        const label = kind.charAt(0).toUpperCase() + kind.slice(1);
        processed = processed.replace(
          new RegExp(`^::: ${kind}(?: (.+))?$`, "gm"),
          (__, nestedTitle?: string) => `> **${nestedTitle ?? label}:**`,
        );
      }
      processed = processed.replace(/^:::$/gm, "");
      // Bump headings inside the block by one level (### → ####, ## → ###, etc.)
      processed = processed.replace(/^(#{2,5}) /gm, "$1# ");
      return `#### ${title}${processed}`;
    },
  );

  // Convert ::: tip/warning/info/danger to blockquote-style headings
  for (const kind of ["tip", "warning", "info", "danger"] as const) {
    const label = kind.charAt(0).toUpperCase() + kind.slice(1);
    result = result.replace(
      new RegExp(`^::: ${kind}(?: (.+))?$`, "gm"),
      (_, title?: string) => `> **${title ?? label}:**`,
    );
  }

  // Remove closing :::
  result = result.replace(/^:::$/gm, "");

  // Collapse 3+ consecutive blank lines to 2
  result = result.replace(/\n{4,}/g, "\n\n\n");

  return result;
}

// Docs live in subdirectories (docs/guide/, docs/reference/, ...) but the skill
// mirror is flat, so cross-doc links like `../faq.md#anchor` or
// `../reference/file-formats.md` must be collapsed to sibling links.
export function rewriteRelativeLinksForFlatMirror(content: string): string {
  return content.replace(
    /\]\((\.\.?\/[^)#\s]*?)([^/)#\s]+\.md)((?:#[^)\s]*)?)((?:\s+"[^"]*")?)\)/g,
    (match, dirPrefix: string, fileName: string, anchor: string, title: string) => {
      if (dirPrefix === "./") return match;
      return `](./${fileName}${anchor}${title})`;
    },
  );
}

// Every relative .md link in the flat mirror must point at a sibling file that
// exists in the mirror; anything else is a broken link in the distributed skill.
export function assertFlatMirrorLinksResolve({ files }: { files: Map<string, string> }): void {
  const problems: string[] = [];
  const linkPattern = /\]\((?!(?:https?|mailto):|#)([^)\s]+?\.md)(?:#[^)\s]*)?(?:\s+"[^"]*")?\)/g;
  for (const [fileName, content] of files) {
    for (const match of content.matchAll(linkPattern)) {
      const target = (match[1] ?? "").replace(/^\.\//, "");
      if (target.includes("/")) {
        problems.push(`${fileName}: link "${match[1]}" is not a flat sibling link`);
      } else if (!files.has(target)) {
        problems.push(`${fileName}: link "${match[1]}" does not resolve to a mirrored file`);
      }
    }
  }
  if (problems.length > 0) {
    throw new Error(`Unresolved relative links in the flat skill mirror:\n${problems.join("\n")}`);
  }
}

// Shallow type guard: checks that value is an array and the first element has
// a `text` property, which is the minimal shape of SidebarItem[].
function isSidebarItemArray(value: unknown): value is SidebarItem[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  const first: unknown = value[0];
  return typeof first === "object" && first !== null && "text" in first;
}

function assertNoFileNameCollision(
  seenFileNames: Map<string, string>,
  fileName: string,
  link: string,
): void {
  const existing = seenFileNames.get(fileName);
  if (existing) {
    throw new Error(
      `Filename collision: "${fileName}" from "${link}" conflicts with "${existing}"`,
    );
  }
  seenFileNames.set(fileName, link);
}

export function syncSkillDocs(): void {
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

  // Collect all file names to detect collisions from different sections
  const seenFileNames = new Map<string, string>();
  // fileName -> written content, for post-write link validation
  const writtenFiles = new Map<string, string>();

  const writeDocFile = ({ link }: { link: string }): string => {
    const fileName = `${basename(link)}.md`;
    assertNoFileNameCollision(seenFileNames, fileName, link);
    const docPath = join(DOCS_DIR, `${link}.md`);
    const content = readFileSync(docPath, "utf-8");
    const cleaned = rewriteRelativeLinksForFlatMirror(removeVitepressSyntax(content));
    const finalContent = cleaned.trimEnd() + "\n";
    writeFileSync(join(SKILL_DIR, fileName), finalContent);
    writtenFiles.set(fileName, finalContent);
    return fileName;
  };

  const tocLines: string[] = [];
  let fileCount = 0;

  for (const entry of sidebar) {
    if (entry.items) {
      // Grouped section
      tocLines.push("", `### ${entry.text}`, "");
      for (const item of entry.items) {
        if (!item.link) continue;
        const fileName = writeDocFile({ link: item.link });
        tocLines.push(`- [${item.text}](./${fileName})`);
        fileCount++;
      }
    } else if (entry.link) {
      // Standalone item
      tocLines.push("");
      const fileName = writeDocFile({ link: entry.link });
      tocLines.push(`- [${entry.text}](./${fileName})`);
      fileCount++;
    }
  }

  // Build reference links from sidebar TOC
  const refLines: string[] = [];
  for (const entry of sidebar) {
    if (entry.items) {
      const links = entry.items
        .filter((item) => item.link)
        .map((item) => `[${item.text}](./${basename(item.link ?? "")}.md)`)
        .join(", ");
      if (links) refLines.push(`- ${links}`);
    } else if (entry.link) {
      refLines.push(`- [${entry.text}](./${basename(entry.link)}.md)`);
    }
  }

  // Write SKILL.md with inline quick start, workflow, and command reference
  const skillContent = [
    FRONTMATTER,
    "",
    "# Rulesync",
    "",
    "Rulesync generates and synchronizes AI rule configuration files across 20+ coding tools (Claude Code, Cursor, Copilot, Windsurf, Cline, Gemini CLI, and more) from a single set of unified rule files in `.rulesync/`.",
    "",
    "## Quick Start",
    "",
    "```bash",
    "# Install",
    "npm install -g rulesync",
    "",
    "# New project: initialize config, rules, and directory structure",
    "rulesync init",
    "",
    "# Import existing AI tool configs into unified format",
    "rulesync import --targets claudecode    # From CLAUDE.md",
    "rulesync import --targets cursor        # From .cursorrules",
    "rulesync import --targets copilot       # From .github/copilot-instructions.md",
    "",
    "# Generate tool-specific configs from unified rules",
    'rulesync generate --targets "*" --features "*"',
    "```",
    "",
    "## Core Workflow",
    "",
    "1. **Init** - `rulesync init` creates `rulesync.jsonc` config and `.rulesync/` directory with sample rules",
    "2. **Write rules** - Add shared AI rules in `.rulesync/rules/`, MCP configs in `.rulesync/mcp/`, commands in `.rulesync/commands/`",
    "3. **Generate** - `rulesync generate` produces tool-specific files (CLAUDE.md, .cursorrules, .github/copilot-instructions.md, etc.)",
    "4. **Verify** - `rulesync generate --dry-run` previews changes; `--check` validates files are up to date (useful in CI)",
    "",
    "## Key Commands",
    "",
    "| Command                                          | Purpose                                          |",
    "| ------------------------------------------------ | ------------------------------------------------ |",
    "| `rulesync init`                                  | Scaffold project with config and sample rules    |",
    '| `rulesync generate --targets "*" --features "*"` | Generate all tool configs from unified rules     |',
    "| `rulesync import --targets <tool>`               | Import existing tool config into unified format  |",
    "| `rulesync fetch owner/repo`                      | Fetch skills from a remote repository            |",
    "| `rulesync install`                               | Install skill sources declared in rulesync.jsonc |",
    "| `rulesync generate --check`                      | CI check that generated files are up to date     |",
    "| `rulesync generate --dry-run`                    | Preview changes without writing files            |",
    "| `rulesync generate --watch`                      | Regenerate whenever source files change          |",
    "",
    "## Detailed Reference",
    "",
    ...refLines,
    "",
  ].join("\n");
  writeFileSync(join(SKILL_DIR, "SKILL.md"), skillContent);
  writtenFiles.set("SKILL.md", skillContent);

  assertFlatMirrorLinksResolve({ files: writtenFiles });

  // oxlint-disable-next-line no-console
  console.log(`Synced docs/ to ${SKILL_DIR}/ (${String(fileCount)} content files + SKILL.md)`);
}

const entryPointPath = process.argv[1];
if (entryPointPath && fileURLToPath(import.meta.url) === entryPointPath) {
  syncSkillDocs();
}
