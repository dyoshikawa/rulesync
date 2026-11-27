import { QODERCN_DIR } from "../../constants/qoder-paths.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import { QoderSubagent } from "./qoder-subagent.js";

/**
 * Subagent generator for **Qoder CN**. Subagents share Qoder's format and the
 * project `.qoder/agents/` directory, so this reuses {@link QoderSubagent} and
 * its `qoder` frontmatter section; only the user directory moves to
 * `~/.qoder-cn/agents/`.
 *
 * @see https://docs.qoder.cn/user-guide/custom-agent
 */
export class QodercnSubagent extends QoderSubagent {
  protected static override readonly globalConfigDir = QODERCN_DIR;
  protected static override readonly toolTarget: ToolTarget = "qodercn";
}
