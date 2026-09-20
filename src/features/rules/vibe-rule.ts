import { NestedAgentsmdRule, NestedAgentsmdRuleFamily } from "./nested-agentsmd-rule.js";

export const VIBE_GLOBAL_DIR = ".vibe";

/**
 * Mistral Vibe rules.
 *
 * Vibe's harness manager walks the directories between the workspace root and
 * the file being read and loads every `AGENTS.md` it finds along the way
 * (`find_subdirectory_agents_md`), injecting the result into the `read_file`
 * tool's output. Nested files are therefore a real scoping surface, not just
 * the root file's overflow. The personal file is `~/.vibe/AGENTS.md`.
 *
 * @see https://github.com/mistralai/mistral-vibe/blob/main/vibe/core/config/harness_files/_harness_manager.py
 */
export class VibeRule extends NestedAgentsmdRule {
  protected static getFamily(): NestedAgentsmdRuleFamily {
    return { globalDir: VIBE_GLOBAL_DIR, toolTarget: "vibe" };
  }
}
