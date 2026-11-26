import { QODERCN_DIR } from "../../constants/qoder-paths.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import { QoderSkill } from "./qoder-skill.js";

/**
 * Skills for **Qoder CN**. Skills share Qoder's layout and the project
 * `.qoder/skills/` directory, so this reuses {@link QoderSkill}; only the user
 * directory moves to `~/.qoder-cn/skills/`.
 *
 * @see https://docs.qoder.cn/user-guide/skills
 */
export class QodercnSkill extends QoderSkill {
  protected static override readonly globalConfigDir = QODERCN_DIR;
  protected static override readonly toolTarget: ToolTarget = "qodercn";
}
