import type { ParsedRule } from "../../types/index.js";
import { resolvePath } from "../../utils/file.js";
import { BaseCommandParser } from "./base.js";
import { parseCommandsFromDirectory } from "./shared.js";

/**
 * Claude Code command parser
 * Parses commands from .claude/commands/*.md files
 */
export class ClaudeCodeCommandParser extends BaseCommandParser {
  getToolName() {
    return "claudecode" as const;
  }

  getCommandsDirectory(): string {
    return ".claude/commands";
  }

  async parseCommands(baseDir: string = process.cwd()): Promise<ParsedRule[]> {
    const commandsDir = resolvePath(this.getCommandsDirectory(), baseDir);
    return await parseCommandsFromDirectory(commandsDir, this.getToolName(), ".md", "Command");
  }
}
