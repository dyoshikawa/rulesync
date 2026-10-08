import {
  ANTIGRAVITY_CLI_GLOBAL_WORKFLOWS_DIR_PATH,
  ANTIGRAVITY_WORKFLOWS_DIR_PATH,
} from "../../constants/antigravity-cli-paths.js";
import { ToolTarget } from "../../types/tool-targets.js";
import { AntigravityCliSkill } from "../skills/antigravity-cli-skill.js";
import { AntigravitySharedCommand } from "./antigravity-shared-command.js";
import { RulesyncCommand } from "./rulesync-command.js";

/**
 * Command generator for the Google Antigravity CLI (`agy`, Antigravity 2.0).
 *
 * Shares all body and frontmatter handling with {@link AntigravitySharedCommand}.
 * Commands are emitted as skills in the shared project `.agents/skills/`
 * directory and the CLI's own global `~/.gemini/antigravity-cli/skills/` tree.
 * Legacy workflows are still imported from `.agents/workflows/` and
 * `~/.gemini/antigravity-cli/global_workflows/`. It answers to the
 * `antigravity-cli` target.
 */
export class AntigravityCliCommand extends AntigravitySharedCommand {
  protected static override getProjectRelativeDirPath(): string {
    return ANTIGRAVITY_WORKFLOWS_DIR_PATH;
  }

  protected static override getGlobalRelativeDirPath(): string {
    return ANTIGRAVITY_CLI_GLOBAL_WORKFLOWS_DIR_PATH;
  }

  protected static override getSkillsRelativeDirPath({ global }: { global: boolean }): string {
    return AntigravityCliSkill.getSettablePaths({ global }).relativeDirPath;
  }

  protected override getToolTargetName(): ToolTarget {
    return "antigravity-cli";
  }

  static override isTargetedByRulesyncCommand(rulesyncCommand: RulesyncCommand): boolean {
    return this.isTargetedByRulesyncCommandDefault({
      rulesyncCommand,
      toolTarget: "antigravity-cli",
    });
  }
}
