import { HERMESAGENT_RULE_FILE_NAME } from "../../constants/hermesagent-paths.js";
import { SingleRootFileRule } from "./single-root-file-rule.js";
import { ToolRuleSettablePaths } from "./tool-rule.js";

/**
 * Rule generator for Hermes Agent.
 *
 * Hermes Agent auto-injects the project-root context file into its system
 * prompt (root priority: `.hermes.md` → `HERMES.md` → `AGENTS.md` →
 * `CLAUDE.md` → `.cursorrules`). Since the progressive subdirectory hint
 * discovery feature (hermes-agent #5291), it also reads nested
 * `AGENTS.md`/`CLAUDE.md`/`.cursorrules` files as it navigates directories
 * (`.hermes.md` stays root-only). There is no documented user-level rules
 * file (the global `~/.hermes/SOUL.md` is an agent-identity slot, not user
 * instructions), so rules are project-scope only.
 * @see https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/context-files.md
 *
 * rulesync deliberately does NOT emit nested per-directory files for that
 * discovery: rulesync's non-root rules are topic-based (globs/description)
 * and carry no target-directory placement, so mapping them onto nested
 * `AGENTS.md` files would require inventing placement semantics no other
 * adapter has. Their bodies are instead folded into the single root
 * `.hermes.md` by the RulesProcessor; there is no separate non-root output
 * location (`nonRoot` is `undefined`). This mirrors the warp / deepagents
 * targets (decision recorded in issue #2214).
 */
export type HermesagentRuleSettablePaths = Pick<ToolRuleSettablePaths, "root"> & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  nonRoot?: undefined;
};

export class HermesagentRule extends SingleRootFileRule {
  static getSettablePaths(): HermesagentRuleSettablePaths {
    // Project instructions live in the repository-root `.hermes.md`. Hermes has
    // no user-level rules file, so rules are project-scope only.
    return {
      root: {
        relativeDirPath: ".",
        relativeFilePath: HERMESAGENT_RULE_FILE_NAME,
      },
    };
  }

  protected static override readonly toolTarget = "hermesagent";
}
