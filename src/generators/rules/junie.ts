import type { Config, GeneratedOutput, ParsedRule } from "../../types/index.js";
import { type EnhancedRuleGeneratorConfig, generateComplexRules } from "./shared-helpers.js";

export async function generateJunieConfig(
  rules: ParsedRule[],
  config: Config,
  baseDir?: string,
): Promise<GeneratedOutput[]> {
  const generatorConfig: EnhancedRuleGeneratorConfig = {
    tool: "junie",
    fileExtension: ".md",
    ignoreFileName: ".aiignore",
    generateContent: (rule) => rule.content.trim(),
    generateRootContent: generateGuidelinesMarkdown,
    rootFilePath: ".junie/guidelines.md",
  };

  return generateComplexRules(rules, config, generatorConfig, baseDir);
}

function generateGuidelinesMarkdown(
  rootRule: ParsedRule | undefined,
  detailRules: ParsedRule[],
): string {
  const lines: string[] = [];

  // Add all rules content (both root and detail) into single guidelines.md
  // Root rule comes first
  if (rootRule) {
    lines.push(rootRule.content);
    lines.push("");
  }

  // Add detail rules
  if (detailRules.length > 0) {
    for (const rule of detailRules) {
      lines.push(rule.content);
      lines.push("");
    }
  }

  return lines.join("\n").trim();
}
