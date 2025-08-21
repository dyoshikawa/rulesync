import type { Config, GeneratedOutput, ParsedRule, ToolTarget } from "../../types/index.js";
import { resolvePath } from "../../utils/file.js";
import { loadIgnorePatterns } from "../../utils/ignore.js";
import { generateIgnoreFile } from "./shared-helpers.js";

export interface RuleGeneratorConfig {
  fileName: string;
  ignoreFileName?: string;
  generateContent: (rules: ParsedRule[]) => string;
  tool: ToolTarget;
}

/**
 * Base function for generating rule configurations
 * Eliminates duplication between similar generators
 */
export async function generateBaseRulesConfig(
  rules: ParsedRule[],
  config: Config,
  generatorConfig: RuleGeneratorConfig,
  baseDir?: string,
): Promise<GeneratedOutput[]> {
  const outputs: GeneratedOutput[] = [];

  // Filter out empty rules
  const nonEmptyRules = rules.filter((rule) => rule.content.trim().length > 0);

  // If we have non-empty rules, generate main rules file
  if (nonEmptyRules.length > 0) {
    const rulesPath = resolvePath(generatorConfig.fileName, baseDir);
    const rulesContent = generatorConfig.generateContent(nonEmptyRules);

    outputs.push({
      tool: generatorConfig.tool,
      filepath: rulesPath,
      content: rulesContent,
    });
  }

  // Generate ignore file if configured and patterns exist
  if (generatorConfig.ignoreFileName) {
    const ignorePatterns = await loadIgnorePatterns(baseDir);
    if (ignorePatterns.patterns.length > 0) {
      const ignorePath = resolvePath(generatorConfig.ignoreFileName, baseDir);
      const ignoreContent = generateIgnoreFile(ignorePatterns.patterns, generatorConfig.tool);

      outputs.push({
        tool: generatorConfig.tool,
        filepath: ignorePath,
        content: ignoreContent,
      });
    }
  }

  return outputs;
}

/**
 * Common pattern for categorizing rules by type
 */
export function categorizeRules(rules: ParsedRule[]) {
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
