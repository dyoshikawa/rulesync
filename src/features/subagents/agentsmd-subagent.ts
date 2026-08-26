import { AGENTSMD_SUBAGENTS_DIR_PATH } from "../../constants/agentsmd-paths.js";
import {
  ANTIGRAVITY_SHARED_SUBAGENT_SECTION_KEYS,
  stringifyAntigravitySubagentFile,
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
    // `fromFileDefault` carries the raw bytes through, so a file another writer
    // of this shared path produced is not silently re-rendered into the
    // simulated shape when it is read back. Nothing depends on that yet --
    // `toRulesyncSubagent` throws for a simulated file, so the import path drops
    // these instances before the bytes are used. It is an invariant held in
    // advance of that method, not a protection currently in force.
    const baseParams = await this.fromFileDefault(params);
    return new AgentsmdSubagent(baseParams);
  }

  static fromRulesyncSubagent(params: ToolSubagentFromRulesyncSubagentParams): ToolSubagent {
    const defaults = this.fromRulesyncSubagentDefault(params);
    // Same shared block, same serialization as the native targets that own this
    // path, so the two writers cannot disagree about the file. This also means an
    // invalid Antigravity block fails generation here, the same file and the same
    // diagnostics a native target would have reported for it -- silently writing a
    // reduced file instead is exactly the degradation the shared block prevents.
    const frontmatter = toAntigravitySubagentFrontmatter({
      rulesyncSubagent: params.rulesyncSubagent,
      sectionKeys: ANTIGRAVITY_SHARED_SUBAGENT_SECTION_KEYS,
      toolTarget: "agentsmd",
    });

    return new AgentsmdSubagent({
      ...defaults,
      frontmatter,
      fileContent: stringifyAntigravitySubagentFile({ body: defaults.body, frontmatter }),
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
