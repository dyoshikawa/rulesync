import { join } from "node:path";

import { ROVODEV_DIR, ROVODEV_REVIEW_AGENT_FILE_NAME } from "../../constants/rovodev-paths.js";
import type { ValidationResult } from "../../types/ai-file.js";
import { readFileContentOrNull } from "../../utils/file.js";
import {
  hasHandWrittenPreamble,
  isOnlyGeneratedSections,
  renderCheckFile,
  splitCheckFile,
} from "./aggregated-check-file.js";
import { RulesyncCheck } from "./rulesync-check.js";
import {
  ToolCheck,
  type ToolCheckForDeletionParams,
  type ToolCheckFromFileParams,
  type ToolCheckFromRulesyncCheckParams,
  type ToolCheckFromRulesyncChecksParams,
  type ToolCheckSettablePaths,
} from "./tool-check.js";

const FALLBACK_CHECK_NAME = "review-agent";

/**
 * Checks adapter for Rovo Dev CLI's code-review custom instructions
 * (`.rovodev/.review-agent.md`).
 *
 * Rovo Dev takes one plain-Markdown instruction file at the repository root's
 * `.rovodev/` folder — no frontmatter, and note the leading dot in the file
 * name. Like Cursor Bugbot it is a single aggregated file rather than a file
 * per check, so every `.rulesync/checks/*.md` targeting Rovo Dev collapses into
 * it via {@link fromRulesyncChecks}, with each check written as a marked
 * section (see `aggregated-check-file.ts` for the marker convention the two
 * adapters share).
 *
 * Rovo Dev reads the file as free prose, so a check's `severity` and `tools`
 * have no equivalent there: they are not written and do not come back on
 * import. Neither does `description` whenever the check also has a body.
 *
 * Project scope only — these are per-repository review instructions, and Rovo
 * Dev documents no user-level equivalent. (The `permissions` adapter for the
 * same tool is the opposite: global only.)
 *
 * @see https://support.atlassian.com/rovo/docs/set-custom-instructions-for-code-reviews/
 */
export class RovodevCheck extends ToolCheck {
  static getSettablePaths(_options: { global?: boolean } = {}): ToolCheckSettablePaths {
    // Naming the file keeps consumers that would otherwise claim the whole
    // `.rovodev/` tree — the gitignore derivation, for one — narrowed to the
    // one file written, since every other Rovo Dev feature writes there too.
    return { relativeDirPath: ROVODEV_DIR, relativeFilePath: ROVODEV_REVIEW_AGENT_FILE_NAME };
  }

  static isTargetedByRulesyncCheck(rulesyncCheck: RulesyncCheck): boolean {
    return this.isTargetedByRulesyncCheckDefault({ rulesyncCheck, toolTarget: "rovodev" });
  }

  /**
   * Ownership guard the processor consults before it deletes anything for this
   * tool. `.review-agent.md` is a file Rovo Dev's own documentation tells users
   * to hand-write, so anything in it that rulesync did not write is not
   * rulesync's to remove — dropping the last check targeting Rovo Dev must not
   * take somebody's hand-written review instructions with it.
   */
  static async canDeleteAuxiliaryFiles({ outputRoot }: { outputRoot: string }): Promise<boolean> {
    const paths = RovodevCheck.getSettablePaths();
    const filePath = join(
      outputRoot,
      paths.relativeDirPath,
      paths.relativeFilePath ?? ROVODEV_REVIEW_AGENT_FILE_NAME,
    );
    const fileContent = await readFileContentOrNull(filePath);
    if (fileContent === null) {
      return true;
    }
    return isOnlyGeneratedSections(fileContent);
  }

  static override fromRulesyncCheck(_params: ToolCheckFromRulesyncCheckParams): RovodevCheck {
    // Sections share one file, so they are only ever built as a set.
    throw new Error("Rovo Dev checks are built from all checks at once; use fromRulesyncChecks.");
  }

  static async fromRulesyncChecks({
    outputRoot = process.cwd(),
    rulesyncChecks,
    global = false,
    logger,
  }: ToolCheckFromRulesyncChecksParams): Promise<RovodevCheck[]> {
    if (rulesyncChecks.length === 0) {
      // No section to write. A stale file from an earlier generate is removed by
      // the processor's deletion pass rather than by an empty file written here.
      return [];
    }

    const paths = RovodevCheck.getSettablePaths({ global });
    const relativeFilePath = paths.relativeFilePath ?? ROVODEV_REVIEW_AGENT_FILE_NAME;
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);

    // The file is rewritten from `.rulesync/checks/` rather than merged into, so
    // say so before hand-written instructions go away — the deletion guard
    // protects them, but generating over them cannot.
    const existingContent = (await readFileContentOrNull(filePath)) ?? "";
    if (hasHandWrittenPreamble(existingContent)) {
      logger?.warn(
        `Rovo Dev checks: ${filePath} holds instructions rulesync did not write, and generating ` +
          `replaces the whole file. Run \`rulesync import --targets rovodev --features checks\` ` +
          `first to keep them.`,
      );
    }

    return [
      new RovodevCheck({
        outputRoot,
        relativeDirPath: paths.relativeDirPath,
        relativeFilePath,
        fileContent: renderCheckFile(rulesyncChecks),
        global,
      }),
    ];
  }

  static async fromFile({
    outputRoot = process.cwd(),
    global = false,
  }: ToolCheckFromFileParams): Promise<RovodevCheck> {
    const paths = RovodevCheck.getSettablePaths({ global });
    const relativeFilePath = paths.relativeFilePath ?? ROVODEV_REVIEW_AGENT_FILE_NAME;
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);
    return new RovodevCheck({
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
  }: ToolCheckForDeletionParams): RovodevCheck {
    return new RovodevCheck({
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
