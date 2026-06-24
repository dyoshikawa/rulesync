import { join } from "node:path";

import {
  CLINE_COMMANDS_DIR_PATH,
  CLINE_COMMANDS_GLOBAL_DIR_PATH,
} from "../../constants/cline-paths.js";
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

export class ClineCommand extends ToolCommand {
  static getSettablePaths({ global }: { global?: boolean } = {}): ToolCommandSettablePaths {
    if (global) {
      return {
        relativeDirPath: CLINE_COMMANDS_GLOBAL_DIR_PATH,
      };
    }

    return {
      relativeDirPath: CLINE_COMMANDS_DIR_PATH,
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
    global = false,
  }: ToolCommandFromRulesyncCommandParams): ClineCommand {
    const paths = this.getSettablePaths({ global });

    return new ClineCommand({
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
      toolTarget: "cline",
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolCommandFromFileParams): Promise<ClineCommand> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);

    const fileContent = await readFileContent(filePath);
    const { body: content } = parseFrontmatter(fileContent, filePath);

    return new ClineCommand({
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
  }: ToolCommandForDeletionParams): ClineCommand {
    return new ClineCommand({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
    });
  }
}
