import { WARP_SKILLS_DIR_PATH } from "../../constants/warp-paths.js";
import { RulesyncCommand } from "./rulesync-command.js";
import { SkillBackedToolCommand } from "./skill-backed-command.js";
import { type ToolCommandSettablePaths } from "./tool-command.js";

/**
 * Represents a Warp slash command, emitted as a Warp Skill.
 *
 * Warp documents skills as its custom slash-command surface: any skill is
 * invocable as `/{skill-name}` with `$ARGUMENTS` / `$ARGUMENTS[N]` / `$N`
 * argument substitution, and Warp has been collapsing its built-in slash
 * commands onto skills (e.g. `/pr-comments` became a bundled skill). Commands
 * are therefore emitted onto the native skills surface, one `SKILL.md` per
 * command: `.warp/skills/<slug>/SKILL.md` (project) and
 * `~/.warp/skills/<slug>/SKILL.md` (global). Warp's `.warp/workflows/` YAML
 * files are parameterized shell-command templates, not agent prompts, so they
 * are deliberately not used here.
 *
 * Import and deletion are intentionally no-ops for this target: the skills
 * feature owns the `.warp/skills/` tree, so importing it as commands would
 * double-import every skill (mirrors the Devin and Hermes Agent commands
 * targets).
 *
 * @see https://docs.warp.dev/agent-platform/capabilities/skills/
 * @see https://docs.warp.dev/agent-platform/capabilities/slash-commands/
 */
export class WarpCommand extends SkillBackedToolCommand {
  static override isTargetedByRulesyncCommand(rulesyncCommand: RulesyncCommand): boolean {
    return this.isTargetedByRulesyncCommandDefault({
      rulesyncCommand,
      toolTarget: "warp",
    });
  }

  static getSettablePaths({
    global: _global = false,
  }: { global?: boolean } = {}): ToolCommandSettablePaths {
    // Same relative tree at both scopes: project `.warp/skills/` and
    // `~/.warp/skills/` (the global root resolves under the home directory).
    return {
      relativeDirPath: WARP_SKILLS_DIR_PATH,
    };
  }
}
