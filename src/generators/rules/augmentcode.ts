import { join } from "node:path";
import type { Config, GeneratedOutput, ParsedRule } from "../../types/index.js";

export async function generateAugmentcodeConfig(
  rules: ParsedRule[],
  config: Config,
  baseDir?: string,
): Promise<GeneratedOutput[]> {
  const outputs: GeneratedOutput[] = [];

  // Separate root and non-root rules
  const rootRules = rules.filter((r) => r.frontmatter.root === true);
  const detailRules = rules.filter((r) => r.frontmatter.root === false);

  // Generate .augment/rules/ directory files for non-root rules
  for (const rule of detailRules) {
    const ruleContent = generateRuleFile(rule);
    const augmentOutputDir = baseDir
      ? join(baseDir, config.outputPaths.augmentcode)
      : config.outputPaths.augmentcode;

    outputs.push({
      tool: "augmentcode",
      filepath: join(augmentOutputDir, ".augment", "rules", `${rule.filename}.md`),
      content: ruleContent,
    });
  }

  // Generate .augment-guidelines for root rules (legacy format)
  if (rootRules.length > 0) {
    const guidelinesContent = generateGuidelinesFile(rootRules);
    const augmentOutputDir = baseDir
      ? join(baseDir, config.outputPaths.augmentcode)
      : config.outputPaths.augmentcode;

    outputs.push({
      tool: "augmentcode",
      filepath: join(augmentOutputDir, ".augment-guidelines"),
      content: guidelinesContent,
    });
  }

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

function generateGuidelinesFile(rootRules: ParsedRule[]): string {
  const lines: string[] = [];

  for (const rule of rootRules) {
    lines.push(rule.content);
    lines.push("");
  }

  return lines.join("\n").trim();
}
