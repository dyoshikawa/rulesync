import type { Config, GeneratedOutput, ParsedRule } from "../../types/index.js";
import { generateIgnoreFile, ignoreConfigs } from "./shared-factory.js";

/**
 * Generate Windsurf ignore file (.codeiumignore)
 *
 * @param rules - Parsed rules from AI rule files
 * @param config - Global configuration
 * @param baseDir - Optional base directory for output (defaults to cwd)
 * @returns Array of generated output files
 */
export function generateWindsurfIgnore(
  rules: ParsedRule[],
  config: Config,
  baseDir?: string,
): GeneratedOutput[] {
  return generateIgnoreFile(rules, config, ignoreConfigs.windsurf, baseDir);
}
