import { ToolTarget } from "../../types/tool-targets.js";
import { AntigravitySharedSubagent } from "./antigravity-shared-subagent.js";

/**
 * Google Antigravity IDE custom agent (subagent).
 *
 * Shares all behavior with {@link AntigravitySharedSubagent} — the subagents
 * documentation is product-wide and lists the same `.agents/agents/` and
 * `~/.gemini/config/agents/` roots for the IDE and the CLI. It answers to the
 * `antigravity-ide` target.
 */
export class AntigravityIdeSubagent extends AntigravitySharedSubagent {
  protected static override getToolTarget(): ToolTarget {
    return "antigravity-ide";
  }
}
