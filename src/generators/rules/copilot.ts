import type { Config, GeneratedOutput, ParsedRule } from "../../types/index.js";
import { generateFromRegistry } from "./generator-registry.js";

export async function generateCopilotConfig(
  rules: ParsedRule[],
  config: Config,
  baseDir?: string,
): Promise<GeneratedOutput[]> {
  return generateFromRegistry("copilot", rules, config, baseDir);
}
