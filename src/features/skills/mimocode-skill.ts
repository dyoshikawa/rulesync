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
}
