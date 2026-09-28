import { MIMOCODE_LAYOUT } from "../../constants/mimocode-paths.js";
import { OpenCodeSkill } from "./opencode-skill.js";

/**
 * Skill generator for **MiMo Code**, Xiaomi's fork of OpenCode. MiMo Code
 * scans `skills/<name>/SKILL.md` under `.mimocode/` (project) and
 * `~/.config/mimocode/` (global), so this target reuses {@link OpenCodeSkill}
 * with that layout.
 *
 * @see https://github.com/XiaomiMiMo/MiMo-Code/blob/main/packages/opencode/src/skill/index.ts
 */
export class MimocodeSkill extends OpenCodeSkill {
  protected static override readonly layout = MIMOCODE_LAYOUT;

  /**
   * MiMo Code resolves a relative `skills.paths` entry against the project
   * directory rather than the config directory. A global config's relative
   * entries therefore depend on the project MiMo Code runs in, which a global
   * import cannot know, so they are not read at that scope.
   */
  protected static override getSkillPathsBaseDir({
    outputRoot,
    global,
  }: {
    outputRoot: string;
    global: boolean;
  }): string | null {
    return global ? null : outputRoot;
  }
}
