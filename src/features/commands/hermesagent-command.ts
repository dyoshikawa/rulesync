import { basename, dirname, join } from "node:path";

import { HERMESAGENT_SKILLS_DIR_PATH } from "../../constants/hermesagent-paths.js";
import { RULESYNC_COMMANDS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { type AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { parseFrontmatter, stringifyFrontmatter } from "../../utils/frontmatter.js";
import { RulesyncCommand } from "./rulesync-command.js";
import { ToolCommand, type ToolCommandFromRulesyncCommandParams } from "./tool-command.js";

const SKILL_FILE_NAME = "SKILL.md";

type HermesagentCommandParams = AiFileParams & {
  slug?: string;
};

function commandSlug(relativeFilePath: string): string {
  return basename(relativeFilePath, ".md").replace(/[^a-zA-Z0-9_-]/g, "-");
}

function commandSkillContent(rulesyncCommand: RulesyncCommand): string {
  const slug = commandSlug(rulesyncCommand.getRelativeFilePath());
  const description = rulesyncCommand.getFrontmatter().description ?? `${slug} command`;

  return stringifyFrontmatter(rulesyncCommand.getBody().trim(), {
    name: slug,
    description,
  });
}

export class HermesagentCommand extends ToolCommand {
  static override isTargetedByRulesyncCommand(rulesyncCommand: RulesyncCommand): boolean {
    const targets = rulesyncCommand.getFrontmatter().targets;

    return !targets || targets.includes("*") || targets.includes("hermesagent");
  }

  static getSettablePaths({ slug = "command" }: { slug?: string; global?: boolean } = {}) {
    return {
      relativeDirPath: join(HERMESAGENT_SKILLS_DIR_PATH, slug),
      relativeFilePath: SKILL_FILE_NAME,
    };
  }

  constructor({ slug, ...params }: HermesagentCommandParams) {
    const resolvedSlug = slug ?? basename(dirname(params.relativeDirPath));
    super({
      ...params,
      ...HermesagentCommand.getSettablePaths({ slug: resolvedSlug }),
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
  }: ToolCommandFromRulesyncCommandParams): HermesagentCommand {
    return new HermesagentCommand({
      outputRoot,
      relativeDirPath: "",
      relativeFilePath: SKILL_FILE_NAME,
      slug: commandSlug(rulesyncCommand.getRelativeFilePath()),
      fileContent: commandSkillContent(rulesyncCommand),
    });
  }
  getFileContent(): string {
    return this.fileContent;
  }
}
