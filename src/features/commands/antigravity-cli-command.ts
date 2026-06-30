import {
  ANTIGRAVITY_CLI_GLOBAL_WORKFLOWS_DIR_PATH,
  ANTIGRAVITY_WORKFLOWS_DIR_PATH,
} from "../../constants/antigravity-cli-paths.js";
import { ToolTarget } from "../../types/tool-targets.js";
import { AntigravitySharedCommand } from "./antigravity-shared-command.js";
import { RulesyncCommand } from "./rulesync-command.js";

/**
 * Command (workflow) generator for the Google Antigravity CLI (`agy`, Antigravity 2.0).
 *
 * Shares all body and frontmatter handling with {@link AntigravitySharedCommand};
 * the CLI reads project workflows from the same `.agents/workflows/` directory as
 * the IDE (the shared Antigravity 2.0 harness), but keeps its own global
 * workflows tree at `~/.gemini/antigravity-cli/global_workflows/` (mirroring the
 * CLI's global skills tree). It answers to the `antigravity-cli` target.
 */
export class AntigravityCliCommand extends AntigravitySharedCommand {
  protected static override getProjectRelativeDirPath(): string {
    return ANTIGRAVITY_WORKFLOWS_DIR_PATH;
  }

  protected static override getGlobalRelativeDirPath(): string {
    return ANTIGRAVITY_CLI_GLOBAL_WORKFLOWS_DIR_PATH;
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
