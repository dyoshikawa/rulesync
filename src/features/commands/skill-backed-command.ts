import { basename, dirname, join } from "node:path";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_COMMANDS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { type AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { parseFrontmatter, stringifyFrontmatter } from "../../utils/frontmatter.js";
import { commandSlug } from "./command-skill-ownership.js";
import { RulesyncCommand, type RulesyncCommandFrontmatter } from "./rulesync-command.js";
import {
  ToolCommand,
  type ToolCommandFromRulesyncCommandParams,
  type ToolCommandSettablePaths,
} from "./tool-command.js";

export type SkillBackedToolCommandParams = AiFileParams & {
  slug?: string;
};

/**
 * Base class for targets that emit each command as a native Skill, one
 * `<skills dir>/<slug>/SKILL.md` per command (Devin, Warp, Kimi Code).
 *
 * Subclasses provide `getSettablePaths` and `isTargetedByRulesyncCommand`, and
 * may override `getSkillFrontmatter` to add target-specific SKILL.md keys.
 *
 * Import and deletion are intentionally no-ops for these targets: the skills
 * feature owns the skills tree, so importing it as commands would
 * double-import every skill.
 */
export class SkillBackedToolCommand extends ToolCommand {
  constructor({ slug, ...params }: SkillBackedToolCommandParams) {
    super({
      ...params,
      ...(slug !== undefined && {
        relativeDirPath: join(params.relativeDirPath, slug),
        relativeFilePath: SKILL_FILE_NAME,
      }),
    });
  }

  static override getSettablePaths(_params: { global?: boolean } = {}): ToolCommandSettablePaths {
    throw new Error("Please implement this method in the subclass.");
  }

  /**
   * The SKILL.md frontmatter emitted for a command. The default writes the
   * `name` and `description` every skill needs.
   */
  protected static getSkillFrontmatter({
    slug,
    frontmatter,
  }: {
    slug: string;
    frontmatter: RulesyncCommandFrontmatter;
  }): Record<string, unknown> {
    return {
      name: slug,
      description: frontmatter.description ?? `${slug} command`,
    };
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
    });
  }

  static override fromRulesyncCommand({
    outputRoot,
    rulesyncCommand,
    global = false,
  }: ToolCommandFromRulesyncCommandParams): SkillBackedToolCommand {
    const paths = this.getSettablePaths({ global });
    const slug = commandSlug(rulesyncCommand.getRelativeFilePath());
    return new this({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: SKILL_FILE_NAME,
      slug,
      fileContent: stringifyFrontmatter(
        rulesyncCommand.getBody().trim(),
        this.getSkillFrontmatter({ slug, frontmatter: rulesyncCommand.getFrontmatter() }),
      ),
    });
  }

  getFileContent(): string {
    return this.fileContent;
  }
}
