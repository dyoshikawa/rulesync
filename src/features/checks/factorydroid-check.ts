import { join } from "node:path";

import { FACTORYDROID_REVIEW_GUIDELINES_DIR_PATH } from "../../constants/factorydroid-paths.js";
import { SKILL_FILE_NAME } from "../../constants/general.js";
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

const FALLBACK_CHECK_NAME = "review-guidelines";

/**
 * Checks adapter for Factory Droid's code-review guidelines
 * (`.factory/skills/review-guidelines/SKILL.md`).
 *
 * Factory's automated code review has no dedicated instruction file: it reads
 * "repository-specific review guidelines" from a skill named
 * `review-guidelines` and injects them into every review run. That makes the
 * output a single aggregated file like Cursor Bugbot's and Rovo Dev's, so every
 * `.rulesync/checks/*.md` targeting Factory Droid collapses into it via
 * {@link fromRulesyncChecks}, each check written as a marked section (see
 * `aggregated-check-file.ts` for the marker convention the adapters share).
 *
 * The file is plain Markdown with no frontmatter, matching Factory's documented
 * example. Frontmatter would also be self-defeating here: `renderCheckFile`
 * writes only marked sections, so anything ahead of the first marker counts as
 * a hand-written preamble — it would warn on every generate and permanently
 * block the deletion guard below.
 *
 * Droid reads the sections as free prose, so a check's `severity` and `tools`
 * have no equivalent there: they are not written and do not come back on
 * import. Neither does `description` whenever the check also has a body.
 *
 * Project scope only — the reviewer runs against a repository and reads the
 * file out of it, so there is no user-level equivalent to write.
 *
 * The output lives inside the same `.factory/skills/` tree the `skills` feature
 * writes, so a user-authored `review-guidelines` skill collides with it. The
 * collision is handled the same way as a hand-written `BUGBOT.md`: generating
 * checks warns before replacing the file, and {@link canDeleteAuxiliaryFiles}
 * refuses to remove one holding anything rulesync did not write.
 *
 * @see https://docs.factory.ai/software-factory/code-review-ci
 */
export class FactorydroidCheck extends ToolCheck {
  static getSettablePaths(_options: { global?: boolean } = {}): ToolCheckSettablePaths {
    return {
      relativeDirPath: FACTORYDROID_REVIEW_GUIDELINES_DIR_PATH,
      relativeFilePath: SKILL_FILE_NAME,
    };
  }

  static isTargetedByRulesyncCheck(rulesyncCheck: RulesyncCheck): boolean {
    return this.isTargetedByRulesyncCheckDefault({ rulesyncCheck, toolTarget: "factorydroid" });
  }

  /**
   * Ownership guard the processor consults before it deletes anything for this
   * tool. `review-guidelines` is an ordinary skill directory a user may have
   * authored by hand, so dropping the last check targeting Factory Droid must
   * not take their review instructions with it. Deletion is allowed only for a
   * file that is nothing but generated sections.
   */
  static async canDeleteAuxiliaryFiles({ outputRoot }: { outputRoot: string }): Promise<boolean> {
    const paths = FactorydroidCheck.getSettablePaths();
    const filePath = join(
      outputRoot,
      paths.relativeDirPath,
      paths.relativeFilePath ?? SKILL_FILE_NAME,
    );
    const fileContent = await readFileContentOrNull(filePath);
    if (fileContent === null) {
      return true;
    }
    return isOnlyGeneratedSections(fileContent);
  }

  static override fromRulesyncCheck(_params: ToolCheckFromRulesyncCheckParams): FactorydroidCheck {
    // Sections share one file, so they are only ever built as a set.
    throw new Error(
      "Factory Droid checks are built from all checks at once; use fromRulesyncChecks.",
    );
  }

  static async fromRulesyncChecks({
    outputRoot = process.cwd(),
    rulesyncChecks,
    global = false,
    logger,
  }: ToolCheckFromRulesyncChecksParams): Promise<FactorydroidCheck[]> {
    if (rulesyncChecks.length === 0) {
      // No section to write. A stale file from an earlier generate is removed by
      // the processor's deletion pass rather than by an empty file written here.
      return [];
    }

    const paths = FactorydroidCheck.getSettablePaths({ global });
    const relativeFilePath = paths.relativeFilePath ?? SKILL_FILE_NAME;
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);

    // The file is rewritten from `.rulesync/checks/` rather than merged into, so
    // say so before a hand-authored `review-guidelines` skill goes away — the
    // deletion guard protects it, but generating over it cannot.
    const existingContent = (await readFileContentOrNull(filePath)) ?? "";
    if (hasHandWrittenPreamble(existingContent)) {
      logger?.warn(
        `Factory Droid checks: ${filePath} holds instructions rulesync did not write, and ` +
          `generating replaces the whole file. Run ` +
          `\`rulesync import --targets factorydroid --features checks\` first to keep them.`,
      );
    }

    const fileContent = renderCheckFile(rulesyncChecks);

    return [
      new FactorydroidCheck({
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
  }: ToolCheckFromFileParams): Promise<FactorydroidCheck> {
    const paths = FactorydroidCheck.getSettablePaths({ global });
    const relativeFilePath = paths.relativeFilePath ?? SKILL_FILE_NAME;
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);
    return new FactorydroidCheck({
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
  }: ToolCheckForDeletionParams): FactorydroidCheck {
    return new FactorydroidCheck({
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
