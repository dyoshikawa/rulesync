import { basename } from "node:path";

import { RULESYNC_CHECKS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { slugifyCheckName } from "./check-slug.js";
import { RulesyncCheck } from "./rulesync-check.js";

/**
 * Shared machinery for the tools whose checks surface is **one aggregated
 * instruction file** rather than a file per check — Cursor Bugbot's
 * `.cursor/BUGBOT.md`, Rovo Dev's `.rovodev/.review-agent.md` and Factory
 * Droid's `.factory/skills/review-guidelines/SKILL.md`.
 *
 * They all read the file as free prose, so the check identities have to be
 * carried in something invisible to the reader: an HTML-comment marker per
 * section. That marker convention, the escaping that keeps a check body from
 * splitting itself, and the import-side split are the same for every one of
 * them, so they live here once.
 */

/** Marks where one check starts inside the single instruction file. */
const CHECK_MARKER_PATTERN = /^<!--\s*rulesync:check:(.+?)\s*-->[ \t]*$/gm;

/**
 * A marker line a check body wrote itself — a rulesync doc fragment quoted in a
 * code block, say. Emitting it verbatim would split that check in two on the
 * next import, so `literal-` is inserted before `check:` on the way out and
 * taken off on the way back. `(?:literal-)*` makes it a ladder, so a body that
 * already contains an escaped marker survives the round trip too.
 */
const ESCAPABLE_MARKER_PATTERN = /^(<!--\s*rulesync:)((?:literal-)*check:.+?\s*-->[ \t]*)$/gm;
const ESCAPED_MARKER_PATTERN = /^(<!--\s*rulesync:)literal-((?:literal-)*check:.+?\s*-->[ \t]*)$/gm;

export function renderCheckMarker(name: string): string {
  return `<!-- rulesync:check:${name} -->`;
}

export function escapeCheckMarkers(content: string): string {
  return content.replace(ESCAPABLE_MARKER_PATTERN, "$1literal-$2");
}

export function unescapeCheckMarkers(content: string): string {
  return content.replace(ESCAPED_MARKER_PATTERN, "$1$2");
}

export type CheckMarker = { name: string; start: number; end: number };

export function findCheckMarkers(fileContent: string): CheckMarker[] {
  // Reset lastIndex explicitly: the pattern is module-level and global.
  CHECK_MARKER_PATTERN.lastIndex = 0;
  const markers: CheckMarker[] = [];
  let match: RegExpExecArray | null = CHECK_MARKER_PATTERN.exec(fileContent);
  while (match !== null) {
    markers.push({
      name: match[1] ?? "",
      start: match.index,
      end: match.index + match[0].length,
    });
    match = CHECK_MARKER_PATTERN.exec(fileContent);
  }
  return markers;
}

/**
 * Whether the file holds instruction text ahead of the first marker — the
 * question the "generating replaces this" warning asks. A file with no marker
 * at all is entirely hand-written, so it qualifies; an empty one does not,
 * since there is nothing to replace.
 */
export function hasHandWrittenPreamble(fileContent: string): boolean {
  const firstMarkerStart = findCheckMarkers(fileContent)[0]?.start ?? fileContent.length;
  return fileContent.slice(0, firstMarkerStart).trim().length > 0;
}

/**
 * Whether the file is nothing but sections rulesync generated — the question
 * the deletion guard asks, and a stricter one than
 * {@link hasHandWrittenPreamble}. A file carrying no marker at all is not
 * rulesync's to remove even when it is empty: rulesync never wrote it, so an
 * empty one is somebody's placeholder rather than our leftover.
 */
export function isOnlyGeneratedSections(fileContent: string): boolean {
  const firstMarkerStart = findCheckMarkers(fileContent)[0]?.start;
  if (firstMarkerStart === undefined) {
    return false;
  }
  return fileContent.slice(0, firstMarkerStart).trim().length === 0;
}

/**
 * The instruction text one check contributes. Neither file has a field to put a
 * summary in, so `description` is used only when there is no body.
 */
function toInstruction(rulesyncCheck: RulesyncCheck): string {
  const body = rulesyncCheck.getBody().trim();
  if (body.length > 0) {
    return body;
  }
  return rulesyncCheck.getFrontmatter().description?.trim() ?? "";
}

export function renderCheckSection(rulesyncCheck: RulesyncCheck): string {
  // basename, so a check in a subdirectory does not name itself `dir/name`.
  const name = basename(rulesyncCheck.getRelativeFilePath(), ".md");
  const heading = `## ${name}`;
  const instruction = toInstruction(rulesyncCheck);
  const lines = [renderCheckMarker(name), heading];
  if (instruction.length > 0) {
    lines.push("", escapeCheckMarkers(instruction));
  }
  return lines.join("\n");
}

export function renderCheckFile(rulesyncChecks: RulesyncCheck[]): string {
  return `${rulesyncChecks.map(renderCheckSection).join("\n\n")}\n`;
}

/** Drop the heading generate writes, so a round trip does not stack headings. */
function stripGeneratedHeading(section: string, name: string): string {
  const [firstLine, ...rest] = section.split("\n");
  if (firstLine?.trim() === `## ${name}`) {
    return rest.join("\n").trim();
  }
  return section.trim();
}

/**
 * Split an aggregated instruction file back into one check per section.
 *
 * Content ahead of the first marker — and a hand-written file with no markers
 * at all — becomes a single check named `fallbackName`, so nothing in the file
 * is dropped.
 */
export function splitCheckFile({
  fileContent,
  fallbackName,
}: {
  fileContent: string;
  fallbackName: string;
}): RulesyncCheck[] {
  const sections: { name: string; content: string }[] = [];
  const markers = findCheckMarkers(fileContent);

  const preambleEnd = markers[0]?.start ?? fileContent.length;
  const preamble = fileContent.slice(0, preambleEnd).trim();
  if (preamble.length > 0) {
    sections.push({ name: fallbackName, content: unescapeCheckMarkers(preamble) });
  }

  for (const [index, marker] of markers.entries()) {
    const sectionEnd = markers[index + 1]?.start ?? fileContent.length;
    const markerName = marker.name.trim();
    // The marker name comes from someone else's file on import, so it goes
    // through the slug rules: a raw `../escape` would otherwise write outside
    // the checks directory.
    const name = slugifyCheckName(markerName) || fallbackName;
    // Matched against the marker name rather than the slug, because that is
    // what generate put in the heading — a check named `No_Console` would
    // otherwise keep its heading and stack a second one on the next generate.
    const content = stripGeneratedHeading(
      fileContent.slice(marker.end, sectionEnd).trim(),
      markerName,
    );
    sections.push({ name, content: unescapeCheckMarkers(content) });
  }

  const used = new Set<string>();
  return sections.map(({ name, content }) => {
    // Two markers can slugify the same; a suffix keeps the second from
    // overwriting the first.
    let uniqueName = name;
    let suffix = 2;
    while (used.has(uniqueName)) {
      uniqueName = `${name}-${suffix}`;
      suffix += 1;
    }
    used.add(uniqueName);

    return new RulesyncCheck({
      outputRoot: ".",
      relativeDirPath: RULESYNC_CHECKS_RELATIVE_DIR_PATH,
      relativeFilePath: `${uniqueName}.md`,
      // These instructions are plain prose, so they apply to any tool — this
      // imports the way an Amp check or a Takt string gate does.
      frontmatter: { targets: ["*"] },
      body: content,
    });
  });
}
