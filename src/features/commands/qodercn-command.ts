import { QODERCN_DIR } from "../../constants/qoder-paths.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import { QoderCommand } from "./qoder-command.js";

/**
 * Custom slash command for **Qoder CN**. Commands share Qoder's format and
 * the project `.qoder/commands/` directory, so this reuses {@link QoderCommand}
 * and its `qoder` frontmatter section; only the user directory moves to
 * `~/.qoder-cn/commands/`.
 *
 * @see https://docs.qoder.cn/qoder/commands
 */
export class QodercnCommand extends QoderCommand {
  protected static override readonly globalConfigDir = QODERCN_DIR;

  protected static override getToolTarget(): ToolTarget {
    return "qodercn";
  }

  protected static override getSectionKey(): string {
    return "qoder";
  }
}
