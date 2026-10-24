import { OPENCODEV1_LAYOUT } from "../../constants/opencode-paths.js";
import { OpenCodeSubagent } from "./opencode-subagent.js";

/**
 * Subagent generator for **OpenCode V1** (OpenCode 1.x), which reads the V1
 * agent frontmatter. It reuses {@link OpenCodeSubagent} with the V1 layout.
 *
 * @see https://opencode.ai/docs/agents/
 */
export class Opencodev1Subagent extends OpenCodeSubagent {
  protected static override readonly layout = OPENCODEV1_LAYOUT;
}
