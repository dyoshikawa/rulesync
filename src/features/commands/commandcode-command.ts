import { join } from "node:path";

import { COMMANDCODE_COMMANDS_DIR_PATH } from "../../constants/commandcode-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { readFileContent } from "../../utils/file.js";
import { parseFrontmatter } from "../../utils/frontmatter.js";
import { RulesyncCommand, RulesyncCommandFrontmatter } from "./rulesync-command.js";
import {
  ToolCommand,
  ToolCommandForDeletionParams,
  ToolCommandFromFileParams,
  ToolCommandFromRulesyncCommandParams,
  ToolCommandSettablePaths,
} from "./tool-command.js";

/**
 * Custom slash command for Command Code.
 *
 * Command Code reads Markdown files from `.commandcode/commands/` (project)
 * and `~/.commandcode/commands/` (user), naming each command after the file's
 * basename; subdirectories only group the files. The file's full trimmed
 * body is the prompt that runs — YAML frontmatter is not stripped, only
 * skipped when the slash menu picks a summary line — so rulesync writes the
 * bare body. On import a hand-written file's frontmatter block is dropped
 * (Command Code would send it as prompt text; a rulesync command carries its
 * own frontmatter) and only the body is kept.
 *
 * @see https://commandcode.ai/docs/custom-slash-commands
 */
export class CommandcodeCommand extends ToolCommand {
  // Both scopes share the same relative path; the home-directory root is
  // applied by the generate pipeline in global mode.
  static getSettablePaths(_options: { global?: boolean } = {}): ToolCommandSettablePaths {
    return {
      relativeDirPath: COMMANDCODE_COMMANDS_DIR_PATH,
    };
  }

  toRulesyncCommand(): RulesyncCommand {
    const rulesyncFrontmatter: RulesyncCommandFrontmatter = {
      targets: ["*"],
    };

    return new RulesyncCommand({
      outputRoot: process.cwd(),
      frontmatter: rulesyncFrontmatter,
      body: this.getFileContent(),
      relativeDirPath: RulesyncCommand.getSettablePaths().relativeDirPath,
      relativeFilePath: this.relativeFilePath,
      fileContent: this.getFileContent(),
      validate: true,
    });
  }

  static fromRulesyncCommand({
    outputRoot = process.cwd(),
    rulesyncCommand,
    validate = true,
  }: ToolCommandFromRulesyncCommandParams): CommandcodeCommand {
    const paths = this.getSettablePaths();

    return new CommandcodeCommand({
      outputRoot: outputRoot,
      fileContent: rulesyncCommand.getBody(),
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: rulesyncCommand.getRelativeFilePath(),
      validate,
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  getBody(): string {
    return this.getFileContent();
  }

  static isTargetedByRulesyncCommand(rulesyncCommand: RulesyncCommand): boolean {
    return this.isTargetedByRulesyncCommandDefault({
      rulesyncCommand,
      toolTarget: "commandcode",
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
  }: ToolCommandFromFileParams): Promise<CommandcodeCommand> {
    const paths = this.getSettablePaths();
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);

    const fileContent = await readFileContent(filePath);
    const { body: content } = parseFrontmatter(fileContent, filePath);

    return new CommandcodeCommand({
      outputRoot: outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      fileContent: content.trim(),
      validate,
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolCommandForDeletionParams): CommandcodeCommand {
    return new CommandcodeCommand({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
    });
  }
}
