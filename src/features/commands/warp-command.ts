import { basename, dirname, join } from "node:path";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_COMMANDS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { WARP_SKILLS_DIR_PATH } from "../../constants/warp-paths.js";
import { type AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { parseFrontmatter, stringifyFrontmatter } from "../../utils/frontmatter.js";
import { commandSlug } from "./command-skill-ownership.js";
import { RulesyncCommand } from "./rulesync-command.js";
import {
  ToolCommand,
  type ToolCommandFromRulesyncCommandParams,
  type ToolCommandSettablePaths,
} from "./tool-command.js";

type WarpCommandParams = AiFileParams & {
  slug?: string;
};

function commandSkillContent(rulesyncCommand: RulesyncCommand): string {
  const slug = commandSlug(rulesyncCommand.getRelativeFilePath());
  const description = rulesyncCommand.getFrontmatter().description ?? `${slug} command`;

  return stringifyFrontmatter(rulesyncCommand.getBody().trim(), {
    name: slug,
    description,
  });
}

/**
 * Represents a Warp slash command, emitted as a Warp Skill.
 *
 * Warp documents skills as its custom slash-command surface: any skill is
 * invocable as `/{skill-name}` with `$ARGUMENTS` / `$ARGUMENTS[N]` / `$N`
 * argument substitution, and Warp has been collapsing its built-in slash
 * commands onto skills (e.g. `/pr-comments` became a bundled skill). Commands
 * are therefore emitted onto the native skills surface, one `SKILL.md` per
 * command: `.warp/skills/<slug>/SKILL.md` (project) and
 * `~/.warp/skills/<slug>/SKILL.md` (global). Warp's `.warp/workflows/` YAML
 * files are parameterized shell-command templates, not agent prompts, so they
 * are deliberately not used here.
 *
 * Import and deletion are intentionally no-ops for this target: the skills
 * feature owns the `.warp/skills/` tree, so importing it as commands would
 * double-import every skill (mirrors the Devin and Hermes Agent commands
 * targets).
 *
 * @see https://docs.warp.dev/agent-platform/capabilities/skills/
 * @see https://docs.warp.dev/agent-platform/capabilities/slash-commands/
 */
export class WarpCommand extends ToolCommand {
  static override isTargetedByRulesyncCommand(rulesyncCommand: RulesyncCommand): boolean {
    return this.isTargetedByRulesyncCommandDefault({
      rulesyncCommand,
      toolTarget: "warp",
    });
  }

  static getSettablePaths({
    global: _global = false,
  }: { global?: boolean } = {}): ToolCommandSettablePaths {
    // Same relative tree at both scopes: project `.warp/skills/` and
    // `~/.warp/skills/` (the global root resolves under the home directory).
    return {
      relativeDirPath: WARP_SKILLS_DIR_PATH,
    };
  }

  constructor({ slug, ...params }: WarpCommandParams) {
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
  }: ToolCommandFromRulesyncCommandParams): WarpCommand {
    const paths = WarpCommand.getSettablePaths({ global });
    return new WarpCommand({
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
