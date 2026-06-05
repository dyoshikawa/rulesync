import { ToolTarget } from "../../types/tool-targets.js";
import { AntigravitySharedSkill } from "./antigravity-shared-skill.js";

/**
 * Represents a Google Antigravity IDE skill directory (Antigravity 2.0).
 *
 * Shares all behavior with {@link AntigravitySharedSkill}. As of Antigravity
 * 2.0 the IDE reads its global skills from the shared `~/.gemini/config/skills/`
 * location (the Skills doc lists `~/.gemini/config/skills/<skill-folder>/` as
 * the global scope); the legacy `~/.gemini/antigravity/skills/` path is no
 * longer used. It answers to the `antigravity-ide` target.
 */
export class AntigravityIdeSkill extends AntigravitySharedSkill {
  protected static override getGlobalSubdir(): string {
    return "config";
  }

  protected static override getToolTarget(): ToolTarget {
    return "antigravity-ide";
  }
}
