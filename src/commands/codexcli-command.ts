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

export type CodexcliCommandParams = AiFileParams;

export class CodexcliCommand extends ToolCommand {
  static getSettablePaths({ global }: { global?: boolean } = {}): ToolCommandSettablePaths {
    if (!global) {
      throw new Error("CodexcliCommand only supports global mode. Please pass { global: true }.");
    }
    return {
      relativeDirPath: join(".codex", "prompts"),
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
    global = false,
  }: ToolCommandFromRulesyncCommandParams): CodexcliCommand {
    const paths = this.getSettablePaths({ global });

    return new CodexcliCommand({
      baseDir: baseDir,
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
      toolTarget: "codexcli",
    });
  }

  static async fromFile({
    baseDir = ".",
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolCommandFromFileParams): Promise<CodexcliCommand> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(baseDir, paths.relativeDirPath, relativeFilePath);

    const fileContent = await readFileContent(filePath);
    const { body: content } = parseFrontmatter(fileContent);

    return new CodexcliCommand({
      baseDir: baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: basename(relativeFilePath),
      fileContent: content.trim(),
      validate,
    });
  }
}
