import { join } from "node:path";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import {
  GITLABDUO_GLOBAL_SKILLS_DIR,
  GITLABDUO_SKILLS_DIR,
} from "../../constants/gitlabduo-paths.js";
import { fileExists } from "../../utils/file.js";
import { AgentsSkillsSkill } from "./agentsskills-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";
import { ToolSkillSettablePaths } from "./tool-skill.js";

/**
 * GitLab Duo skills follow the Agent Skills standard (`name` and `description`
 * are required; `metadata: { slash-command: enabled }` exposes a skill as a
 * slash command), so this target reuses {@link AgentsSkillsSkill} with GitLab's
 * locations:
 *
 * - Project skills live in a non-hidden `skills/<name>/SKILL.md` at the project
 *   root, which both the GitLab UI flows and the GitLab Duo CLI read.
 * - User skills live in `~/.gitlab/duo/skills/` and are loaded by the CLI only
 *   when started with `--enable-global-skills true` (or
 *   `GITLAB_ENABLE_GLOBAL_SKILLS=true`).
 *
 * @see https://docs.gitlab.com/user/duo_agent_platform/customize/agent_skills/
 */
export class GitlabduoSkill extends AgentsSkillsSkill {
  static override getSettablePaths({
    global = false,
  }: { global?: boolean } = {}): ToolSkillSettablePaths {
    return {
      relativeDirPath: global ? GITLABDUO_GLOBAL_SKILLS_DIR : GITLABDUO_SKILLS_DIR,
    };
  }

  static override isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean {
    const targets = rulesyncSkill.getFrontmatter().targets;
    return targets.includes("*") || targets.includes("gitlabduo");
  }

  /**
   * The project skills root is a plain `skills/` directory that many
   * repositories already use for unrelated content, so only a subdirectory
   * holding a `SKILL.md` is treated as a skill — for import and for the
   * `--delete` orphan sweep alike.
   */
  static async isDirOwned({
    outputRoot,
    relativeDirPath,
    dirName,
  }: {
    outputRoot: string;
    relativeDirPath: string;
    dirName: string;
  }): Promise<boolean> {
    return await fileExists(join(outputRoot, relativeDirPath, dirName, SKILL_FILE_NAME));
  }
}
