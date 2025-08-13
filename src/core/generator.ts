import { generateAugmentCodeIgnoreFiles } from "../generators/ignore/augmentcode.js";
import { generateJunieIgnoreFiles } from "../generators/ignore/junie.js";
import { generateKiroIgnoreFiles } from "../generators/ignore/kiro.js";
import { generateWindsurfIgnore } from "../generators/ignore/windsurf.js";
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
import { generateRooConfig } from "../generators/rules/roo.js";
import { createOutputsArray } from "../generators/rules/shared-helpers.js";
import { generateWindsurfConfig } from "../generators/rules/windsurf.js";
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
  switch (tool) {
    case "augmentcode": {
      const augmentRulesOutputs = await generateAugmentcodeConfig(rules, config, baseDir);
      const augmentIgnoreOutputs = await generateAugmentCodeIgnoreFiles(rules, config, baseDir);
      return [...augmentRulesOutputs, ...augmentIgnoreOutputs];
    }
    case "augmentcode-legacy": {
      const augmentLegacyRulesOutputs = await generateAugmentcodeLegacyConfig(
        rules,
        config,
        baseDir,
      );
      const augmentIgnoreOutputs = await generateAugmentCodeIgnoreFiles(rules, config, baseDir);
      return [...augmentLegacyRulesOutputs, ...augmentIgnoreOutputs];
    }
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
    case "junie": {
      const junieRulesOutputs = await generateJunieConfig(rules, config, baseDir);
      const junieIgnoreOutputs = await generateJunieIgnoreFiles(rules, config, baseDir);
      return [...junieRulesOutputs, ...junieIgnoreOutputs];
    }
    case "kiro": {
      const kiroRulesOutputs = await generateKiroConfig(rules, config, baseDir);
      const kiroIgnoreOutputs = await generateKiroIgnoreFiles(rules, config, baseDir);
      return [...kiroRulesOutputs, ...kiroIgnoreOutputs];
    }
    case "windsurf": {
      const windsurfRulesOutputs = await generateWindsurfConfig(rules, config, baseDir);
      const windsurfIgnoreOutputs = await generateWindsurfIgnore(rules, config, baseDir);
      return [...windsurfRulesOutputs, ...windsurfIgnoreOutputs];
    }
    default:
      console.warn(`Unknown tool: ${tool}`);
      return null;
  }
}
