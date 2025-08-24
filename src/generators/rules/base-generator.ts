import type { Config, GeneratedOutput, ParsedRule, ToolTarget } from "../../types/index.js";
import { generateRulesConfig, type UnifiedRuleGeneratorConfig } from "./shared-helpers.js";

export interface RuleGeneratorConfig {
  fileName: string;
  ignoreFileName?: string;
  generateContent: (rules: ParsedRule[]) => string;
  tool: ToolTarget;
}

/**
 * Base function for generating rule configurations
 * Now uses the unified generateRulesConfig function to eliminate duplication
 */
export async function generateBaseRulesConfig(
  rules: ParsedRule[],
  config: Config,
  generatorConfig: RuleGeneratorConfig,
  baseDir?: string,
): Promise<GeneratedOutput[]> {
  // Convert old config to new unified config
  const unifiedConfig: UnifiedRuleGeneratorConfig = {
    tool: generatorConfig.tool,
    fileName: generatorConfig.fileName,
    ...(generatorConfig.ignoreFileName ? { ignoreFileName: generatorConfig.ignoreFileName } : {}),
    singleFileMode: true,
    generateCombinedContent: generatorConfig.generateContent,
    generateContent: () => "", // Not used in single file mode
  };

  return generateRulesConfig(rules, config, unifiedConfig, baseDir);
}

/**
 * Common pattern for categorizing rules by type
 */
function categorizeRules(rules: ParsedRule[]) {
  return rules.reduce<{
    root: ParsedRule[];
    detail: ParsedRule[];
  }>(
    (acc, rule) => {
      if (rule.frontmatter.root) {
        acc.root.push(rule);
      } else {
        acc.detail.push(rule);
      }
      return acc;
    },
    { root: [], detail: [] },
  );
}

/**
 * Common pattern for generating markdown content
 */
export function generateMarkdownContent(rules: ParsedRule[]): string {
  const sections: string[] = [];
  const categorized = categorizeRules(rules);

  // Add root rule first if present
  if (categorized.root.length > 0) {
    sections.push(...categorized.root.map((rule) => rule.content.trim()));
  }

  // Add detail rules
  if (categorized.detail.length > 0) {
    sections.push(...categorized.detail.map((rule) => rule.content.trim()));
  }

  // Join sections with double newlines
  return sections.join("\n\n").trim();
}
