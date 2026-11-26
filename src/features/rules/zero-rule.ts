import { join } from "node:path";

import {
  ZERO_AGENTSMD_FILE_NAME,
  ZERO_RULE_FILE_NAME,
  zeroGlobalConfigDir,
} from "../../constants/zero-paths.js";
import { stripControlCharacters } from "../../utils/control-characters.js";
import { fileExists } from "../../utils/file.js";
import { SingleRootFileRule } from "./single-root-file-rule.js";
import { ToolRule, ToolRuleRootOnlySettablePaths } from "./tool-rule.js";

/**
 * Rule generator for Zero (`Twigpine/zero`).
 *
 * Zero walks from the git root down to the working directory and, at each
 * level, reads the first of `AGENTS.md`, `ZERO.md` and `.zero/AGENTS.md` that
 * exists. rulesync writes Zero's own `ZERO.md` at the project root, so it only
 * takes effect when no `AGENTS.md` sits beside it (the `agentsmd` target
 * covers that file). The user-level file is `<user config dir>/zero/ZERO.md`
 * (`~/.config/zero/ZERO.md` on Linux and macOS, `%AppData%\zero\ZERO.md` on
 * Windows), injected before the project files.
 *
 * Non-root rules fold into the root file, and so does a `localRoot` rule:
 * the documented personal file `.zero/AGENTS.md` is the lowest-priority name
 * of the same level, so Zero never reads it next to a `ZERO.md`.
 *
 * @see https://github.com/Twigpine/zero/blob/main/docs/EXTENDING.md
 * @see https://github.com/Twigpine/zero/blob/main/internal/agent/system_prompt.go
 */
export class ZeroRule extends SingleRootFileRule {
  static getSettablePaths({
    global = false,
  }: {
    global?: boolean;
  } = {}): ToolRuleRootOnlySettablePaths {
    return {
      root: {
        relativeDirPath: global ? zeroGlobalConfigDir() : ".",
        relativeFilePath: ZERO_RULE_FILE_NAME,
      },
    };
  }

  protected static override isRootFilePath({
    relativeDirPath,
    relativeFilePath,
  }: {
    relativeDirPath: string;
    relativeFilePath: string;
    global: boolean;
  }): boolean {
    return (
      relativeFilePath === ZERO_RULE_FILE_NAME &&
      (relativeDirPath === "." || relativeDirPath === zeroGlobalConfigDir())
    );
  }

  /**
   * Warn when an `AGENTS.md` already sits next to the generated project
   * `ZERO.md`: Zero reads only the first match per directory, and `AGENTS.md`
   * comes first, so the generated file would be ignored.
   */
  static async getGenerationWarnings({
    toolRules,
    outputRoot,
    global,
  }: {
    toolRules: ToolRule[];
    outputRoot: string;
    global: boolean;
  }): Promise<string[]> {
    if (global) {
      return [];
    }
    const warnings: string[] = [];
    const dirs = new Set(toolRules.map((rule) => rule.getRelativeDirPath()));
    for (const dir of dirs) {
      const agentsmdPath = join(dir, ZERO_AGENTSMD_FILE_NAME);
      if (!(await fileExists(join(outputRoot, agentsmdPath)))) {
        continue;
      }
      const rulePath = join(dir, ZERO_RULE_FILE_NAME);
      warnings.push(
        `${stripControlCharacters(agentsmdPath)} exists next to ${stripControlCharacters(rulePath)}, and Zero reads only the first of AGENTS.md, ZERO.md and .zero/AGENTS.md in a directory, so the generated ${stripControlCharacters(rulePath)} is ignored by Zero. Zero reads that AGENTS.md instead; drop the zero target for rules if the agentsmd target already covers it.`,
      );
    }
    return warnings;
  }

  protected static override readonly toolTarget = "zero";
}
