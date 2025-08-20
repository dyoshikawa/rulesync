import type { Config, GeneratedOutput, ParsedRule } from "../../types/index.js";
import { resolvePath } from "../../utils/file.js";
import { loadIgnorePatterns } from "../../utils/ignore.js";
import { generateIgnoreFile } from "./shared-helpers.js";

export async function generateCodexConfig(
  rules: ParsedRule[],
  config: Config,
  baseDir?: string,
): Promise<GeneratedOutput[]> {
  const outputs: GeneratedOutput[] = [];

  // Filter out empty rules
  const nonEmptyRules = rules.filter((rule) => rule.content.trim().length > 0);

  // If we have non-empty rules, generate AGENTS.md file
  if (nonEmptyRules.length > 0) {
    const agentsPath = resolvePath("AGENTS.md", baseDir);
    const agentsContent = generateAgentsMarkdown(nonEmptyRules);

    outputs.push({
      tool: "codexcli",
      filepath: agentsPath,
      content: agentsContent,
    });
  }

  // Generate ignore file if patterns exist
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

  return outputs;
}

function generateAgentsMarkdown(rules: ParsedRule[]): string {
  const sections: string[] = [];

  // Add root rule first if present
  const rootRule = rules.find((rule) => rule.frontmatter.root);
  if (rootRule) {
    sections.push(rootRule.content.trim());
  }

  // Add detail rules
  const detailRules = rules.filter((rule) => !rule.frontmatter.root);
  for (const rule of detailRules) {
    if (rule.content.trim()) {
      sections.push(rule.content.trim());
    }
  }

  // Join sections with double newlines
  return sections.join("\n\n").trim();
}
