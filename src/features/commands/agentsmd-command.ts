import { join } from "node:path";

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

export class AgentsmdCommand extends SimulatedCommand {
  static getSettablePaths(): ToolCommandSettablePaths {
    return {
      relativeDirPath: join(".agents", "commands"),
    };
  }

  static fromRulesyncCommand({
    outputRoot = process.cwd(),
    rulesyncCommand,
    validate = true,
  }: ToolCommandFromRulesyncCommandParams): AgentsmdCommand {
    return new AgentsmdCommand(
      this.fromRulesyncCommandDefault({ outputRoot, rulesyncCommand, validate }),
    );
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
  }: ToolCommandFromFileParams): Promise<AgentsmdCommand> {
    const filePath = join(
      outputRoot,
      AgentsmdCommand.getSettablePaths().relativeDirPath,
      relativeFilePath,
    );
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent, filePath);

    const result = SimulatedCommandFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new AgentsmdCommand({
      outputRoot: outputRoot,
      relativeDirPath: AgentsmdCommand.getSettablePaths().relativeDirPath,
      relativeFilePath,
      frontmatter: result.data,
      body: content.trim(),
      validate,
    });
  }

  static isTargetedByRulesyncCommand(rulesyncCommand: RulesyncCommand): boolean {
    return this.isTargetedByRulesyncCommandDefault({
      rulesyncCommand,
      toolTarget: "agentsmd",
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolCommandForDeletionParams): AgentsmdCommand {
    return new AgentsmdCommand(
      this.forDeletionDefault({ outputRoot, relativeDirPath, relativeFilePath }),
    );
  }
}
