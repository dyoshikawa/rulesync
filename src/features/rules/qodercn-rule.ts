import { QODERCN_DIR } from "../../constants/qoder-paths.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import { QoderRule } from "./qoder-rule.js";

/**
 * Rule generator for **Qoder CN**, the China-region edition of Qoder (Qoder
 * CLI CN and the Qoder CN desktop app). The project layout is Qoder's own
 * (`AGENTS.md` and `.qoder/rules/`), so this reuses {@link QoderRule} and its
 * `qoder` frontmatter section; only the user files move to
 * `~/.qoder-cn/AGENTS.md` and `~/.qoder-cn/rules/`.
 *
 * @see https://docs.qoder.cn/cli/memory
 */
export class QodercnRule extends QoderRule {
  protected static override readonly globalConfigDir = QODERCN_DIR;
  protected static override readonly toolTarget: ToolTarget = "qodercn";
}
