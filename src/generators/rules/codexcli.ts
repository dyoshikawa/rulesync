import type { Config, GeneratedOutput, ParsedRule } from "../../types/index.js";
import { resolvePath } from "../../utils/file.js";
import { loadIgnorePatterns } from "../../utils/ignore.js";
import { generateRootMarkdownWithXmlDocs } from "../../utils/xml-document-generator.js";
import {
  type EnhancedRuleGeneratorConfig,
  generateComplexRules,
  generateIgnoreFile,
} from "./shared-helpers.js";

export async function generateCodexConfig(
  rules: ParsedRule[],
  config: Config,
  baseDir?: string,
): Promise<GeneratedOutput[]> {
  const outputs: GeneratedOutput[] = [];

  // Filter out empty rules
  const nonEmptyRules = rules.filter((rule) => rule.content.trim().length > 0);

  // If we have non-empty rules, generate configuration files
  if (nonEmptyRules.length > 0) {
    const generatorConfig: EnhancedRuleGeneratorConfig = {
      tool: "codexcli",
      fileExtension: ".md",
      ignoreFileName: ".codexignore",
      generateContent: generateCodexMemoryMarkdown,
      generateDetailContent: generateCodexMemoryMarkdown,
      generateRootContent: generateCodexRootMarkdown,
      rootFilePath: "AGENTS.md",
      detailSubDir: ".codex/memories",
    };

    const ruleOutputs = await generateComplexRules(nonEmptyRules, config, generatorConfig, baseDir);
    outputs.push(...ruleOutputs);
  } else {
    // Even if no rules, still generate ignore file if patterns exist
    const ignorePatterns = await loadIgnorePatterns(baseDir);
    if (ignorePatterns.patterns.length > 0) {
      const ignorePath = resolvePath(".codexignore", baseDir);
      const ignoreContent = generateIgnoreFile(ignorePatterns.patterns, "codexcli");

      outputs.push({
        tool: "codexcli",
        filepath: ignorePath,
        content: ignoreContent,
      });
    }
  }

  return outputs;
}

function generateCodexMemoryMarkdown(rule: ParsedRule): string {
  // Just return the content without description header and trim leading whitespace
  return rule.content.trim();
}

function generateCodexRootMarkdown(
  rootRule: ParsedRule | undefined,
  memoryRules: ParsedRule[],
  _baseDir?: string,
): string {
  return generateRootMarkdownWithXmlDocs(rootRule, memoryRules, {
    memorySubDir: ".codex/memories",
    fallbackTitle: "OpenAI Codex CLI Configuration",
  });
}
