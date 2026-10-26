import { COMMANDCODE_DIR, COMMANDCODE_RULE_FILE_NAME } from "../../constants/commandcode-paths.js";
import { SingleRootFileRule } from "./single-root-file-rule.js";
import { ToolRuleSettablePaths } from "./tool-rule.js";

/**
 * Rule generator for Command Code, the open-source terminal coding agent.
 *
 * Command Code reads the project `AGENTS.md` at the repository root (the
 * `.commandcode/AGENTS.md` fallback is only consulted when the root file is
 * missing) and the user `~/.commandcode/AGENTS.md`. An `AGENTS.md` in a
 * subdirectory is loaded lazily, only once the agent touches a file beneath
 * it, so there is no deterministic nested rules surface to emit and rulesync's
 * topic-based non-root rules are folded into the single root file by the
 * RulesProcessor (`nonRoot` is `undefined`).
 *
 * @see https://commandcode.ai/docs/memory
 */
export type CommandcodeRuleSettablePaths = Pick<ToolRuleSettablePaths, "root"> & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  nonRoot?: undefined;
};

export class CommandcodeRule extends SingleRootFileRule {
  static getSettablePaths({
    global = false,
  }: {
    global?: boolean;
    excludeToolDir?: boolean;
  } = {}): CommandcodeRuleSettablePaths {
    return {
      root: {
        // The workspace file sits at the project root; the user file sits
        // inside the profile directory, which the processor reaches by
        // supplying the home directory as outputRoot.
        relativeDirPath: global ? COMMANDCODE_DIR : ".",
        relativeFilePath: COMMANDCODE_RULE_FILE_NAME,
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
      relativeFilePath === COMMANDCODE_RULE_FILE_NAME &&
      (relativeDirPath === "." || relativeDirPath === COMMANDCODE_DIR)
    );
  }

  protected static override readonly toolTarget = "commandcode";
}
