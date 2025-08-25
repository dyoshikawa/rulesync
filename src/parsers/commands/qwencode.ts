import type { ParsedRule } from "../../types/index.js";
import { resolvePath } from "../../utils/file.js";
import { BaseCommandParser } from "./base.js";
import { parseCommandsFromDirectory } from "./shared.js";

/**
 * Qwen Code command parser
 * Parses commands from .qwen/commands/*.md files
 */
export class QwenCodeCommandParser extends BaseCommandParser {
  getToolName() {
    return "qwencode" as const;
  }

  getCommandsDirectory(): string {
    return ".qwen/commands";
  }

  async parseCommands(baseDir: string = process.cwd()): Promise<ParsedRule[]> {
    const commandsDir = resolvePath(this.getCommandsDirectory(), baseDir);
    return await parseCommandsFromDirectory(commandsDir, this.getToolName(), ".md", "Command");
  }
}
