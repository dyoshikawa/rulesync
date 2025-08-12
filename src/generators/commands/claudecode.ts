import { join } from "node:path";
import type { CommandOutput, ParsedCommand } from "../../types/commands.js";

export class ClaudeCodeCommandGenerator {
  generate(command: ParsedCommand, outputDir: string): CommandOutput {
    const filepath = this.getOutputPath(command.filename, outputDir);

    // Build frontmatter
    const frontmatter: string[] = ["---"];
    if (command.frontmatter.description) {
      frontmatter.push(`description: ${command.frontmatter.description}`);
    }
    frontmatter.push("---");

    // Combine frontmatter and content
    const content = `${frontmatter.join("\n")}\n\n${command.content.trim()}\n`;

    return {
      tool: "claudecode",
      filepath,
      content,
    };
  }

  getOutputPath(filename: string, baseDir: string): string {
    // Flatten subdirectory structure (git/commit.md -> git-commit.md)
    const flattenedName = filename.replace(/\//g, "-");
    return join(baseDir, ".claude", "commands", `${flattenedName}.md`);
  }
}
