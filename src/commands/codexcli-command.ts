import { basename, join } from "node:path";
import { readFileContent } from "../utils/file.js";
import { parseFrontmatter } from "../utils/frontmatter.js";
import { SimulatedCommand, SimulatedCommandFrontmatterSchema } from "./simulated-command.js";
import {
  ToolCommandFromFileParams,
  ToolCommandFromRulesyncCommandParams,
  ToolCommandSettablePaths,
} from "./tool-command.js";

export class CodexCliCommand extends SimulatedCommand {
  static getSettablePaths(): ToolCommandSettablePaths {
    return {
      relativeDirPath: ".codex/commands",
    };
  }

  static fromRulesyncCommand({
    baseDir = ".",
    rulesyncCommand,
    validate = true,
  }: ToolCommandFromRulesyncCommandParams): CodexCliCommand {
    return new CodexCliCommand(
      this.fromRulesyncCommandDefault({ baseDir, rulesyncCommand, validate }),
    );
  }

  static async fromFile({
    baseDir = ".",
    relativeFilePath,
    validate = true,
  }: ToolCommandFromFileParams): Promise<CodexCliCommand> {
    const filePath = join(
      baseDir,
      CodexCliCommand.getSettablePaths().relativeDirPath,
      relativeFilePath,
    );
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent);

    const result = SimulatedCommandFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${result.error.message}`);
    }

    return new CodexCliCommand({
      baseDir: baseDir,
      relativeDirPath: CodexCliCommand.getSettablePaths().relativeDirPath,
      relativeFilePath: basename(relativeFilePath),
      frontmatter: result.data,
      body: content.trim(),
      validate,
    });
  }
}
