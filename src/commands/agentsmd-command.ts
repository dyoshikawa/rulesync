import { basename, join } from "node:path";
import { formatError } from "../utils/error.js";
import { readFileContent } from "../utils/file.js";
import { parseFrontmatter } from "../utils/frontmatter.js";
import { RulesyncCommand } from "./rulesync-command.js";
import { SimulatedCommand, SimulatedCommandFrontmatterSchema } from "./simulated-command.js";
import {
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
    baseDir = process.cwd(),
    rulesyncCommand,
    validate = true,
  }: ToolCommandFromRulesyncCommandParams): AgentsmdCommand {
    return new AgentsmdCommand(
      this.fromRulesyncCommandDefault({ baseDir, rulesyncCommand, validate }),
    );
  }

  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true,
  }: ToolCommandFromFileParams): Promise<AgentsmdCommand> {
    const filePath = join(
      baseDir,
      AgentsmdCommand.getSettablePaths().relativeDirPath,
      relativeFilePath,
    );
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent);

    const result = SimulatedCommandFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new AgentsmdCommand({
      baseDir: baseDir,
      relativeDirPath: AgentsmdCommand.getSettablePaths().relativeDirPath,
      relativeFilePath: basename(relativeFilePath),
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
}
