import { KILO_REVIEW_FILE_NAME } from "../../constants/kilo-paths.js";
import { type ToolTarget } from "../../types/tool-targets.js";
import { AggregatedToolCheck, type AggregatedToolCheckConfig } from "./aggregated-tool-check.js";
import { type ToolCheckSettablePaths } from "./tool-check.js";

function handWrittenWarning({
  filePath,
  displayName,
  toolTarget,
}: {
  filePath: string;
  displayName: string;
  toolTarget: ToolTarget;
}): string {
  return (
    `${displayName} checks: ${filePath} holds instructions rulesync did not write, so it is ` +
    `left as it is and no checks were generated for ${displayName}. Run ` +
    `\`rulesync import --targets ${toolTarget} --features checks\` to bring them into ` +
    `\`.rulesync/checks/\` and then delete the file, so the next generate writes it back ` +
    `from there. Importing alone leaves this file as it is, so it keeps blocking generation ` +
    `until it is gone.`
  );
}

/**
 * Checks adapter for Kilo Code Reviews' repository guidance (root `REVIEW.md`).
 *
 * The Kilo review agent reads one plain-Markdown file at the repository root
 * (from the PR/MR base branch, once "Use REVIEW.md" is enabled in the Kilo web
 * app), so every `.rulesync/checks/*.md` targeting Kilo collapses into it via
 * the `fromRulesyncChecks` on {@link AggregatedToolCheck}, with each check
 * written as a marked section (see `aggregated-check-file.ts` for the marker
 * convention).
 *
 * The reviewer reads the file as free prose, so a check's `severity` and
 * `tools` have no equivalent there: they are not written and do not come back
 * on import. Neither does `description` whenever the check also has a body.
 *
 * Project scope only — the reviewer reads the file from the repository and
 * there is no user-level equivalent.
 *
 * A root-level `REVIEW.md` is a generic name other reviewers may read too, so
 * unlike Cursor Bugbot's tool-specific `.cursor/BUGBOT.md` a hand-written file
 * here is left untouched (the `skip` policy) rather than replaced.
 *
 * @see https://kilo.ai/docs/automate/code-reviews
 */
export class KiloCheck extends AggregatedToolCheck {
  static getSettablePaths(_options: { global?: boolean } = {}): ToolCheckSettablePaths {
    return { relativeDirPath: ".", relativeFilePath: KILO_REVIEW_FILE_NAME };
  }

  protected static override getAggregatedCheckConfig(): AggregatedToolCheckConfig {
    return {
      displayName: "Kilo Code",
      toolTarget: "kilo",
      // The name given to a hand-written file with no marked section.
      fallbackCheckName: "review",
      handWrittenPreamble: "skip",
      handWrittenWarning,
    };
  }
}
