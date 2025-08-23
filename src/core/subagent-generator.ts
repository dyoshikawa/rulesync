import path from "node:path";
import { ClaudeCodeSubagentGenerator } from "../generators/subagents/claudecode.js";
import { parseSubagentsFromDirectory } from "../parsers/features/subagent-parser.js";
import type { Config } from "../types/config.js";
import type { ProcessedRule } from "../types/rules.js";
import type { ParsedSubagent } from "../types/subagent.js";
import type { ToolTarget } from "../types/tool-targets.js";
import { logger } from "../utils/logger.js";

export interface SubagentOutput {
  tool: ToolTarget;
  filepath: string;
  content: string;
}

/**
 * Generate subagent files for specified tools
 */
export async function generateSubagents(
  rulesyncDir: string,
  outputDir?: string,
  tools?: ToolTarget[],
  rules?: ProcessedRule[],
): Promise<SubagentOutput[]> {
  const outputs: SubagentOutput[] = [];

  // Parse existing subagents from .rulesync/subagents if it exists
  const subagentsDir = path.join(rulesyncDir, "subagents");
  let parsedSubagents: ParsedSubagent[] = [];

  try {
    parsedSubagents = await parseSubagentsFromDirectory(subagentsDir);
    if (parsedSubagents.length > 0) {
      logger.debug(`Found ${parsedSubagents.length} subagent files in ${subagentsDir}`);
    }
  } catch (error) {
    logger.debug(`No subagents directory found or error reading: ${error}`);
  }

  // If no tools specified, return empty array
  if (!tools || tools.length === 0) {
    return outputs;
  }

  // Create a dummy config for generators that need it
  const config: Config = {
    aiRulesDir: rulesyncDir,
    outputPaths: {
      agentsmd: ".",
      amazonqcli: ".",
      augmentcode: ".augment",
      "augmentcode-legacy": ".",
      copilot: ".github",
      cursor: ".cursor",
      cline: ".",
      claudecode: ".",
      codexcli: ".",
      opencode: ".",
      qwencode: ".",
      roo: ".roo",
      geminicli: ".gemini",
      kiro: ".kiro",
      junie: ".junie",
      windsurf: ".windsurf",
    },
    watchEnabled: false,
    defaultTargets: tools,
  };

  // Generate subagents for each tool
  for (const tool of tools) {
    try {
      let generator;

      switch (tool) {
        case "claudecode":
          generator = new ClaudeCodeSubagentGenerator();
          break;
        // Add other tool generators here as they are implemented
        default:
          logger.debug(`Subagent generation not yet implemented for ${tool}`);
          continue;
      }

      // Generate subagent files
      // Only pass rules if no parsed subagents are available
      const generatedOutputs = await generator.generate(
        parsedSubagents.length > 0 ? [] : (rules || []),
        config,
        outputDir,
        parsedSubagents,
      );

      // Convert to SubagentOutput format
      for (const output of generatedOutputs) {
        outputs.push({
          tool,
          filepath: output.filepath,
          content: output.content,
        });
      }
    } catch (error) {
      logger.error(`Failed to generate subagents for ${tool}:`, error);
    }
  }

  return outputs;
}
