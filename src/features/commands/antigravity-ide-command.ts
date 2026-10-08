import {
  ANTIGRAVITY_IDE_COMMANDS_DIR_PATH,
  ANTIGRAVITY_IDE_GLOBAL_WORKFLOWS_DIR_PATH,
} from "../../constants/antigravity-ide-paths.js";
import { ToolTarget } from "../../types/tool-targets.js";
import { AntigravityIdeSkill } from "../skills/antigravity-ide-skill.js";
import { AntigravitySharedCommand } from "./antigravity-shared-command.js";
import { RulesyncCommand } from "./rulesync-command.js";

/**
 * Command generator for the Google Antigravity IDE (Antigravity 2.0).
 *
 * Emits each command as a skill in `.agents/skills/<name>/SKILL.md` (project
 * scope) and `~/.gemini/config/skills/<name>/SKILL.md` (global scope), the
 * IDE's skills directories. Legacy workflows are still imported from
 * `.agents/workflows/` and `~/.gemini/antigravity/global_workflows/`. All
 * body and frontmatter handling is shared with {@link AntigravitySharedCommand}.
 */
export class AntigravityIdeCommand extends AntigravitySharedCommand {
  protected static override getProjectRelativeDirPath(): string {
    return ANTIGRAVITY_IDE_COMMANDS_DIR_PATH;
  }

  protected static override getGlobalRelativeDirPath(): string {
    return ANTIGRAVITY_IDE_GLOBAL_WORKFLOWS_DIR_PATH;
  }

  protected static override getSkillsRelativeDirPath({ global }: { global: boolean }): string {
    return AntigravityIdeSkill.getSettablePaths({ global }).relativeDirPath;
  }

  protected override getToolTargetName(): ToolTarget {
    return "antigravity-ide";
  }

  static override isTargetedByRulesyncCommand(rulesyncCommand: RulesyncCommand): boolean {
    return this.isTargetedByRulesyncCommandDefault({
      rulesyncCommand,
      toolTarget: "antigravity-ide",
    });
  }
}
