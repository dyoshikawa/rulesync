import { KiroSubagent } from "./kiro-subagent.js";

/**
 * Subagent generator for the **Kiro CLI**.
 *
 * The Kiro CLI reads agent definitions as JSON agent-config files under
 * `.kiro/agents/<name>.json`, which is exactly what {@link KiroSubagent} emits,
 * so this target reuses it verbatim and only narrows targeting to `kiro-cli`.
 * (The Kiro IDE, by contrast, reads Markdown subagents — see
 * {@link import("./kiro-ide-subagent.js").KiroIdeSubagent}.)
 */
export class KiroCliSubagent extends KiroSubagent {
  protected static getToolTarget(): "kiro-cli" {
    return "kiro-cli";
  }
}
