import { basename, join } from "node:path";
import { readFileContent } from "../utils/file.js";
import { parseFrontmatter } from "../utils/frontmatter.js";
import { RulesyncCommand } from "./rulesync-command.js";
import { SimulatedCommand, SimulatedCommandFrontmatterSchema } from "./simulated-command.js";
import {
  ToolCommandFromFileParams,
  ToolCommandFromRulesyncCommandParams,
  ToolCommandSettablePaths,
} from "./tool-command.js";

export class CopilotCommand extends SimulatedCommand {
  static getSettablePaths(): ToolCommandSettablePaths {
    return {
      relativeDirPath: ".github/commands",
    };
  }

  static fromRulesyncCommand({
    baseDir = ".",
    rulesyncCommand,
    validate = true,
  }: ToolCommandFromRulesyncCommandParams): CopilotCommand {
    return new CopilotCommand(
      this.fromRulesyncCommandDefault({ baseDir, rulesyncCommand, validate }),
    );
  }

  static async fromFile({
    baseDir = ".",
    relativeFilePath,
    validate = true,
  }: ToolCommandFromFileParams): Promise<CopilotCommand> {
    const filePath = join(
      baseDir,
      CopilotCommand.getSettablePaths().relativeDirPath,
      relativeFilePath,
    );
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent);

    const result = SimulatedCommandFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${result.error.message}`);
    }

    return new CopilotCommand({
      baseDir: baseDir,
      relativeDirPath: CopilotCommand.getSettablePaths().relativeDirPath,
      relativeFilePath: basename(relativeFilePath),
      frontmatter: result.data,
      body: content.trim(),
      validate,
    });
  }

  static isTargetedByRulesyncCommand(rulesyncCommand: RulesyncCommand): boolean {
    return this.isTargetedByRulesyncCommandDefault({
      rulesyncCommand,
      toolTarget: "copilot",
    });
  }
}
