import type { Config, GeneratedOutput, ParsedRule } from "../../types/index.js";
import { generateIgnoreFile, ignoreConfigs } from "./shared-factory.js";

export async function generateAugmentCodeIgnoreFiles(
  rules: ParsedRule[],
  config: Config,
  baseDir?: string,
): Promise<GeneratedOutput[]> {
  return generateIgnoreFile(rules, config, ignoreConfigs.augmentcode, baseDir);
}
