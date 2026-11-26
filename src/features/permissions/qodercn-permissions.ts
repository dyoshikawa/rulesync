import { QODERCN_DIR } from "../../constants/qoder-paths.js";
import { QoderPermissions } from "./qoder-permissions.js";

/**
 * Permissions for **Qoder CN**. Permissions share Qoder's settings shape and
 * the project `.qoder/settings.json`, so this reuses {@link QoderPermissions}
 * (and the `qoder` override block); only the user file moves to
 * `~/.qoder-cn/settings.json`.
 *
 * @see https://docs.qoder.cn/cli/settings-reference
 */
export class QodercnPermissions extends QoderPermissions {
  protected static override readonly globalConfigDir = QODERCN_DIR;
}
