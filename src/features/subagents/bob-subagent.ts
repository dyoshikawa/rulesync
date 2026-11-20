import { join } from "node:path";

import {
  BOB_CUSTOM_MODES_FILE_NAME,
  BOB_DIR,
  BOB_GLOBAL_SETTINGS_DIR_PATH,
} from "../../constants/bob-paths.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import { formatError } from "../../utils/error.js";
import { isRecord, isStringArray } from "../../utils/type-guards.js";
import { loadYaml } from "../../utils/yaml.js";
import { RooMode, RooSubagent, stringifyRooModes } from "./roo-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";
import type { ToolSubagentSettablePaths } from "./tool-subagent.js";

/**
 * Subagent (custom-mode) generator for **IBM Bob** (Bob IDE and Bob Shell).
 *
 * Bob has no file-based subagents — its native subagents are the two fixed
 * presets `explore` and `general` — but it reads custom modes from an
 * aggregated `customModes` YAML file in Roo's format, so every targeted rulesync
 * subagent becomes one mode in `.bob/custom_modes.yaml`, exactly as the `roo`
 * target fills `.roomodes`. In global mode the same array goes to
 * `~/.bob/settings/custom_modes.yaml`, the user file both the Bob IDE and Bob
 * Shell custom-modes pages name. That file is unversioned and Bob IDE's "Edit
 * Global Modes" setting writes it too, so rulesync does not own it: a global
 * generate merges the generated modes into it by `slug`, keeps every other
 * mode, and the file is never deleted. The project file stays wholly owned by
 * rulesync, like Roo's `.roomodes`.
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

  static override getSettablePaths({
    global = false,
  }: { global?: boolean } = {}): ToolSubagentSettablePaths {
    // Naming the file keeps the derived gitignore entry to that one file
    // instead of the whole `.bob/` directory, which holds other features'
    // outputs and hand-maintained settings.
    return {
      relativeDirPath: global ? BOB_GLOBAL_SETTINGS_DIR_PATH : BOB_DIR,
      relativeFilePath: BOB_CUSTOM_MODES_FILE_NAME,
    };
  }

  override isDeletable(): boolean {
    // The global file is shared with Bob IDE's own mode editor.
    return !this.global;
  }

  override shouldMergeExistingFileContent(): boolean {
    return this.global;
  }

  /**
   * Merge the generated modes into the existing global file: a mode whose
   * `slug` rulesync generates is replaced in place, every other entry is kept
   * as written, and new modes are appended. A file that cannot be read as a
   * `customModes` document is an error rather than something to overwrite.
   */
  override setFileContent(existingContent: string): void {
    if (!this.global) {
      super.setFileContent(existingContent);
      return;
    }
    const filePath = join(
      this.getOutputRoot(),
      this.getRelativeDirPath(),
      this.getRelativeFilePath(),
    );
    let parsed: unknown;
    try {
      parsed = loadYaml(existingContent);
    } catch (error) {
      throw new Error(
        `Failed to parse custom modes (${filePath}); not overwriting it: ${formatError(error)}`,
        { cause: error },
      );
    }
    const existingModes = isRecord(parsed) ? parsed.customModes : undefined;
    if (
      !(parsed === null || parsed === undefined || isRecord(parsed)) ||
      !(existingModes === null || existingModes === undefined || Array.isArray(existingModes))
    ) {
      throw new Error(
        `Invalid custom modes in ${filePath}; not overwriting it: expected a "customModes" list.`,
      );
    }

    const generated = new Map(this.getModes().map((mode) => [mode.slug, mode]));
    const merged: unknown[] = (Array.isArray(existingModes) ? existingModes : []).map((entry) => {
      const slug = isRecord(entry) ? entry.slug : undefined;
      if (typeof slug !== "string" || !generated.has(slug)) {
        return entry;
      }
      const mode = generated.get(slug);
      generated.delete(slug);
      return mode;
    });
    merged.push(...generated.values());

    super.setFileContent(stringifyRooModes(merged));
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
