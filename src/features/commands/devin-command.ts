import {
  DEVIN_GLOBAL_SKILLS_DIR_PATH,
  DEVIN_SKILLS_DIR_PATH,
} from "../../constants/devin-paths.js";
import { RulesyncCommand, type RulesyncCommandFrontmatter } from "./rulesync-command.js";
import { SkillBackedToolCommand } from "./skill-backed-command.js";
import { type ToolCommandSettablePaths } from "./tool-command.js";

/**
 * Devin SKILL.md frontmatter keys a command may author through its `devin:`
 * section (`argument-hint`, `model`, `agent`, …).
 * @see https://docs.devin.ai/cli/extensibility/skills/creating-skills
 */
const DEVIN_COMMAND_SECTION_KEYS = [
  "argument-hint",
  "model",
  "subagent",
  "agent",
  "allowed-tools",
  "permissions",
  "triggers",
] as const;

/**
 * Represents a Devin slash command, emitted as a Devin Skill.
 *
 * Devin's extensibility docs no longer document a standalone
 * workflows/commands component — reusable prompts invoked as slash commands
 * are Skills (`/name`). Commands are therefore emitted onto the native skills
 * surface, one `SKILL.md` per command: `.devin/skills/<slug>/SKILL.md`
 * (project) and `~/.config/devin/skills/<slug>/SKILL.md` (global). The legacy
 * Windsurf/Cascade-era `.devin/workflows/` and
 * `~/.codeium/windsurf/global_workflows/` locations are no longer emitted.
 *
 * Import and deletion are intentionally no-ops for this target: the skills
 * feature owns the `.devin/skills/` tree, so importing it as commands would
 * double-import every skill (mirrors the Hermes Agent commands target).
 *
 * @see https://docs.devin.ai/cli/extensibility
 * @see https://docs.devin.ai/cli/extensibility/skills/overview
 */
export class DevinCommand extends SkillBackedToolCommand {
  static override isTargetedByRulesyncCommand(rulesyncCommand: RulesyncCommand): boolean {
    return this.isTargetedByRulesyncCommandDefault({
      rulesyncCommand,
      toolTarget: "devin",
    });
  }

  static getSettablePaths({ global = false }: { global?: boolean } = {}): ToolCommandSettablePaths {
    return {
      relativeDirPath: global ? DEVIN_GLOBAL_SKILLS_DIR_PATH : DEVIN_SKILLS_DIR_PATH,
    };
  }

  protected static override getSkillFrontmatter({
    slug,
    frontmatter,
  }: {
    slug: string;
    frontmatter: RulesyncCommandFrontmatter;
  }): Record<string, unknown> {
    const description = frontmatter.description ?? `${slug} command`;

    const devinSection = frontmatter.devin ?? {};
    const extras: Record<string, unknown> = {};
    for (const key of DEVIN_COMMAND_SECTION_KEYS) {
      if (devinSection[key] !== undefined) {
        extras[key] = devinSection[key];
      }
    }

    return {
      ...extras,
      name: slug,
      description,
    };
  }
}
