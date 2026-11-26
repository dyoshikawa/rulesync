import { join } from "node:path";

import { QODER_DIR, QODER_SKILLS_DIR_PATH } from "../../constants/qoder-paths.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import { AgentsSkillsSkill } from "./agentsskills-skill.js";
import { ToolSkillSettablePaths } from "./tool-skill.js";

/**
 * Qoder skills follow the Agent Skills layout (`<name>/SKILL.md` with the
 * required `name` and `description` frontmatter; `name` is lowercase letters,
 * digits and hyphens up to 64 characters, `description` up to 1024), so this
 * target reuses {@link AgentsSkillsSkill} with Qoder's locations:
 * `.qoder/skills/` (project) and `~/.qoder/skills/` (user). The Qoder IDE and
 * the CLI read the same directories.
 *
 * @see https://docs.qoder.com/en/cli/04-extending-qoder-cli/Skills
 */
export class QoderSkill extends AgentsSkillsSkill {
  /** The user-level config directory; Qoder CN reads `~/.qoder-cn/`. */
  protected static readonly globalConfigDir: string = QODER_DIR;

  static override getSettablePaths({
    global = false,
  }: { global?: boolean } = {}): ToolSkillSettablePaths {
    // The home-directory root is applied by the processor in global mode, so
    // only the config directory name differs between the scopes.
    return {
      relativeDirPath: global ? join(this.globalConfigDir, "skills") : QODER_SKILLS_DIR_PATH,
    };
  }

  protected static override readonly toolTarget: ToolTarget = "qoder";
}
