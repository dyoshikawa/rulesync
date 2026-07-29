import { join } from "node:path";

import { CURSOR_BUGBOT_FILE_NAME, CURSOR_DIR } from "../../constants/cursor-paths.js";
import type { ValidationResult } from "../../types/ai-file.js";
import { readFileContentOrNull } from "../../utils/file.js";
import { hasHandWrittenContent, renderCheckFile, splitCheckFile } from "./aggregated-check-file.js";
import { RulesyncCheck } from "./rulesync-check.js";
import {
  ToolCheck,
  type ToolCheckForDeletionParams,
  type ToolCheckFromFileParams,
  type ToolCheckFromRulesyncCheckParams,
  type ToolCheckFromRulesyncChecksParams,
  type ToolCheckSettablePaths,
} from "./tool-check.js";

const FALLBACK_CHECK_NAME = "bugbot";

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
    return !hasHandWrittenContent(fileContent);
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
    if (hasHandWrittenContent(existingContent)) {
      logger?.warn(
        `Cursor checks: ${filePath} holds instructions rulesync did not write, and generating ` +
          `replaces the whole file. Run \`rulesync import --targets cursor --features checks\` ` +
          `first to keep them.`,
      );
    }

    const fileContent = renderCheckFile(rulesyncChecks);

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
    return splitCheckFile({
      fileContent: this.getFileContent(),
      fallbackName: FALLBACK_CHECK_NAME,
    });
  }
}
