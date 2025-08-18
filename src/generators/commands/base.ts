import type { CommandOutput, ParsedCommand } from "../../types/commands.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import {
  getFlattenedCommandPath,
  getHierarchicalCommandPath,
} from "../../utils/command-generators.js";

/**
 * Abstract base class for command generators
 * Provides common functionality and enforces consistent interface
 */
export abstract class BaseCommandGenerator {
  abstract getToolName(): ToolTarget;
  abstract getSubDirectory(): string;
  abstract processContent(command: ParsedCommand): string;

  /**
   * Generate command output for the specified tool
   */
  generate(command: ParsedCommand, outputDir: string): CommandOutput {
    const filepath = this.getOutputPath(command.filename, outputDir);
    const content = this.processContent(command);

    return {
      tool: this.getToolName(),
      filepath,
      content,
    };
  }

  /**
   * Get the output path for the command file
   * Override this method if custom path logic is needed
   */
  public getOutputPath(filename: string, baseDir: string): string {
    if (this.supportsHierarchy()) {
      return getHierarchicalCommandPath(
        filename,
        baseDir,
        this.getSubDirectory(),
        this.getFileExtension(),
      );
    } else {
      return getFlattenedCommandPath(filename, baseDir, this.getSubDirectory());
    }
  }

  /**
   * Whether this tool supports hierarchical directory structure
   * Override to return true for tools that support nested commands
   */
  protected supportsHierarchy(): boolean {
    return false;
  }

  /**
   * Get file extension for the target tool
   * Override if tool uses different extension than .md
   */
  protected getFileExtension(): string {
    return "md";
  }
}
