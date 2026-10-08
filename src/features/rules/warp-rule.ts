import { WARP_GLOBAL_RULE_DIR } from "../../constants/warp-paths.js";
import { AiFileParams } from "../../types/ai-file.js";
import { NestedAgentsmdRule, NestedAgentsmdRuleFamily } from "./nested-agentsmd-rule.js";

export type WarpRuleParams = AiFileParams & {
  root?: boolean;
};

/**
 * Warp rules.
 *
 * Warp reads project rules from `AGENTS.md` (or the back-compat `WARP.md`) at
 * the repository root and in subdirectories "for more targeted guidance": it
 * applies the root file plus the current directory's file, and the
 * subdirectory's rules take precedence over the root's. Nested per-directory
 * files are therefore a real scoping surface. Warp does NOT scan a
 * `.warp/memories/` directory and does not follow references out of a rules
 * file, so every non-root rule without `agentsmd.subprojectPath` folds into
 * the root `./AGENTS.md`.
 *
 * In global mode, Warp reads a third rule source from `~/.agents/AGENTS.md`
 * (the cross-tool agent config directory), indexed like project rules and also
 * used from remote hosts in SSH sessions. The same root-fold policy applies.
 *
 * @see https://docs.warp.dev/agents/capabilities/rules/
 * @see https://docs.warp.dev/terminal/settings/file-locations/
 */
export class WarpRule extends NestedAgentsmdRule {
  protected static getFamily(): NestedAgentsmdRuleFamily {
    return { globalDir: WARP_GLOBAL_RULE_DIR, toolTarget: "warp" };
  }
}
