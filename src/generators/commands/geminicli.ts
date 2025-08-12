import { join } from "node:path";
import type { CommandOutput, ParsedCommand } from "../../types/commands.js";

export class GeminiCliCommandGenerator {
  generate(command: ParsedCommand, outputDir: string): CommandOutput {
    const filepath = this.getOutputPath(command.filename, outputDir);
    
    // Convert content syntax from Claude Code to Gemini CLI
    let convertedContent = this.convertSyntax(command.content);
    
    // Build TOML content
    const tomlLines: string[] = [];
    
    // Add description if present
    if (command.frontmatter.description) {
      tomlLines.push(`description = "${this.escapeTomlString(command.frontmatter.description)}"`);
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
    const tomlFilename = filename.replace(/\.md$/, ".toml");
    const filenameWithExt = tomlFilename.endsWith(".toml") ? tomlFilename : `${tomlFilename}.toml`;
    return join(baseDir, ".gemini", "commands", filenameWithExt);
  }

  private convertSyntax(content: string): string {
    let converted = content;
    
    // Convert $ARGUMENTS to {{args}}
    converted = converted.replace(/\$ARGUMENTS/g, "{{args}}");
    
    // Convert shell command injection: !`command` to !{command}
    converted = converted.replace(/!`([^`]+)`/g, "!{$1}");
    
    // Check for @ syntax and log warning (Gemini CLI doesn't support file injection)
    const atSyntaxMatches = converted.match(/@[^\s]+/g);
    if (atSyntaxMatches) {
      console.warn(
        `⚠️  Warning: @ syntax found (${atSyntaxMatches.join(", ")}). ` +
        "Gemini CLI does not support file content injection. " +
        "Consider using shell commands or remove these references.",
      );
    }
    
    return converted.trim();
  }

  private escapeTomlString(str: string): string {
    // Escape special characters for TOML strings
    return str
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r")
      .replace(/\t/g, "\\t");
  }
}