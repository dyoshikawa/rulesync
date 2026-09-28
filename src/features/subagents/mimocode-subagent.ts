import { MIMOCODE_LAYOUT } from "../../constants/mimocode-paths.js";
import { OpenCodeSubagent } from "./opencode-subagent.js";

/**
 * Subagent generator for **MiMo Code**, Xiaomi's fork of OpenCode. MiMo Code
 * loads OpenCode-format Markdown agents from `.mimocode/agents/` (project) and
 * `~/.config/mimocode/agents/` (global), so this target reuses
 * {@link OpenCodeSubagent} with that layout.
 *
 * @see https://github.com/XiaomiMiMo/MiMo-Code/blob/main/packages/opencode/src/config/agent.ts
 */
export class MimocodeSubagent extends OpenCodeSubagent {
  protected static override readonly layout = MIMOCODE_LAYOUT;
}
