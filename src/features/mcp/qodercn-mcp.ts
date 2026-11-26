import { QODERCN_DIR } from "../../constants/qoder-paths.js";
import { QoderMcp } from "./qoder-mcp.js";

/**
 * MCP configuration for **Qoder CN**. The project file is the root `.mcp.json`
 * Qoder reads, so this reuses {@link QoderMcp} (and the `qoder` block); only
 * the user servers move to the `mcpServers` key of `~/.qoder-cn/settings.json`.
 *
 * @see https://docs.qoder.cn/cli/mcp-reference
 */
export class QodercnMcp extends QoderMcp {
  protected static override readonly globalConfigDir = QODERCN_DIR;
}
