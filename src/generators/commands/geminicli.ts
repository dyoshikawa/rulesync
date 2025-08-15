import type { CommandOutput, ParsedCommand } from "../../types/commands.js";
import {
  escapeTomlString,
  getHierarchicalCommandPath,
  syntaxConverters,
} from "../../utils/command-generators.js";

export class GeminiCliCommandGenerator {
  generate(command: ParsedCommand, outputDir: string): CommandOutput {
    const filepath = this.getOutputPath(command.filename, outputDir);

    // Convert content syntax from Claude Code to Gemini CLI
    const convertedContent = syntaxConverters.toGeminiCli(command.content);

    // Build TOML content
    const tomlLines: string[] = [];

    // Add description if present
    if (command.frontmatter.description) {
      tomlLines.push(`description = "${escapeTomlString(command.frontmatter.description)}"`);
      tomlLines.push("");
    }

    // Add prompt
    tomlLines.push(`prompt = """${convertedContent}"""`);

    const content = tomlLines.join("\n") + "\n";

    return {
      tool: "geminicli",
      filepath,
      content,
    };
  }

  getOutputPath(filename: string, baseDir: string): string {
    // Preserve directory structure for namespacing
    return getHierarchicalCommandPath(filename, baseDir, ".gemini/commands", "toml");
  }
}
