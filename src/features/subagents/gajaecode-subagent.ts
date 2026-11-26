import { GAJAECODE_LAYOUT } from "../../constants/gajaecode-paths.js";
import { OmpSubagent } from "./omp-subagent.js";

/**
 * Subagent generator for **Gajae-Code** (`gjc`): `.gjc/agents/*.md` (project)
 * and `~/.gjc/agent/agents/*.md` (global). Gajae-Code parses agent frontmatter
 * like oh-my-pi (a file without both `name` and `description` is skipped;
 * `tools`, `spawns`, `model`, ... pass through), so this target reuses
 * {@link OmpSubagent} with the `.gjc` layout. Keys under the `gajaecode:`
 * section of a rulesync subagent are copied into the frontmatter verbatim.
 *
 * @see https://github.com/Yeachan-Heo/gajae-code/blob/main/docs/customization.md
 */
export class GajaecodeSubagent extends OmpSubagent {
  protected static override readonly layout = GAJAECODE_LAYOUT;
}
