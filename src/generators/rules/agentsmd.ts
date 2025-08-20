import type { Config, GeneratedOutput, ParsedRule } from "../../types/index.js";
import { resolvePath } from "../../utils/file.js";

export async function generateAgentsMdConfig(
  rules: ParsedRule[],
  config: Config,
  baseDir?: string,
): Promise<GeneratedOutput[]> {
  const outputs: GeneratedOutput[] = [];

  // Filter out empty rules
  const nonEmptyRules = rules.filter((rule) => rule.content.trim().length > 0);

  if (nonEmptyRules.length > 0) {
    // Find root rule and detail rules
    const rootRule = nonEmptyRules.find((rule) => rule.frontmatter.root);
    const detailRules = nonEmptyRules.filter((rule) => !rule.frontmatter.root);

    // Generate AGENTS.md file (for root rule only)
    if (rootRule) {
      const agentsPath = resolvePath("AGENTS.md", baseDir);
      const agentsContent = generateAgentsMarkdown(rootRule);

      outputs.push({
        tool: "agentsmd",
        filepath: agentsPath,
        content: agentsContent,
      });
    }

    // Generate detail rule files in .agents/memories directory
    for (const rule of detailRules) {
      const memoryPath = resolvePath(`.agents/memories/${rule.filename}.md`, baseDir);
      const memoryContent = generateMemoryMarkdown(rule);

      outputs.push({
        tool: "agentsmd",
        filepath: memoryPath,
        content: memoryContent,
      });
    }
  }

  return outputs;
}

function generateAgentsMarkdown(rootRule: ParsedRule): string {
  return rootRule.content.trim();
}

function generateMemoryMarkdown(rule: ParsedRule): string {
  return rule.content.trim();
}
