import { MIMOCODE_LAYOUT } from "../../constants/mimocode-paths.js";
import { OpencodeMcp } from "./opencode-mcp.js";

/**
 * MCP generator for **MiMo Code**, Xiaomi's fork of OpenCode. MiMo Code keeps
 * OpenCode's `mcp` / `tools` / `instructions` config keys but reads them from
 * `.mimocode/mimocode.jsonc` (project) and `~/.config/mimocode/mimocode.jsonc`
 * (global), so this target reuses {@link OpencodeMcp} with that layout.
 *
 * @see https://github.com/XiaomiMiMo/MiMo-Code/blob/main/packages/opencode/src/config/mcp.ts
 */
export class MimocodeMcp extends OpencodeMcp {
  protected static override readonly layout = MIMOCODE_LAYOUT;

  /**
   * MiMo Code resolves a relative `instructions` entry against the project
   * directory, not the config directory, so a global rule is written as a
   * `~/`-rooted path (which MiMo Code expands to the home directory).
   *
   * @see https://github.com/XiaomiMiMo/MiMo-Code/blob/main/packages/opencode/src/session/instruction.ts
   */
  protected static override toGlobalInstructionEntry({ path }: { path: string }): string {
    return `~/${path}`;
  }
}
