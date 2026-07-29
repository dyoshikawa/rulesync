import { basename, join } from "node:path";

import { CURSOR_BUGBOT_FILE_NAME, CURSOR_DIR } from "../../constants/cursor-paths.js";
import { RULESYNC_CHECKS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import type { ValidationResult } from "../../types/ai-file.js";
import { readFileContentOrNull } from "../../utils/file.js";
import { slugifyCheckName } from "./check-slug.js";
import { RulesyncCheck } from "./rulesync-check.js";
import {
  ToolCheck,
  type ToolCheckForDeletionParams,
  type ToolCheckFromFileParams,
  type ToolCheckFromRulesyncCheckParams,
  type ToolCheckFromRulesyncChecksParams,
  type ToolCheckSettablePaths,
} from "./tool-check.js";

/**
 * Marks where one check starts inside the single instruction file. Bugbot reads
 * the file as prose, and an HTML comment is invisible in rendered Markdown, so
 * the marker carries the check identity without changing what Bugbot is told.
 */
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

const FALLBACK_CHECK_NAME = "bugbot";

function renderMarker(name: string): string {
  return `<!-- rulesync:check:${name} -->`;
}

function escapeMarkers(content: string): string {
  return content.replace(ESCAPABLE_MARKER_PATTERN, "$1literal-$2");
}

function unescapeMarkers(content: string): string {
  return content.replace(ESCAPED_MARKER_PATTERN, "$1$2");
}

type CheckMarker = { name: string; start: number; end: number };

function findMarkers(fileContent: string): CheckMarker[] {
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
 * The instruction text one check contributes. Bugbot has no field to put a
 * summary in, so `description` is used only when there is no body — the same
 * fallback the file-stem heading above it gets.
 */
function toInstruction(rulesyncCheck: RulesyncCheck): string {
  const body = rulesyncCheck.getBody().trim();
  if (body.length > 0) {
    return body;
  }
  return rulesyncCheck.getFrontmatter().description?.trim() ?? "";
}

function renderSection(rulesyncCheck: RulesyncCheck): string {
  // basename, so a check in a subdirectory does not name itself `dir/name`.
  const name = basename(rulesyncCheck.getRelativeFilePath(), ".md");
  const heading = `## ${name}`;
  const instruction = toInstruction(rulesyncCheck);
  const lines = [renderMarker(name), heading];
  if (instruction.length > 0) {
    lines.push("", escapeMarkers(instruction));
  }
  return lines.join("\n");
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
 * Checks adapter for Cursor Bugbot (`.cursor/BUGBOT.md`).
 *
 * Bugbot takes one aggregated instruction file per directory rather than a file
 * per check, so every `.rulesync/checks/*.md` targeting Cursor collapses into
 * the repository-root `.cursor/BUGBOT.md` — hence {@link fromRulesyncChecks}
 * rather than the usual per-check conversion. Each check becomes one section:
 * an HTML-comment marker carrying the check name, an `## <name>` heading, and
 * the check body as the instruction text (the `description` is used when the
 * body is empty).
 *
 * Bugbot reads the file as free prose, so a check's `severity` and `tools` have
 * no equivalent there: they are not written and do not come back on import. So
 * is `description` whenever the check also has a body.
 *
 * Project scope only — Bugbot reads repository files, and there is no
 * user-level instruction file. Bugbot also merges nested `<dir>/.cursor/BUGBOT.md`
 * files found while traversing upward from changed files, but rulesync check
 * sources carry no directory-placement semantics, so only the root file is
 * generated.
 *
 * On import the markers split the file back into one check per section; content
 * before the first marker — and a hand-written file with no markers at all —
 * becomes a single `bugbot` check, so nothing in the file is dropped. A file
 * holding anything rulesync did not write is never deleted either (see
 * {@link canDeleteAuxiliaryFiles}), though generating checks for Cursor does
 * replace it — import first to keep what is there, which is warned about.
 *
 * @see https://cursor.com/docs/bugbot
 */
export class CursorCheck extends ToolCheck {
  static getSettablePaths(_options: { global?: boolean } = {}): ToolCheckSettablePaths {
    // Naming the file keeps consumers that would otherwise claim the whole
    // `.cursor/` tree — the gitignore derivation, for one — narrowed to the one
    // file written, since every other Cursor feature writes there too.
    return { relativeDirPath: CURSOR_DIR, relativeFilePath: CURSOR_BUGBOT_FILE_NAME };
  }

  static isTargetedByRulesyncCheck(rulesyncCheck: RulesyncCheck): boolean {
    return this.isTargetedByRulesyncCheckDefault({ rulesyncCheck, toolTarget: "cursor" });
  }

  /**
   * Ownership guard the processor consults before it deletes anything for this
   * tool. `.cursor/BUGBOT.md` is a file Cursor's own documentation tells users
   * to hand-write, so anything in it that rulesync did not write is not
   * rulesync's to remove — dropping the last check targeting Cursor must not
   * take somebody's hand-written review instructions with it. Deletion is
   * therefore allowed only for a file that is nothing but generated sections:
   * one that carries no marker at all, or that carries hand-written text ahead
   * of the first marker, stays.
   */
  static async canDeleteAuxiliaryFiles({ outputRoot }: { outputRoot: string }): Promise<boolean> {
    const paths = CursorCheck.getSettablePaths();
    const filePath = join(
      outputRoot,
      paths.relativeDirPath,
      paths.relativeFilePath ?? CURSOR_BUGBOT_FILE_NAME,
    );
    const fileContent = await readFileContentOrNull(filePath);
    if (fileContent === null) {
      return true;
    }
    const firstMarkerStart = findMarkers(fileContent)[0]?.start;
    if (firstMarkerStart === undefined) {
      return false;
    }
    return fileContent.slice(0, firstMarkerStart).trim().length === 0;
  }

  static override fromRulesyncCheck(_params: ToolCheckFromRulesyncCheckParams): CursorCheck {
    // Sections share one file, so they are only ever built as a set.
    throw new Error("Cursor checks are built from all checks at once; use fromRulesyncChecks.");
  }

  static async fromRulesyncChecks({
    outputRoot = process.cwd(),
    rulesyncChecks,
    global = false,
    logger,
  }: ToolCheckFromRulesyncChecksParams): Promise<CursorCheck[]> {
    if (rulesyncChecks.length === 0) {
      // No section to write. A stale file from an earlier generate is removed by
      // the processor's deletion pass rather than by an empty file written here.
      return [];
    }

    const paths = CursorCheck.getSettablePaths({ global });
    const relativeFilePath = paths.relativeFilePath ?? CURSOR_BUGBOT_FILE_NAME;
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);

    // The file is rewritten from `.rulesync/checks/` rather than merged into, so
    // say so before hand-written instructions go away — the deletion guard
    // protects them, but generating over them cannot.
    const existingContent = (await readFileContentOrNull(filePath)) ?? "";
    const firstMarkerStart = findMarkers(existingContent)[0]?.start ?? existingContent.length;
    if (existingContent.slice(0, firstMarkerStart).trim().length > 0) {
      logger?.warn(
        `Cursor checks: ${filePath} holds instructions rulesync did not write, and generating ` +
          `replaces the whole file. Run \`rulesync import --targets cursor --features checks\` ` +
          `first to keep them.`,
      );
    }

    const fileContent = `${rulesyncChecks.map(renderSection).join("\n\n")}\n`;

    return [
      new CursorCheck({
        outputRoot,
        relativeDirPath: paths.relativeDirPath,
        relativeFilePath,
        fileContent,
        global,
      }),
    ];
  }

  static async fromFile({
    outputRoot = process.cwd(),
    global = false,
  }: ToolCheckFromFileParams): Promise<CursorCheck> {
    const paths = CursorCheck.getSettablePaths({ global });
    const relativeFilePath = paths.relativeFilePath ?? CURSOR_BUGBOT_FILE_NAME;
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);
    return new CursorCheck({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      fileContent: (await readFileContentOrNull(filePath)) ?? "",
      global,
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolCheckForDeletionParams): CursorCheck {
    return new CursorCheck({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      global,
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  toRulesyncCheck(): RulesyncCheck {
    const checks = this.toRulesyncChecks();
    const first = checks[0];
    if (!first) {
      throw new Error(
        `No check instructions found in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}.`,
      );
    }
    return first;
  }

  override toRulesyncChecks(): RulesyncCheck[] {
    const fileContent = this.getFileContent();
    const sections: { name: string; content: string }[] = [];
    const markers = findMarkers(fileContent);

    // Anything ahead of the first marker was hand-written beside the generated
    // sections — or is the whole of a file rulesync never wrote. Either way it
    // is instruction text, so it imports as its own check rather than vanishing.
    const preambleEnd = markers[0]?.start ?? fileContent.length;
    const preamble = fileContent.slice(0, preambleEnd).trim();
    if (preamble.length > 0) {
      sections.push({ name: FALLBACK_CHECK_NAME, content: unescapeMarkers(preamble) });
    }

    for (const [index, marker] of markers.entries()) {
      const sectionEnd = markers[index + 1]?.start ?? fileContent.length;
      const markerName = marker.name.trim();
      // The marker name comes from someone else's BUGBOT.md on import, so it
      // goes through the slug rules: a raw `../escape` would otherwise write
      // outside the checks directory.
      const name = slugifyCheckName(markerName) || FALLBACK_CHECK_NAME;
      // Matched against the marker name rather than the slug, because that is
      // what generate put in the heading — a check named `No_Console` would
      // otherwise keep its heading and stack a second one on the next generate.
      const content = stripGeneratedHeading(
        fileContent.slice(marker.end, sectionEnd).trim(),
        markerName,
      );
      sections.push({ name, content: unescapeMarkers(content) });
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
        // Bugbot instructions are plain prose, so they apply to any tool — this
        // imports the way an Amp check or a Takt string gate does.
        frontmatter: { targets: ["*"] },
        body: content,
      });
    });
  }
}
