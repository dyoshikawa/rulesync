import { DSH_DIR } from "../../constants/dsh-paths.js";
import { NestedAgentsmdRule, NestedAgentsmdRuleFamily } from "./nested-agentsmd-rule.js";

/**
 * DeepSeek Harness (`dsh`) rules.
 *
 * Project scope writes the root `AGENTS.md` plus nested `<dir>/AGENTS.md`
 * files — the project chain `dsh-agent-instructions` loads from the `.git`
 * root down to the session cwd, broad to specific, so a per-directory file
 * applies only while working under that directory. Global scope writes the
 * user-global `~/.dsh/AGENTS.md` (`$DSH_HOME` default), which the harness
 * reads as a single root file with no `.local.md` overlay, so non-root rules
 * fold into it.
 *
 * @see https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/context/agent-instructions/README.md
 */
export class DshRule extends NestedAgentsmdRule {
  protected static getFamily(): NestedAgentsmdRuleFamily {
    return { globalDir: DSH_DIR, toolTarget: "dsh" };
  }
}
