import type { Config, GeneratedOutput, ParsedRule } from "../../types/index.js";
import { generateFromRegistry } from "./generator-registry.js";

export async function generateWindsurfConfig(
  rules: ParsedRule[],
  config: Config,
  baseDir?: string,
): Promise<GeneratedOutput[]> {
  return generateFromRegistry("windsurf", rules, config, baseDir);
}
