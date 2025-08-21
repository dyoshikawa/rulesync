import type { ParsedSubagent, SubagentOutput } from "../../types/subagents.js";
import type { ToolTarget } from "../../types/tool-targets.js";

/**
 * Abstract base class for subagent generators
 * Provides common functionality and enforces consistent interface
 */
export abstract class BaseSubagentGenerator {
  abstract getToolName(): ToolTarget;
  abstract getSubagentsDirectory(): string;
  abstract processContent(subagent: ParsedSubagent): string;

  /**
   * Generate subagent output for the specified tool
   */
  generate(subagent: ParsedSubagent, outputDir: string): SubagentOutput {
    const filepath = this.getOutputPath(subagent.filename, outputDir);
    const content = this.processContent(subagent);

    return {
      tool: this.getToolName(),
      filepath,
      content,
    };
  }

  /**
   * Get the output path for the subagent file
   * Override this method if custom path logic is needed
   */
  public getOutputPath(filename: string, baseDir: string): string {
    const baseName = filename.replace(/\.md$/, "");
    const extension = this.getFileExtension();
    return `${baseDir}/${this.getSubagentsDirectory()}/${baseName}.${extension}`;
  }

  /**
   * Get file extension for the target tool
   * Override if tool uses different extension than yaml
   */
  protected getFileExtension(): string {
    return "yaml";
  }
}
