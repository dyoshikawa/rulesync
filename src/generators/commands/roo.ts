import { join } from "node:path";
import type { CommandOutput, ParsedCommand } from "../../types/commands.js";

export class RooCommandGenerator {
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
      tool: "roo",
      filepath,
      content,
    };
  }

  getOutputPath(filename: string, baseDir: string): string {
    // Flatten subdirectory structure (git/commit.md -> git-commit.md)
    // This follows the user requirement of not supporting nested directories
    const flattenedName = filename.replace(/\//g, "-");
    return join(baseDir, ".roo", "commands", `${flattenedName}.md`);
  }
}
