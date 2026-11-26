import { GAJAECODE_LAYOUT } from "../../constants/gajaecode-paths.js";
import { PiCommand } from "./pi-command.js";

/**
 * Command generator for **Gajae-Code** (`gjc`), a descendant of Pi and
 * oh-my-pi. Gajae-Code loads Markdown slash commands from `.gjc/commands/`
 * (project) and `~/.gjc/agent/commands/` (global) and reads their
 * `description` frontmatter, so this target reuses {@link PiCommand} with the
 * `.gjc` layout.
 *
 * @see https://github.com/Yeachan-Heo/gajae-code/blob/main/docs/customization.md
 */
export class GajaecodeCommand extends PiCommand {
  protected static override readonly layout = GAJAECODE_LAYOUT;
}
