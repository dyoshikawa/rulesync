import { OPENCODEV1_LAYOUT } from "../../constants/opencode-paths.js";
import { OpenCodeCommand } from "./opencode-command.js";

/**
 * Command generator for **OpenCode V1** (OpenCode 1.x), which reads the
 * `subtask` and `variant` frontmatter keys that OpenCode 2.x renamed. It
 * reuses {@link OpenCodeCommand} with the V1 layout.
 *
 * @see https://opencode.ai/docs/commands/
 */
export class Opencodev1Command extends OpenCodeCommand {
  protected static override readonly layout = OPENCODEV1_LAYOUT;
}
