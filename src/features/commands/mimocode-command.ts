import { MIMOCODE_LAYOUT } from "../../constants/mimocode-paths.js";
import { OpenCodeCommand } from "./opencode-command.js";

/**
 * Command generator for **MiMo Code**, Xiaomi's fork of OpenCode. MiMo Code
 * loads OpenCode-format Markdown commands from `.mimocode/commands/` (project)
 * and `~/.config/mimocode/commands/` (global), so this target reuses
 * {@link OpenCodeCommand} with that layout.
 *
 * @see https://github.com/XiaomiMiMo/MiMo-Code/blob/main/packages/opencode/src/config/command.ts
 */
export class MimocodeCommand extends OpenCodeCommand {
  protected static override readonly layout = MIMOCODE_LAYOUT;
}
