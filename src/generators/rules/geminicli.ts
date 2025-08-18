import type { Config, GeneratedOutput, ParsedRule } from "../../types/index.js";
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
  const lines: string[] = [];

  // Start with CLAUDE.md style introduction if memory files exist
  if (memoryRules.length > 0) {
    lines.push(
      "Please also reference the following documents as needed. In this case, `@` stands for the project root directory.",
    );
    lines.push("");
    lines.push("| Document | Description | File Patterns |");
    lines.push("|----------|-------------|---------------|");

    for (const rule of memoryRules) {
      const relativePath = `@.gemini/memories/${rule.filename}.md`;
      const filePatterns =
        rule.frontmatter.globs.length > 0 ? rule.frontmatter.globs.join(", ") : "-";
      lines.push(`| ${relativePath} | ${rule.frontmatter.description} | ${filePatterns} |`);
    }
    lines.push("");
    lines.push("");
  }

  // Add root rule content if available
  if (rootRule) {
    lines.push(rootRule.content.trim());
  } else if (memoryRules.length === 0) {
    // Fallback if no rules are provided
    lines.push("# Gemini CLI Configuration");
    lines.push("");
    lines.push("No configuration rules have been defined yet.");
  }

  return lines.join("\n");
}
