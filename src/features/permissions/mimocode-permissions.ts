import { MIMOCODE_LAYOUT } from "../../constants/mimocode-paths.js";
import { OpencodePermissions } from "./opencode-permissions.js";

/**
 * Permissions generator for **MiMo Code**, Xiaomi's fork of OpenCode. MiMo
 * Code keeps OpenCode's `permission` key and schema in its own
 * `mimocode.jsonc`, so this target reuses {@link OpencodePermissions} with the
 * `.mimocode/` layout. Tool-only categories round-trip through the `mimocode`
 * override block.
 *
 * @see https://github.com/XiaomiMiMo/MiMo-Code/blob/main/packages/opencode/src/config/permission.ts
 */
export class MimocodePermissions extends OpencodePermissions {
  protected static override readonly layout = MIMOCODE_LAYOUT;
}
