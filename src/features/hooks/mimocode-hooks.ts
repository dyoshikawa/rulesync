import { MIMOCODE_LAYOUT } from "../../constants/mimocode-paths.js";
import { OpencodeHooks } from "./opencode-hooks.js";

/**
 * Hooks generator for **MiMo Code**, Xiaomi's fork of OpenCode. MiMo Code
 * auto-loads OpenCode-style plugins from `.mimocode/plugins/` (project) and
 * `~/.config/mimocode/plugins/` (global) and keeps OpenCode's plugin event
 * names, so this target reuses {@link OpencodeHooks} with that layout.
 *
 * @see https://github.com/XiaomiMiMo/MiMo-Code/blob/main/packages/opencode/src/config/plugin.ts
 */
export class MimocodeHooks extends OpencodeHooks {
  protected static override readonly layout = MIMOCODE_LAYOUT;
}
