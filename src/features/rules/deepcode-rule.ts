import { DEEPCODE_DIR } from "../../constants/deepcode-paths.js";
import { NestedAgentsmdRule, NestedAgentsmdRuleFamily } from "./nested-agentsmd-rule.js";

/**
 * DeepCode (HKUDS) rules.
 *
 * DeepCode reads project instructions from the root `AGENTS.md` and from
 * further `AGENTS.md` files inside packages, the one closer to the working
 * directory taking precedence, so a directory-scoped rule is emitted as a
 * nested `<subprojectPath>/AGENTS.md` while plain topic rules fold into the
 * root file. Personal instructions live in `~/.deepcode/AGENTS.md`
 * (`$DEEPCODE_HOME` default), which is a single root file, so non-root rules
 * fold into it. Within one directory DeepCode uses the first of `AGENTS.md`,
 * `DEEPCODE.md` and `CLAUDE.md`; rulesync writes only `AGENTS.md`.
 *
 * @see https://github.com/HKUDS/DeepCode/blob/main/docs/guide/skills-and-memory.md
 */
export class DeepcodeRule extends NestedAgentsmdRule {
  protected static getFamily(): NestedAgentsmdRuleFamily {
    return { globalDir: DEEPCODE_DIR, toolTarget: "deepcode" };
  }
}
