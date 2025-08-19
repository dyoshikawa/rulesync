import type { Config, GeneratedOutput, ParsedRule } from "../../types/index.js";
import { generateRootMarkdownWithXmlDocs } from "../../utils/xml-document-generator.js";
import { type EnhancedRuleGeneratorConfig, generateComplexRules } from "./shared-helpers.js";

export async function generateQwencodeConfig(
  rules: ParsedRule[],
  config: Config,
  baseDir?: string,
): Promise<GeneratedOutput[]> {
  const generatorConfig: EnhancedRuleGeneratorConfig = {
    tool: "qwencode",
    fileExtension: ".md",
    // ignoreFileName omitted - Qwen Code uses git-aware filtering instead of dedicated ignore files
    generateContent: generateQwenMemoryMarkdown,
    generateDetailContent: generateQwenMemoryMarkdown,
    generateRootContent: generateQwenRootMarkdown,
    rootFilePath: "QWEN.md",
    detailSubDir: ".qwen/memories",
  };

  return generateComplexRules(rules, config, generatorConfig, baseDir);
}

function generateQwenMemoryMarkdown(rule: ParsedRule): string {
  // Just return the content without description header and trim leading whitespace
  return rule.content.trim();
}

function generateQwenRootMarkdown(
  rootRule: ParsedRule | undefined,
  memoryRules: ParsedRule[],
  _baseDir?: string,
): string {
  return generateRootMarkdownWithXmlDocs(rootRule, memoryRules, {
    memorySubDir: ".qwen/memories",
    fallbackTitle: "Qwen Code Configuration",
  });
}
