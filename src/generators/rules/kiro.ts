import type { Config, GeneratedOutput, ParsedRule } from "../../types/index.js";
import { generateFromRegistry } from "./generator-registry.js";

export async function generateKiroConfig(
  rules: ParsedRule[],
  config: Config,
  baseDir?: string,
): Promise<GeneratedOutput[]> {
  return generateFromRegistry("kiro", rules, config, baseDir);
}
