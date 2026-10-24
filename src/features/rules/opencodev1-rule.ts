import { OPENCODEV1_LAYOUT } from "../../constants/opencode-paths.js";
import { OpenCodeRule } from "./opencode-rule.js";

/**
 * Rule generator for **OpenCode V1** (OpenCode 1.x). Rules are the same
 * `AGENTS.md` plus `instructions` list in both generations, so this target
 * reuses {@link OpenCodeRule} with the V1 layout.
 *
 * @see https://opencode.ai/docs/rules/
 */
export class Opencodev1Rule extends OpenCodeRule {
  protected static override readonly layout = OPENCODEV1_LAYOUT;
}
