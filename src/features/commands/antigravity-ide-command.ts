import { join } from "node:path";

import { ToolTarget } from "../../types/tool-targets.js";
import { AntigravitySharedCommand } from "./antigravity-shared-command.js";
import { RulesyncCommand } from "./rulesync-command.js";

/**
 * Command (workflow) generator for the Google Antigravity IDE (Antigravity 2.0).
 *
 * Generates workflow files in `.agents/workflows/` (project scope) and
 * `~/.gemini/antigravity/global_workflows/` (global scope). All body and
 * frontmatter handling is shared with {@link AntigravitySharedCommand}.
 */
export class AntigravityIdeCommand extends AntigravitySharedCommand {
  protected static override getProjectRelativeDirPath(): string {
    return join(".agents", "workflows");
  }

  protected static override getGlobalRelativeDirPath(): string {
    return join(".gemini", "antigravity", "global_workflows");
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
