import type { Config, GeneratedOutput, ParsedRule } from "../../types/index.js";
import { generateRulesConfig, type RuleGeneratorConfig } from "./shared-helpers.js";

export async function generateCodexConfig(
  rules: ParsedRule[],
  config: Config,
  baseDir?: string,
): Promise<GeneratedOutput[]> {
  const generatorConfig: RuleGeneratorConfig = {
    tool: "codexcli",
    fileExtension: ".md",
    ignoreFileName: ".codexignore",
    generateContent: generateCodexInstructionsMarkdown,
    pathResolver: (rule, outputDir) => {
      // For root rules, generate codex.md in the output directory
      if (rule.frontmatter.root === true) {
        return `${outputDir}/codex.md`;
      }
      // For non-root rules, generate <filename>.md in output directory
      return `${outputDir}/${rule.filename}.md`;
    },
  };

  return generateRulesConfig(rules, config, generatorConfig, baseDir);
}

function generateCodexInstructionsMarkdown(rule: ParsedRule): string {
  const lines: string[] = [];

  // For Codex CLI, we generate plain Markdown without frontmatter
  // Only include description as comment for non-root rules and when it's not the default
  if (
    rule.frontmatter.root === false &&
    rule.frontmatter.description &&
    rule.frontmatter.description !== "Main instructions" &&
    !rule.frontmatter.description.includes("Project-level Codex CLI instructions")
  ) {
    lines.push(`<!-- ${rule.frontmatter.description} -->`);
    if (rule.content.trim()) {
      lines.push("");
    }
  }

  // Add the content directly - Codex CLI expects plain Markdown
  const content = rule.content.trim();
  if (content) {
    lines.push(content);
  }

  return lines.join("\n");
}
