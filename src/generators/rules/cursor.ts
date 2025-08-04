import type { Config, GeneratedOutput, ParsedRule } from "../../types/index.js";
import { generateFromRegistry } from "./generator-registry.js";

export async function generateCursorConfig(
  rules: ParsedRule[],
  config: Config,
  baseDir?: string,
): Promise<GeneratedOutput[]> {
  return generateFromRegistry("cursor", rules, config, baseDir);
}
