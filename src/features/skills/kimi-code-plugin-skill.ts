import { KIMI_CODE_PLUGIN_SKILLS_DIR } from "../../constants/plugin-paths.js";
import { KimiCodeSkill } from "./kimi-code-skill.js";
import type { RulesyncSkill } from "./rulesync-skill.js";
import type { ToolSkillSettablePaths } from "./tool-skill.js";

/**
 * Skill inside a Kimi Code plugin bundle (`<plugin>/skills/<name>/SKILL.md`),
 * in the same `SKILL.md` format as `.kimi-code/skills/`. Kimi reads the
 * directory only when the manifest declares `"skills": "./skills/"`; without
 * it, a root `SKILL.md` is the plugin's single skill.
 *
 * @see https://github.com/MoonshotAI/kimi-code/blob/%40moonshot-ai/kimi-code%402.1.1/docs/en/customization/plugins.md
 */
export class KimiCodePluginSkill extends KimiCodeSkill {
  static override isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean {
    const targets = rulesyncSkill.getFrontmatter().targets;
    return targets.includes("*") || targets.includes("kimi-code-plugin");
  }

  static override getSettablePaths(): ToolSkillSettablePaths {
    return { relativeDirPath: KIMI_CODE_PLUGIN_SKILLS_DIR };
  }

  /**
   * The bundle is read from `--output-root <plugin>`, but the imported rulesync
   * file belongs to the project's `.rulesync/`, not to the plugin root.
   */
  protected override getRulesyncOutputRoot(): string {
    return ".";
  }
}
