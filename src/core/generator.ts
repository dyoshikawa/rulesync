import { generateAgentsMdConfig } from "../generators/rules/agentsmd.js";
import { generateAmazonqcliConfig } from "../generators/rules/amazonqcli.js";
import { generateAugmentcodeConfig } from "../generators/rules/augmentcode.js";
import { generateAugmentcodeLegacyConfig } from "../generators/rules/augmentcode-legacy.js";
import { generateClaudecodeConfig } from "../generators/rules/claudecode.js";
import { generateClineConfig } from "../generators/rules/cline.js";
import { generateCodexConfig } from "../generators/rules/codexcli.js";
import { generateCopilotConfig } from "../generators/rules/copilot.js";
import { generateCursorConfig } from "../generators/rules/cursor.js";
import { generateGeminiConfig } from "../generators/rules/geminicli.js";
import { generateJunieConfig } from "../generators/rules/junie.js";
import { generateKiroConfig } from "../generators/rules/kiro.js";
import { generateOpenCodeConfig } from "../generators/rules/opencode.js";
import { generateQwencodeConfig } from "../generators/rules/qwencode.js";
import { generateRooConfig } from "../generators/rules/roo.js";
import { createOutputsArray } from "../generators/rules/shared-helpers.js";
import { generateWindsurfConfig } from "../generators/rules/windsurf.js";
import { RulesProcessor } from "../rules/rules-processor.js";
import type { Config, GeneratedOutput, ParsedRule, ToolTarget } from "../types/index.js";
import { resolveTargets } from "../utils/index.js";
import { logger } from "../utils/logger.js";

export async function generateConfigurations(
  rules: ParsedRule[],
  config: Config,
  targetTools?: ToolTarget[],
  baseDir?: string,
): Promise<GeneratedOutput[]> {
  const outputs = createOutputsArray();
  const toolsToGenerate = targetTools || config.defaultTargets;

  // Check for root files
  const rootFiles = rules.filter((rule) => rule.frontmatter.root === true);
  if (rootFiles.length === 0) {
    logger.warn("No files with 'root: true' found. This may result in incomplete configurations.");
  }

  for (const tool of toolsToGenerate) {
    const relevantRules = filterRulesForTool(rules, tool, config);

    if (relevantRules.length === 0) {
      logger.warn(`No rules found for tool: ${tool}`);
      continue;
    }

    const toolOutputs = await generateForTool(tool, relevantRules, config, baseDir);
    if (toolOutputs) {
      outputs.push(...toolOutputs);
    }
  }

  return outputs;
}

function filterRulesForTool(rules: ParsedRule[], tool: ToolTarget, config: Config): ParsedRule[] {
  return rules.filter((rule) => {
    const targets = resolveTargets(rule.frontmatter.targets, config);
    if (!targets.includes(tool)) {
      return false;
    }

    return true;
  });
}

async function generateForTool(
  tool: ToolTarget,
  rules: ParsedRule[],
  config: Config,
  baseDir?: string,
): Promise<GeneratedOutput[] | null> {
  // Log which tool-specific processor is being used
  logger.debug(`Generating configuration for tool: ${tool}`);

  // Get RulesProcessor instance for this tool if available
  const resolvedBaseDir = baseDir || process.cwd();
  const rulesProcessor = RulesProcessor.create(tool, resolvedBaseDir);

  if (rulesProcessor) {
    logger.debug(`Using RulesProcessor for tool: ${tool}`);
  } else {
    logger.debug(`Using legacy generator for tool: ${tool}`);
  }

  switch (tool) {
    case "agentsmd":
      return await generateAgentsMdConfig(rules, config, baseDir);
    case "amazonqcli":
      return await generateAmazonqcliConfig(rules, config, baseDir);
    case "augmentcode":
      return generateAugmentcodeConfig(rules, config, baseDir);
    case "augmentcode-legacy":
      return generateAugmentcodeLegacyConfig(rules, config, baseDir);
    case "copilot":
      return generateCopilotConfig(rules, config, baseDir);
    case "cursor":
      return generateCursorConfig(rules, config, baseDir);
    case "cline":
      return generateClineConfig(rules, config, baseDir);
    case "claudecode":
      return await generateClaudecodeConfig(rules, config, baseDir);
    case "codexcli":
      return generateCodexConfig(rules, config, baseDir);
    case "roo":
      return generateRooConfig(rules, config, baseDir);
    case "geminicli":
      return generateGeminiConfig(rules, config, baseDir);
    case "junie":
      return generateJunieConfig(rules, config, baseDir);
    case "kiro":
      return generateKiroConfig(rules, config, baseDir);
    case "opencode":
      return generateOpenCodeConfig(rules, config, baseDir);
    case "qwencode":
      return generateQwencodeConfig(rules, config, baseDir);
    case "windsurf":
      return generateWindsurfConfig(rules, config, baseDir);
    default:
      logger.warn(`Unknown tool: ${tool}`);
      return null;
  }
}
