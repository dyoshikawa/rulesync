import { OPENCODEV1_LAYOUT } from "../../constants/opencode-paths.js";
import { OpencodePermissions } from "./opencode-permissions.js";

/**
 * Permissions generator for **OpenCode V1** (OpenCode 1.x), which reads the
 * per-tool `permission` map that OpenCode 2.x replaced with an ordered
 * `permissions` array. It reuses {@link OpencodePermissions} with the V1
 * layout; tool-only categories round-trip through the `opencodev1` override
 * block.
 *
 * @see https://opencode.ai/docs/permissions/
 */
export class Opencodev1Permissions extends OpencodePermissions {
  protected static override readonly layout = OPENCODEV1_LAYOUT;
}
