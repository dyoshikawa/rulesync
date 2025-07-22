import type { Config, GeneratedOutput, ParsedRule } from "../../types/index.js";
import { addOutput, createOutputsArray } from "./shared-helpers.js";

export async function generateAugmentcodeLegacyConfig(
  rules: ParsedRule[],
  config: Config,
  baseDir?: string,
): Promise<GeneratedOutput[]> {
  const outputs = createOutputsArray();

  // Generate single legacy .augment-guidelines file for all rules
  if (rules.length > 0) {
    addOutput(
      outputs,
      "augmentcode-legacy",
      config,
      baseDir,
      ".augment-guidelines",
      generateLegacyGuidelinesFile(rules),
    );
  }

  return outputs;
}

function generateLegacyGuidelinesFile(allRules: ParsedRule[]): string {
  const lines: string[] = [];

  for (const rule of allRules) {
    lines.push(rule.content.trim());
    lines.push(""); // Add empty line between rules
  }

  return lines.join("\n").trim();
}
