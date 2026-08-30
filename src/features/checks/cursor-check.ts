import { CURSOR_BUGBOT_FILE_NAME, CURSOR_DIR } from "../../constants/cursor-paths.js";
import { AggregatedToolCheck, type AggregatedToolCheckConfig } from "./aggregated-tool-check.js";
import { type ToolCheckSettablePaths } from "./tool-check.js";

/**
 * Checks adapter for Cursor Bugbot (`.cursor/BUGBOT.md`).
 *
 * Bugbot takes one aggregated instruction file per directory rather than a file
 * per check, so every `.rulesync/checks/*.md` targeting Cursor collapses into
 * the repository-root `.cursor/BUGBOT.md` — hence `fromRulesyncChecks` rather
 * than the usual per-check conversion, which {@link AggregatedToolCheck}
 * provides. Each check becomes one section: an HTML-comment marker carrying the
 * check name, an `## <name>` heading, and the check body as the instruction
 * text (the `description` is used when the body is empty).
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
 * `canDeleteAuxiliaryFiles` on the base), though generating checks for Cursor
 * does replace it — import first to keep what is there, which is warned about.
 *
 * @see https://cursor.com/docs/bugbot
 */
export class CursorCheck extends AggregatedToolCheck {
  static getSettablePaths(_options: { global?: boolean } = {}): ToolCheckSettablePaths {
    // Naming the file keeps consumers that would otherwise claim the whole
    // `.cursor/` tree — the gitignore derivation, for one — narrowed to the one
    // file written, since every other Cursor feature writes there too.
    return { relativeDirPath: CURSOR_DIR, relativeFilePath: CURSOR_BUGBOT_FILE_NAME };
  }

  protected static override getAggregatedCheckConfig(): AggregatedToolCheckConfig {
    return {
      displayName: "Cursor",
      toolTarget: "cursor",
      // The name given to a hand-written file with no marked section.
      fallbackCheckName: "bugbot",
      // `.cursor/BUGBOT.md` is a path only the reviewer reads, so rewriting it
      // replaces review instructions with review instructions.
      handWrittenPreamble: "replace",
    };
  }
}
