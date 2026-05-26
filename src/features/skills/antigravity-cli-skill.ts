import { ToolTarget } from "../../types/tool-targets.js";
import { AntigravitySharedSkill } from "./antigravity-shared-skill.js";

/**
 * Represents a Google Antigravity CLI skill directory (Antigravity 2.0).
 *
 * Shares all behavior with {@link AntigravitySharedSkill}; the CLI keeps its
 * own global skills tree at `~/.gemini/antigravity-cli/skills/` and answers to
 * the `antigravity-cli` target.
 */
export class AntigravityCliSkill extends AntigravitySharedSkill {
  protected static override getGlobalSubdir(): string {
    return "antigravity-cli";
  }

  protected static override getToolTarget(): ToolTarget {
    return "antigravity-cli";
  }
}
