import { basename, join } from "node:path";
import { AiFileParams, ValidationResult } from "../types/ai-file.js";
import { readFileContent } from "../utils/file.js";
import { parseFrontmatter } from "../utils/frontmatter.js";
import { RulesyncCommand, RulesyncCommandFrontmatter } from "./rulesync-command.js";
import {
  ToolCommand,
  ToolCommandFromFileParams,
  ToolCommandFromRulesyncCommandParams,
  ToolCommandSettablePaths,
} from "./tool-command.js";

export type CursorCommandParams = AiFileParams;

export class CursorCommand extends ToolCommand {
  static getSettablePaths(): ToolCommandSettablePaths {
    return {
      relativeDirPath: ".cursor/commands",
    };
  }

  toRulesyncCommand(): RulesyncCommand {
    const rulesyncFrontmatter: RulesyncCommandFrontmatter = {
      targets: ["*"],
      description: "",
    };

    return new RulesyncCommand({
      baseDir: ".", // RulesyncCommand baseDir is always the project root directory
      frontmatter: rulesyncFrontmatter,
      body: this.getFileContent(),
      relativeDirPath: RulesyncCommand.getSettablePaths().relativeDirPath,
      relativeFilePath: this.relativeFilePath,
      fileContent: this.getFileContent(),
      validate: true,
    });
  }

  static fromRulesyncCommand({
    baseDir = ".",
    rulesyncCommand,
    validate = true,
  }: ToolCommandFromRulesyncCommandParams): CursorCommand {
    return new CursorCommand({
      baseDir: baseDir,
      fileContent: rulesyncCommand.getBody(),
      relativeDirPath: CursorCommand.getSettablePaths().relativeDirPath,
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
      toolTarget: "cursor",
    });
  }

  static async fromFile({
    baseDir = ".",
    relativeFilePath,
    validate = true,
  }: ToolCommandFromFileParams): Promise<CursorCommand> {
    const filePath = join(
      baseDir,
      CursorCommand.getSettablePaths().relativeDirPath,
      relativeFilePath,
    );

    const fileContent = await readFileContent(filePath);
    const { body: content } = parseFrontmatter(fileContent);

    return new CursorCommand({
      baseDir: baseDir,
      relativeDirPath: CursorCommand.getSettablePaths().relativeDirPath,
      relativeFilePath: basename(relativeFilePath),
      fileContent: content.trim(),
      validate,
    });
  }
}
