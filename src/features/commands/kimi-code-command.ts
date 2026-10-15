import { basename, dirname, join } from "node:path";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { KIMI_CODE_SKILLS_DIR_NAME } from "../../constants/kimi-code-paths.js";
import { RULESYNC_COMMANDS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { type AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { parseFrontmatter, stringifyFrontmatter } from "../../utils/frontmatter.js";
import { getKimiCodeRelativeDirPath } from "../../utils/kimi-code.js";
import { commandSlug } from "./command-skill-ownership.js";
import { RulesyncCommand } from "./rulesync-command.js";
import {
  ToolCommand,
  type ToolCommandFromRulesyncCommandParams,
  type ToolCommandSettablePaths,
} from "./tool-command.js";

type KimiCodeCommandParams = AiFileParams & {
  slug?: string;
};

/**
 * Kimi Code SKILL.md frontmatter keys a command may author through its
 * `kimi-code:` section.
 * @see https://moonshotai.github.io/kimi-code/en/customization/skills.html
 */
const KIMI_CODE_COMMAND_SECTION_KEYS = [
  "type",
  "whenToUse",
  "disableModelInvocation",
  "arguments",
] as const;

function commandSkillContent(rulesyncCommand: RulesyncCommand): string {
  const slug = commandSlug(rulesyncCommand.getRelativeFilePath());
  const frontmatter = rulesyncCommand.getFrontmatter();
  const description = frontmatter.description ?? `${slug} command`;

  const kimiCodeSection = frontmatter["kimi-code"] ?? {};
  const extras: Record<string, unknown> = {};
  for (const key of KIMI_CODE_COMMAND_SECTION_KEYS) {
    if (kimiCodeSection[key] !== undefined) {
      extras[key] = kimiCodeSection[key];
    }
  }

  return stringifyFrontmatter(rulesyncCommand.getBody().trim(), {
    name: slug,
    description,
    // A command is a user-invoked prompt, so keep the model from invoking the
    // command-derived skill on its own unless the `kimi-code:` section says
    // otherwise.
    disableModelInvocation: true,
    ...extras,
  });
}

/**
 * Represents a Kimi Code slash command, emitted as a Kimi Code Skill.
 *
 * Kimi Code has no standalone custom-command directory outside plugins: every
 * external Skill is registered as a slash command (`/skill:<name>`, with a
 * `/<name>` shorthand when the bare name is free), and the Skill body supports
 * `$ARGUMENTS`, positional `$0` / `$1`, and named `$<name>` placeholders.
 * Commands are therefore emitted onto the native skills surface, one
 * `SKILL.md` per command: `.kimi-code/skills/<slug>/SKILL.md` (project) and
 * `~/.kimi-code/skills/<slug>/SKILL.md` (global; `$KIMI_CODE_HOME/skills/`
 * when `KIMI_CODE_HOME` is set). Directory-form `SKILL.md` requires both
 * `name` and `description`, so both are always written.
 *
 * Import and deletion are intentionally no-ops for this target: the skills
 * feature owns the `.kimi-code/skills/` tree, so importing it as commands
 * would double-import every skill (mirrors the Devin, Warp and Hermes Agent
 * commands targets).
 *
 * @see https://moonshotai.github.io/kimi-code/en/customization/skills.html
 * @see https://moonshotai.github.io/kimi-code/en/reference/slash-commands.html
 */
export class KimiCodeCommand extends ToolCommand {
  static override isTargetedByRulesyncCommand(rulesyncCommand: RulesyncCommand): boolean {
    return this.isTargetedByRulesyncCommandDefault({
      rulesyncCommand,
      toolTarget: "kimi-code",
    });
  }

  static getSettablePaths({ global = false }: { global?: boolean } = {}): ToolCommandSettablePaths {
    return {
      relativeDirPath: getKimiCodeRelativeDirPath({
        global,
        relativeDirPath: KIMI_CODE_SKILLS_DIR_NAME,
      }),
    };
  }

  constructor({ slug, ...params }: KimiCodeCommandParams) {
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
  }: ToolCommandFromRulesyncCommandParams): KimiCodeCommand {
    const paths = KimiCodeCommand.getSettablePaths({ global });
    return new KimiCodeCommand({
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
