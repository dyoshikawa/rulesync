import type { ParsedCommand } from "../../types/commands.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import { escapeTomlString, syntaxConverters } from "../../utils/command-generators.js";
import { BaseCommandGenerator } from "./base.js";

export class GeminiCliCommandGenerator extends BaseCommandGenerator {
  getToolName(): ToolTarget {
    return "geminicli";
  }

  getSubDirectory(): string {
    return ".gemini/commands";
  }

  processContent(command: ParsedCommand): string {
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

    return tomlLines.join("\n") + "\n";
  }

  protected supportsHierarchy(): boolean {
    return true; // Preserve directory structure for namespacing
  }

  protected getFileExtension(): string {
    return "toml";
  }
}
