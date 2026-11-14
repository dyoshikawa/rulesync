import { CORTEXCODE_RULE_FILE_NAME } from "../../constants/cortexcode-paths.js";
import { SingleRootFileRule } from "./single-root-file-rule.js";
import { ToolRuleRootOnlySettablePaths } from "./tool-rule.js";

/**
 * Rule generator for Snowflake Cortex Code.
 *
 * The Cortex Code CLI documents `AGENTS.md` at the project root as its
 * instruction file. The RulesProcessor folds non-root rules into that file
 * (`nonRoot` is `undefined`, mirroring the codexcli and warp targets).
 * Global rules are unsupported: this adapter only handles the project file.
 * CoCo Desktop's `~/.snowflake/cortex/AGENTS.md` is outside that scope.
 *
 * @see https://docs.snowflake.com/en/user-guide/cortex-code/cortex-code
 */
export class CortexcodeRule extends SingleRootFileRule {
  static getSettablePaths(
    _options: {
      global?: boolean;
    } = {},
  ): ToolRuleRootOnlySettablePaths {
    return {
      root: {
        relativeDirPath: ".",
        relativeFilePath: CORTEXCODE_RULE_FILE_NAME,
      },
    };
  }

  protected static override readonly toolTarget = "cortexcode";
}
