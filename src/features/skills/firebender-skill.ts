import { join } from "node:path";

import { FIREBENDER_SKILLS_DIR_PATH } from "../../constants/firebender-paths.js";
import { SKILL_FILE_NAME } from "../../constants/general.js";
import { warnWithFallback } from "../../utils/logger.js";
import { quoteValueForWarning } from "../../utils/quote-value.js";
import {
  AgentsSkillsSkill,
  type AgentsSkillsSkillFrontmatter,
  resolveAgentsSkillsSection,
  toSpecConformantAgentSkillFields,
} from "./agentsskills-skill.js";
import { RulesyncSkill, type RulesyncSkillFrontmatterInput } from "./rulesync-skill.js";
import { resolveDisableModelInvocation } from "./skills-utils.js";
import { ToolSkillFromRulesyncSkillParams, ToolSkillSettablePaths } from "./tool-skill.js";

/**
 * The Agent Skills standard keys the `agentsskills` section carries. On import
 * they go back there, exactly as for the `agentsskills` target, and every other
 * key besides `name` / `description` goes into the `firebender` section.
 */
const AGENT_SKILLS_STANDARD_KEYS = new Set([
  "name",
  "description",
  "license",
  "compatibility",
  "metadata",
  "allowed-tools",
]);

/**
 * Firebender skills follow the Agent Skills layout (`<name>/SKILL.md` with the
 * required `name` and `description` frontmatter, plus optional supporting
 * files), so this target reuses {@link AgentsSkillsSkill} with Firebender's
 * recommended locations: `.firebender/skills/` (project) and
 * `~/.firebender/skills/` (user).
 *
 * On top of the standard fields, Firebender reads `version`, `autoTrigger`,
 * `disable-model-invocation` (the inverse of `autoTrigger`, which wins when
 * both are set), `projectTypes` and `icon`. Those come from the `firebender`
 * section of the rulesync skill and are written verbatim;
 * `disable-model-invocation` falls back to the root-level rulesync value.
 *
 * @see https://docs.firebender.com/api-reference/skills
 */
export class FirebenderSkill extends AgentsSkillsSkill {
  static override getSettablePaths(_options: { global?: boolean } = {}): ToolSkillSettablePaths {
    // Both scopes share the same relative path; the home-directory root is
    // applied by the processor in global mode.
    return { relativeDirPath: FIREBENDER_SKILLS_DIR_PATH };
  }

  override toRulesyncSkill(): RulesyncSkill {
    const base = super.toRulesyncSkill();
    // Everything Firebender-specific goes into the `firebender` section, not
    // the root: the root values are shared defaults for every tool that honors
    // the field.
    const firebenderSection = Object.fromEntries(
      Object.entries(this.getFrontmatter()).filter(([key]) => !AGENT_SKILLS_STANDARD_KEYS.has(key)),
    );
    if (Object.keys(firebenderSection).length === 0) {
      return base;
    }

    const rulesyncFrontmatter: RulesyncSkillFrontmatterInput = {
      ...base.getFrontmatter(),
      firebender: firebenderSection,
    };
    return new RulesyncSkill({
      outputRoot: base.getOutputRoot(),
      relativeDirPath: base.getRelativeDirPath(),
      dirName: base.getDirName(),
      frontmatter: rulesyncFrontmatter,
      body: base.getBody(),
      otherFiles: base.getOtherFiles(),
      validate: true,
      global: this.global,
    });
  }

  static override fromRulesyncSkill({
    outputRoot = process.cwd(),
    rulesyncSkill,
    validate = true,
    global = false,
    logger,
  }: ToolSkillFromRulesyncSkillParams): FirebenderSkill {
    const settablePaths = FirebenderSkill.getSettablePaths({ global });
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();
    const dirName = rulesyncSkill.getDirName();

    // The `firebender` section carries Firebender-specific frontmatter
    // verbatim. The canonical name/description and the Agent Skills standard
    // fields (which come from the root and the `agentsskills` section) are not
    // taken from it, so they cannot change sides on a generate -> import round
    // trip.
    const firebenderSection: Record<string, unknown> = {};
    const ignoredKeys: string[] = [];
    for (const [key, value] of Object.entries(rulesyncFrontmatter.firebender ?? {})) {
      if (AGENT_SKILLS_STANDARD_KEYS.has(key)) {
        ignoredKeys.push(key);
      } else {
        firebenderSection[key] = value;
      }
    }
    if (ignoredKeys.length > 0) {
      warnWithFallback(
        logger,
        `${join(outputRoot, settablePaths.relativeDirPath, dirName, SKILL_FILE_NAME)}: ` +
          `the firebender section sets ${ignoredKeys.map(quoteValueForWarning).join(", ")}, which ${ignoredKeys.length === 1 ? "is" : "are"} ignored there; ` +
          "set name/description at the root and the Agent Skills standard fields at the root or in the agentsskills section.",
      );
    }
    const disableModelInvocation = resolveDisableModelInvocation({
      rootFrontmatter: rulesyncFrontmatter,
      section: rulesyncFrontmatter.firebender,
    });

    const frontmatter: AgentsSkillsSkillFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
      ...toSpecConformantAgentSkillFields(resolveAgentsSkillsSection(rulesyncFrontmatter)),
      ...firebenderSection,
      ...(disableModelInvocation !== undefined && {
        "disable-model-invocation": disableModelInvocation,
      }),
    };

    AgentsSkillsSkill.reportSpecViolations({
      outputRoot,
      relativeDirPath: settablePaths.relativeDirPath,
      dirName,
      frontmatter,
      sourceAllowedTools: rulesyncFrontmatter.agentsskills?.["allowed-tools"],
      logger,
    });

    return new FirebenderSkill({
      outputRoot,
      relativeDirPath: settablePaths.relativeDirPath,
      dirName,
      frontmatter,
      body: rulesyncSkill.getBody(),
      otherFiles: rulesyncSkill.getOtherFiles(),
      validate,
      global,
    });
  }

  protected static override readonly toolTarget = "firebender";
}
