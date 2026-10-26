import { CORTEXCODE_RULE_FILE_NAME } from "../../constants/cortexcode-paths.js";
import { SingleRootFileRule } from "./single-root-file-rule.js";
import { ToolRuleSettablePaths } from "./tool-rule.js";

/**
 * Rule generator for Snowflake Cortex Code.
 *
 * The Cortex Code CLI documents `AGENTS.md` at the project root as its
 * instruction file ("Support for AGENTS.md files and Agent Skills"). No nested
 * rule directory and no user-scoped rule file are documented for the CLI, so
 * rulesync's topic-based non-root rules are folded into the single root
 * `AGENTS.md` by the RulesProcessor (`nonRoot` is `undefined`, mirroring the
 * codexcli and warp targets) and the target is project-only.
 *
 * @see https://docs.snowflake.com/en/user-guide/cortex-code/cortex-code
 */
export type CortexcodeRuleSettablePaths = Pick<ToolRuleSettablePaths, "root"> & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  nonRoot?: undefined;
};

export class CortexcodeRule extends SingleRootFileRule {
  static getSettablePaths(
    _options: {
      global?: boolean;
      excludeToolDir?: boolean;
    } = {},
  ): CortexcodeRuleSettablePaths {
    return {
      root: {
        relativeDirPath: ".",
        relativeFilePath: CORTEXCODE_RULE_FILE_NAME,
      },
    };
  }

  protected static override readonly toolTarget = "cortexcode";
}
