import type { CommandOutput, ParsedCommand } from "../../types/commands.js";
import { buildCommandContent, getFlattenedCommandPath } from "../../utils/command-generators.js";

export class RooCommandGenerator {
  generate(command: ParsedCommand, outputDir: string): CommandOutput {
    const filepath = this.getOutputPath(command.filename, outputDir);
    const content = buildCommandContent(command);

    return {
      tool: "roo",
      filepath,
      content,
    };
  }

  getOutputPath(filename: string, baseDir: string): string {
    // Flatten subdirectory structure (git/commit.md -> git-commit.md)
    // This follows the user requirement of not supporting nested directories
    return getFlattenedCommandPath(filename, baseDir, ".roo/commands");
  }
}
