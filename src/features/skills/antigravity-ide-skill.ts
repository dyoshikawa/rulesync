import { ToolTarget } from "../../types/tool-targets.js";
import { AntigravitySharedSkill } from "./antigravity-shared-skill.js";

/**
 * Represents a Google Antigravity IDE skill directory (Antigravity 2.0).
 *
 * Shares all behavior with {@link AntigravitySharedSkill}; the IDE keeps its
 * global skill location at `~/.gemini/antigravity/skills/` and answers to the
 * `antigravity-ide` target.
 */
export class AntigravityIdeSkill extends AntigravitySharedSkill {
  protected static override getGlobalSubdir(): string {
    return "antigravity";
  }

  protected static override getToolTarget(): ToolTarget {
    return "antigravity-ide";
  }
}
