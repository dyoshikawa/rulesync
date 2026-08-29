import { join } from "node:path";

import {
  FACTORYDROID_REVIEW_GUIDELINES_DIR_NAME,
  FACTORYDROID_REVIEW_GUIDELINES_DIR_PATH,
} from "../../constants/factorydroid-paths.js";
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

// The skill's own name: an import that finds no marked section attributes the
// whole file to one check named after it.
const FALLBACK_CHECK_NAME = FACTORYDROID_REVIEW_GUIDELINES_DIR_NAME;

/**
 * Drop the YAML frontmatter of a hand-authored `review-guidelines` skill before
 * the file is split into checks.
 *
 * rulesync never writes frontmatter here, but a user who authored this path as
 * an ordinary skill did, and that block is the skill's metadata rather than
 * review instructions. Left in the body it would be re-read as the check's own
 * frontmatter on the next load — a `severity: bogus` copied out of a skill
 * would then fail `.rulesync/checks/` validation for a file rulesync had just
 * written.
 *
 * The block is found the way gray-matter finds it rather than by parsing it, so
 * that exactly what gray-matter would have swallowed is dropped and no more:
 * a block whose YAML is invalid goes too (writing the check back out re-parses
 * whatever leads the body, so leaving it in place turns a stray
 * `name: [unclosed` in someone else's file into an import that throws), while
 * a fence nothing closes is left alone as the horizontal rule it is — treating
 * it as frontmatter is what empties the file.
 */
const FRONTMATTER_OPEN_PATTERN = /^\uFEFF?---[^\S\r\n]*\r?\n/;
// gray-matter ends the block at the first `\n---`, with no requirement that the
// delimiter be alone on its line, and drops one newline after it.
const FRONTMATTER_CLOSE_PATTERN = /\r?\n---/;
const LEADING_BLANK_LINE_PATTERN = /^[^\S\r\n]*\r?\n/;

function stripSkillFrontmatter(fileContent: string): string {
  let content = fileContent;
  // A loop, not a single pass: the written check is re-read from its own text,
  // so a second block stacked behind the first would become its frontmatter.
  for (;;) {
    const opening = FRONTMATTER_OPEN_PATTERN.exec(content);
    if (!opening) {
      return content;
    }
    const rest = content.slice(opening[0].length);
    const closing = FRONTMATTER_CLOSE_PATTERN.exec(rest);
    if (!closing) {
      // Nothing closes the fence, so this is prose under a horizontal rule and
      // only the rule itself goes. Reading it as frontmatter would leave an
      // empty body, and the warning on the generate side tells people to import
      // this file precisely to keep what it holds.
      return rest;
    }
    content = rest.slice(closing.index + closing[0].length).replace(LEADING_BLANK_LINE_PATTERN, "");
  }
}

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
          `generating replaces the whole file. If they were hand-authored, run ` +
          `\`rulesync import --targets factorydroid --features checks\` first to keep them. ` +
          `A rulesync skill named \`${FACTORYDROID_REVIEW_GUIDELINES_DIR_NAME}\` is no longer ` +
          `generated here — Factory's reviewer reads this path, so the checks feature owns it — ` +
          `but a directory an older rulesync wrote can still be sitting there.`,
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
      fileContent: stripSkillFrontmatter(this.getFileContent()),
      fallbackName: FALLBACK_CHECK_NAME,
    });
  }
}
