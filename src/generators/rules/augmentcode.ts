import { join } from "node:path";
import type { Config, GeneratedOutput, ParsedRule } from "../../types/index.js";
import { addOutput, createOutputsArray } from "./shared-helpers.js";

export async function generateAugmentcodeConfig(
  rules: ParsedRule[],
  config: Config,
  baseDir?: string,
): Promise<GeneratedOutput[]> {
  const outputs = createOutputsArray();

  // Generate individual rule files in .augment/rules/
  rules.forEach((rule) => {
    addOutput(
      outputs,
      "augmentcode",
      config,
      baseDir,
      join(".augment", "rules", `${rule.filename}.md`),
      generateRuleFile(rule),
    );
  });

  return outputs;
}

function generateRuleFile(rule: ParsedRule): string {
  const lines: string[] = [];

  // Add YAML frontmatter for AugmentCode rules
  lines.push("---");

  // Determine rule type based on filename suffix or default to manual
  let ruleType = "manual";
  let description = rule.frontmatter.description;

  if (rule.filename.endsWith("-always")) {
    ruleType = "always";
    description = ""; // Always rules should have blank description
  } else if (rule.filename.endsWith("-auto")) {
    ruleType = "auto";
  }

  lines.push(`type: ${ruleType}`);
  lines.push(`description: "${description}"`);

  // Add tags if present
  if (
    rule.frontmatter.tags &&
    Array.isArray(rule.frontmatter.tags) &&
    rule.frontmatter.tags.length > 0
  ) {
    lines.push(`tags: [${rule.frontmatter.tags.map((tag) => `"${tag}"`).join(", ")}]`);
  }

  lines.push("---");
  lines.push("");
  lines.push(rule.content.trim());

  return lines.join("\n");
}
