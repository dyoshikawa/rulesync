import type { Config, GeneratedOutput, ParsedRule } from "../../types/index.js";
import { generateRootMarkdownWithXmlDocs } from "../../utils/xml-document-generator.js";
import { type EnhancedRuleGeneratorConfig, generateComplexRules } from "./shared-helpers.js";

export async function generateGeminiConfig(
  rules: ParsedRule[],
  config: Config,
  baseDir?: string,
): Promise<GeneratedOutput[]> {
  const generatorConfig: EnhancedRuleGeneratorConfig = {
    tool: "geminicli",
    fileExtension: ".md",
    ignoreFileName: ".aiexclude",
    generateContent: generateGeminiMemoryMarkdown,
    generateDetailContent: generateGeminiMemoryMarkdown,
    generateRootContent: generateGeminiRootMarkdown,
    rootFilePath: "GEMINI.md",
    detailSubDir: ".gemini/memories",
  };

  return generateComplexRules(rules, config, generatorConfig, baseDir);
}

function generateGeminiMemoryMarkdown(rule: ParsedRule): string {
  // Just return the content without description header and trim leading whitespace
  return rule.content.trim();
}

function generateGeminiRootMarkdown(
  rootRule: ParsedRule | undefined,
  memoryRules: ParsedRule[],
  _baseDir?: string,
): string {
  return generateRootMarkdownWithXmlDocs(rootRule, memoryRules, {
    memorySubDir: ".gemini/memories",
    fallbackTitle: "Gemini CLI Configuration",
  });
}
