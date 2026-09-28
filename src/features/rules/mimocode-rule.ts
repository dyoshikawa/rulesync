import { MIMOCODE_LAYOUT } from "../../constants/mimocode-paths.js";
import type { SharedWritePath } from "../../lib/shared-file-derive.js";
import { MimocodeMcp } from "../mcp/mimocode-mcp.js";
import { OpenCodeRule } from "./opencode-rule.js";

/**
 * Rule generator for **MiMo Code**, Xiaomi's fork of OpenCode. It reads the
 * same `AGENTS.md` (project root and `~/.config/mimocode/AGENTS.md`) plus the
 * `instructions` list of its config, so this target reuses {@link OpenCodeRule}
 * with the `.mimocode/` layout.
 *
 * @see https://github.com/XiaomiMiMo/MiMo-Code/blob/main/packages/opencode/src/session/instruction.ts
 */
export class MimocodeRule extends OpenCodeRule {
  protected static override readonly layout = MIMOCODE_LAYOUT;

  static override getExtraSharedWritePaths({
    global = false,
  }: { global?: boolean } = {}): SharedWritePath[] {
    return [MimocodeMcp.getSettablePaths({ global })];
  }
}
