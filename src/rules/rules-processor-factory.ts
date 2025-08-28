import type { ToolTarget } from "../types/index.js";
import { logger } from "../utils/logger.js";
import { RulesProcessor, type RulesProcessorToolTarget } from "./rules-processor.js";

/**
 * Cache for RulesProcessor instances
 */
const processorCache = new Map<string, RulesProcessor>();

/**
 * Map legacy ToolTarget to RulesProcessorToolTarget
 */
function mapToolTargetToRulesProcessorTarget(tool: ToolTarget): RulesProcessorToolTarget | null {
  const mappings: Record<ToolTarget, RulesProcessorToolTarget | null> = {
    agentsmd: "agentsmd",
    amazonqcli: "amazonqcli",
    augmentcode: "augmentcode",
    "augmentcode-legacy": "augmentcode-legacy",
    claudecode: "claudecode",
    cline: "cline",
    codexcli: "codexcli",
    copilot: "copilot",
    cursor: "cursor",
    geminicli: "geminicli",
    junie: "junie",
    kiro: "kiro",
    opencode: "opencode",
    qwencode: "qwencode",
    roo: "roo",
    windsurf: "windsurf",
  };

  return mappings[tool] || null;
}

/**
 * Create or get a cached RulesProcessor instance for the specified tool and base directory
 */
export function getRulesProcessor(tool: ToolTarget, baseDir: string): RulesProcessor | null {
  const cacheKey = `${tool}-${baseDir}`;

  const cachedProcessor = processorCache.get(cacheKey);
  if (cachedProcessor) {
    return cachedProcessor;
  }

  // Map ToolTarget to RulesProcessorToolTarget
  const rulesProcessorToolTarget = mapToolTargetToRulesProcessorTarget(tool);

  if (!rulesProcessorToolTarget) {
    logger.warn(`No RulesProcessor mapping found for tool: ${tool}`);
    return null;
  }

  try {
    const processor = new RulesProcessor({
      baseDir,
      toolTarget: rulesProcessorToolTarget,
    });

    processorCache.set(cacheKey, processor);
    logger.debug(`Created RulesProcessor for tool: ${tool}, baseDir: ${baseDir}`);

    return processor;
  } catch (error) {
    logger.error(`Failed to create RulesProcessor for tool ${tool}:`, error);
    return null;
  }
}

/**
 * Clear the processor cache
 */
export function clearRulesProcessorCache(): void {
  processorCache.clear();
}

/**
 * Check if a tool is supported by the RulesProcessor
 */
export function isToolSupportedByRulesProcessor(tool: ToolTarget): boolean {
  return mapToolTargetToRulesProcessorTarget(tool) !== null;
}

/**
 * Get all supported tools
 */
export function getSupportedRulesProcessorTools(): ToolTarget[] {
  const allTools: ToolTarget[] = [
    "agentsmd",
    "amazonqcli",
    "augmentcode",
    "augmentcode-legacy",
    "claudecode",
    "cline",
    "codexcli",
    "copilot",
    "cursor",
    "geminicli",
    "junie",
    "kiro",
    "opencode",
    "qwencode",
    "roo",
    "windsurf",
  ];

  return allTools.filter((tool) => isToolSupportedByRulesProcessor(tool));
}
