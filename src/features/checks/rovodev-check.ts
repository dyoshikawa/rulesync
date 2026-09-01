import { ROVODEV_DIR, ROVODEV_REVIEW_AGENT_FILE_NAME } from "../../constants/rovodev-paths.js";
import { AggregatedToolCheck, type AggregatedToolCheckConfig } from "./aggregated-tool-check.js";
import { type ToolCheckSettablePaths } from "./tool-check.js";

/**
 * Checks adapter for Rovo Dev CLI's code-review custom instructions
 * (`.rovodev/.review-agent.md`).
 *
 * Rovo Dev takes one plain-Markdown instruction file at the repository root's
 * `.rovodev/` folder — no frontmatter, and note the leading dot in the file
 * name. Like Cursor Bugbot it is a single aggregated file rather than a file
 * per check, so every `.rulesync/checks/*.md` targeting Rovo Dev collapses into
 * it via the `fromRulesyncChecks` on {@link AggregatedToolCheck}, with each
 * check written as a marked section (see `aggregated-check-file.ts` for the
 * marker convention the three aggregated adapters share).
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
export class RovodevCheck extends AggregatedToolCheck {
  static getSettablePaths(_options: { global?: boolean } = {}): ToolCheckSettablePaths {
    // Naming the file keeps consumers that would otherwise claim the whole
    // `.rovodev/` tree — the gitignore derivation, for one — narrowed to the
    // one file written, since every other Rovo Dev feature writes there too.
    return { relativeDirPath: ROVODEV_DIR, relativeFilePath: ROVODEV_REVIEW_AGENT_FILE_NAME };
  }

  protected static override getAggregatedCheckConfig(): AggregatedToolCheckConfig {
    return {
      displayName: "Rovo Dev",
      toolTarget: "rovodev",
      // The name given to a hand-written file with no marked section.
      fallbackCheckName: "review-agent",
      // `.review-agent.md` is a path only the reviewer reads, so rewriting it
      // replaces review instructions with review instructions.
      handWrittenPreamble: "replace",
    };
  }
}
