import { join } from "node:path";
import { ClaudeCodeSubagentGenerator } from "../generators/subagents/claudecode.js";
import type { SubagentOutput } from "../types/subagents.js";
import type { ToolTarget } from "../types/tool-targets.js";
import { fileExists } from "../utils/file.js";
import { logger } from "../utils/logger.js";
import { parseSubagentsFromDirectory } from "./subagent-parser.js";

export async function generateSubagents(
  projectRoot: string,
  baseDir: string | undefined,
  targets: ToolTarget[],
): Promise<SubagentOutput[]> {
  const subagentsDir = join(projectRoot, ".rulesync", "subagents");

  // Check if subagents directory exists
  if (!(await fileExists(subagentsDir))) {
    // No subagents directory, skip silently
    return [];
  }

  // Parse subagents from directory
  const subagents = await parseSubagentsFromDirectory(subagentsDir);

  if (subagents.length === 0) {
    return [];
  }

  const outputs: SubagentOutput[] = [];
  const outputDir = baseDir || projectRoot;

  // Filter targets to only those that support subagents
  const supportedTargets = targets.filter((target) => ["claudecode"].includes(target));

  // Generate subagent files for each supported target
  for (const target of supportedTargets) {
    const generator = getSubagentGenerator(target);

    if (!generator) {
      continue;
    }

    for (const subagent of subagents) {
      try {
        const output = generator.generate(subagent, outputDir);
        outputs.push(output);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(
          `Failed to generate ${target} subagent for ${subagent.filename}: ${errorMessage}`,
        );
      }
    }
  }

  return outputs;
}

function getSubagentGenerator(target: ToolTarget) {
  switch (target) {
    case "claudecode":
      return new ClaudeCodeSubagentGenerator();
    default:
      logger.warn(`No subagent generator available for tool: ${target}`);
      return null;
  }
}
