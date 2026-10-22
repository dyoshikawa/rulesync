import { join } from "node:path";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { XUM_SKILLS_DIR_PATH } from "../../constants/xum-paths.js";
import { warnWithFallback } from "../../utils/logger.js";
import { quoteValueForWarning } from "../../utils/quote-value.js";
import {
  AgentsSkillsSkill,
  type AgentsSkillsSkillFrontmatter,
  resolveAgentsSkillsSection,
  toSpecConformantAgentSkillFields,
} from "./agentsskills-skill.js";
import { RulesyncSkill, type RulesyncSkillFrontmatterInput } from "./rulesync-skill.js";
import { resolveDisableModelInvocation, resolveUserInvocable } from "./skills-utils.js";
import { ToolSkillFromRulesyncSkillParams, ToolSkillSettablePaths } from "./tool-skill.js";

/**
 * The Agent Skills standard keys the `agentsskills` section carries. On import
 * they go back there, exactly as for the `agentsskills` target, and every other
 * key besides `name` / `description` goes into the `xum` section.
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
 * Xum skills follow the Agent Skills layout (`<name>/SKILL.md` with the
 * required `name` and `description` frontmatter; the directory name is
 * lowercase letters, digits and single hyphens up to 64 characters, and
 * `name` must match it), so this target reuses {@link AgentsSkillsSkill} with
 * Xum's locations: `.xum/skills/` (project) and `~/.xum/skills/` (user).
 * Within one directory `.xum/skills` wins over `.agents/skills`.
 *
 * On top of the standard fields, Xum reads `disable-model-invocation` (and its
 * own `advertise: false` alias), `user-invocable`, `argument-hint`,
 * `when_to_use` / `when-to-use` and `paths` (globs that make the skill
 * path-scoped). Those come from the `xum` section of the rulesync skill and are
 * written verbatim; the two invocation gates fall back to the root-level
 * rulesync values.
 *
 * @see https://xum.cdr.dev/agents/agent-skills
 */
export class XumSkill extends AgentsSkillsSkill {
  static override getSettablePaths(_options: { global?: boolean } = {}): ToolSkillSettablePaths {
    // Both scopes share the same relative path; the home-directory root is
    // applied by the processor in global mode.
    return { relativeDirPath: XUM_SKILLS_DIR_PATH };
  }

  override toRulesyncSkill(): RulesyncSkill {
    const base = super.toRulesyncSkill();
    // Everything Xum-specific goes into the `xum` section, not the root: the
    // root values are shared defaults for every tool that honors the field.
    const xumSection = Object.fromEntries(
      Object.entries(this.getFrontmatter()).filter(([key]) => !AGENT_SKILLS_STANDARD_KEYS.has(key)),
    );
    if (Object.keys(xumSection).length === 0) {
      return base;
    }

    const rulesyncFrontmatter: RulesyncSkillFrontmatterInput = {
      ...base.getFrontmatter(),
      xum: xumSection,
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
  }: ToolSkillFromRulesyncSkillParams): XumSkill {
    const settablePaths = XumSkill.getSettablePaths({ global });
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();
    const dirName = rulesyncSkill.getDirName();

    // The `xum` section carries Xum-specific frontmatter verbatim. The
    // canonical name/description and the Agent Skills standard fields (which
    // come from the root and the `agentsskills` section) are not taken from
    // it, so they cannot change sides on a generate -> import round trip.
    const xumSection: Record<string, unknown> = {};
    const ignoredKeys: string[] = [];
    for (const [key, value] of Object.entries(rulesyncFrontmatter.xum ?? {})) {
      if (AGENT_SKILLS_STANDARD_KEYS.has(key)) {
        ignoredKeys.push(key);
      } else {
        xumSection[key] = value;
      }
    }
    if (ignoredKeys.length > 0) {
      warnWithFallback(
        logger,
        `${join(outputRoot, settablePaths.relativeDirPath, dirName, SKILL_FILE_NAME)}: ` +
          `the xum section sets ${ignoredKeys.map(quoteValueForWarning).join(", ")}, which ${ignoredKeys.length === 1 ? "is" : "are"} ignored there; ` +
          "set name/description at the root and the Agent Skills standard fields at the root or in the agentsskills section.",
      );
    }
    const userInvocable = resolveUserInvocable({
      rootFrontmatter: rulesyncFrontmatter,
      section: xumSection,
    });
    const disableModelInvocation = resolveDisableModelInvocation({
      rootFrontmatter: rulesyncFrontmatter,
      section: xumSection,
    });

    const frontmatter: AgentsSkillsSkillFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
      ...toSpecConformantAgentSkillFields(resolveAgentsSkillsSection(rulesyncFrontmatter)),
      ...xumSection,
      ...(userInvocable !== undefined && { "user-invocable": userInvocable }),
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

    return new XumSkill({
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

  static override isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean {
    const targets = rulesyncSkill.getFrontmatter().targets;
    return targets.includes("*") || targets.includes("xum");
  }
}
