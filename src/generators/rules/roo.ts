import type { Config, GeneratedOutput, ParsedRule } from "../../types/index.js";
import { generateFromRegistry } from "./generator-registry.js";

export async function generateRooConfig(
  rules: ParsedRule[],
  config: Config,
  baseDir?: string,
): Promise<GeneratedOutput[]> {
  return generateFromRegistry("roo", rules, config, baseDir);
}
