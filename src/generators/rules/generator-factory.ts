import type { Config, GeneratedOutput, ParsedRule, ToolTarget } from "../../types/index.js";
import { generateFromRegistry } from "./generator-registry.js";

/**
 * Create a simple generator function for tools that use the registry pattern
 */
function createSimpleGenerator(toolName: ToolTarget) {
  return async function (
    rules: ParsedRule[],
    config: Config,
    baseDir?: string,
  ): Promise<GeneratedOutput[]> {
    return generateFromRegistry(toolName, rules, config, baseDir);
  };
}

// Pre-created simple generators for common tools
export const generateCursorConfig = createSimpleGenerator("cursor");
export const generateClineConfig = createSimpleGenerator("cline");
export const generateCopilotConfig = createSimpleGenerator("copilot");
export const generateWindsurfConfig = createSimpleGenerator("windsurf");
export const generateKiroConfig = createSimpleGenerator("kiro");
export const generateRooConfig = createSimpleGenerator("roo");
