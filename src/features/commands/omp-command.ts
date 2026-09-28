import { OMP_LAYOUT } from "../../constants/omp-paths.js";
import { PiCommand } from "./pi-command.js";

/**
 * Command generator for **oh-my-pi** (`omp`), a fork of Pi. oh-my-pi loads
 * Markdown slash commands from `.omp/commands/` (project) and
 * `~/.omp/agent/commands/` (global) with the same `description` /
 * `argument-hint` frontmatter and `$1` / `$@` / `$ARGUMENTS` placeholders as
 * Pi's prompt templates, so this target reuses {@link PiCommand} with that
 * layout.
 *
 * @see https://github.com/can1357/oh-my-pi/blob/main/docs/slash-command-internals.md
 */
export class OmpCommand extends PiCommand {
  protected static override readonly layout = OMP_LAYOUT;
}
