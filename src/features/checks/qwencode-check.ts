import { QWENCODE_DIR, QWENCODE_REVIEW_RULES_FILE_NAME } from "../../constants/qwencode-paths.js";
import { AggregatedToolCheck, type AggregatedToolCheckConfig } from "./aggregated-tool-check.js";
import { type ToolCheckSettablePaths } from "./tool-check.js";

/**
 * Checks adapter for Qwen Code's `/review` project rules (`.qwen/review-rules.md`).
 *
 * `/review` reads one plain-Markdown rules file and injects it into its review
 * agents as additional criteria, so every `.rulesync/checks/*.md` targeting
 * Qwen Code collapses into it via the `fromRulesyncChecks` on
 * {@link AggregatedToolCheck}, with each check written as a marked section (see
 * `aggregated-check-file.ts` for the marker convention).
 *
 * `/review` reads the file as free prose, so a check's `severity` and `tools`
 * have no equivalent there: they are not written and do not come back on
 * import. Neither does `description` whenever the check also has a body.
 *
 * Project scope only — `/review` reads the file from the repository (from the
 * base branch for PR reviews), and there is no user-level rules file. The
 * reviewer policy settings under `review.*` are a different surface: upstream
 * honors them only in user/system settings and they are not review criteria.
 *
 * @see https://qwenlm.github.io/qwen-code-docs/en/users/features/code-review/
 */
export class QwencodeCheck extends AggregatedToolCheck {
  static getSettablePaths(_options: { global?: boolean } = {}): ToolCheckSettablePaths {
    // Naming the file keeps consumers that would otherwise claim the whole
    // `.qwen/` tree — the gitignore derivation, for one — narrowed to the one
    // file written, since every other Qwen Code feature writes there too.
    return { relativeDirPath: QWENCODE_DIR, relativeFilePath: QWENCODE_REVIEW_RULES_FILE_NAME };
  }

  protected static override getAggregatedCheckConfig(): AggregatedToolCheckConfig {
    return {
      displayName: "Qwen Code",
      toolTarget: "qwencode",
      // The name given to a hand-written file with no marked section.
      fallbackCheckName: "review-rules",
      // `review-rules.md` is a path only `/review` reads, so rewriting it
      // replaces review instructions with review instructions.
      handWrittenPreamble: "replace",
    };
  }
}
