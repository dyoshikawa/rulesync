import {
  MUSECODE_GLOBAL_SUBAGENTS_DIR_PATH,
  MUSECODE_SUBAGENTS_DIR_PATH,
} from "../../constants/musecode-paths.js";
import { ToolTarget } from "../../types/tool-targets.js";
import { AntigravitySharedSubagent } from "./antigravity-shared-subagent.js";
import type {
  ToolSubagent,
  ToolSubagentFromRulesyncSubagentParams,
  ToolSubagentSettablePaths,
} from "./tool-subagent.js";

/**
 * Muse Code agent names are lowercase words joined by single hyphens
 * (`test-writer`).
 *
 * @see https://dev.meta.ai/docs/muse-code/agents
 */
const MUSECODE_AGENT_NAME_PATTERN = /^[a-z]+(?:-[a-z]+)*$/;

/**
 * Meta Muse Code custom agent (subagent): a Markdown file with YAML
 * frontmatter (`name`, `description`, and optionally `model`, `effort`,
 * `tools`, `disallowedTools`) whose body is the agent's prompt.
 *
 * Project agents load from `.agents/agents/`, the directory the Antigravity
 * targets and the simulated `agentsmd` writer already generate into, so the
 * project file is rendered exactly like theirs (the `musecode` section is part
 * of the merge every writer of that file performs) and the file on disk does
 * not depend on which target ran last. User agents load from
 * `~/.config/muse/agents/`, which only this target writes, so only the
 * `musecode` section is merged there.
 *
 * @see https://dev.meta.ai/docs/muse-code/agents
 */
export class MusecodeSubagent extends AntigravitySharedSubagent {
  protected static override getToolTarget(): ToolTarget {
    return "musecode";
  }

  protected static override getReadSectionKeys({
    global = false,
  }: { global?: boolean } = {}): ToolTarget[] {
    return global ? ["musecode"] : super.getReadSectionKeys({ global });
  }

  static override getSettablePaths({
    global = false,
  }: { global?: boolean } = {}): ToolSubagentSettablePaths {
    return {
      relativeDirPath: global ? MUSECODE_GLOBAL_SUBAGENTS_DIR_PATH : MUSECODE_SUBAGENTS_DIR_PATH,
    };
  }

  static override fromRulesyncSubagent(
    params: ToolSubagentFromRulesyncSubagentParams,
  ): ToolSubagent {
    const name = params.rulesyncSubagent.getFrontmatter().name;
    if (!MUSECODE_AGENT_NAME_PATTERN.test(name)) {
      params.logger?.warn(
        `Muse Code subagent name '${name}' in ${params.rulesyncSubagent.getRelativeFilePath()} ` +
          "is not lowercase words joined by single hyphens (e.g. 'test-writer'); " +
          "Muse Code may not load it.",
      );
    }
    return super.fromRulesyncSubagent(params);
  }
}
