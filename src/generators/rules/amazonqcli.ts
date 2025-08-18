import type { Config, GeneratedOutput, ParsedRule } from "../../types/index.js";
import { type EnhancedRuleGeneratorConfig, generateComplexRules } from "./shared-helpers.js";

export async function generateAmazonqcliConfig(
  rules: ParsedRule[],
  config: Config,
  baseDir?: string,
): Promise<GeneratedOutput[]> {
  const generatorConfig: EnhancedRuleGeneratorConfig = {
    tool: "amazonqcli",
    fileExtension: ".md",
    generateContent: generateRuleFile,
    generateRootContent: generateMainRulesFile,
    rootFilePath: ".amazonq/rules/main.md",
    generateDetailContent: generateRuleFile,
    detailSubDir: ".amazonq/rules",
  };

  return generateComplexRules(rules, config, generatorConfig, baseDir);
}

function generateMainRulesFile(
  rootRule: ParsedRule | undefined,
  detailRules: ParsedRule[],
): string {
  const lines: string[] = [];

  // Add reference header for detail rules
  if (detailRules.length > 0) {
    lines.push("# Amazon Q Developer CLI Project Rules");
    lines.push("");
    lines.push("This file contains the main project rules. See also:");
    lines.push("");
    for (const rule of detailRules) {
      lines.push(`- ${rule.filename}.md: ${rule.frontmatter.description}`);
    }
    lines.push("");
  }

  // Add root rule content if available
  if (rootRule) {
    if (detailRules.length > 0) {
      lines.push("## Overview");
      lines.push("");
    }
    lines.push(rootRule.content);
    lines.push("");
  } else if (detailRules.length === 0) {
    // Fallback content if no rules are provided
    lines.push("# Amazon Q Developer CLI Project Rules");
    lines.push("");
    lines.push("This file contains project-specific rules and context for Amazon Q Developer CLI.");
    lines.push("");
    lines.push("## Development Standards");
    lines.push("");
    lines.push("Add your project-specific development standards here.");
    lines.push("");
  }

  return lines.join("\n").trim() + "\n";
}

function generateRuleFile(rule: ParsedRule): string {
  const lines: string[] = [];

  // Add title based on rule description or filename
  lines.push(`# ${rule.frontmatter.description || rule.filename}`);
  lines.push("");

  // Add rule content
  lines.push(rule.content.trim());
  lines.push("");

  return lines.join("\n");
}
