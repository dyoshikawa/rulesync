import path from "node:path";
import type { Config, GeneratedOutput } from "../../types/index.js";
import type { ProcessedRule } from "../../types/rules.js";
import type { ParsedSubagent, SubagentOutput } from "../../types/subagent.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import { ensureDir, resolvePath } from "../../utils/file.js";
import { logger } from "../../utils/logger.js";

export abstract class BaseSubagentGenerator {
  abstract getToolName(): ToolTarget;
  abstract getAgentsDirectory(): string;
  abstract generateFromRules(rules: ProcessedRule[]): SubagentOutput[];
  abstract generateFromParsedSubagents(subagents: ParsedSubagent[]): SubagentOutput[];
  abstract processContent(subagent: ParsedSubagent): string;

  /**
   * Generate subagent files for the tool
   */
  async generate(
    rules: ProcessedRule[],
    config: Config,
    baseDir?: string,
    parsedSubagents?: ParsedSubagent[],
  ): Promise<GeneratedOutput[]> {
    const toolName = this.getToolName();
    const agentsDir = this.getAgentsDirectory();
    const outputs: GeneratedOutput[] = [];

    try {
      // Determine output directory
      const outputDir = resolvePath(
        path.join(config.outputPaths[toolName] ?? "", agentsDir),
        baseDir,
      );

      // Ensure directory exists
      await ensureDir(outputDir);

      // Generate subagents from either parsed subagents or rules
      let subagentOutputs: SubagentOutput[];
      if (parsedSubagents && parsedSubagents.length > 0) {
        logger.debug(
          `Generating ${parsedSubagents.length} subagents from parsed data for ${toolName}`,
        );
        subagentOutputs = this.generateFromParsedSubagents(parsedSubagents);
      } else {
        logger.debug(`Generating subagents from rules for ${toolName}`);
        subagentOutputs = this.generateFromRules(rules);
      }

      // Create output files
      for (const subagent of subagentOutputs) {
        const filePath = path.join(outputDir, subagent.filename);
        outputs.push({
          tool: toolName,
          filepath: filePath,
          content: subagent.content,
        });
      }

      if (outputs.length > 0) {
        logger.info(`Generated ${outputs.length} subagent files for ${toolName}`);
      } else {
        logger.debug(`No subagents generated for ${toolName}`);
      }

      return outputs;
    } catch (error) {
      logger.error(`Error generating subagents for ${toolName}:`, error);
      return [];
    }
  }
}
