import { BOB_CUSTOM_MODES_FILE_NAME, BOB_DIR } from "../../constants/bob-paths.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import { isRecord, isStringArray } from "../../utils/type-guards.js";
import { RooMode, RooSubagent } from "./roo-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";
import type { ToolSubagentSettablePaths } from "./tool-subagent.js";

/**
 * Subagent (custom-mode) generator for **IBM Bob** (Bob IDE and Bob Shell).
 *
 * Bob has no file-based subagents — its native subagents are the two fixed
 * presets `explore` and `general` — but it reads custom modes from an
 * aggregated `customModes` YAML file in Roo's format, so every targeted rulesync
 * subagent becomes one mode in `.bob/custom_modes.yaml`, exactly as the `roo`
 * target fills `.roomodes`. Only the project file is emitted: the Bob IDE and
 * Bob Shell docs name different global files.
 *
 * The mode fields ride a `bob:` frontmatter section rather than Roo's `roo:`
 * one, because Bob's tool groups are spelled differently (`execute` where Roo
 * says `command`, plus `skill`, `workflow`, `todo`, `subtask`, `subagent` and
 * `mode`), so a `roo.groups` list is not valid for Bob. A mode without
 * `bob.groups` gets `["read", "edit", "execute", "mcp"]`, Roo's default with
 * Bob IDE's spelling — the one Bob's shared approval settings use too. The Bob
 * Shell custom-modes page still lists Roo's `command` / `browser` groups, so a
 * mode meant for the Shell should spell its groups out in `bob.groups`.
 * `bob.allowedSubagents` (Bob IDE) is emitted when it is a string list, and
 * every other mode field is lifted back into `bob:` on import.
 *
 * @see https://bob.ibm.com/docs/ide/configuration/custom-modes
 * @see https://bob.ibm.com/docs/shell/configuration/custom-modes-bobshell
 * @see https://bob.ibm.com/docs/ide/features/subagents
 */
export class BobSubagent extends RooSubagent {
  protected static override readonly modesFileName: string = BOB_CUSTOM_MODES_FILE_NAME;
  protected static override readonly modeSectionKey: string = "bob";
  protected static override readonly defaultGroups: readonly string[] = [
    "read",
    "edit",
    "execute",
    "mcp",
  ];
  protected static override readonly importTarget: ToolTarget = "bob";

  static override getSettablePaths(_options: { global?: boolean } = {}): ToolSubagentSettablePaths {
    // Naming the file keeps the derived gitignore entry to that one file
    // instead of the whole `.bob/` directory, which holds other features'
    // outputs and hand-maintained settings.
    return {
      relativeDirPath: BOB_DIR,
      relativeFilePath: BOB_CUSTOM_MODES_FILE_NAME,
    };
  }

  static override isTargetedByRulesyncSubagent(rulesyncSubagent: RulesyncSubagent): boolean {
    return this.isTargetedByRulesyncSubagentDefault({
      rulesyncSubagent,
      toolTarget: "bob",
    });
  }

  static override toRooMode(rulesyncSubagent: RulesyncSubagent): RooMode {
    const mode = super.toRooMode(rulesyncSubagent);

    const frontmatter = rulesyncSubagent.getFrontmatter() as Record<string, unknown>;
    const bobSection = isRecord(frontmatter.bob) ? frontmatter.bob : {};
    if (isStringArray(bobSection.allowedSubagents)) {
      (mode as Record<string, unknown>).allowedSubagents = bobSection.allowedSubagents;
    }

    return mode;
  }
}
