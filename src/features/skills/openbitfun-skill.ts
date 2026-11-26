import {
  OPENBITFUN_SKILLS_DIR_PATH,
  openbitfunGlobalSkillsDir,
} from "../../constants/openbitfun-paths.js";
import type { Logger } from "../../utils/logger.js";
import { warnOpenbitfunXdgOverride } from "../../utils/openbitfun.js";
import { AgentsSkillsSkill } from "./agentsskills-skill.js";
import { ToolSkillFromRulesyncSkillParams, ToolSkillSettablePaths } from "./tool-skill.js";

/**
 * OpenBitFun skills follow the Agent Skills layout (`<name>/SKILL.md` with
 * `name` and `description` frontmatter, plus optional supporting files), so
 * this target reuses {@link AgentsSkillsSkill} with OpenBitFun's locations:
 * `.openbitfun/skills/` (project) and the OS-dependent user skills directory
 * (global, see {@link openbitfunGlobalSkillsDir}). A project skill shadows a
 * user skill of the same name.
 *
 * @see https://github.com/openBitFun/OpenBitFun/blob/main/docs/interactive-capabilities/capabilities/feature.skills.md
 */
export class OpenbitfunSkill extends AgentsSkillsSkill {
  static override getSettablePaths({
    global = false,
  }: { global?: boolean } = {}): ToolSkillSettablePaths {
    return { relativeDirPath: global ? openbitfunGlobalSkillsDir() : OPENBITFUN_SKILLS_DIR_PATH };
  }

  static override fromRulesyncSkill(params: ToolSkillFromRulesyncSkillParams): AgentsSkillsSkill {
    if (params.global) {
      warnOpenbitfunXdgOverride({ kind: "data", logger: params.logger });
    }
    return super.fromRulesyncSkill(params);
  }

  /**
   * OpenBitFun has no configured skill roots; this import-only hook is used to
   * warn, on `import --global`, about a moved user tree, which the import would
   * otherwise silently find empty.
   */
  static async getConfiguredImportRoots({
    global = false,
    logger,
  }: {
    outputRoot: string;
    global?: boolean;
    logger?: Logger;
  }): Promise<Array<{ outputRoot: string; relativeDirPath: string }>> {
    if (global) {
      warnOpenbitfunXdgOverride({ kind: "data", logger });
    }
    return [];
  }

  protected static override readonly toolTarget = "openbitfun";
}
