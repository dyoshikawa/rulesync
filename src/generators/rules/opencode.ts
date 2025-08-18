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
    generateContent: generateOpenCodeMarkdown,
    generateDetailContent: generateOpenCodeMarkdown,
    generateRootContent: generateOpenCodeRootMarkdown,
    rootFilePath: "AGENTS.md",
    detailSubDir: ".opencode/memories",
  };

  return generateComplexRules(rules, config, generatorConfig, baseDir);
}

function generateOpenCodeMarkdown(rule: ParsedRule): string {
  // Just return the content without description header and trim leading whitespace
  return rule.content.trim();
}

function generateOpenCodeRootMarkdown(
  rootRule: ParsedRule | undefined,
  memoryRules: ParsedRule[],
  _baseDir?: string,
): string {
  return generateRootMarkdownWithXmlDocs(rootRule, memoryRules, {
    memorySubDir: ".opencode/memories",
    fallbackTitle: "OpenCode Configuration",
  });
}
