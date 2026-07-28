import { basename, dirname, join } from "node:path";

import {
  DEVIN_GLOBAL_SKILLS_DIR_PATH,
  DEVIN_SKILLS_DIR_PATH,
} from "../../constants/devin-paths.js";
import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_COMMANDS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { type AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { parseFrontmatter, stringifyFrontmatter } from "../../utils/frontmatter.js";
import { commandSlug } from "./command-skill-ownership.js";
import { RulesyncCommand } from "./rulesync-command.js";
import {
  ToolCommand,
  type ToolCommandFromRulesyncCommandParams,
  type ToolCommandSettablePaths,
} from "./tool-command.js";

type DevinCommandParams = AiFileParams & {
  slug?: string;
};

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

function commandSkillContent(rulesyncCommand: RulesyncCommand): string {
  const slug = commandSlug(rulesyncCommand.getRelativeFilePath());
  const frontmatter = rulesyncCommand.getFrontmatter();
  const description = frontmatter.description ?? `${slug} command`;

  const devinSection = frontmatter.devin ?? {};
  const extras: Record<string, unknown> = {};
  for (const key of DEVIN_COMMAND_SECTION_KEYS) {
    if (devinSection[key] !== undefined) {
      extras[key] = devinSection[key];
    }
  }

  return stringifyFrontmatter(rulesyncCommand.getBody().trim(), {
    ...extras,
    name: slug,
    description,
  });
}

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
export class DevinCommand extends ToolCommand {
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

  constructor({ slug, ...params }: DevinCommandParams) {
    super({
      ...params,
      ...(slug !== undefined && {
        relativeDirPath: join(params.relativeDirPath, slug),
        relativeFilePath: SKILL_FILE_NAME,
      }),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  toRulesyncCommand(): RulesyncCommand {
    const slug = basename(dirname(this.getRelativePathFromCwd()));
    const { frontmatter, body } = parseFrontmatter(this.getFileContent(), this.getFilePath());
    const description =
      typeof frontmatter.description === "string" ? frontmatter.description : undefined;

    return new RulesyncCommand({
      relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
      relativeFilePath: `${slug}.md`,
      frontmatter: { description },
      body: body.trimStart(),
    } as ConstructorParameters<typeof RulesyncCommand>[0]);
  }

  static override fromRulesyncCommand({
    outputRoot,
    rulesyncCommand,
    global = false,
  }: ToolCommandFromRulesyncCommandParams): DevinCommand {
    const paths = DevinCommand.getSettablePaths({ global });
    return new DevinCommand({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: SKILL_FILE_NAME,
      slug: commandSlug(rulesyncCommand.getRelativeFilePath()),
      fileContent: commandSkillContent(rulesyncCommand),
    });
  }

  getFileContent(): string {
    return this.fileContent;
  }
}
