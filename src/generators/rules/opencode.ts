import type { Config, GeneratedOutput, ParsedRule } from "../../types/index.js";
import { generateRootMarkdownWithXmlDocs } from "../../utils/xml-document-generator.js";
import { type EnhancedRuleGeneratorConfig, generateComplexRules } from "./shared-helpers.js";

export async function generateOpenCodeConfig(
  rules: ParsedRule[],
  config: Config,
  baseDir?: string,
): Promise<GeneratedOutput[]> {
  const generatorConfig: EnhancedRuleGeneratorConfig = {
    tool: "opencode",
    fileExtension: ".md",
    // ignoreFileName omitted - OpenCode doesn't use dedicated ignore files
    generateContent: (rule) => rule.content.trim(),
    generateDetailContent: (rule) => rule.content.trim(),
    generateRootContent: (rootRule, memoryRules) =>
      generateRootMarkdownWithXmlDocs(rootRule, memoryRules, {
        memorySubDir: ".opencode/memories",
        fallbackTitle: "OpenCode Configuration",
      }),
    rootFilePath: "AGENTS.md",
    detailSubDir: ".opencode/memories",
  };

  return generateComplexRules(rules, config, generatorConfig, baseDir);
}
