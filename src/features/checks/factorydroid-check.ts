import {
  FACTORYDROID_REVIEW_GUIDELINES_DIR_NAME,
  FACTORYDROID_REVIEW_GUIDELINES_DIR_PATH,
} from "../../constants/factorydroid-paths.js";
import { SKILL_FILE_NAME } from "../../constants/general.js";
import { AggregatedToolCheck, type AggregatedToolCheckConfig } from "./aggregated-tool-check.js";
import { type ToolCheckSettablePaths } from "./tool-check.js";

/**
 * Drop the YAML frontmatter of a hand-authored `review-guidelines` skill before
 * the file is split into checks.
 *
 * rulesync never writes frontmatter here, but a user who authored this path as
 * an ordinary skill did, and that block is the skill's metadata rather than
 * review instructions. Writing the check back out hands the body to
 * gray-matter's `stringify`, which re-parses whatever leads it and *merges*
 * those keys into the frontmatter it is given — so a `severity: bogus` copied
 * out of a skill would fail `.rulesync/checks/` validation for a file rulesync
 * had just written, and a stray `name: [unclosed` would make the import throw
 * a raw YAML error.
 *
 * The block is therefore found the way gray-matter finds it rather than by
 * parsing it, so that what gray-matter would have swallowed is what goes: the
 * opening delimiter may carry a language name (`---yaml`), but four dashes are
 * a horizontal rule gray-matter itself skips. The one deliberate difference is
 * a fence nothing closes: gray-matter would swallow the rest of the file, so
 * only the rule line goes and the prose under it is kept.
 */
// `(?!-)` mirrors gray-matter's own "next character is a delimiter, so this is
// not front matter" test; the rest of the line is the language name it reads.
const FRONTMATTER_OPEN_PATTERN = /^\uFEFF?---(?!-)[^\r\n]*\r?\n/;
// gray-matter ends the block at the first `\n---`, with no requirement that the
// delimiter be alone on its line, and drops one newline after it. It starts
// that search at the newline of the opening line, which the opening pattern
// above has already consumed — so `^---` is the same delimiter seen from here,
// and without it an empty block (`---` on two adjacent lines) would look
// unclosed.
const FRONTMATTER_CLOSE_PATTERN = /^---|\r?\n---/;
const LEADING_BLANK_LINE_PATTERN = /^[^\S\r\n]*\r?\n/;

function stripSkillFrontmatter(fileContent: string): string {
  let content = fileContent;
  // A loop, not a single pass: gray-matter takes only the leading block, so a
  // second one written immediately behind the first would lead the body and be
  // merged into the check's own frontmatter on the way out. A block further
  // down is ordinary content and the loop stops before it.
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

function handWrittenWarning({ filePath }: { filePath: string }): string {
  return (
    `Factory Droid checks: ${filePath} holds instructions rulesync did not write, so it is ` +
    `left as it is and no checks were generated for Factory Droid. Run ` +
    `\`rulesync import --targets factorydroid --features checks\` to bring them into ` +
    `\`.rulesync/checks/\` and then delete the file, so the next generate writes it back ` +
    `from there; delete it outright if you no longer want it, or rename the directory if ` +
    `it is an ordinary skill rather than review guidelines. Importing alone leaves this ` +
    `file as it is, so it keeps blocking generation until it is gone. A rulesync skill ` +
    `named \`${FACTORYDROID_REVIEW_GUIDELINES_DIR_NAME}\` is no longer generated here — ` +
    `Factory's reviewer reads this path, so the checks feature owns it — but a directory ` +
    `an older rulesync wrote can still be sitting there.`
  );
}

/**
 * Checks adapter for Factory Droid's code-review guidelines
 * (`.factory/skills/review-guidelines/SKILL.md`).
 *
 * Factory's automated code review has no dedicated instruction file: it reads
 * "repository-specific review guidelines" from a skill named
 * `review-guidelines` and injects them into every review run. That makes the
 * output a single aggregated file like Cursor Bugbot's and Rovo Dev's, so every
 * `.rulesync/checks/*.md` targeting Factory Droid collapses into it via the
 * `fromRulesyncChecks` on {@link AggregatedToolCheck}, each check written as a
 * marked section (see `aggregated-check-file.ts` for the marker convention the
 * three aggregated adapters share).
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
 * path has one owner rather than a merge rule, and the owner is this feature:
 * generating leaves a file holding anything rulesync did not write untouched —
 * the `skip` policy below — and the base's `canDeleteAuxiliaryFiles` refuses to
 * remove one.
 * Their content is somebody's own writing and rulesync cannot reconstruct it,
 * so neither direction guesses. That is stricter than Cursor Bugbot's
 * replace-and-warn, and deliberately: `.cursor/BUGBOT.md` is a path only the
 * reviewer reads, so rewriting it replaces review instructions with review
 * instructions, while a file here may be an ordinary skill written for Droid's
 * skill loader that has nothing to do with reviews.
 *
 * @see https://docs.factory.ai/software-factory/code-review-ci
 */
export class FactorydroidCheck extends AggregatedToolCheck {
  static getSettablePaths(_options: { global?: boolean } = {}): ToolCheckSettablePaths {
    return {
      relativeDirPath: FACTORYDROID_REVIEW_GUIDELINES_DIR_PATH,
      relativeFilePath: SKILL_FILE_NAME,
    };
  }

  protected static override getAggregatedCheckConfig(): AggregatedToolCheckConfig {
    return {
      displayName: "Factory Droid",
      toolTarget: "factorydroid",
      // The skill's own name: an import that finds no marked section attributes
      // the whole file to one check named after it.
      fallbackCheckName: FACTORYDROID_REVIEW_GUIDELINES_DIR_NAME,
      // Stricter than Cursor Bugbot's replace-and-warn, and deliberately: a
      // file here may be an ordinary skill written for Droid's skill loader
      // that has nothing to do with reviews.
      handWrittenPreamble: "skip",
      handWrittenWarning,
      // The only aggregated adapter that needs one: this path can also hold a
      // hand-authored skill, and a skill carries frontmatter.
      transformImportedContent: stripSkillFrontmatter,
    };
  }
}
