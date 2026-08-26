import { AGENTSMD_SUBAGENTS_DIR_PATH } from "../../constants/agentsmd-paths.js";
import { stringifyFrontmatter } from "../../utils/frontmatter.js";
import {
  ANTIGRAVITY_SHARED_SUBAGENT_SECTION_KEYS,
  toAntigravitySubagentFrontmatter,
} from "./antigravity-shared-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";
import { SimulatedSubagent } from "./simulated-subagent.js";
import {
  ToolSubagent,
  ToolSubagentForDeletionParams,
  ToolSubagentFromFileParams,
  ToolSubagentFromRulesyncSubagentParams,
  ToolSubagentSettablePaths,
} from "./tool-subagent.js";

/**
 * Represents a simulated subagent for AGENTS.md.
 * Since AGENTS.md doesn't have native subagent support, this provides
 * a compatible subagent file format at `.agents/agents/`.
 *
 * `.agents/agents/` is not an AGENTS.md convention — the standard defines only
 * `AGENTS.md` itself. It is the cross-vendor location AGENTS.md-era clients
 * actually scan for agent definitions, and the native `antigravity-*` targets
 * write to it as well, so both resolve to the same file. To keep that harmless,
 * this writer emits exactly the frontmatter the Antigravity targets emit:
 * whichever target runs last, the file on disk is the same, and the tool
 * specific fields are not dropped.
 *
 * @see https://agents.md/
 * @see https://antigravity.google/docs/subagents
 */
export class AgentsmdSubagent extends SimulatedSubagent {
  static getSettablePaths(): ToolSubagentSettablePaths {
    return {
      relativeDirPath: AGENTSMD_SUBAGENTS_DIR_PATH,
    };
  }

  static async fromFile(params: ToolSubagentFromFileParams): Promise<AgentsmdSubagent> {
    const baseParams = await this.fromFileDefault(params);
    return new AgentsmdSubagent(baseParams);
  }

  static fromRulesyncSubagent(params: ToolSubagentFromRulesyncSubagentParams): ToolSubagent {
    const defaults = this.fromRulesyncSubagentDefault(params);
    // Same shared block, same serialization as the native targets that own this
    // path, so the two writers cannot disagree about the file.
    const frontmatter = toAntigravitySubagentFrontmatter({
      rulesyncSubagent: params.rulesyncSubagent,
      sectionKeys: ANTIGRAVITY_SHARED_SUBAGENT_SECTION_KEYS,
      toolTarget: "agentsmd",
    });

    return new AgentsmdSubagent({
      ...defaults,
      frontmatter,
      fileContent: stringifyFrontmatter(defaults.body, frontmatter, { avoidBlockScalars: true }),
    });
  }

  static isTargetedByRulesyncSubagent(rulesyncSubagent: RulesyncSubagent): boolean {
    return this.isTargetedByRulesyncSubagentDefault({
      rulesyncSubagent,
      toolTarget: "agentsmd",
    });
  }

  static forDeletion(params: ToolSubagentForDeletionParams): AgentsmdSubagent {
    return new AgentsmdSubagent(this.forDeletionDefault(params));
  }
}
