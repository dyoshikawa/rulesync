import { POOL_GLOBAL_DIR } from "../../constants/pool-paths.js";
import { NestedAgentsmdRule, NestedAgentsmdRuleFamily } from "./nested-agentsmd-rule.js";

/**
 * Pool (Poolside) rules.
 *
 * Pool reads personal, project, and directory-level `AGENTS.md` files: inside
 * a git repository it loads every `AGENTS.md` from the repository root down
 * through the working directory (deeper files take precedence), skipping
 * ignored directories. Nested files are therefore a real scoping surface, not
 * just the root file's overflow. The personal file sits below both at
 * `~/.config/poolside/AGENTS.md`.
 *
 * @see https://docs.poolside.ai/agent-instructions
 */
export class PoolRule extends NestedAgentsmdRule {
  protected static getFamily(): NestedAgentsmdRuleFamily {
    return { globalDir: POOL_GLOBAL_DIR, toolTarget: "pool" };
  }
}
