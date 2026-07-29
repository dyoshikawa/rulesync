import { ToolTarget } from "../../types/tool-targets.js";
import { AntigravitySharedSubagent } from "./antigravity-shared-subagent.js";

/**
 * Google Antigravity CLI custom agent (subagent), shipped in CLI v1.1.6.
 *
 * Shares all behavior with {@link AntigravitySharedSubagent}; the CLI reads the
 * same `.agents/agents/` and `~/.gemini/config/agents/` roots as the IDE and
 * exposes them through the `agy agents` subcommand and the `--agent` flag. It
 * answers to the `antigravity-cli` target.
 */
export class AntigravityCliSubagent extends AntigravitySharedSubagent {
  protected static override getToolTarget(): ToolTarget {
    return "antigravity-cli";
  }
}
