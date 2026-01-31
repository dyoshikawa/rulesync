import { basename, join } from "node:path";

import { formatError } from "../../utils/error.js";
import { readFileContent } from "../../utils/file.js";
import { parseFrontmatter } from "../../utils/frontmatter.js";
import { RulesyncCommand } from "./rulesync-command.js";
import { SimulatedCommand, SimulatedCommandFrontmatterSchema } from "./simulated-command.js";
import {
  ToolCommandForDeletionParams,
  ToolCommandFromFileParams,
  ToolCommandFromRulesyncCommandParams,
  ToolCommandSettablePaths,
} from "./tool-command.js";

export class FactoryCommand extends SimulatedCommand {
  static getSettablePaths(_options?: { global?: boolean }): ToolCommandSettablePaths {
    return {
      relativeDirPath: join(".factory", "commands"),
    };
  }

  static fromRulesyncCommand({
    baseDir = process.cwd(),
    rulesyncCommand,
    validate = true,
    global = false,
  }: ToolCommandFromRulesyncCommandParams): FactoryCommand {
    return new FactoryCommand(
      this.fromRulesyncCommandDefault({ baseDir, rulesyncCommand, validate, global }),
    );
  }

  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolCommandFromFileParams): Promise<FactoryCommand> {
    const paths = FactoryCommand.getSettablePaths({ global });
    const filePath = join(baseDir, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent);

    const result = SimulatedCommandFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new FactoryCommand({
      baseDir: baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: basename(relativeFilePath),
      frontmatter: result.data,
      body: content.trim(),
      validate,
    });
  }

  static isTargetedByRulesyncCommand(rulesyncCommand: RulesyncCommand): boolean {
    return this.isTargetedByRulesyncCommandDefault({
      rulesyncCommand,
      toolTarget: "factory",
    });
  }

  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolCommandForDeletionParams): FactoryCommand {
    return new FactoryCommand(
      this.forDeletionDefault({ baseDir, relativeDirPath, relativeFilePath }),
    );
  }
}
