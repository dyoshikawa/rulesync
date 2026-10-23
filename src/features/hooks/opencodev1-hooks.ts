import { OPENCODEV1_LAYOUT } from "../../constants/opencode-paths.js";
import { OpencodeHooks } from "./opencode-hooks.js";

/**
 * Hooks generator for **OpenCode V1** (OpenCode 1.x). OpenCode 2.x does not
 * run V1 plugin code, so this target keeps emitting the V1 plugin module
 * (`export const RulesyncHooksPlugin = async ({ $ }) => ...`) through
 * {@link OpencodeHooks} with the V1 layout.
 *
 * @see https://opencode.ai/docs/plugins/
 */
export class Opencodev1Hooks extends OpencodeHooks {
  protected static override readonly layout = OPENCODEV1_LAYOUT;
}
