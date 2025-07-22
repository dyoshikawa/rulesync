import { generateKiroIgnoreFiles } from "../generators/ignore/kiro.js";
import { generateAugmentcodeConfig } from "../generators/rules/augmentcode.js";
import { generateClaudecodeConfig } from "../generators/rules/claudecode.js";
import { generateClineConfig } from "../generators/rules/cline.js";
import { generateCopilotConfig } from "../generators/rules/copilot.js";
import { generateCursorConfig } from "../generators/rules/cursor.js";
import { generateGeminiConfig } from "../generators/rules/geminicli.js";
import { generateKiroConfig } from "../generators/rules/kiro.js";
import { generateRooConfig } from "../generators/rules/roo.js";
import { createOutputsArray } from "../generators/rules/shared-helpers.js";
import type { Config, GeneratedOutput, ParsedRule, ToolTarget } from "../types/index.js";
import { resolveTargets } from "../utils/index.js";

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
    console.warn(
      "⚠️  Warning: No files with 'root: true' found. This may result in incomplete configurations.",
    );
  }

  for (const tool of toolsToGenerate) {
    const relevantRules = filterRulesForTool(rules, tool, config);

    if (relevantRules.length === 0) {
      console.warn(`No rules found for tool: ${tool}`);
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
    return targets.includes(tool);
  });
}

async function generateForTool(
  tool: ToolTarget,
  rules: ParsedRule[],
  config: Config,
  baseDir?: string,
): Promise<GeneratedOutput[] | null> {
  switch (tool) {
    case "augmentcode":
      return await generateAugmentcodeConfig(rules, config, baseDir);
    case "copilot":
      return generateCopilotConfig(rules, config, baseDir);
    case "cursor":
      return generateCursorConfig(rules, config, baseDir);
    case "cline":
      return generateClineConfig(rules, config, baseDir);
    case "claudecode":
      return await generateClaudecodeConfig(rules, config, baseDir);
    case "roo":
      return generateRooConfig(rules, config, baseDir);
    case "geminicli":
      return generateGeminiConfig(rules, config, baseDir);
    case "kiro": {
      const kiroRulesOutputs = await generateKiroConfig(rules, config, baseDir);
      const kiroIgnoreOutputs = await generateKiroIgnoreFiles(rules, config, baseDir);
      return [...kiroRulesOutputs, ...kiroIgnoreOutputs];
    }
    default:
      console.warn(`Unknown tool: ${tool}`);
      return null;
  }
}
