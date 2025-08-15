import type { CommandOutput, ParsedCommand } from "../../types/commands.js";
import { buildCommandContent, getFlattenedCommandPath } from "../../utils/command-generators.js";

export class ClaudeCodeCommandGenerator {
  generate(command: ParsedCommand, outputDir: string): CommandOutput {
    const filepath = this.getOutputPath(command.filename, outputDir);
    const content = buildCommandContent(command);

    return {
      tool: "claudecode",
      filepath,
      content,
    };
  }

  getOutputPath(filename: string, baseDir: string): string {
    return getFlattenedCommandPath(filename, baseDir, ".claude/commands");
  }
}
