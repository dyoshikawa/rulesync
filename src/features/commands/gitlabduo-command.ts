import { join } from "node:path";

import {
  GITLABDUO_COMMANDS_DIR,
  GITLABDUO_GLOBAL_COMMANDS_DIR,
} from "../../constants/gitlabduo-paths.js";
import { formatError } from "../../utils/error.js";
import { readFileContent } from "../../utils/file.js";
import { parseFrontmatter, stringifyFrontmatter } from "../../utils/frontmatter.js";
import { RulesyncCommand, RulesyncCommandFrontmatter } from "./rulesync-command.js";
import { SimulatedCommand, SimulatedCommandFrontmatterSchema } from "./simulated-command.js";
import {
  ToolCommandForDeletionParams,
  ToolCommandFromFileParams,
  ToolCommandFromRulesyncCommandParams,
  ToolCommandSettablePaths,
} from "./tool-command.js";

/**
 * GitLab Duo CLI custom slash commands are Markdown files named after the
 * command, with an optional `description` in YAML frontmatter. The project
 * directory is the cross-tool `.agents/commands/`; the user directory is
 * `~/.gitlab/duo/commands/`. The scan is flat, and text typed after the command
 * is appended to the prompt (there are no argument placeholders).
 *
 * The file format is the same `description`-only shape `AgentsmdCommand`
 * writes, so it reuses that base class, but this adapter is native: it
 * supports the user scope and imports back into rulesync.
 *
 * @see https://docs.gitlab.com/user/gitlab_duo_cli/customize/
 */
export class GitlabduoCommand extends SimulatedCommand {
  static getSettablePaths({ global = false }: { global?: boolean } = {}): ToolCommandSettablePaths {
    return {
      relativeDirPath: global ? GITLABDUO_GLOBAL_COMMANDS_DIR : GITLABDUO_COMMANDS_DIR,
    };
  }

  static fromRulesyncCommand({
    outputRoot = process.cwd(),
    rulesyncCommand,
    validate = true,
    global = false,
  }: ToolCommandFromRulesyncCommandParams): GitlabduoCommand {
    return new GitlabduoCommand({
      outputRoot,
      frontmatter: { description: rulesyncCommand.getFrontmatter().description },
      body: rulesyncCommand.getBody(),
      relativeDirPath: this.getSettablePaths({ global }).relativeDirPath,
      relativeFilePath: rulesyncCommand.getRelativeFilePath(),
      validate,
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolCommandFromFileParams): Promise<GitlabduoCommand> {
    const relativeDirPath = this.getSettablePaths({ global }).relativeDirPath;
    const filePath = join(outputRoot, relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body } = parseFrontmatter(fileContent, filePath);

    const result = SimulatedCommandFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new GitlabduoCommand({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      frontmatter: result.data,
      body: body.trim(),
      validate,
    });
  }

  override toRulesyncCommand(): RulesyncCommand {
    const { description } = this.getFrontmatter();
    const rulesyncFrontmatter: RulesyncCommandFrontmatter = {
      targets: ["*"],
      ...(typeof description === "string" && { description }),
    };

    return new RulesyncCommand({
      outputRoot: ".", // RulesyncCommand outputRoot is always the project root directory
      frontmatter: rulesyncFrontmatter,
      body: this.getBody(),
      relativeDirPath: RulesyncCommand.getSettablePaths().relativeDirPath,
      relativeFilePath: this.relativeFilePath,
      fileContent: stringifyFrontmatter(this.getBody(), rulesyncFrontmatter),
      validate: true,
    });
  }

  static isTargetedByRulesyncCommand(rulesyncCommand: RulesyncCommand): boolean {
    return this.isTargetedByRulesyncCommandDefault({
      rulesyncCommand,
      toolTarget: "gitlabduo",
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolCommandForDeletionParams): GitlabduoCommand {
    return new GitlabduoCommand(
      this.forDeletionDefault({ outputRoot, relativeDirPath, relativeFilePath }),
    );
  }
}
