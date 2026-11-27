import { QODERCN_DIR } from "../../constants/qoder-paths.js";
import { QoderHooks } from "./qoder-hooks.js";

/**
 * Lifecycle hooks for **Qoder CN**. Hooks share Qoder's settings shape and the
 * project `.qoder/settings.json`, so this reuses {@link QoderHooks} (and the
 * `qoder.hooks` override block); only the user file moves to
 * `~/.qoder-cn/settings.json`.
 *
 * @see https://docs.qoder.cn/user-guide/hooks
 */
export class QodercnHooks extends QoderHooks {
  protected static override readonly globalConfigDir = QODERCN_DIR;
}
